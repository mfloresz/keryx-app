package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// scriptedServer runs a mock OpenAI-compatible API returning the given
// responses in order (one per request) and recording every request body and
// header. A nil *[]string responses entry emits an empty body.
func scriptedServer(t *testing.T, responses []string, bodies *[]map[string]any, headers *[]http.Header) *httptest.Server {
	t.Helper()
	var mu sync.Mutex
	var count int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		i := count
		count++
		mu.Unlock()

		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("request body is not JSON: %v", err)
		}
		mu.Lock()
		*bodies = append(*bodies, body)
		*headers = append(*headers, r.Header.Clone())
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		if i < len(responses) {
			_, _ = w.Write([]byte(responses[i]))
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

const chatCompletionOK = `{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`

// toolArgsWire returns the web_search arguments as a JSON-encoded string,
// which is the wire format OpenAI tool calls use for function arguments.
func toolArgsWire() string {
	raw, _ := json.Marshal(map[string]string{"query": "keryx"})
	encoded, _ := json.Marshal(string(raw))
	return string(encoded)
}

func chatCompletionToolCall() string {
	return `{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","tool_calls":[{"id":"call_1","type":"function","function":{"name":"web_search","arguments":` + toolArgsWire() + `}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}`
}

func TestReasoningVariantSendsEffortAndBaseModel(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "openai/gpt-5.6-luna (reasoning: medium)",
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
		Model:    "openai/gpt-5.6-luna (reasoning: low)",
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if len(bodies) != 1 {
		t.Fatalf("expected 1 request, got %d", len(bodies))
	}
	body := bodies[0]
	if body["model"] != "openai/gpt-5.6-luna" {
		t.Errorf("model = %v, want stripped base model", body["model"])
	}
	if body["reasoning_effort"] != "low" {
		t.Errorf("reasoning_effort = %v, want low", body["reasoning_effort"])
	}
}

func TestReasoningEffortFromProviderModel(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "openai/gpt-5.6-luna (reasoning: low)",
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	reasoning, ok := bodies[0]["reasoning_effort"].(string)
	if !ok || reasoning != "low" {
		t.Errorf("reasoning_effort = %v, want low", bodies[0]["reasoning_effort"])
	}
}

func TestOpenRouterChatSendsSessionIDPromptCacheKeyAndUsage(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

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
	body := bodies[0]
	if body["session_id"] != "abc12345" {
		t.Errorf("session_id = %v, want abc12345", body["session_id"])
	}
	if body["prompt_cache_key"] != "abc12345" {
		t.Errorf("prompt_cache_key = %v, want abc12345", body["prompt_cache_key"])
	}
	usage, ok := body["usage"].(map[string]any)
	if !ok || usage["include"] != true {
		t.Errorf("usage.include = %v, want true", body["usage"])
	}
	if h := headers[0].Get("X-Title"); h != keryxUserAgent {
		t.Errorf("X-Title = %q, want %q", h, keryxUserAgent)
	}
	if h := headers[0].Get("User-Agent"); h != keryxUserAgent {
		t.Errorf("User-Agent = %q, want %q", h, keryxUserAgent)
	}
}

func TestOpenRouterChatOmitsSessionWithoutCacheKey(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

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
	body := bodies[0]
	if _, ok := body["session_id"]; ok {
		t.Errorf("expected no session_id without CacheKey, got %v", body["session_id"])
	}
	if _, ok := body["prompt_cache_key"]; ok {
		t.Errorf("expected no prompt_cache_key without CacheKey, got %v", body["prompt_cache_key"])
	}
}

func TestStandardProviderSendsPromptCacheKeyButNoSessionID(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "e2ee-deepseek-v4-flash",
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
		CacheKey: "abc12345",
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	body := bodies[0]
	if body["prompt_cache_key"] != "abc12345" {
		t.Errorf("prompt_cache_key = %v, want abc12345", body["prompt_cache_key"])
	}
	if _, ok := body["session_id"]; ok {
		t.Errorf("expected no OpenRouter session_id on standard providers, got %v", body["session_id"])
	}
	if _, ok := body["usage"]; ok {
		t.Errorf("expected no usage reporting toggle on standard providers, got %v", body["usage"])
	}
}

func TestProviderSendsRegistryOptions(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
		Options: map[string]any{
			"venice_parameters": map[string]any{"include_venice_system_prompt": false},
		},
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if _, ok := bodies[0]["venice_parameters"]; !ok {
		t.Errorf("expected venice_parameters passthrough, got %v", bodies[0])
	}
}

func TestOpenCodeSessionHeader(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:    "test-key",
		BaseURL:   srv.URL,
		Model:     "mimo-v2.5",
		SessionID: "deadbeef",
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if h := headers[0].Get(opencodeSessionHeader); h != "deadbeef" {
		t.Errorf("%s = %q, want deadbeef", opencodeSessionHeader, h)
	}
}

func TestChatStreamReportsCacheUsage(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	streamOK := "data: {\"id\":\"x\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"hi\"}}]}\n\n" +
		"data: {\"choices\":[{\"delta\":{},\"index\":0,\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":10,\"total_tokens\":110,\"prompt_tokens_details\":{\"cached_tokens\":60}}}\n\n" +
		"data: [DONE]\n\n"
	srv := scriptedServer(t, []string{streamOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
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

// chatStreamToolCall emits a streamed web_search tool call followed by the
// usage-carrying final chunk.
func chatStreamToolCall() string {
	return "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"web_search\",\"arguments\":" + toolArgsWire() + "}}]}}]}\n\n" +
		"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n" +
		"data: [DONE]\n\n"
}

func chatStreamText(text string) string {
	return "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"" + text + "\"}}]}\n\n" +
		"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":20,\"completion_tokens\":3}}\n\n" +
		"data: [DONE]\n\n"
}

func TestChatStreamToolLoopExecutesAndEmitsEvents(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatStreamToolCall(), chatStreamText("done")}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
	}

	var chunks []StreamChunk
	result, err := provider.ChatStream(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "search"}},
		Tools: []ToolDefinition{{
			Name:        "web_search",
			Description: "Search the web",
			InputSchema: `{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}`,
		}},
		ToolExec: func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
			if toolName != "web_search" {
				t.Errorf("toolName = %q, want web_search", toolName)
			}
			return "search results", nil
		},
	}, func(c StreamChunk) {
		chunks = append(chunks, c)
	})
	if err != nil {
		t.Fatalf("ChatStream failed: %v", err)
	}

	if result.Text != "done" {
		t.Errorf("result.Text = %q, want done", result.Text)
	}
	if result.Usage.InputTokens != 30 {
		t.Errorf("InputTokens = %d, want 30 (sum of both steps)", result.Usage.InputTokens)
	}

	// Request bodies: first sends the tool, second sends the tool result.
	if len(bodies) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(bodies))
	}
	if _, ok := bodies[0]["tools"]; !ok {
		t.Error("first request should declare tools")
	}
	secondMsgs, _ := bodies[1]["messages"].([]any)
	if len(secondMsgs) != 3 {
		t.Fatalf("expected [user assistant tool] messages on second request, got %d", len(secondMsgs))
	}
	toolMsg, _ := secondMsgs[2].(map[string]any)
	if toolMsg["role"] != "tool" || toolMsg["content"] != "search results" || toolMsg["tool_call_id"] != "call_1" {
		t.Errorf("unexpected tool message: %v", toolMsg)
	}

	// Event sequence: tool call, tool result, then streamed text.
	var kinds []StreamChunkKind
	for _, c := range chunks {
		kinds = append(kinds, c.Kind)
	}
	if len(kinds) < 3 || kinds[0] != StreamChunkToolCall || kinds[1] != StreamChunkToolResult || kinds[2] != StreamChunkText {
		t.Errorf("unexpected chunk sequence: %v", kinds)
	}
	if chunks[0].ToolName != "web_search" || chunks[0].ToolCallID != "call_1" {
		t.Errorf("unexpected tool call chunk: %+v", chunks[0])
	}
	var input map[string]string
	if err := json.Unmarshal([]byte(chunks[0].Input), &input); err != nil || input["query"] != "keryx" {
		t.Errorf("unexpected tool input: %v", chunks[0].Input)
	}
	if chunks[1].Output != "search results" {
		t.Errorf("unexpected tool output: %q", chunks[1].Output)
	}
}

func TestChatToolLoopNonStream(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionToolCall(), chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
	}
	executed := false
	text, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "search"}},
		Tools: []ToolDefinition{{
			Name:        "web_search",
			Description: "Search the web",
			InputSchema: `{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}`,
		}},
		ToolExec: func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
			executed = true
			return "results", nil
		},
	})
	if err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if !executed {
		t.Error("tool was not executed")
	}
	if text != "ok" {
		t.Errorf("text = %q, want ok", text)
	}
	if len(bodies) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(bodies))
	}
}

func TestChatToolFailureFeedsModelInsteadOfFailing(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionToolCall(), chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
	}
	text, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "search"}},
		Tools: []ToolDefinition{{
			Name:        "web_search",
			Description: "Search the web",
			InputSchema: `{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}`,
		}},
		ToolExec: func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
			return "", fmt.Errorf("boom")
		},
	})
	if err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if text != "ok" {
		t.Errorf("text = %q, want ok", text)
	}
	// The failure text travels as the tool message content.
	secondMsgs, _ := bodies[1]["messages"].([]any)
	toolMsg, _ := secondMsgs[2].(map[string]any)
	if !strings.Contains(fmt.Sprint(toolMsg["content"]), "boom") {
		t.Errorf("expected tool failure fed back to the model, got %v", toolMsg)
	}
}

func TestFilePartsPayloadInjection(t *testing.T) {
	t.Run("pdf attachment becomes a file part", func(t *testing.T) {
		var bodies []map[string]any
		var headers []http.Header
		srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

		provider := &OpenAIProvider{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"}
		if _, err := provider.Chat(context.Background(), ChatRequest{
			Messages: []ChatMessage{{
				Role:    "user",
				Content: "read this",
				Attachments: []ChatAttachment{{
					Filename:  "report.pdf",
					MediaType: "application/pdf",
					Data:      []byte("%PDF-1.4 raw"),
				}},
			}},
		}); err != nil {
			t.Fatalf("Chat failed: %v", err)
		}

		msgs, _ := bodies[0]["messages"].([]any)
		msg, _ := msgs[0].(map[string]any)
		content, ok := msg["content"].([]any)
		if !ok {
			t.Fatalf("expected content array, got %v", msg["content"])
		}
		if len(content) != 2 {
			t.Fatalf("expected [text file] items, got %v", content)
		}
		file, _ := content[1].(map[string]any)
		if file["type"] != "file" {
			t.Errorf("expected file item, got %v", file)
		}
		inner, _ := file["file"].(map[string]any)
		if inner["filename"] != "report.pdf" {
			t.Errorf("expected filename, got %v", inner)
		}
		if data, _ := inner["file_data"].(string); !strings.HasPrefix(data, "data:application/pdf;base64,") {
			t.Errorf("expected data URL, got %v", inner["file_data"])
		}
	})

	t.Run("audio attachment becomes input_audio", func(t *testing.T) {
		var bodies []map[string]any
		var headers []http.Header
		srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

		provider := &OpenAIProvider{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"}
		if _, err := provider.Chat(context.Background(), ChatRequest{
			Messages: []ChatMessage{{
				Role: "user",
				Attachments: []ChatAttachment{{
					Filename:  "note.wav",
					MediaType: "audio/wav",
					Data:      []byte("RIFF"),
				}},
			}},
		}); err != nil {
			t.Fatalf("Chat failed: %v", err)
		}

		msgs, _ := bodies[0]["messages"].([]any)
		msg, _ := msgs[0].(map[string]any)
		content, _ := msg["content"].([]any)
		if len(content) != 1 {
			t.Fatalf("expected [input_audio] item, got %v", content)
		}
		audio, _ := content[0].(map[string]any)
		if audio["type"] != "input_audio" {
			t.Errorf("expected input_audio item, got %v", audio)
		}
	})

	t.Run("unsupported binaries are omitted", func(t *testing.T) {
		var bodies []map[string]any
		var headers []http.Header
		srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

		provider := &OpenAIProvider{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"}
		if _, err := provider.Chat(context.Background(), ChatRequest{
			Messages: []ChatMessage{{
				Role: "user",
				Attachments: []ChatAttachment{{
					Filename:  "blob.bin",
					MediaType: "application/octet-stream",
					Data:      []byte{0, 1, 2},
				}},
			}},
		}); err != nil {
			t.Fatalf("Chat failed: %v", err)
		}

		msgs, _ := bodies[0]["messages"].([]any)
		msg, _ := msgs[0].(map[string]any)
		if content := msg["content"]; content != nil && content != "" {
			t.Errorf("expected empty content for omitted binary, got %v", content)
		}
	})

	t.Run("markdown conversion still travels as text", func(t *testing.T) {
		var bodies []map[string]any
		var headers []http.Header
		srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

		provider := &OpenAIProvider{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"}
		if _, err := provider.Chat(context.Background(), ChatRequest{
			Messages: []ChatMessage{{
				Role: "user",
				Attachments: []ChatAttachment{{
					Filename:  "report.pdf",
					MediaType: "application/pdf",
					Data:      []byte("raw"),
					Markdown:  "converted",
				}},
			}},
		}); err != nil {
			t.Fatalf("Chat failed: %v", err)
		}

		msgs, _ := bodies[0]["messages"].([]any)
		msg, _ := msgs[0].(map[string]any)
		content, ok := msg["content"].([]any)
		if !ok || len(content) != 1 {
			t.Fatalf("expected one text item, got %v", msg["content"])
		}
		text, _ := content[0].(map[string]any)
		if !strings.Contains(fmt.Sprint(text["text"]), "converted") {
			t.Errorf("expected markdown text content, got %v", content)
		}
	})
}

func TestChatSendsMaxTokens(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatCompletionOK}, &bodies, &headers)

	provider := &OpenAIProvider{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages:  []ChatMessage{{Role: "user", Content: "hello"}},
		MaxTokens: 256,
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if bodies[0]["max_tokens"] != float64(256) {
		t.Errorf("max_tokens = %v, want 256", bodies[0]["max_tokens"])
	}
}
