package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// skillRequest is the create/update body for admin skill routes.
type skillRequest struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	Instructions string `json:"instructions"`
	Enabled      bool   `json:"enabled"`
}

// skillErrorResponse maps store sentinel errors to HTTP statuses.
func skillErrorResponse(w http.ResponseWriter, r *http.Request, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		errorResponse(w, "Skill not found", http.StatusNotFound)
	case errors.Is(err, store.ErrInvalid):
		errorResponse(w, "Invalid skill: name is required and must be unique", http.StatusBadRequest)
	default:
		internalError(w, r, fallback, err)
	}
}

// ---- User routes ----

// skillSummary is the public shape of GET /api/skills.
type skillSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// handleListSkills returns the enabled skills for authenticated users (names
// and descriptions only), so clients can offer pinning.
func (s *Server) handleListSkills(w http.ResponseWriter, r *http.Request) {
	skills, err := s.Store.ListEnabledSkills()
	if err != nil {
		internalError(w, r, "Failed to list skills", err)
		return
	}
	out := make([]skillSummary, 0, len(skills))
	for _, sk := range skills {
		out = append(out, skillSummary{Name: sk.Name, Description: sk.Description})
	}
	jsonResponse(w, out, http.StatusOK)
}

// handleAdminListSkills returns every skill (enabled and disabled).
func (s *Server) handleAdminListSkills(w http.ResponseWriter, r *http.Request) {
	skills, err := s.Store.ListSkills()
	if err != nil {
		internalError(w, r, "Failed to list skills", err)
		return
	}
	if skills == nil {
		skills = []store.Skill{}
	}
	jsonResponse(w, skills, http.StatusOK)
}

// handleAdminCreateSkill inserts a skill.
func (s *Server) handleAdminCreateSkill(w http.ResponseWriter, r *http.Request) {
	var req skillRequest
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	skill, err := s.Store.CreateSkill(&store.Skill{
		Name:         req.Name,
		Description:  req.Description,
		Instructions: req.Instructions,
		Enabled:      req.Enabled,
	})
	if err != nil {
		skillErrorResponse(w, r, err, "Failed to create skill")
		return
	}
	auditLog(r, "skill.create", skill.ID, "name", skill.Name)
	jsonResponse(w, skill, http.StatusCreated)
}

// handleAdminUpdateSkill edits an existing skill.
func (s *Server) handleAdminUpdateSkill(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req skillRequest
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	skill, err := s.Store.UpdateSkill(id, &store.Skill{
		Name:         req.Name,
		Description:  req.Description,
		Instructions: req.Instructions,
		Enabled:      req.Enabled,
	})
	if err != nil {
		skillErrorResponse(w, r, err, "Failed to update skill")
		return
	}
	auditLog(r, "skill.update", id, "name", skill.Name)
	jsonResponse(w, skill, http.StatusOK)
}

// handleAdminDeleteSkill removes a skill.
func (s *Server) handleAdminDeleteSkill(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.Store.DeleteSkill(id); err != nil {
		skillErrorResponse(w, r, err, "Failed to delete skill")
		return
	}
	auditLog(r, "skill.delete", id)
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// ---- load_skill tool (stream side) ----

// loadSkillToolInputSchema is the JSON Schema for the load_skill tool.
const loadSkillToolInputSchema = `{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The name of the skill to load, exactly as listed in the Skills section"
    }
  },
  "required": ["name"]
}`

// buildLoadSkillToolDefinition returns the tool that loads a skill's full
// instructions on demand (progressive disclosure).
func buildLoadSkillToolDefinition() ai.ToolDefinition {
	return ai.ToolDefinition{
		Name:        "load_skill",
		Description: "Load the detailed instructions of a skill by name. Use it when the current task matches one of the available skills before attempting the task.",
		InputSchema: loadSkillToolInputSchema,
	}
}

// buildSkillsPrompt returns the system prompt section advertising the
// available skills. Only names and descriptions go into the prompt; the full
// instructions are fetched via load_skill when a task matches.
func buildSkillsPrompt(skills []store.Skill) string {
	out := "\n\n### Skills\nYou can load a skill's detailed instructions with the load_skill tool when a task matches. Available skills:\n"
	for _, sk := range skills {
		out += "- " + sk.Name + ": " + sk.Description + "\n"
	}
	return out
}

// execLoadSkillTool resolves one skill by name; unknown or disabled skills
// yield a soft "not found" tool output so the model can course-correct.
func (s *Server) execLoadSkillTool(input json.RawMessage) (string, error) {
	var params struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid load_skill params: %w", err)
	}
	skill, err := s.Store.GetSkillByName(strings.TrimSpace(params.Name))
	if err != nil || !skill.Enabled {
		return "Skill not found.", nil
	}
	return skill.Instructions, nil
}
