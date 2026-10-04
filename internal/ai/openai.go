package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/cloudwego/eino/components/model"
	einoopenai "github.com/cloudwego/eino-ext/components/model/openai"
)

// OpenAIProvider implements Provider for OpenAI-compatible APIs (OpenAI,
// OpenRouter, Venice, OpenCode, LM Studio, …) using the eino OpenAI
// component, which streams reasoning content and reports token usage —
// including prompt-cache hits — as part of its message metadata.
type OpenAIProvider struct {
	APIKey  string
	BaseURL string
	Model   string
	Timeout time.Duration
	// Options are static wire extras from the provider registry, e.g.
	// venice_parameters. Behavior toggles the previous engine accepted
	// (useResponsesAPI, strictJsonSchema, structuredOutputs) are dropped:
	// eino always speaks Chat Completions and never forces structured
	// outputs for plain text generation.
	Options map[string]any
	// OpenRouter selects OpenRouter-specific wire behavior: session_id
	// grouping plus usage reporting body fields and app attribution headers.
	// Without it OpenRouter shows the app as Unknown and streams without
	// usage accounting.
	OpenRouter bool
	// SessionID carries the opaque OpenCode session for cache grouping.
	// Only set for opencode-go/opencode-zen; empty for every other provider.
	SessionID string
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

// isOpenRouter reports whether this instance targets OpenRouter, either via
// the explicit flag or by BaseURL. The flag covers tests with a mock URL;
// the BaseURL check is a safety net for providers built without the flag.
func (p *OpenAIProvider) isOpenRouter() bool {
	if p == nil {
		return false
	}
	if p.OpenRouter {
		return true
	}
	return strings.Contains(p.BaseURL, "openrouter.ai")
}

// headers identifies the app and, when SessionID is set, the chat conversation.
// User-Agent is always keryx so OpenCode does not see a generic Go HTTP client;
// X-Title attributes the app on OpenRouter.
func (p *OpenAIProvider) headers() map[string]string {
	h := map[string]string{"User-Agent": keryxUserAgent}
	if trimmed := strings.TrimSpace(p.SessionID); trimmed != "" {
		h[opencodeSessionHeader] = trimmed
	}
	if p.isOpenRouter() {
		h["X-Title"] = keryxUserAgent
	}
	return h
}

// requestModel returns the upstream model ID for a request: the per-request
// model (reasoning suffix stripped) or the provider default.
func (p *OpenAIProvider) requestModel(req ChatRequest) string {
	if req.Model != "" {
		return reasoningBaseModel(req.Model)
	}
	return reasoningBaseModel(p.Model)
}

// requestOptions builds the per-request model options: reasoning effort
// (derived from the model variant, which is fixed per catalog model so it
// stays correct even when the provider instance is cached), output budget,
// app headers, prompt-cache grouping and file-part payload injection.
func (p *OpenAIProvider) requestOptions(req ChatRequest) ([]model.Option, error) {
	var opts []model.Option

	// Reasoning effort comes from the per-request model variant, falling
	// back to the provider's variant when the request doesn't override the
	// model (the effort is fixed per catalog model, never chosen at request
	// time).
	variant := req.Model
	if variant == "" {
		variant = p.Model
	}
	if effort := reasoningEffort(variant); effort != "" {
		opts = append(opts, einoopenai.WithReasoningEffort(einoopenai.ReasoningEffortLevel(effort)))
	}

	if req.MaxTokens > 0 {
		opts = append(opts, model.WithMaxTokens(req.MaxTokens))
	}

	if headers := p.headers(); len(headers) > 0 {
		opts = append(opts, einoopenai.WithExtraHeader(headers))
	}

	extra := map[string]any{}
	if p.isOpenRouter() {
		// OpenRouter's native grouping key for sticky routing and session
		// analytics. Without it, sticky routing falls back to hashing the
		// opening messages, which changes on every chat turn (dynamic
		// datetime context) and kills cache affinity. usage.include makes
		// OpenRouter report token usage on streamed responses. The standard
		// prompt_cache_key travels too as a fallback sticky-routing key.
		if trimmed := strings.TrimSpace(req.CacheKey); trimmed != "" {
			extra["session_id"] = trimmed
			extra["prompt_cache_key"] = trimmed
		}
		extra["usage"] = map[string]any{"include": true}
	} else if trimmed := strings.TrimSpace(req.CacheKey); trimmed != "" {
		// Standard OpenAI-compatible grouping key for prompt-cache affinity.
		extra["prompt_cache_key"] = trimmed
	}
	for k, v := range p.Options {
		if k == "useResponsesAPI" || k == "strictJsonSchema" || k == "structuredOutputs" {
			continue
		}
		extra[k] = v
	}
	if len(extra) > 0 {
		opts = append(opts, einoopenai.WithExtraFields(extra))
	}

	if hasWireFileParts(req) {
		opts = append(opts, einoopenai.WithRequestPayloadModifier(injectFileParts))
	}

	return opts, nil
}

func (p *OpenAIProvider) chatModel(ctx context.Context, req ChatRequest) (model.BaseChatModel, []model.Option, error) {
	if p == nil || p.APIKey == "" {
		return nil, nil, fmt.Errorf("openai-compatible provider not configured: missing API key")
	}
	cm, err := einoopenai.NewChatModel(ctx, &einoopenai.ChatModelConfig{
		APIKey:  p.APIKey,
		BaseURL: p.BaseURL,
		Model:   p.requestModel(req),
	})
	if err != nil {
		return nil, nil, err
	}
	opts, err := p.requestOptions(req)
	if err != nil {
		return nil, nil, err
	}
	return cm, opts, nil
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
	// Caller-owned timeout: the HTTP client is left timeout-free so a long
	// tool-loop stream is never killed by the client before the chunk
	// channel is drained; the context is canceled only after full
	// consumption, which avoids spurious "context canceled" errors.
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	cm, opts, err := p.chatModel(ctx, req)
	if err != nil {
		return "", err
	}
	msgs := buildSchemaMessages(req, false)
	tools, err := toToolInfos(req.Tools)
	if err != nil {
		return "", err
	}
	result, err := runToolLoopGenerate(ctx, cm, msgs, tools, req, opts)
	if err != nil {
		return "", fmt.Errorf("chat completion: %w", err)
	}
	return result.Text, nil
}

func (p *OpenAIProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (ChatStreamResult, error) {
	var result ChatStreamResult

	// Caller-owned timeout (see Chat): cancel runs only after the stream is
	// fully drained and the error checked, so it can never win the race
	// against the final buffered chunks.
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	cm, opts, err := p.chatModel(ctx, req)
	if err != nil {
		return result, err
	}
	msgs := buildSchemaMessages(req, false)
	tools, err := toToolInfos(req.Tools)
	if err != nil {
		return result, err
	}
	result, err = runToolLoopStream(ctx, cm, msgs, tools, req, opts, onChunk)
	if err != nil {
		return result, fmt.Errorf("chat stream: %w", err)
	}
	return result, nil
}

func (p *OpenAIProvider) GenerateTitle(ctx context.Context, systemPrompt string, userMessage string, language string) (string, error) {
	return p.Chat(ctx, ChatRequest{
		System:   systemPrompt,
		Messages: []ChatMessage{{Role: "user", Content: userMessage}},
	})
}
