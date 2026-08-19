package ai

import (
	"context"
	"encoding/json"
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
	// ResponsesAPIModels is the set of base upstream model IDs (reasoning
	// suffixes stripped) that must use the Responses API instead of Chat
	// Completions. Some gateways (e.g. opencode-go) only stream these models
	// in real time over /responses.
	ResponsesAPIModels map[string]bool
}

// reasoningEffort extracts the reasoning effort from a model variant string
// like "openai/gpt-5.6-luna (reasoning: medium)". Returns "" for plain models.
// The effort is fixed per catalog model (never chosen at request time), and is
// sent to the provider as a reasoning option — mirroring Yara's provider
// mapping of reasoning levels to distinct models.
func reasoningEffort(model string) string {
	const marker = " (reasoning: "
	i := strings.Index(model, marker)
	if i < 0 || !strings.HasSuffix(model, ")") {
		return ""
	}
	effort := strings.TrimSpace(model[i+len(marker) : len(model)-1])
	switch effort {
	case "none", "low", "medium":
		return effort
	}
	return ""
}

// reasoningBaseModel strips the "(reasoning: <effort>)" variant suffix from a
// model string, returning the upstream model ID actually sent to the provider.
func reasoningBaseModel(model string) string {
	if effort := reasoningEffort(model); effort != "" {
		return strings.TrimSuffix(model, " (reasoning: "+effort+")")
	}
	return model
}

func (p *OpenAIProvider) model() (provider.LanguageModel, error) {
	if p == nil || p.APIKey == "" {
		return nil, fmt.Errorf("openai-compatible provider not configured: missing API key")
	}
	opts := []openai.Option{openai.WithAPIKey(p.APIKey)}
	if p.BaseURL != "" {
		opts = append(opts, openai.WithBaseURL(p.BaseURL))
	}
	return openai.Chat(reasoningBaseModel(p.Model), opts...), nil
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

// requestOptions returns the provider options for a single request. Reasoning
// effort is derived from the per-request model variant (which is fixed per
// catalog model), so it stays correct even when the provider instance is
// cached and shared across different model variants.
func (p *OpenAIProvider) requestOptions(req ChatRequest) map[string]any {
	opts := p.mergedOptions()
	model := req.Model
	if model == "" {
		model = p.Model
	}
	if effort := reasoningEffort(model); effort != "" {
		opts["reasoning"] = map[string]any{"effort": effort}
	}
	// Some gateways (e.g. opencode-go) only stream reasoning-class models in
	// real time over the Responses API; Chat Completions buffers the whole
	// response. Keyed by base model so it survives the reasoning variants.
	if p.ResponsesAPIModels != nil && p.ResponsesAPIModels[reasoningBaseModel(model)] {
		opts["useResponsesAPI"] = true
	}
	return opts
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

	// Provider-specific options
	opts := p.requestOptions(req)
	if len(opts) > 0 {
		o = append(o, goai.WithProviderOptions(opts))
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
			// Wrap the execute function to pass through the tool name.
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

func (p *OpenAIProvider) requestTimeout(req ChatRequest) time.Duration {
	timeout := p.Timeout
	if req.Timeout > 0 {
		timeout = req.Timeout
	}
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return timeout
}

func (p *OpenAIProvider) Chat(ctx context.Context, req ChatRequest) (string, error) {
	model, err := p.model()
	if err != nil {
		return "", err
	}

	// Caller-owned timeout: do NOT use goai.WithTimeout. goai's internal
	// timeout context is canceled before the chunk channel closes at the end
	// of tool-loop streams, producing a spurious "context canceled" error
	// after an otherwise successful response (see streamWithToolLoop /
	// TextStream.consume in goai 0.9.2). Wrapping the context outside goai
	// and canceling after full consumption avoids that race entirely.
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	// Override model from request if provided
	if req.Model != "" {
		opts := []openai.Option{openai.WithAPIKey(p.APIKey)}
		if p.BaseURL != "" {
			opts = append(opts, openai.WithBaseURL(p.BaseURL))
		}
		model = openai.Chat(reasoningBaseModel(req.Model), opts...)
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

	// Caller-owned timeout (see Chat for why goai.WithTimeout is avoided).
	// cancel runs only after the stream is fully drained and Err() checked,
	// so it can never win the race against the final buffered chunks.
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	// Override model from request if provided
	if req.Model != "" {
		opts := []openai.Option{openai.WithAPIKey(p.APIKey)}
		if p.BaseURL != "" {
			opts = append(opts, openai.WithBaseURL(p.BaseURL))
		}
		model = openai.Chat(reasoningBaseModel(req.Model), opts...)
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
