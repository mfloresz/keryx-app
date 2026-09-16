package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSessionForChatIsStableOpaqueAndShort(t *testing.T) {
	first := SessionForChat("chat-123")
	second := SessionForChat("chat-123")
	if first != second {
		t.Fatalf("expected stable session for same chat, got %q vs %q", first, second)
	}
	if len(first) != opencodeSessionLength {
		t.Fatalf("expected session length %d, got %q", opencodeSessionLength, first)
	}
	for _, r := range first {
		if !strings.ContainsRune("0123456789abcdef", r) {
			t.Fatalf("expected lowercase hex session, got %q", first)
		}
	}
	if other := SessionForChat("chat-456"); other == first {
		t.Fatalf("expected different chats to map to different sessions, both %q", first)
	}
	if strings.Contains(first, "chat-123") {
		t.Fatalf("session must not expose the chat id, got %q", first)
	}
}

func TestIsOpencodeProvider(t *testing.T) {
	for _, id := range []string{"opencode-go", "opencode-zen"} {
		if !IsOpencodeProvider(id) {
			t.Fatalf("expected %q to consume the session header", id)
		}
	}
	for _, id := range []string{"venice", "openrouter", "google", "", "  "} {
		if IsOpencodeProvider(id) {
			t.Fatalf("expected %q to skip the session header", id)
		}
	}
}

func TestOpenAIProviderHeadersAlwaysIdentifyApp(t *testing.T) {
	h := (&OpenAIProvider{}).headers()
	if h["User-Agent"] != keryxUserAgent {
		t.Fatalf("expected User-Agent %q, got %q", keryxUserAgent, h["User-Agent"])
	}
	if _, ok := h[opencodeSessionHeader]; ok {
		t.Fatalf("expected no session header when SessionID is empty, got %v", h)
	}

	h = (&OpenAIProvider{SessionID: "abc12345"}).headers()
	if h[opencodeSessionHeader] != "abc12345" {
		t.Fatalf("expected session header to carry the session id, got %v", h)
	}
}

func TestOpenAIProviderSendsSessionAndUserAgent(t *testing.T) {
	var gotUA, gotSession string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUA = r.Header.Get("User-Agent")
		gotSession = r.Header.Get(opencodeSessionHeader)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))
	}))
	defer srv.Close()

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
		GoAIOptions: map[string]any{
			"useResponsesAPI": false,
		},
		SessionID: "abc12345",
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if gotUA != keryxUserAgent {
		t.Fatalf("expected User-Agent %q, got %q", keryxUserAgent, gotUA)
	}
	if gotSession != "abc12345" {
		t.Fatalf("expected %s %q, got %q", opencodeSessionHeader, "abc12345", gotSession)
	}
}

func TestOpenAIProviderOmitsSessionWhenEmpty(t *testing.T) {
	var gotSession string
	var sessionPresent bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, sessionPresent = r.Header[http.CanonicalHeaderKey(opencodeSessionHeader)]
		gotSession = r.Header.Get(opencodeSessionHeader)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`))
	}))
	defer srv.Close()

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
		GoAIOptions: map[string]any{
			"useResponsesAPI": false,
		},
	}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}); err != nil {
		t.Fatalf("Chat failed: %v", err)
	}
	if sessionPresent || gotSession != "" {
		t.Fatalf("expected no session header for non-opencode providers, got %q", gotSession)
	}
}

func TestSessionForChatDecodesAsJSONRoundTrip(t *testing.T) {
	// Guards the 8-hex-char contract against accidental format changes.
	raw, _ := json.Marshal(map[string]string{"session": SessionForChat("chat-123")})
	var decoded map[string]string
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("session id must stay JSON-safe: %v", err)
	}
	if len(decoded["session"]) != opencodeSessionLength {
		t.Fatalf("expected session length %d, got %q", opencodeSessionLength, decoded["session"])
	}
}
