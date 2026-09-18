package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOpenAIProviderRequestOptionsReasoning(t *testing.T) {
	provider := &OpenAIProvider{
		Model: "openai/gpt-5.6-luna (reasoning: medium)",
		GoAIOptions: map[string]any{
			"useResponsesAPI": false,
		},
	}

	// A reasoning-variant request carries the effort as a provider option.
	opts := provider.requestOptions(ChatRequest{Model: "openai/gpt-5.6-luna (reasoning: low)"})
	reasoning, ok := opts["reasoning"].(map[string]any)
	if !ok {
		t.Fatalf("expected reasoning option, got %v", opts["reasoning"])
	}
	if reasoning["effort"] != "low" {
		t.Errorf("effort = %v, want low", reasoning["effort"])
	}

	// A plain request has no reasoning option, even when the cached provider
	// was built for a reasoning variant (cached per provider ID).
	opts = provider.requestOptions(ChatRequest{Model: "nvidia/nemotron-3.5-lightning"})
	if _, ok := opts["reasoning"]; ok {
		t.Errorf("unexpected reasoning option for plain model: %v", opts["reasoning"])
	}
}

func TestOpenAIProviderModelIDStripsReasoningSuffix(t *testing.T) {
	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: "https://openrouter.ai/api/v1",
		Model:   "openai/gpt-5.6-luna (reasoning: medium)",
	}

	model, err := provider.model()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if model.ModelID() != "openai/gpt-5.6-luna" {
		t.Errorf("model ID = %q, want %q", model.ModelID(), "openai/gpt-5.6-luna")
	}
}

func TestOpenAIProviderResponsesAPIModels(t *testing.T) {
	provider := &OpenAIProvider{
		Model: "gpt-5.6-luna (reasoning: medium)",
		GoAIOptions: map[string]any{
			"useResponsesAPI": false,
		},
		ResponsesAPIModels: map[string]bool{"gpt-5.6-luna": true},
	}

	// Reasoning variants of a flagged base model switch to the Responses API,
	// overriding the provider-level Chat Completions default.
	opts := provider.requestOptions(ChatRequest{Model: "gpt-5.6-luna (reasoning: low)"})
	if useResponses, _ := opts["useResponsesAPI"].(bool); !useResponses {
		t.Errorf("useResponsesAPI = %v, want true", opts["useResponsesAPI"])
	}

	// Models not in the set keep the provider default (Chat Completions).
	opts = provider.requestOptions(ChatRequest{Model: "mimo-v2.5"})
	if useResponses, _ := opts["useResponsesAPI"].(bool); useResponses {
		t.Errorf("useResponsesAPI = %v, want false", opts["useResponsesAPI"])
	}

	// Unset ResponsesAPIModels leaves the provider default untouched.
	provider.ResponsesAPIModels = nil
	opts = provider.requestOptions(ChatRequest{Model: "gpt-5.6-luna (reasoning: medium)"})
	if useResponses, _ := opts["useResponsesAPI"].(bool); useResponses {
		t.Errorf("useResponsesAPI = %v, want false without ResponsesAPIModels", opts["useResponsesAPI"])
	}
}

func TestOpenAIProviderRequestOptionsCacheKey(t *testing.T) {
	provider := &OpenAIProvider{
		Model:       "test-model",
		GoAIOptions: map[string]any{"useResponsesAPI": false},
	}

	opts := provider.requestOptions(ChatRequest{CacheKey: "abc12345"})
	if opts["prompt_cache_key"] != "abc12345" {
		t.Errorf("prompt_cache_key = %v, want abc12345", opts["prompt_cache_key"])
	}

	opts = provider.requestOptions(ChatRequest{})
	if _, ok := opts["prompt_cache_key"]; ok {
		t.Errorf("expected no prompt_cache_key without CacheKey, got %v", opts["prompt_cache_key"])
	}

	opts = provider.requestOptions(ChatRequest{CacheKey: "  "})
	if _, ok := opts["prompt_cache_key"]; ok {
		t.Errorf("expected no prompt_cache_key for blank CacheKey, got %v", opts["prompt_cache_key"])
	}
}

// captureBodies runs Chat against a mock server and returns every request body.
func captureBodies(t *testing.T, response string) (*httptest.Server, *[]map[string]any) {
	t.Helper()
	var bodies []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("request body is not JSON: %v", err)
		}
		bodies = append(bodies, body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(srv.Close)
	return srv, &bodies
}

const chatCompletionOK = `{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`

func TestOpenRouterChatSendsSessionIDAndPromptCacheKey(t *testing.T) {
	srv, bodies := captureBodies(t, chatCompletionOK)
	provider := &OpenAIProvider{
		APIKey:     "test-key",
		BaseURL:    srv.URL,
		Model:      "openai/gpt-5.6-luna",
		OpenRouter: true,
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
		CacheKey: "abc12345",
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if len(*bodies) != 1 {
		t.Fatalf("expected 1 request, got %d", len(*bodies))
	}
	body := (*bodies)[0]
	if body["session_id"] != "abc12345" {
		t.Errorf("session_id = %v, want abc12345", body["session_id"])
	}
	if body["prompt_cache_key"] != "abc12345" {
		t.Errorf("prompt_cache_key = %v, want abc12345", body["prompt_cache_key"])
	}
}

func TestOpenRouterChatOmitsSessionWithoutCacheKey(t *testing.T) {
	srv, bodies := captureBodies(t, chatCompletionOK)
	provider := &OpenAIProvider{
		APIKey:     "test-key",
		BaseURL:    srv.URL,
		Model:      "openai/gpt-5.6-luna",
		OpenRouter: true,
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	body := (*bodies)[0]
	if _, ok := body["session_id"]; ok {
		t.Errorf("expected no session_id without CacheKey, got %v", body["session_id"])
	}
	if _, ok := body["prompt_cache_key"]; ok {
		t.Errorf("expected no prompt_cache_key without CacheKey, got %v", body["prompt_cache_key"])
	}
}

func TestStandardProviderSendsPromptCacheKeyButNoSessionID(t *testing.T) {
	srv, bodies := captureBodies(t, chatCompletionOK)
	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "e2ee-deepseek-v4-flash",
		GoAIOptions: map[string]any{
			"useResponsesAPI": false,
		},
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
		CacheKey: "abc12345",
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	body := (*bodies)[0]
	if body["prompt_cache_key"] != "abc12345" {
		t.Errorf("prompt_cache_key = %v, want abc12345", body["prompt_cache_key"])
	}
	if _, ok := body["session_id"]; ok {
		t.Errorf("expected no OpenRouter session_id on standard providers, got %v", body["session_id"])
	}
}

func TestChatStreamReportsCacheUsage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"id\":\"x\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{},\"index\":0,\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":10,\"total_tokens\":110,\"prompt_tokens_details\":{\"cached_tokens\":60}}}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	t.Cleanup(srv.Close)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
		GoAIOptions: map[string]any{
			"useResponsesAPI": false,
		},
	}
	result, err := provider.ChatStream(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
		CacheKey: "abc12345",
	}, nil)
	if err != nil {
		t.Fatalf("ChatStream failed: %v", err)
	}
	if !strings.Contains(result.Text, "hi") {
		t.Errorf("expected streamed text, got %q", result.Text)
	}
	if result.Usage.CacheReadTokens != 60 {
		t.Errorf("CacheReadTokens = %d, want 60", result.Usage.CacheReadTokens)
	}
	if result.Usage.InputTokens == 0 || result.Usage.OutputTokens == 0 {
		t.Errorf("expected input/output tokens, got %+v", result.Usage)
	}
}
