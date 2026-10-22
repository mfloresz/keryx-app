package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"keryx-server/internal/store"
)

// createTestChat stores an empty chat owned by the given user.
func createTestChat(t *testing.T, env *apiTestEnv, ownerID string) string {
	t.Helper()
	chat, err := env.store.SaveChat(&store.ChatRecord{
		ID:         "chat_approval_test",
		OwnerID:    ownerID,
		Title:      "",
		Visibility: "private",
		Messages:   json.RawMessage("[]"),
		Votes:      json.RawMessage("[]"),
	}, ownerID)
	if err != nil {
		t.Fatalf("save chat: %v", err)
	}
	return chat.ID
}

// TestToolApprovalReleasesTheWaitingStream is the core contract: while a
// write waits for consent the stream is blocked, and the answer releases it.
func TestToolApprovalReleasesTheWaitingStream(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "approval@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	// Stand in for the stream handler that is blocked on the approval.
	pending := env.server.toolApprovals.register(chatID, "appr_1", "call_1", "write_file", `{"path":"a.md"}`)
	released := make(chan approvalDecision, 1)
	go func() {
		decision := <-pending.ch
		released <- decision
	}()

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/tool-approval", u.Token, map[string]any{
		"approvalId": "appr_1",
		"approved":   true,
	})
	assertStatus(t, rec, http.StatusOK)

	select {
	case decision := <-released:
		if !decision.Approved {
			t.Fatalf("expected the approval to be granted, got %+v", decision)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the waiting stream was never released")
	}
}

// TestToolApprovalDenialReleasesTheStream covers the deny path.
func TestToolApprovalDenialReleasesTheStream(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "approval-deny@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	pending := env.server.toolApprovals.register(chatID, "appr_1", "call_1", "edit_file", `{"path":"a.md"}`)
	released := make(chan approvalDecision, 1)
	go func() {
		decision := <-pending.ch
		released <- decision
	}()

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/tool-approval", u.Token, map[string]any{
		"approvalId": "appr_1",
		"approved":   false,
		"reason":     "not now",
	})
	assertStatus(t, rec, http.StatusOK)

	select {
	case decision := <-released:
		if decision.Approved {
			t.Fatal("expected the approval to be denied")
		}
		if decision.Reason != "not now" {
			t.Fatalf("expected the reason to be kept, got %q", decision.Reason)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the waiting stream was never released")
	}
}

// TestToolApprovalRejectsUnknownApproval makes sure a stale answer cannot
// reach a finished stream.
func TestToolApprovalRejectsUnknownApproval(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "approval-unknown@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/tool-approval", u.Token, map[string]any{
		"approvalId": "does_not_exist",
		"approved":   true,
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an unknown approval, got %d", rec.Code)
	}
}

// TestToolApprovalRequiresAuth makes sure the endpoint is protected.
func TestToolApprovalRequiresAuth(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "approval-auth@example.com")
	chatID := createTestChat(t, env, u.User.ID)

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/tool-approval", "", map[string]any{
		"approvalId": "appr_1",
		"approved":   true,
	})
	if rec.Code == http.StatusOK {
		t.Fatal("expected a non-OK status without auth")
	}
}

// TestToolApprovalRejectsForeignChat makes sure one user cannot answer
// another user's approval.
func TestToolApprovalRejectsForeignChat(t *testing.T) {
	env := newAPITestEnv(t)
	owner := testUser(t, env, "approval-owner@example.com")
	other := testUser(t, env, "approval-other@example.com")
	chatID := createTestChat(t, env, owner.User.ID)

	env.server.toolApprovals.register(chatID, "appr_1", "call_1", "write_file", "{}")

	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/"+chatID+"/tool-approval", other.Token, map[string]any{
		"approvalId": "appr_1",
		"approved":   true,
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for a chat the caller does not own, got %d", rec.Code)
	}
}
