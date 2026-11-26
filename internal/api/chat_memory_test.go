package api

import (
	"strings"
	"testing"
)

func uiTestMsg(id, role, text string) map[string]any {
	return map[string]any{
		"id":   id,
		"role": role,
		"parts": []any{
			map[string]any{"type": "text", "text": text},
		},
	}
}

// TestSummarizeWindow pins the memory split: the recent window is the
// longest suffix within the budget (the newest message is always kept) and
// the summarized range covers everything before the window that the current
// summary does not yet cover.
func TestSummarizeWindow(t *testing.T) {
	msgs := []map[string]any{
		uiTestMsg("m1", "user", strings.Repeat("a", 100)),
		uiTestMsg("m2", "assistant", strings.Repeat("b", 100)),
		uiTestMsg("m3", "user", strings.Repeat("c", 100)),
		uiTestMsg("m4", "assistant", strings.Repeat("d", 100)),
	}

	// Budget fits all four: nothing to summarize.
	toSum, win := summarizeWindow(msgs, "", 400)
	if len(win) != 4 || len(toSum) != 0 {
		t.Fatalf("expected full window and nothing to summarize, got win=%d toSum=%d", len(win), len(toSum))
	}

	// Budget fits exactly two: window = [m3, m4], summarize [m1, m2].
	toSum, win = summarizeWindow(msgs, "", 200)
	if len(win) != 2 || win[0]["id"] != "m3" || win[1]["id"] != "m4" {
		t.Fatalf("unexpected window: %+v", win)
	}
	if len(toSum) != 2 || toSum[0]["id"] != "m1" || toSum[1]["id"] != "m2" {
		t.Fatalf("unexpected toSummarize: %+v", toSum)
	}

	// A summary through m1: only m2 is new.
	toSum, _ = summarizeWindow(msgs, "m1", 200)
	if len(toSum) != 1 || toSum[0]["id"] != "m2" {
		t.Fatalf("expected only m2 after frontier m1, got: %+v", toSum)
	}

	// The newest message is always kept, even alone over budget.
	toSum, win = summarizeWindow(msgs, "", 50)
	if len(win) != 1 || win[0]["id"] != "m4" {
		t.Fatalf("expected the newest message alone in the window, got: %+v", win)
	}
	if len(toSum) != 3 {
		t.Fatalf("expected the first three to be summarized, got %d", len(toSum))
	}

	// Empty input.
	toSum, win = summarizeWindow(nil, "", 100)
	if toSum != nil || win != nil {
		t.Fatalf("expected nil,nil for empty input, got %v %v", toSum, win)
	}
}

// TestBuildSummarizePrompt: previous summary + role-labeled message text,
// with oversized messages truncated.
func TestBuildSummarizePrompt(t *testing.T) {
	out := buildSummarizePrompt("prev summary", []map[string]any{
		uiTestMsg("m1", "user", "hello"),
		uiTestMsg("m2", "assistant", strings.Repeat("x", 9000)),
	})
	if !strings.Contains(out, "prev summary") {
		t.Errorf("expected the previous summary in the payload")
	}
	if !strings.Contains(out, "[user]: hello") {
		t.Errorf("expected the role-labeled user message, got: %s", out)
	}
	if strings.Count(out, strings.Repeat("x", 8000)) != 1 || strings.Count(out, strings.Repeat("x", 8001)) != 0 {
		t.Errorf("expected the assistant message truncated to 8000 chars")
	}

	// Empty previous summary renders as "(none)".
	out = buildSummarizePrompt("", []map[string]any{uiTestMsg("m1", "user", "hi")})
	if !strings.Contains(out, "(none)") {
		t.Errorf("expected (none) placeholder, got: %s", out)
	}
}
