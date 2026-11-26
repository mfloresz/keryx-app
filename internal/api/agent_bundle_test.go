package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// ---- tool whitelist / tool set ----

func toolNames(tools []ai.ToolDefinition) []string {
	out := make([]string, 0, len(tools))
	for _, t := range tools {
		out = append(out, t.Name)
	}
	return out
}

func contains(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// TestApplyAgentToolWhitelist: an empty whitelist keeps the defaults; a
// non-empty one restricts only the agent-selectable tools (update_artifact /
// web_search) and never touches project tools or load_skill.
func TestApplyAgentToolWhitelist(t *testing.T) {
	// Empty whitelist = defaults: everything stays.
	got := chatToolSet(chatToolOptions{
		webSearchActive: true, project: true, loadSkill: true,
	})
	if !contains(toolNames(got), "update_artifact") || !contains(toolNames(got), "web_search") {
		t.Fatalf("expected defaults to keep base tools, got %v", toolNames(got))
	}

	// Whitelist with only web_search: update_artifact drops, project tools
	// and load_skill survive untouched.
	got = chatToolSet(chatToolOptions{
		webSearchActive: true, project: true, loadSkill: true,
		agentTools: []string{store.AgentToolWebSearch},
	})
	names := toolNames(got)
	if contains(names, "update_artifact") {
		t.Errorf("update_artifact should be dropped by the whitelist, got %v", names)
	}
	if !contains(names, "web_search") || !contains(names, "ls") || !contains(names, "write_file") || !contains(names, "load_skill") {
		t.Errorf("expected search, project and load_skill tools to survive, got %v", names)
	}

	// web_search is still gated by the instance feature even when whitelisted.
	got = chatToolSet(chatToolOptions{
		webSearchActive: false, agentTools: []string{store.AgentToolWebSearch},
	})
	if contains(toolNames(got), "web_search") {
		t.Error("web_search must not be registered when the feature is inactive")
	}

	// update_artifact whitelisted but search inactive.
	got = chatToolSet(chatToolOptions{
		webSearchActive: false, agentTools: []string{store.AgentToolUpdateArtifact},
	})
	names = toolNames(got)
	if !contains(names, "update_artifact") || contains(names, "web_search") {
		t.Errorf("unexpected tool set %v", names)
	}
}

// ---- skill preloading ----

// TestResolveAgentSkillsSkipsUnknownAndDisabled: unresolvable names are
// silently skipped, disabled skills are not injected.
func TestResolveAgentSkillsSkipsUnknownAndDisabled(t *testing.T) {
	env := newAPITestEnv(t)
	if _, err := env.store.CreateSkill(&store.Skill{Name: "alpha", Instructions: "A", Enabled: true}); err != nil {
		t.Fatalf("create skill: %v", err)
	}
	if _, err := env.store.CreateSkill(&store.Skill{Name: "beta", Instructions: "B", Enabled: false}); err != nil {
		t.Fatalf("create skill: %v", err)
	}

	got := env.server.resolveAgentSkills([]string{"alpha", "ghost", "beta"})
	if len(got) != 1 || got[0].Name != "alpha" {
		t.Fatalf("expected only alpha, got %+v", got)
	}
}

// TestRenderSkillSections checks the injection headers for bound and
// user-requested (pinned) skills.
func TestRenderSkillSections(t *testing.T) {
	out := renderSkillSections([]store.Skill{{Name: "alpha", Instructions: "do A"}}, skillHeaderBound)
	if !strings.Contains(out, "\n\n### Skill: alpha\ndo A") {
		t.Fatalf("unexpected bound section: %q", out)
	}
	out = renderSkillSections([]store.Skill{{Name: "beta", Instructions: "do B"}}, skillHeaderPinned)
	if !strings.Contains(out, "\n\n### Skill (user-requested): beta\ndo B") {
		t.Fatalf("unexpected pinned section: %q", out)
	}
	if renderSkillSections(nil, skillHeaderBound) != "" {
		t.Fatal("no skills should render nothing")
	}
}

// ---- knowledge injection ----

// TestCapKnowledgeFilesDropsBeyondBudget: files accumulate in order; the
// first file that does not fit ends the section (drop everything after it).
func TestCapKnowledgeFilesDropsBeyondBudget(t *testing.T) {
	files := []knowledgeFile{
		{Filename: "a.txt", Text: strings.Repeat("a", 60)},
		{Filename: "b.txt", Text: strings.Repeat("b", 60)},
		{Filename: "c.txt", Text: strings.Repeat("c", 10)},
	}
	got := capKnowledgeFiles(files, 100)
	if len(got) != 1 || got[0].Filename != "a.txt" {
		t.Fatalf("expected only a.txt to fit, got %+v", got)
	}

	got = capKnowledgeFiles(files, 125)
	if len(got) != 2 {
		t.Fatalf("expected two files to fit, got %+v", got)
	}
	if capKnowledgeFiles(files, 1000) == nil || len(capKnowledgeFiles(files, 1000)) != 3 {
		t.Fatal("everything fits under a large budget")
	}
}

func TestBuildKnowledgeSection(t *testing.T) {
	out := buildKnowledgeSection([]knowledgeFile{{Filename: "notes.md", MediaType: "text/markdown", Text: "hello"}})
	for _, want := range []string{"### Knowledge", `<file name="notes.md" media=text/markdown>`, "hello", "</file>"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected section to contain %q, got: %s", want, out)
		}
	}
	if buildKnowledgeSection(nil) != "" {
		t.Fatal("no files should render nothing")
	}
}

// ---- automation task prompt ----

func TestRenderTaskPrompt(t *testing.T) {
	now := time.Date(2026, 10, 23, 14, 5, 0, 0, time.UTC)
	got := renderTaskPrompt("Today is {date} at {time}; again {date}.", now)
	want := "Today is 2026-10-23 at 14:05; again 2026-10-23."
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if renderTaskPrompt("no placeholders", now) != "no placeholders" {
		t.Fatal("prompt without placeholders is unchanged")
	}
}

// ---- unattended write policy ----

func TestGuardWriteTools(t *testing.T) {
	base := func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
		return "ran:" + toolName, nil
	}

	denied := guardWriteTools(base, false)
	for _, tool := range []string{"write_file", "edit_file"} {
		out, err := denied(context.Background(), tool, nil)
		if err != nil || out != "denied: unattended run" {
			t.Errorf("expected %s to be denied, got %q, %v", tool, out, err)
		}
	}
	if out, _ := denied(context.Background(), "ls", nil); out != "ran:ls" {
		t.Errorf("read tools must pass through, got %q", out)
	}

	allowed := guardWriteTools(base, true)
	if out, _ := allowed(context.Background(), "write_file", nil); out != "ran:write_file" {
		t.Errorf("expected write_file allowed when the automation permits writes, got %q", out)
	}
}

// ---- pinned skills over HTTP ----

// TestPinnedSkillsMaxFive: the stream endpoint rejects more than five pinned
// skills before any other work happens.
func TestPinnedSkillsMaxFive(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "pinned@example.com")

	body := map[string]any{
		"model":        "lmstudio/local-model",
		"messages":     []map[string]any{{"role": "user", "content": "hi"}},
		"pinnedSkills": []string{"a", "b", "c", "d", "e", "f"},
	}
	rec := doJSONRequest(t, env.handler, "POST", "/api/chats/nope/stream", u.Token, body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for six pinned skills, got %d: %s", rec.Code, rec.Body.String())
	}

	body["pinnedSkills"] = []string{"a", "b", "c", "d", "e"}
	rec = doJSONRequest(t, env.handler, "POST", "/api/chats/nope/stream", u.Token, body)
	// Five is accepted; the request now fails later on the missing chat.
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing chat with five pinned skills, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestListSkillsEndpoint: GET /api/skills exposes enabled skills only.
func TestListSkillsEndpoint(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "skills-public@example.com")
	if _, err := env.store.CreateSkill(&store.Skill{Name: "on", Description: "enabled", Enabled: true}); err != nil {
		t.Fatalf("create skill: %v", err)
	}
	if _, err := env.store.CreateSkill(&store.Skill{Name: "off", Description: "disabled", Enabled: false}); err != nil {
		t.Fatalf("create skill: %v", err)
	}

	rec := doJSONRequest(t, env.handler, "GET", "/api/skills", u.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	var skills []skillSummary
	if err := json.Unmarshal(rec.Body.Bytes(), &skills); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(skills) != 1 || skills[0].Name != "on" || skills[0].Description != "enabled" {
		t.Fatalf("unexpected skills list: %+v", skills)
	}
}
