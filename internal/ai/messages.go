package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/cloudwego/eino/schema"
)

// extraFilePartsKey carries wire-file parts (binary attachments) on user
// schema messages for the OpenAI payload modifier. eino's OpenAI converter
// has no file-part mapping, so these attachments ride on the message Extra
// and are injected into the serialized payload as chat-completions content
// items, mirroring the previous engine: PDFs become "file" parts, audio
// becomes "input_audio", anything else is omitted (inlining raw base64 as
// text would only feed the model garbage).
const extraFilePartsKey = "keryx.wire_file_parts"

// wireFilePart is a binary attachment staged for payload injection.
type wireFilePart struct {
	Name      string `json:"name"`
	MediaType string `json:"media_type"`
	DataURL   string `json:"data_url"`
	Base64    string `json:"base64"`
}

// buildSchemaMessages converts a ChatRequest into eino schema messages.
// When inlineFileParts is true (native file support, e.g. Gemini), binary
// attachments become file/audio parts; otherwise they are stashed under
// extraFilePartsKey for injectFileParts to merge into the OpenAI payload.
func buildSchemaMessages(req ChatRequest, inlineFileParts bool) []*schema.Message {
	var msgs []*schema.Message
	if s := strings.TrimSpace(req.System); s != "" {
		msgs = append(msgs, schema.SystemMessage(s))
	}
	for _, m := range req.Messages {
		switch m.Role {
		case "assistant":
			if strings.TrimSpace(m.Content) == "" {
				continue
			}
			msgs = append(msgs, schema.AssistantMessage(m.Content, nil))
		case "user":
			msg := userSchemaMessage(m, inlineFileParts)
			if msg == nil {
				continue
			}
			msgs = append(msgs, msg)
		}
	}
	return msgs
}

// userSchemaMessage converts one user message into a schema message with
// multimodal input parts. Text-like content and document Markdown
// conversions travel as labeled text blocks so any provider can read them;
// images travel as image parts; other binaries become file/audio parts
// (inlineFileParts) or staged wire-file parts. Returns nil when the message
// has no representable content.
func userSchemaMessage(m ChatMessage, inlineFileParts bool) *schema.Message {
	var parts []schema.MessageInputPart
	var files []wireFilePart
	addText := func(text string) {
		parts = append(parts, schema.MessageInputPart{Type: schema.ChatMessagePartTypeText, Text: text})
	}

	if m.Content != "" {
		addText(m.Content)
	}
	for _, a := range m.Attachments {
		if a.Markdown != "" {
			addText(formatFileBlock(a.Filename, "text/markdown", a.Markdown))
			continue
		}
		if len(a.Data) == 0 {
			continue
		}
		if isTextMedia(a.MediaType) {
			addText(formatFileBlock(a.Filename, a.MediaType, string(a.Data)))
			continue
		}
		b64 := base64.StdEncoding.EncodeToString(a.Data)
		if strings.HasPrefix(a.MediaType, "image/") {
			dataURL := "data:" + a.MediaType + ";base64," + b64
			parts = append(parts, schema.MessageInputPart{
				Type: schema.ChatMessagePartTypeImageURL,
				Image: &schema.MessageInputImage{
					MessagePartCommon: schema.MessagePartCommon{URL: &dataURL},
				},
			})
			continue
		}
		if inlineFileParts {
			common := schema.MessagePartCommon{Base64Data: &b64, MIMEType: a.MediaType}
			if strings.HasPrefix(a.MediaType, "audio/") {
				parts = append(parts, schema.MessageInputPart{
					Type:  schema.ChatMessagePartTypeAudioURL,
					Audio: &schema.MessageInputAudio{MessagePartCommon: common},
				})
			} else {
				parts = append(parts, schema.MessageInputPart{
					Type: schema.ChatMessagePartTypeFileURL,
					File: &schema.MessageInputFile{MessagePartCommon: common, Name: a.Filename},
				})
			}
			continue
		}
		files = append(files, wireFilePart{
			Name:      a.Filename,
			MediaType: a.MediaType,
			DataURL:   "data:" + a.MediaType + ";base64," + b64,
			Base64:    b64,
		})
	}

	if len(parts) == 0 && len(files) == 0 {
		return nil
	}
	msg := schema.UserMessage("")
	msg.UserInputMultiContent = parts
	if len(files) > 0 {
		msg.Extra = map[string]any{extraFilePartsKey: files}
	}
	return msg
}

// hasWireFileParts reports whether any user message carries binary
// attachments that need OpenAI payload injection.
func hasWireFileParts(req ChatRequest) bool {
	for _, m := range req.Messages {
		if m.Role != "user" {
			continue
		}
		for _, a := range m.Attachments {
			if a.Markdown == "" && len(a.Data) > 0 &&
				!isTextMedia(a.MediaType) && !strings.HasPrefix(a.MediaType, "image/") {
				return true
			}
		}
	}
	return false
}

// openAIAudioFormats maps audio media types to the inline audio formats
// chat-completions accepts; anything absent has no wire representation.
var openAIAudioFormats = map[string]string{
	"audio/flac": "flac",
	"audio/mp3":  "mp3",
	"audio/mp4":  "mp4",
	"audio/mpeg": "mp3",
	"audio/mpga": "mpga",
	"audio/m4a":  "m4a",
	"audio/ogg":  "ogg",
	"audio/wav":  "wav",
	"audio/webm": "webm",
}

// injectFileParts merges wire-file parts staged on the schema messages into
// the serialized chat-completions payload. The n-th schema message maps 1:1
// to the n-th payload message (eino's converter preserves order and count);
// when that no longer holds, the payload is passed through untouched rather
// than corrupted.
func injectFileParts(_ context.Context, msgs []*schema.Message, rawBody []byte) ([]byte, error) {
	var body map[string]json.RawMessage
	if err := json.Unmarshal(rawBody, &body); err != nil {
		return nil, err
	}
	var rawMsgs []json.RawMessage
	if raw := body["messages"]; len(raw) > 0 {
		if err := json.Unmarshal(raw, &rawMsgs); err != nil {
			return nil, err
		}
	}
	if len(rawMsgs) != len(msgs) {
		return rawBody, nil
	}

	changed := false
	for i, msg := range msgs {
		var files []wireFilePart
		if msg.Extra != nil {
			files, _ = msg.Extra[extraFilePartsKey].([]wireFilePart)
		}
		if len(files) == 0 {
			continue
		}
		items := openAIFileItems(files)
		if len(items) == 0 {
			continue
		}
		var msgObj map[string]any
		if err := json.Unmarshal(rawMsgs[i], &msgObj); err != nil {
			return nil, err
		}
		var arr []any
		switch c := msgObj["content"].(type) {
		case string:
			if c != "" {
				arr = append(arr, map[string]any{"type": "text", "text": c})
			}
		case []any:
			arr = c
		}
		arr = append(arr, items...)
		msgObj["content"] = arr
		updated, err := json.Marshal(msgObj)
		if err != nil {
			return nil, err
		}
		rawMsgs[i] = updated
		changed = true
	}
	if !changed {
		return rawBody, nil
	}

	msgsJSON, err := json.Marshal(rawMsgs)
	if err != nil {
		return nil, err
	}
	body["messages"] = msgsJSON
	return json.Marshal(body)
}

// openAIFileItems converts staged wire-file parts into chat-completions
// content items: PDFs become "file" parts, audio becomes "input_audio",
// anything else is omitted (no wire representation).
func openAIFileItems(files []wireFilePart) []any {
	var out []any
	for _, f := range files {
		switch {
		case f.MediaType == "application/pdf":
			out = append(out, map[string]any{
				"type": "file",
				"file": map[string]any{"filename": f.Name, "file_data": f.DataURL},
			})
		default:
			if format, ok := openAIAudioFormats[f.MediaType]; ok {
				out = append(out, map[string]any{
					"type":        "input_audio",
					"input_audio": map[string]any{"data": f.Base64, "format": format},
				})
			}
		}
	}
	return out
}
