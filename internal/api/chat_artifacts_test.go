package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"keryx-server/internal/store"
)

// TestUpdateArtifactToolSavesAndBumpsVersion pins the versioning contract:
// a new title starts at version 1 with a fresh artifact id, calling again
// with the same title (case-insensitive) bumps the version on the SAME
// artifact, and a different title starts a new artifact.
func TestUpdateArtifactToolSavesAndBumpsVersion(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "artifacts@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	var updates []artifactUpdate
	onResult := func(upd artifactUpdate) { updates = append(updates, upd) }

	// First save: version 1, fresh id.
	out, err := env.server.execUpdateArtifactTool(chatID,
		json.RawMessage(`{"title":"Demo Page","artifactType":"html","content":"<h1>hi</h1>"}`), onResult)
	if err != nil {
		t.Fatalf("first save: %v", err)
	}
	if out != "Artifact 'Demo Page' saved as version 1." {
		t.Errorf("unexpected tool output: %q", out)
	}
	if len(updates) != 1 || updates[0].Version != 1 || !strings.HasPrefix(updates[0].ArtifactID, "art_") {
		t.Fatalf("unexpected first update: %+v", updates)
	}
	firstID := updates[0].ArtifactID

	art, err := env.store.GetChatArtifact(chatID, firstID, 0)
	if err != nil {
		t.Fatalf("get artifact: %v", err)
	}
	if art.Title != "Demo Page" || art.Type != "html" || art.Content != "<h1>hi</h1>" || art.Version != 1 {
		t.Errorf("unexpected stored artifact: %+v", art)
	}

	// Same title, different case: same artifact id, version bumped.
	if _, err := env.server.execUpdateArtifactTool(chatID,
		json.RawMessage(`{"title":"demo page","artifactType":"markdown","content":"# v2"}`), onResult); err != nil {
		t.Fatalf("second save: %v", err)
	}
	if len(updates) != 2 || updates[1].ArtifactID != firstID || updates[1].Version != 2 {
		t.Fatalf("expected version 2 on the same artifact, got: %+v", updates)
	}

	// A different title starts a new artifact at version 1.
	if _, err := env.server.execUpdateArtifactTool(chatID,
		json.RawMessage(`{"title":"Other Doc","artifactType":"markdown","content":"# other"}`), onResult); err != nil {
		t.Fatalf("third save: %v", err)
	}
	if len(updates) != 3 || updates[2].ArtifactID == firstID || updates[2].Version != 1 {
		t.Fatalf("expected a fresh artifact at version 1, got: %+v", updates)
	}

	// Invalid input is rejected.
	if _, err := env.server.execUpdateArtifactTool(chatID,
		json.RawMessage(`{"title":"","artifactType":"html","content":"x"}`), onResult); err == nil {
		t.Error("expected an error for an empty title")
	}
	if _, err := env.server.execUpdateArtifactTool(chatID,
		json.RawMessage(`{"title":"X","artifactType":"pdf","content":"x"}`), onResult); err == nil {
		t.Error("expected an error for an unsupported artifactType")
	}
}

// TestGetChatArtifactEndpoint covers the owner-gated artifact fetch.
func TestGetChatArtifactEndpoint(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "artifact-get@example.com")
	other := testUser(t, env, "artifact-other@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	var upd artifactUpdate
	if _, err := env.server.execUpdateArtifactTool(chatID,
		json.RawMessage(`{"title":"Doc","artifactType":"markdown","content":"# v1"}`),
		func(a artifactUpdate) { upd = a }); err != nil {
		t.Fatalf("save artifact: %v", err)
	}
	if _, err := env.server.execUpdateArtifactTool(chatID,
		json.RawMessage(`{"title":"Doc","artifactType":"markdown","content":"# v2"}`), nil); err != nil {
		t.Fatalf("save artifact v2: %v", err)
	}

	// Latest version by default.
	rec := doJSONRequest(t, env.handler, "GET", "/api/chats/"+chatID+"/artifacts/"+upd.ArtifactID, u.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	var body struct {
		ArtifactID string `json:"artifactId"`
		Title      string `json:"title"`
		Type       string `json:"type"`
		Version    int    `json:"version"`
		Content    string `json:"content"`
		CreatedAt  string `json:"createdAt"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.ArtifactID != upd.ArtifactID || body.Title != "Doc" || body.Type != "markdown" || body.Version != 2 || body.Content != "# v2" {
		t.Errorf("unexpected artifact response: %+v", body)
	}
	if body.CreatedAt == "" {
		t.Error("expected createdAt to be set")
	}

	// Explicit version.
	rec = doJSONRequest(t, env.handler, "GET", "/api/chats/"+chatID+"/artifacts/"+upd.ArtifactID+"?version=1", u.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Version != 1 || body.Content != "# v1" {
		t.Errorf("expected version 1 content, got: %+v", body)
	}

	// A foreign user gets a 404 (chat owner check).
	rec = doJSONRequest(t, env.handler, "GET", "/api/chats/"+chatID+"/artifacts/"+upd.ArtifactID, other.Token, nil)
	assertStatus(t, rec, http.StatusNotFound)

	// Unknown artifact id.
	rec = doJSONRequest(t, env.handler, "GET", "/api/chats/"+chatID+"/artifacts/art_nope", u.Token, nil)
	assertStatus(t, rec, http.StatusNotFound)
}

// TestSaveChatImportsClientMessages: creating a chat with a non-empty
// messages array persists them into the chat_messages collection.
func TestSaveChatImportsClientMessages(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "chat-create@example.com")

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats", u.Token, map[string]any{
		"title": "Client chat",
		"messages": []map[string]any{
			{"id": "msg_a", "role": "user", "createdAt": "2026-01-01T00:00:00Z", "parts": []any{
				map[string]any{"type": "text", "text": "hello"},
			}},
		},
	})
	assertStatus(t, rec, http.StatusOK)

	var saved store.ChatRecord
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	msgs, err := env.store.ChatMessages(saved.ID)
	if err != nil {
		t.Fatalf("load messages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected 1 persisted message, got %d", len(msgs))
	}
	if id, _ := msgs[0]["id"].(string); id != "msg_a" {
		t.Errorf("unexpected message id: %v", msgs[0]["id"])
	}
}
