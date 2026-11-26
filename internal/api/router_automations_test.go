package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// doMultipartRequest sends a multipart upload with a single file under the
// "files" field.
func doMultipartRequest(t *testing.T, h http.Handler, method, path, token, filename, contentType string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("files", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := io.Copy(fw, bytes.NewReader(data)); err != nil {
		t.Fatalf("write file part: %v", err)
	}
	mw.Close()

	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// stubProvider is a minimal ai.Provider for unattended-run tests.
type stubProvider struct {
	text string
}

func (p *stubProvider) Chat(ctx context.Context, req ai.ChatRequest) (string, error) {
	return p.text, nil
}

func (p *stubProvider) ChatStream(ctx context.Context, req ai.ChatRequest, onChunk func(ai.StreamChunk)) (ai.ChatStreamResult, error) {
	if onChunk != nil {
		onChunk(ai.StreamChunk{Kind: ai.StreamChunkText, Text: p.text})
	}
	return ai.ChatStreamResult{Text: p.text, Usage: ai.Usage{OutputTokens: 7}}, nil
}

func (p *stubProvider) GenerateTitle(ctx context.Context, systemPrompt, userMessage, language string) (string, error) {
	return "t", nil
}

// createTestAgent inserts a private agent for the owner and returns its id.
func createTestAgent(t *testing.T, env *apiTestEnv, ownerID, name string) string {
	t.Helper()
	ag, err := env.store.CreateAgent(&store.Agent{
		Name:         name,
		SystemPrompt: "You are " + name + ".",
	}, ownerID, "")
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	return ag.ID
}

// TestAutomationsCRUDAndOwnership: create, list, foreign isolation, trigger
// authorization and runs listing.
func TestAutomationsCRUDAndOwnership(t *testing.T) {
	env := newAPITestEnv(t)
	owner := testUser(t, env, "auto-owner@example.com")
	other := testUser(t, env, "auto-other@example.com")
	agentID := createTestAgent(t, env, owner.User.ID, "Reporter")

	// Trigger and list require auth.
	rec := doJSONRequest(t, env.handler, "GET", "/api/automations", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d", rec.Code)
	}

	// Invalid schedule is rejected.
	rec = doJSONRequest(t, env.handler, "POST", "/api/automations", owner.Token, map[string]any{
		"agentId": agentID, "taskPrompt": "hi", "schedule": "hourly",
	})
	assertStatus(t, rec, http.StatusBadRequest)

	// Unknown agent is rejected.
	rec = doJSONRequest(t, env.handler, "POST", "/api/automations", owner.Token, map[string]any{
		"agentId": "ghost", "taskPrompt": "hi", "schedule": "every:15m",
	})
	assertStatus(t, rec, http.StatusBadRequest)

	// Create.
	rec = doJSONRequest(t, env.handler, "POST", "/api/automations", owner.Token, map[string]any{
		"agentId": agentID, "taskPrompt": "Report {date}", "schedule": "every:15m",
		"webhookOutUrl": "", "allowWriteTools": false,
	})
	assertStatus(t, rec, http.StatusCreated)
	var created automationJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.ID == "" || created.AgentName != "Reporter" || !created.Enabled {
		t.Fatalf("unexpected automation: %+v", created)
	}

	// List enriches with the agent name.
	rec = doJSONRequest(t, env.handler, "GET", "/api/automations", owner.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	var list []automationJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 1 || list[0].AgentName != "Reporter" {
		t.Fatalf("unexpected list: %+v", list)
	}

	// Foreign users see nothing and cannot mutate: 404, not 403, so the
	// automation's existence is not revealed.
	rec = doJSONRequest(t, env.handler, "PUT", "/api/automations/"+created.ID, other.Token, map[string]any{
		"taskPrompt": "hijacked",
	})
	assertStatus(t, rec, http.StatusNotFound)
	rec = doJSONRequest(t, env.handler, "DELETE", "/api/automations/"+created.ID, other.Token, nil)
	assertStatus(t, rec, http.StatusNotFound)
	rec = doJSONRequest(t, env.handler, "POST", "/api/automations/"+created.ID+"/trigger", other.Token, nil)
	assertStatus(t, rec, http.StatusNotFound)
	rec = doJSONRequest(t, env.handler, "GET", "/api/automations/"+created.ID+"/runs", other.Token, nil)
	assertStatus(t, rec, http.StatusNotFound)

	// Trigger requires auth.
	rec = doJSONRequest(t, env.handler, "POST", "/api/automations/"+created.ID+"/trigger", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated trigger, got %d", rec.Code)
	}

	// Owner trigger returns immediately with success.
	rec = doJSONRequest(t, env.handler, "POST", "/api/automations/"+created.ID+"/trigger", owner.Token, nil)
	assertStatus(t, rec, http.StatusOK)

	// Runs listing works for the owner and starts empty.
	rec = doJSONRequest(t, env.handler, "GET", "/api/automations/"+created.ID+"/runs", owner.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	var runs []store.AutomationRun
	if err := json.Unmarshal(rec.Body.Bytes(), &runs); err != nil {
		t.Fatalf("decode runs: %v", err)
	}
	if runs == nil || len(runs) != 0 {
		t.Fatalf("expected an empty runs list, got %+v", runs)
	}

	// Owner update works.
	rec = doJSONRequest(t, env.handler, "PUT", "/api/automations/"+created.ID, owner.Token, map[string]any{
		"taskPrompt": "Updated {time}",
		"enabled":    false,
	})
	assertStatus(t, rec, http.StatusOK)
	var updated automationJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode update: %v", err)
	}
	if updated.TaskPrompt != "Updated {time}" || updated.Enabled {
		t.Fatalf("unexpected updated automation: %+v", updated)
	}

	// Owner delete.
	rec = doJSONRequest(t, env.handler, "DELETE", "/api/automations/"+created.ID, owner.Token, nil)
	assertStatus(t, rec, http.StatusOK)
}

// forceAutomationDue seeds next_run in the past so the scheduler picks the
// automation up on its next tick (creation already seeds next_run ahead).
func forceAutomationDue(t *testing.T, env *apiTestEnv, automationID string) {
	t.Helper()
	if err := env.store.MarkAutomationRan(automationID, true, time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("force due: %v", err)
	}
}

// TestSchedulerTickRecordsAgentError: a due automation whose agent is gone
// records an error run and increments the failure streak — no provider needed.
func TestSchedulerTickRecordsAgentError(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "sched-err@example.com")

	auto, err := env.store.CreateAutomation(&store.Automation{
		AgentID:    "ghost-agent",
		TaskPrompt: "run {date}",
		Schedule:   "every:15m",
	}, u.User.ID)
	if err != nil {
		t.Fatalf("create automation: %v", err)
	}
	forceAutomationDue(t, env, auto.ID)

	env.server.schedulerTick()

	runs, err := env.store.ListAutomationRuns(auto.ID, 10)
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	if len(runs) != 1 || runs[0].Status != store.AutomationRunStatusError {
		t.Fatalf("expected one error run, got %+v", runs)
	}
	if !strings.Contains(runs[0].Summary, "agent unavailable") {
		t.Fatalf("unexpected summary: %q", runs[0].Summary)
	}

	updated, err := env.store.GetAutomation(auto.ID, u.User.ID)
	if err != nil {
		t.Fatalf("get automation: %v", err)
	}
	if updated.ConsecutiveFailures != 1 {
		t.Fatalf("expected consecutiveFailures=1, got %d", updated.ConsecutiveFailures)
	}
	next, err := time.Parse(time.RFC3339, updated.NextRun)
	if err != nil || !next.After(time.Now()) {
		t.Fatalf("expected next_run in the future, got %q (%v)", updated.NextRun, err)
	}

	// A second tick must not duplicate the run (no longer due).
	env.server.schedulerTick()
	runs, _ = env.store.ListAutomationRuns(auto.ID, 10)
	if len(runs) != 1 {
		t.Fatalf("expected no additional runs on the second tick, got %d", len(runs))
	}
}

// TestSchedulerTickRunsAutomation: a due automation with a resolvable agent
// and a stubbed provider runs end to end: the task prompt is rendered and
// persisted, the assistant answer lands in the chat, and a success run is
// recorded with the token count.
func TestSchedulerTickRunsAutomation(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "sched-run@example.com")
	agentID := createTestAgent(t, env, u.User.ID, "Daily Bot")

	env.server.AIProviders["chutes"] = &stubProvider{text: "automation output"}
	auto, err := env.store.CreateAutomation(&store.Automation{
		AgentID:    agentID,
		TaskPrompt: "Summarize for {date} at {time}.",
		Schedule:   "every:15m",
	}, u.User.ID)
	if err != nil {
		t.Fatalf("create automation: %v", err)
	}
	forceAutomationDue(t, env, auto.ID)

	env.server.schedulerTick()

	runs, err := env.store.ListAutomationRuns(auto.ID, 10)
	if err != nil {
		t.Fatalf("list runs: %v", err)
	}
	if len(runs) != 1 || runs[0].Status != store.AutomationRunStatusSuccess {
		t.Fatalf("expected one success run, got %+v", runs)
	}
	if runs[0].OutputMessageID == "" || runs[0].Tokens != 7 {
		t.Fatalf("unexpected run record: %+v", runs[0])
	}

	updated, err := env.store.GetAutomation(auto.ID, u.User.ID)
	if err != nil {
		t.Fatalf("get automation: %v", err)
	}
	if updated.ChatID == "" || updated.ConsecutiveFailures != 0 {
		t.Fatalf("expected a linked chat and a reset streak, got %+v", updated)
	}

	chat, err := env.store.GetChat(updated.ChatID, u.User.ID)
	if err != nil {
		t.Fatalf("get automation chat: %v", err)
	}
	if !strings.Contains(chat.Title, "Daily Bot") {
		t.Errorf("expected the agent name in the chat title, got %q", chat.Title)
	}
	var messages []map[string]any
	if err := json.Unmarshal(chat.Messages, &messages); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected user+assistant messages, got %d", len(messages))
	}
	// The task prompt placeholders were rendered against server-local time.
	now := time.Now()
	if text := uiMessageText(messages[0]); !strings.Contains(text, now.Format("2006-01-02")) {
		t.Errorf("expected rendered {date} in the task prompt, got %q", text)
	}
	if text := uiMessageText(messages[1]); text != "automation output" {
		t.Errorf("expected the assistant answer, got %q", text)
	}
}

// TestAgentKnowledgeMetadata: agent JSON carries knowledge file metadata and
// the knowledge endpoints manage it owner-scoped.
func TestAgentKnowledgeMetadata(t *testing.T) {
	env := newAPITestEnv(t)
	owner := testUser(t, env, "know-owner@example.com")
	other := testUser(t, env, "know-other@example.com")
	agentID := createTestAgent(t, env, owner.User.ID, "Archivist")

	// Upload a knowledge file as the owner.
	rec := doMultipartRequest(t, env.handler, "POST", "/api/agents/"+agentID+"/knowledge", owner.Token,
		"notes.txt", "text/plain", []byte("hello knowledge"))
	assertStatus(t, rec, http.StatusOK)
	var upload struct {
		Attachments []*store.AttachmentInfo `json:"attachments"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &upload); err != nil {
		t.Fatalf("decode upload: %v", err)
	}
	if len(upload.Attachments) != 1 {
		t.Fatalf("expected one upload, got %+v", upload)
	}
	attachmentID := upload.Attachments[0].ID

	// Link it to the agent.
	if _, err := env.store.UpdateAgent(agentID, func(cur *store.Agent) (*store.Agent, error) {
		next := *cur
		next.Knowledge = []string{attachmentID}
		return &next, nil
	}); err != nil {
		t.Fatalf("link knowledge: %v", err)
	}

	// The agent JSON now carries the metadata.
	rec = doJSONRequest(t, env.handler, "GET", "/api/agents/"+agentID, owner.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	var agent agentJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &agent); err != nil {
		t.Fatalf("decode agent: %v", err)
	}
	if len(agent.Knowledge) != 1 || agent.Knowledge[0].ID != attachmentID ||
		agent.Knowledge[0].Filename != "notes.txt" || agent.Knowledge[0].MediaType != "text/plain; charset=utf-8" {
		t.Fatalf("unexpected knowledge metadata: %+v", agent.Knowledge)
	}

	// Other users cannot upload.
	rec = doMultipartRequest(t, env.handler, "POST", "/api/agents/"+agentID+"/knowledge", other.Token,
		"intruder.txt", "text/plain", []byte("nope"))
	assertStatus(t, rec, http.StatusNotFound)

	// The knowledge list endpoint returns the file for the form.
	rec = doJSONRequest(t, env.handler, "GET", "/api/agents/"+agentID+"/knowledge", owner.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	var meta []knowledgeMeta
	if err := json.Unmarshal(rec.Body.Bytes(), &meta); err != nil {
		t.Fatalf("decode knowledge list: %v", err)
	}
	if len(meta) != 1 || meta[0].Filename != "notes.txt" {
		t.Fatalf("unexpected knowledge list: %+v", meta)
	}

	// Foreign delete → 404.
	rec = doJSONRequest(t, env.handler, "DELETE", "/api/agents/"+agentID+"/knowledge/"+attachmentID, other.Token, nil)
	assertStatus(t, rec, http.StatusNotFound)

	// Owner delete drops the attachment and the id from the agent.
	rec = doJSONRequest(t, env.handler, "DELETE", "/api/agents/"+agentID+"/knowledge/"+attachmentID, owner.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	if _, _, err := env.store.GetAttachmentData(attachmentID, owner.User.ID); err == nil {
		t.Fatal("expected the attachment to be gone")
	}
	ag, err := env.store.GetAgentForStream(agentID, owner.User.ID)
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if len(ag.Knowledge) != 0 {
		t.Fatalf("expected the knowledge list to be empty, got %v", ag.Knowledge)
	}
}
