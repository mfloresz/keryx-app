package api

import (
	"testing"
	"time"
)

func TestApprovalRegistryResolve(t *testing.T) {
	r := newApprovalRegistry()
	r.register("chat1", "appr1", "call1", "write_file", `{"path":"a.md"}`)

	pending := r.get("appr1")
	if pending == nil {
		t.Fatal("expected the approval to be registered")
	}
	if pending.ChatID != "chat1" || pending.ToolName != "write_file" {
		t.Fatalf("unexpected pending approval: %+v", pending)
	}

	if !r.resolve("appr1", approvalDecision{Approved: true}) {
		t.Fatal("expected the approval to be resolved")
	}

	// The decision reaches the waiting stream handler.
	select {
	case decision := <-pending.ch:
		if !decision.Approved {
			t.Fatalf("expected the decision to be approved, got %+v", decision)
		}
	case <-time.After(time.Second):
		t.Fatal("expected a decision on the channel")
	}

	// A resolved approval is gone from the registry: a second answer is
	// rejected instead of being applied twice.
	if r.get("appr1") != nil {
		t.Fatal("expected the approval to be removed after resolving")
	}
	if r.resolve("appr1", approvalDecision{Approved: true}) {
		t.Fatal("expected a second resolve to fail")
	}
}

func TestApprovalRegistryDeny(t *testing.T) {
	r := newApprovalRegistry()
	r.register("chat1", "appr1", "call1", "edit_file", `{"path":"a.md"}`)

	pending := r.get("appr1")
	if pending == nil {
		t.Fatal("expected the approval to be registered")
	}

	r.resolve("appr1", approvalDecision{Approved: false, Reason: "not now"})

	select {
	case decision := <-pending.ch:
		if decision.Approved {
			t.Fatal("expected the decision to be denied")
		}
		if decision.Reason != "not now" {
			t.Fatalf("expected the reason to be kept, got %q", decision.Reason)
		}
	case <-time.After(time.Second):
		t.Fatal("expected a decision on the channel")
	}
}

func TestApprovalRegistryRemove(t *testing.T) {
	r := newApprovalRegistry()
	r.register("chat1", "appr1", "call1", "write_file", "{}")

	r.remove("appr1")

	if r.get("appr1") != nil {
		t.Fatal("expected the approval to be removed")
	}
	if r.resolve("appr1", approvalDecision{Approved: true}) {
		t.Fatal("expected a removed approval to be unresolvable")
	}
}
