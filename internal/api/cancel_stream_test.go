package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
)

// TestCancelStreamRejectsForeignChat: cancelling another user's stream must
// not even reveal whether one is running — same ownership check as the
// reconnect endpoint.
func TestCancelStreamRejectsForeignChat(t *testing.T) {
	env := newAPITestEnv(t)
	owner := testUser(t, env, "cancel-owner@example.com")
	other := testUser(t, env, "cancel-other@example.com")
	chatID := createTestChat(t, env, owner.User.ID)

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/cancel", other.Token, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a chat the caller does not own, got %d", rec.Code)
	}
}

// TestCancelStreamWithoutActiveStreamSucceeds: the endpoint is idempotent —
// no active stream is still a success, so a stale Stop press is harmless.
func TestCancelStreamWithoutActiveStreamSucceeds(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "cancel-idle@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/cancel", u.Token, nil)
	assertStatus(t, rec, http.StatusOK)

	var body struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Success {
		t.Fatalf("expected success:true, got: %s", rec.Body.String())
	}
}

// TestCancelStreamCancelsActiveRun: with a registered stream, the cancel
// endpoint stops the run's context.
func TestCancelStreamCancelsActiveRun(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "cancel-active@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	ctx, cancel := context.WithCancel(context.Background())
	env.server.activeStreams.register(chatID, "m1", cancel)

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/cancel", u.Token, nil)
	assertStatus(t, rec, http.StatusOK)

	select {
	case <-ctx.Done():
	default:
		t.Fatal("expected the active run's context to be cancelled")
	}
}

// TestCancelStreamRequiresAuth makes sure the endpoint is protected.
func TestCancelStreamRequiresAuth(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "cancel-auth@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/cancel", "", nil)
	if rec.Code == http.StatusOK {
		t.Fatal("expected a non-OK status without auth")
	}
}
