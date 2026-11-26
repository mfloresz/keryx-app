package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"keryx-server/internal/store"
)

// TestAdminSkillsCRUD exercises the admin skill routes end to end: admin
// gating, create, duplicate-name rejection, list, update and delete.
func TestAdminSkillsCRUD(t *testing.T) {
	env := newAPITestEnv(t)
	admin := testUser(t, env, "skills-admin@example.com")
	if err := env.store.UpdateUserRole(admin.User.ID, store.RoleAdmin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	user := testUser(t, env, "skills-user@example.com")

	// Non-admins are rejected.
	rec := doJSONRequest(t, env.handler, "GET", "/api/admin/skills", user.Token, nil)
	assertStatus(t, rec, http.StatusForbidden)

	// Empty list first.
	rec = doJSONRequest(t, env.handler, "GET", "/api/admin/skills", admin.Token, nil)
	assertStatus(t, rec, http.StatusOK)

	// Create.
	rec = doJSONRequest(t, env.handler, "POST", "/api/admin/skills", admin.Token, map[string]any{
		"name":         "spanish-tone",
		"description":  "Write in a warm Spanish tone",
		"instructions": "# Tono\nSé cálido.",
		"enabled":      true,
	})
	assertStatus(t, rec, http.StatusCreated)
	var created store.Skill
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if created.ID == "" || created.Name != "spanish-tone" || !created.Enabled {
		t.Fatalf("unexpected created skill: %+v", created)
	}

	// Duplicate name is rejected.
	rec = doJSONRequest(t, env.handler, "POST", "/api/admin/skills", admin.Token, map[string]any{
		"name": "spanish-tone",
	})
	assertStatus(t, rec, http.StatusBadRequest)

	// A skill without a name is rejected.
	rec = doJSONRequest(t, env.handler, "POST", "/api/admin/skills", admin.Token, map[string]any{
		"description": "nameless",
	})
	assertStatus(t, rec, http.StatusBadRequest)

	// List contains the created skill.
	rec = doJSONRequest(t, env.handler, "GET", "/api/admin/skills", admin.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	var skills []store.Skill
	if err := json.Unmarshal(rec.Body.Bytes(), &skills); err != nil {
		t.Fatalf("decode list response: %v", err)
	}
	if len(skills) != 1 || skills[0].ID != created.ID {
		t.Fatalf("unexpected skill list: %+v", skills)
	}

	// Update: disable and rename.
	rec = doJSONRequest(t, env.handler, "PUT", "/api/admin/skills/"+created.ID, admin.Token, map[string]any{
		"name":         "spanish-tone-v2",
		"description":  "Updated",
		"instructions": "# Tono v2",
		"enabled":      false,
	})
	assertStatus(t, rec, http.StatusOK)
	var updated store.Skill
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if updated.Name != "spanish-tone-v2" || updated.Enabled {
		t.Fatalf("unexpected updated skill: %+v", updated)
	}

	// Unknown id on update → 404.
	rec = doJSONRequest(t, env.handler, "PUT", "/api/admin/skills/zzz", admin.Token, map[string]any{
		"name": "whatever",
	})
	assertStatus(t, rec, http.StatusNotFound)

	// Delete, then delete again → 404.
	rec = doJSONRequest(t, env.handler, "DELETE", "/api/admin/skills/"+created.ID, admin.Token, nil)
	assertStatus(t, rec, http.StatusOK)
	rec = doJSONRequest(t, env.handler, "DELETE", "/api/admin/skills/"+created.ID, admin.Token, nil)
	assertStatus(t, rec, http.StatusNotFound)
}

// TestLoadSkillToolExec: the load_skill tool resolves enabled skills and
// softly reports unknown or disabled ones.
func TestLoadSkillToolExec(t *testing.T) {
	env := newAPITestEnv(t)

	// Unknown name.
	out, err := env.server.execLoadSkillTool([]byte(`{"name":"nope"}`))
	if err != nil {
		t.Fatalf("exec load_skill: %v", err)
	}
	if out != "Skill not found." {
		t.Fatalf("expected 'Skill not found.', got %q", out)
	}

	// Disabled skill is not loadable.
	if _, err := env.store.CreateSkill(&store.Skill{Name: "off-skill", Instructions: "hidden", Enabled: false}); err != nil {
		t.Fatalf("create skill: %v", err)
	}
	out, err = env.server.execLoadSkillTool([]byte(`{"name":"off-skill"}`))
	if err != nil {
		t.Fatalf("exec load_skill: %v", err)
	}
	if out != "Skill not found." {
		t.Fatalf("expected disabled skills to be 'Skill not found.', got %q", out)
	}

	// Enabled skill returns its instructions.
	if _, err := env.store.CreateSkill(&store.Skill{Name: "on-skill", Instructions: "# Do this", Enabled: true}); err != nil {
		t.Fatalf("create skill: %v", err)
	}
	out, err = env.server.execLoadSkillTool([]byte(`{"name":"on-skill"}`))
	if err != nil {
		t.Fatalf("exec load_skill: %v", err)
	}
	if out != "# Do this" {
		t.Fatalf("expected instructions, got %q", out)
	}
}

// TestBuildSkillsPrompt lists every enabled skill in the prompt section.
func TestBuildSkillsPrompt(t *testing.T) {
	out := buildSkillsPrompt([]store.Skill{
		{Name: "a", Description: "first"},
		{Name: "b", Description: "second"},
	})
	for _, want := range []string{"### Skills", "load_skill", "- a: first", "- b: second"} {
		if !strings.Contains(out, want) {
			t.Errorf("expected prompt to contain %q, got: %s", want, out)
		}
	}
}
