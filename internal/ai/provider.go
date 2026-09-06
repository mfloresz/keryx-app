package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/zendev-sh/goai/provider"
)

// Provider is the interface for AI model providers.
type Provider interface {
	// Chat sends a chat completion request and returns the full response text.
	Chat(ctx context.Context, req ChatRequest) (string, error)
	// ChatStream sends a chat completion request and streams the response chunks.
	// The onChunk callback is called for each chunk (text or reasoning) received.
	// Returns the full combined text and reasoning.
	ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (ChatStreamResult, error)
	// GenerateTitle generates a concise title for a chat based on a user message and language.
	// The systemPrompt provides the instructions for title generation.
	GenerateTitle(ctx context.Context, systemPrompt string, userMessage string, language string) (string, error)
}

// StreamChunkKind identifies the kind of a streamed chunk.
type StreamChunkKind string

const (
	StreamChunkText      StreamChunkKind = "text"
	StreamChunkReasoning StreamChunkKind = "reasoning"
)

// StreamChunk is a single streamed unit emitted during ChatStream.
type StreamChunk struct {
	Kind StreamChunkKind
	Text string
}

// ChatStreamResult is the accumulated output of a ChatStream call.
type ChatStreamResult struct {
	Text      string
	Reasoning string
}

// ChatMessage represents a single message in a chat conversation.
type ChatMessage struct {
	Role        string           `json:"role"`
	Content     string           `json:"content"`
	Attachments []ChatAttachment `json:"attachments,omitempty"`
}

// ChatAttachment is a file attached to a message, already resolved to bytes.
type ChatAttachment struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	MediaType string `json:"mediaType"`
	Data      []byte `json:"-"`
}

// TextAttachmentBudget caps the total characters of text attachments inlined
// into a title prompt (~2000 tokens at ~4 chars/token).
const TextAttachmentBudget = 8000

// formatFileBlock renders a text attachment as a labeled file block for prompts.
func formatFileBlock(filename, mediaType, text string) string {
	return fmt.Sprintf("<file name=%q media=%s>\n%s\n</file>", filename, mediaType, text)
}

// TitleUserMessage builds the user message for title generation: the message
// text plus text attachments inlined as file blocks under a shared character
// budget (each file truncated line-safely with a marker). Non-text attachments
// are skipped.
func TitleUserMessage(m ChatMessage, maxAttachmentChars int) string {
	var b strings.Builder
	b.WriteString(m.Content)
	remaining := maxAttachmentChars
	for _, a := range m.Attachments {
		if remaining <= 0 || len(a.Data) == 0 || !isTextMedia(a.MediaType) {
			continue
		}
		text := string(a.Data)
		n := utf8.RuneCountInString(text)
		if n > remaining {
			text = TruncateText(text, remaining)
			n = remaining
		}
		remaining -= n
		b.WriteString("\n\n" + formatFileBlock(a.Filename, a.MediaType, text))
	}
	return b.String()
}

// TruncateText cuts s to at most maxChars runes, preferring a line boundary
// (as long as it keeps at least half the budget), and appends a marker.
func TruncateText(s string, maxChars int) string {
	cut := -1
	runes := 0
	for i := range s {
		if runes == maxChars {
			cut = i
			break
		}
		runes++
	}
	if cut < 0 {
		return s
	}
	if nl := strings.LastIndexByte(s[:cut], '\n'); nl > cut/2 {
		cut = nl + 1
	}
	return s[:cut] + "\n…[truncated]"
}

// messageParts converts a ChatMessage into goai provider parts.
// Text-like attachments are inlined as labeled text; images go as image parts;
// other binaries go as file parts with a data URL.
func messageParts(m ChatMessage) []provider.Part {
	var parts []provider.Part
	if m.Content != "" {
		parts = append(parts, provider.Part{Type: provider.PartText, Text: m.Content})
	}
	for _, a := range m.Attachments {
		if len(a.Data) == 0 {
			continue
		}
		if isTextMedia(a.MediaType) {
			parts = append(parts, provider.Part{
				Type: provider.PartText,
				Text: formatFileBlock(a.Filename, a.MediaType, string(a.Data)),
			})
			continue
		}
		dataURL := "data:" + a.MediaType + ";base64," + base64.StdEncoding.EncodeToString(a.Data)
		if strings.HasPrefix(a.MediaType, "image/") {
			parts = append(parts, provider.Part{Type: provider.PartImage, URL: dataURL})
		} else {
			parts = append(parts, provider.Part{Type: provider.PartFile, URL: dataURL, Filename: a.Filename, MediaType: a.MediaType})
		}
	}
	return parts
}

func isTextMedia(mediaType string) bool {
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/json", "application/xml", "application/javascript",
		"application/typescript", "application/x-sh", "application/yaml",
		"image/svg+xml":
		return true
	}
	return false
}

// ToolDefinition defines a tool/function that the model can call.
type ToolDefinition struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// InputSchema is the JSON Schema for the tool's parameters.
	InputSchema string `json:"inputSchema"`
}

// ToolExecFunc executes a tool with the given name and JSON input, returning the result text.
type ToolExecFunc func(ctx context.Context, toolName string, input json.RawMessage) (string, error)

// ChatRequest is the input for a chat completion.
type ChatRequest struct {
	Model     string        `json:"model"`
	Messages  []ChatMessage `json:"messages"`
	System    string        `json:"system,omitempty"`
	MaxTokens int           `json:"maxTokens,omitempty"`
	Timeout   time.Duration `json:"timeout,omitempty"`
	// Tools is an optional list of tool definitions for function calling.
	Tools []ToolDefinition `json:"tools,omitempty"`
	// ToolExec is the function that executes a tool by name when the model calls it.
	// If nil, tools are defined to the model but execution falls back to the
	// provider's default behaviour (e.g. OpenRouter server-side tools).
	ToolExec ToolExecFunc `json:"-"`
}

// ProviderOptions are passed to goai on every Chat/ChatStream call.
// Shared by OpenAIProvider, used for provider-specific behavior toggles.
type ProviderOptions struct {
	UseResponsesAPI  *bool          `json:"useResponsesAPI,omitempty"`
	StrictJSONSchema *bool          `json:"strictJsonSchema,omitempty"`
	VeniceParams     map[string]any `json:"venice_parameters,omitempty"`
}
