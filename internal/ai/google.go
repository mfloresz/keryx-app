package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/zendev-sh/goai"
	"github.com/zendev-sh/goai/provider"
	"github.com/zendev-sh/goai/provider/google"
)

// GoogleProvider implements Provider for Google's Gemini API using goai.
type GoogleProvider struct {
	APIKey  string
	Model   string
	Timeout time.Duration
}

func (p *GoogleProvider) model() (provider.LanguageModel, error) {
	if p == nil || p.APIKey == "" {
		return nil, fmt.Errorf("google provider not configured: missing API key")
	}
	return google.Chat(p.Model, google.WithAPIKey(p.APIKey)), nil
}

func (p *GoogleProvider) goaiOpts(req ChatRequest) []goai.Option {
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

	// Tools (function calling)
	if len(req.Tools) > 0 && req.ToolExec != nil {
		tools := make([]goai.Tool, 0, len(req.Tools))
		for _, t := range req.Tools {
			toolDef := goai.Tool{
				Name:        t.Name,
				Description: t.Description,
			}
			if t.InputSchema != "" {
				toolDef.InputSchema = json.RawMessage(t.InputSchema)
			}
			toolName := t.Name
			toolDef.Execute = func(ctx context.Context, input json.RawMessage) (string, error) {
				return req.ToolExec(ctx, toolName, input)
			}
			tools = append(tools, toolDef)
		}
		o = append(o, goai.WithTools(tools...), goai.WithMaxSteps(5))
	}

	return o
}

func (p *GoogleProvider) requestTimeout(req ChatRequest) time.Duration {
	timeout := p.Timeout
	if req.Timeout > 0 {
		timeout = req.Timeout
	}
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return timeout
}

func (p *GoogleProvider) Chat(ctx context.Context, req ChatRequest) (string, error) {
	model, err := p.model()
	if err != nil {
		return "", err
	}

	// Caller-owned timeout: goai.WithTimeout is avoided because goai cancels
	// its internal timeout context before closing the chunk channel at the
	// end of tool-loop streams, surfacing a spurious "context canceled".
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	if req.Model != "" {
		model = google.Chat(req.Model, google.WithAPIKey(p.APIKey))
	}

	result, err := goai.GenerateText(ctx, model, p.goaiOpts(req)...)
	if err != nil {
		return "", fmt.Errorf("google chat completion: %w", err)
	}
	return strings.TrimSpace(result.Text), nil
}

func (p *GoogleProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (ChatStreamResult, error) {
	var result ChatStreamResult

	model, err := p.model()
	if err != nil {
		return result, err
	}

	// Caller-owned timeout (see Chat for rationale).
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	if req.Model != "" {
		model = google.Chat(req.Model, google.WithAPIKey(p.APIKey))
	}

	stream, err := goai.StreamText(ctx, model, p.goaiOpts(req)...)
	if err != nil {
		return result, fmt.Errorf("google chat stream: %w", err)
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
		return result, fmt.Errorf("google stream error: %w", err)
	}

	return result, nil
}

func (p *GoogleProvider) GenerateTitle(ctx context.Context, systemPrompt string, userMessage string, language string) (string, error) {
	return p.Chat(ctx, ChatRequest{
		System:   systemPrompt,
		Messages: []ChatMessage{{Role: "user", Content: userMessage}},
	})
}
