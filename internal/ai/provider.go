package ai

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

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
				Text: fmt.Sprintf("<file name=%q media=%s>\n%s\n</file>", a.Filename, a.MediaType, string(a.Data)),
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

// ChatRequest is the input for a chat completion.
type ChatRequest struct {
	Model     string        `json:"model"`
	Messages  []ChatMessage `json:"messages"`
	System    string        `json:"system,omitempty"`
	MaxTokens int           `json:"maxTokens,omitempty"`
	Timeout   time.Duration `json:"timeout,omitempty"`
}

// ProviderOptions are passed to goai on every Chat/ChatStream call.
// Shared by OpenAIProvider, used for provider-specific behavior toggles.
type ProviderOptions struct {
	UseResponsesAPI  *bool          `json:"useResponsesAPI,omitempty"`
	StrictJSONSchema *bool          `json:"strictJsonSchema,omitempty"`
	VeniceParams     map[string]any `json:"venice_parameters,omitempty"`
}
