package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// chatStreamWriteFileCall emits a streamed write_file tool call followed by
// the usage-carrying final chunk.
func chatStreamWriteFileCall() string {
	args, _ := json.Marshal(map[string]string{"path": "a.md"})
	encoded, _ := json.Marshal(string(args))
	return "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"write_file\",\"arguments\":" + string(encoded) + "}}]}}]}\n\n" +
		"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\n" +
		"data: [DONE]\n\n"
}

// TestChatStreamDeniedToolIsNotExecuted pins the approval contract: when the
// approval hook denies a tool, the tool never runs and the model is told the
// user refused.
func TestChatStreamDeniedToolIsNotExecuted(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatStreamWriteFileCall(), chatStreamText("ok")}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
	}

	executed := false
	result, err := provider.ChatStream(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "write it"}},
		Tools: []ToolDefinition{{
			Name:        "write_file",
			Description: "Write a file",
			InputSchema: `{"type":"object","properties":{"path":{"type":"string"}}}`,
		}},
		ToolExec: func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
			executed = true
			return "written", nil
		},
		ToolApproval: func(ctx context.Context, toolCallID, toolName, input string) (bool, string) {
			if toolName != "write_file" {
				t.Errorf("toolName = %q, want write_file", toolName)
			}
			return false, "not this time"
		},
	}, nil)
	if err != nil {
		t.Fatalf("ChatStream failed: %v", err)
	}

	if executed {
		t.Fatal("the denied tool must not run")
	}
	if result.Text != "ok" {
		t.Errorf("result.Text = %q, want ok", result.Text)
	}

	// The model is told the user denied the tool, so it can adapt.
	if len(bodies) < 2 {
		t.Fatalf("expected 2 requests, got %d", len(bodies))
	}
	msgs, _ := bodies[1]["messages"].([]any)
	if len(msgs) != 3 {
		t.Fatalf("expected [user assistant tool] messages, got %d", len(msgs))
	}
	toolMsg, _ := msgs[2].(map[string]any)
	content, _ := toolMsg["content"].(string)
	if !strings.Contains(content, "denied") {
		t.Errorf("expected the denial to be reported to the model, got %q", content)
	}
	if !strings.Contains(content, "not this time") {
		t.Errorf("expected the reason to reach the model, got %q", content)
	}
}

// TestChatStreamApprovedToolRuns pins the other half: an approved tool runs
// exactly as it did before approvals existed, and the result carries the
// call arguments so the client can show what was written.
func TestChatStreamApprovedToolRuns(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatStreamWriteFileCall(), chatStreamText("ok")}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
	}

	executed := false
	var chunks []StreamChunk
	_, err := provider.ChatStream(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "write it"}},
		Tools: []ToolDefinition{{
			Name:        "write_file",
			Description: "Write a file",
			InputSchema: `{"type":"object","properties":{"path":{"type":"string"}}}`,
		}},
		ToolExec: func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
			executed = true
			return "written", nil
		},
		ToolApproval: func(ctx context.Context, toolCallID, toolName, input string) (bool, string) {
			return true, ""
		},
	}, func(c StreamChunk) {
		chunks = append(chunks, c)
	})
	if err != nil {
		t.Fatalf("ChatStream failed: %v", err)
	}

	if !executed {
		t.Fatal("the approved tool must run")
	}

	// The tool result carries the arguments, so the persisted part shows
	// what the tool was asked to do.
	var result *StreamChunk
	for i := range chunks {
		if chunks[i].Kind == StreamChunkToolResult {
			result = &chunks[i]
		}
	}
	if result == nil {
		t.Fatal("expected a tool result chunk")
	}
	if !strings.Contains(result.Input, "a.md") {
		t.Errorf("expected the tool arguments in the result, got %q", result.Input)
	}
}

// TestChatStreamWithoutApprovalHookRunsTool makes sure the hook is optional:
// chats without one keep the previous behaviour.
func TestChatStreamWithoutApprovalHookRunsTool(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	srv := scriptedServer(t, []string{chatStreamWriteFileCall(), chatStreamText("ok")}, &bodies, &headers)

	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: srv.URL,
		Model:   "test-model",
	}

	executed := false
	_, err := provider.ChatStream(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "write it"}},
		Tools: []ToolDefinition{{
			Name:        "write_file",
			Description: "Write a file",
			InputSchema: `{"type":"object","properties":{"path":{"type":"string"}}}`,
		}},
		ToolExec: func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
			executed = true
			return "written", nil
		},
	}, nil)
	if err != nil {
		t.Fatalf("ChatStream failed: %v", err)
	}

	if !executed {
		t.Fatal("the tool must run when no approval hook is set")
	}
}
