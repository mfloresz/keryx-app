package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"keryx-server/internal/ai"
)

// toolsRequiringApproval lists the workspace tools that mutate state. Every
// other tool (reads, searches, listings) runs without asking.
var toolsRequiringApproval = map[string]bool{
	"write_file": true,
	"edit_file":  true,
}

// approvalTimeout bounds how long a tool call waits for the user's answer.
// When it expires the tool is denied: a write never happens without an
// explicit approval.
const approvalTimeout = 5 * time.Minute

// toolApprovalHook returns an approval function for the given stream.
//
// The hook runs inside the provider's tool loop (in the run goroutine), so it
// can block: it broadcasts a tool_approval event to the stream's subscribers,
// then waits for the client to answer through
// POST /api/chats/{id}/tool-approval.
func (s *Server) toolApprovalHook(chatID string, active *activeStream) ai.ToolApprovalFunc {
	return func(ctx context.Context, toolCallID, toolName, input string) (bool, string) {
		if !toolsRequiringApproval[toolName] {
			return true, ""
		}

		approvalID := generateID()

		// The approval is registered before the event is broadcast: a fast
		// client could answer before the registration existed, and the
		// answer would be dropped.
		pending := s.toolApprovals.register(chatID, approvalID, toolCallID, toolName, input)
		// The approval is dropped from the registry when the stream ends, so
		// a late answer cannot revive a finished stream.
		defer s.toolApprovals.remove(approvalID)

		extra := map[string]string{
			"approvalId": approvalID,
			"toolCallId": toolCallID,
			"name":       toolName,
			"input":      input,
			"reason":     approvalReason(toolName, input),
		}
		// The event goes to the stream's subscribers only — the HTTP request
		// that started the run is just another observer now. It is also
		// recorded on the stream so a client that subscribes while the
		// approval is pending sees the prompt again (see followStream).
		active.setPendingApproval(extra)
		// Cleared no matter how the wait ends (decision, cancellation, stream
		// end, timeout) so late subscribers never see a stale prompt.
		defer active.clearPendingApproval()
		active.broadcast("tool_approval", extra)

		select {
		case decision := <-pending.ch:
			return decision.Approved, decision.Reason
		case <-ctx.Done():
			return false, "The request was cancelled before the tool was approved."
		case <-active.done:
			return false, "The response ended before the tool was approved."
		case <-time.After(approvalTimeout):
			return false, "The approval request timed out."
		}
	}
}

// approvalReason describes the pending change in plain language, so the user
// can decide without reading raw JSON.
func approvalReason(toolName, input string) string {
	var args struct {
		Path      string `json:"path"`
		Content   string `json:"content"`
		OldString string `json:"old_string"`
		NewString string `json:"new_string"`
	}
	_ = json.Unmarshal([]byte(input), &args)

	switch toolName {
	case "write_file":
		if args.Path == "" {
			return "The agent wants to write a file in the workspace."
		}
		return fmt.Sprintf("The agent wants to write %s in the workspace.", args.Path)
	case "edit_file":
		if args.Path == "" {
			return "The agent wants to edit a file in the workspace."
		}
		return fmt.Sprintf("The agent wants to edit %s in the workspace.", args.Path)
	default:
		return "The agent wants to run a tool that changes the workspace."
	}
}

// handleToolApproval records the user's answer to a pending tool approval.
//
// The stream handler is blocked waiting for this answer, so the endpoint
// resolves it and returns immediately.
func (s *Server) handleToolApproval(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		ApprovalID string `json:"approvalId"`
		Approved   bool   `json:"approved"`
		Reason     string `json:"reason"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.ApprovalID) == "" {
		errorResponse(w, "Missing approvalId", http.StatusBadRequest)
		return
	}

	// Ownership check: the approval must belong to a chat the caller owns.
	if _, err := s.Store.GetChat(chatID, userID); err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	pending := s.toolApprovals.get(req.ApprovalID)
	if pending == nil {
		errorResponse(w, "Approval not found or already answered", http.StatusNotFound)
		return
	}
	if pending.ChatID != chatID {
		errorResponse(w, "Approval does not belong to this chat", http.StatusBadRequest)
		return
	}

	s.toolApprovals.resolve(req.ApprovalID, approvalDecision{
		Approved: req.Approved,
		Reason:   strings.TrimSpace(req.Reason),
	})

	jsonResponse(w, map[string]any{
		"approvalId": req.ApprovalID,
		"approved":   req.Approved,
	}, http.StatusOK)
}
