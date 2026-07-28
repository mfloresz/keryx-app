package ai

import (
	"context"
	"time"
)

// Provider is the interface for AI model providers.
type Provider interface {
	// Chat sends a chat completion request and returns the full response text.
	Chat(ctx context.Context, req ChatRequest) (string, error)
	// ChatStream sends a chat completion request and streams the response tokens.
	// The onChunk callback is called for each text chunk received.
	// Returns the full combined text.
	ChatStream(ctx context.Context, req ChatRequest, onChunk func(string)) (string, error)
	// GenerateTitle generates a concise title for a chat based on a user message.
	GenerateTitle(ctx context.Context, userMessage string) (string, error)
}

// ChatMessage represents a single message in a chat conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest is the input for a chat completion.
type ChatRequest struct {
	Model     string        `json:"model"`
	Messages  []ChatMessage `json:"messages"`
	System    string        `json:"system,omitempty"`
	MaxTokens int           `json:"maxTokens,omitempty"`
	Timeout   time.Duration `json:"timeout,omitempty"`
}
