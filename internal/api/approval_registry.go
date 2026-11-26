package api

import (
	"sync"
	"time"
)

// pendingApproval is a tool call that is waiting for the user to approve
// or deny it. The chat stream handler blocks on the channel until the
// client answers through POST /api/chats/{id}/tool-approval.
type pendingApproval struct {
	ChatID     string
	ApprovalID string
	ToolCallID string
	ToolName   string
	Input      string
	CreatedAt  time.Time

	// ch carries the decision. Buffered with room for one value so the
	// answering request never blocks.
	ch chan approvalDecision
}

// approvalDecision is the user's answer to a pending approval.
type approvalDecision struct {
	Approved bool
	Reason   string
}

// approvalRegistry keeps pending tool approvals keyed by approval ID.
type approvalRegistry struct {
	mu      sync.Mutex
	pending map[string]*pendingApproval
}

func newApprovalRegistry() *approvalRegistry {
	return &approvalRegistry{pending: make(map[string]*pendingApproval)}
}

// register creates a pending approval and returns it.
func (r *approvalRegistry) register(chatID, approvalID, toolCallID, toolName, input string) *pendingApproval {
	r.mu.Lock()
	defer r.mu.Unlock()
	pa := &pendingApproval{
		ChatID:     chatID,
		ApprovalID: approvalID,
		ToolCallID: toolCallID,
		ToolName:   toolName,
		Input:      input,
		CreatedAt:  time.Now(),
		ch:         make(chan approvalDecision, 1),
	}
	r.pending[approvalID] = pa
	return pa
}

// get returns a pending approval, or nil when it is unknown (already
// answered, expired, or never registered).
func (r *approvalRegistry) get(approvalID string) *pendingApproval {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.pending[approvalID]
}

// resolve delivers a decision to the waiting stream handler and removes the
// approval from the registry. It reports whether an approval was waiting.
func (r *approvalRegistry) resolve(approvalID string, decision approvalDecision) bool {
	r.mu.Lock()
	pa := r.pending[approvalID]
	if pa != nil {
		delete(r.pending, approvalID)
	}
	r.mu.Unlock()

	if pa == nil {
		return false
	}
	select {
	case pa.ch <- decision:
		return true
	default:
		return false
	}
}

// remove drops a pending approval without answering it. Used when the
// stream ends (aborted, errored, or timed out) so the registry does not
// leak entries.
func (r *approvalRegistry) remove(approvalID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.pending, approvalID)
}
