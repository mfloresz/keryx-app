package api

import (
	"encoding/json"
	"testing"
)

// TestAssistantMessagePersistsSources pins the source contract: the
// citations the answer is based on are stored with the assistant message, so
// they survive a reload and can be rendered as a source list.
func TestAssistantMessagePersistsSources(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "sources@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	sources := []map[string]any{
		{
			"type":     "source-url",
			"sourceId": "src_1",
			"url":      "https://example.com/a",
			"title":    "Example A",
		},
		{
			"type":     "source-url",
			"sourceId": "src_2",
			"url":      "https://example.com/b",
			"title":    "Example B",
		},
	}

	env.server.appendAssistantMessage(
		chatID, u.User.ID, "msg_1",
		"La respuesta", "", nil, sources, nil,
	)

	chat, err := env.store.GetChat(chatID, u.User.ID)
	if err != nil {
		t.Fatalf("get chat: %v", err)
	}

	var messages []struct {
		Parts []map[string]any `json:"parts"`
	}
	if err := json.Unmarshal(chat.Messages, &messages); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(messages))
	}

	found := 0
	for _, part := range messages[0].Parts {
		if part["type"] != "source-url" {
			continue
		}
		found++
		if part["url"] == nil || part["title"] == nil {
			t.Errorf("source part is missing url/title: %v", part)
		}
	}
	if found != 2 {
		t.Fatalf("expected 2 source parts, got %d", found)
	}

	// The text part is still there, after the sources.
	last := messages[0].Parts[len(messages[0].Parts)-1]
	if last["type"] != "text" {
		t.Errorf("expected the text part last, got %v", last["type"])
	}
}

// TestAssistantMessageWithoutSourcesKeepsShape makes sure a chat without
// citations stores the same part layout as before.
func TestAssistantMessageWithoutSourcesKeepsShape(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "sources-none@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	env.server.appendAssistantMessage(
		chatID, u.User.ID, "msg_1",
		"La respuesta", "el razonamiento", nil, nil, nil,
	)

	chat, err := env.store.GetChat(chatID, u.User.ID)
	if err != nil {
		t.Fatalf("get chat: %v", err)
	}

	var messages []struct {
		Parts []map[string]any `json:"parts"`
	}
	if err := json.Unmarshal(chat.Messages, &messages); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(messages))
	}

	parts := messages[0].Parts
	if len(parts) != 2 {
		t.Fatalf("expected [reasoning text], got %d parts", len(parts))
	}
	if parts[0]["type"] != "reasoning" {
		t.Errorf("expected reasoning first, got %v", parts[0]["type"])
	}
	if parts[1]["type"] != "text" {
		t.Errorf("expected text second, got %v", parts[1]["type"])
	}
}

// TestSearchCitationsAreCollected verifies the Brave response carries the
// citations the client needs for the source list.
func TestSearchCitationsAreCollected(t *testing.T) {
	result := &braveSearchResult{
		Results: "Web search results",
		Citations: []searchCitation{
			{Title: "A", URL: "https://a.example"},
			{Title: "B", URL: "https://b.example"},
		},
	}

	if len(result.Citations) != 2 {
		t.Fatalf("expected 2 citations, got %d", len(result.Citations))
	}
	if result.Citations[0].URL != "https://a.example" || result.Citations[1].Title != "B" {
		t.Errorf("unexpected citations: %+v", result.Citations)
	}
}
