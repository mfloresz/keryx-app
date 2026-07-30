package ai

import (
	"context"
	"fmt"
	"maps"
	"strings"
	"time"

	"github.com/zendev-sh/goai"
	"github.com/zendev-sh/goai/provider"
	"github.com/zendev-sh/goai/provider/openai"
)

// OpenAIProvider implements Provider for OpenAI-compatible APIs using goai.
type OpenAIProvider struct {
	APIKey  string
	BaseURL string
	Model   string
	Timeout time.Duration
	// ProviderOptions are passed to goai on every call. Use for provider-specific
	// behavior toggles like forcing Chat Completions (e.g. Venice).
	ProviderOptions map[string]any
	// GoAIOptions are the static provider options from the registry (GoAIOptions).
	GoAIOptions map[string]any
}

func (p *OpenAIProvider) model() (provider.LanguageModel, error) {
	if p == nil || p.APIKey == "" {
		return nil, fmt.Errorf("openai-compatible provider not configured: missing API key")
	}
	opts := []openai.Option{openai.WithAPIKey(p.APIKey)}
	if p.BaseURL != "" {
		opts = append(opts, openai.WithBaseURL(p.BaseURL))
	}
	modelID := p.Model
	return openai.Chat(modelID, opts...), nil
}

// mergedOptions merges static GoAIOptions with per-call ProviderOptions.
// For Chat/ChatStream (text generation), strictJsonSchema is excluded.
func (p *OpenAIProvider) mergedOptions() map[string]any {
	out := make(map[string]any)
	if p.GoAIOptions != nil {
		maps.Copy(out, p.GoAIOptions)
	}
	if p.ProviderOptions != nil {
		maps.Copy(out, p.ProviderOptions)
	}
	// DeepSeek models don't support structured outputs
	if strings.Contains(p.Model, "deepseek") {
		out["structuredOutputs"] = false
	}
	// For text generation, strictJsonSchema is not needed
	delete(out, "strictJsonSchema")
	return out
}

func (p *OpenAIProvider) goaiOpts(req ChatRequest) []goai.Option {
	var o []goai.Option

	if req.System != "" {
		o = append(o, goai.WithSystem(req.System))
	}

	if len(req.Messages) > 0 {
		msgs := make([]provider.Message, 0, len(req.Messages))
		for _, m := range req.Messages {
			parts := messageParts(m)
			if len(parts) == 0 {
				continue
			}
			msgs = append(msgs, provider.Message{
				Role:    provider.Role(m.Role),
				Content: parts,
			})
		}
		o = append(o, goai.WithMessages(msgs...))
	}

	if req.MaxTokens > 0 {
		o = append(o, goai.WithMaxOutputTokens(req.MaxTokens))
	}

	timeout := p.Timeout
	if req.Timeout > 0 {
		timeout = req.Timeout
	}
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	o = append(o, goai.WithTimeout(timeout))

	// Provider-specific options
	opts := p.mergedOptions()
	if len(opts) > 0 {
		o = append(o, goai.WithProviderOptions(opts))
	}

	return o
}

func (p *OpenAIProvider) Chat(ctx context.Context, req ChatRequest) (string, error) {
	model, err := p.model()
	if err != nil {
		return "", err
	}

	// Override model from request if provided
	if req.Model != "" {
		opts := []openai.Option{openai.WithAPIKey(p.APIKey)}
		if p.BaseURL != "" {
			opts = append(opts, openai.WithBaseURL(p.BaseURL))
		}
		model = openai.Chat(req.Model, opts...)
	}

	result, err := goai.GenerateText(ctx, model, p.goaiOpts(req)...)
	if err != nil {
		return "", fmt.Errorf("chat completion: %w", err)
	}
	return strings.TrimSpace(result.Text), nil
}

func (p *OpenAIProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (ChatStreamResult, error) {
	var result ChatStreamResult

	model, err := p.model()
	if err != nil {
		return result, err
	}

	// Override model from request if provided
	if req.Model != "" {
		opts := []openai.Option{openai.WithAPIKey(p.APIKey)}
		if p.BaseURL != "" {
			opts = append(opts, openai.WithBaseURL(p.BaseURL))
		}
		model = openai.Chat(req.Model, opts...)
	}

	stream, err := goai.StreamText(ctx, model, p.goaiOpts(req)...)
	if err != nil {
		return result, fmt.Errorf("chat stream: %w", err)
	}

	var text strings.Builder
	var reasoning strings.Builder
	for chunk := range stream.Stream() {
		switch chunk.Type {
		case provider.ChunkText:
			text.WriteString(chunk.Text)
			if onChunk != nil {
				onChunk(StreamChunk{Kind: StreamChunkText, Text: chunk.Text})
			}
		case provider.ChunkReasoning:
			reasoning.WriteString(chunk.Text)
			if onChunk != nil {
				onChunk(StreamChunk{Kind: StreamChunkReasoning, Text: chunk.Text})
			}
		}
	}

	result.Text = strings.TrimSpace(text.String())
	result.Reasoning = strings.TrimSpace(reasoning.String())
	if err := stream.Err(); err != nil {
		return result, fmt.Errorf("stream error: %w", err)
	}

	return result, nil
}

func (p *OpenAIProvider) GenerateTitle(ctx context.Context, systemPrompt string, userMessage string, language string) (string, error) {
	return p.Chat(ctx, ChatRequest{
		System:   systemPrompt,
		Messages: []ChatMessage{{Role: "user", Content: userMessage}},
	})
}
