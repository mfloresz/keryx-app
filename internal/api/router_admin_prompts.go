package api

import (
	"net/http"

	"keryx-server/internal/store"
)

// handleAdminGetPromptOverrides returns both global prompts with their origin.
func (s *Server) handleAdminGetPromptOverrides(w http.ResponseWriter, r *http.Request) {
	base := s.Store.GetEffectiveBasePrompt(s.Cfg.BaseSystemPrompt)
	title := s.Store.GetEffectiveTitlePrompt(s.Cfg.TitleGenerationSystemPrompt)

	jsonResponse(w, map[string]store.PromptOverride{
		"base":  base,
		"title": title,
	}, http.StatusOK)
}

// handleAdminSetPromptOverride upserts a base|title override.
func (s *Server) handleAdminSetPromptOverride(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	key := r.PathValue("key")
	if !store.ValidPromptOverrideKey(key) {
		errorResponse(w, "Invalid key", http.StatusNotFound)
		return
	}

	var req struct {
		Prompt string `json:"prompt"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Prompt) == 0 || len(req.Prompt) > 20000 {
		errorResponse(w, "Prompt must be between 1 and 20000 characters", http.StatusBadRequest)
		return
	}

	if err := s.Store.SetPromptOverride(key, req.Prompt, userID); err != nil {
		errorResponse(w, "Failed to save prompt override", http.StatusInternalServerError)
		return
	}
	auditLog(r, "prompt_override.set", key, "length", len(req.Prompt))
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// handleAdminDeletePromptOverride resets an override (falls back to embedded).
func (s *Server) handleAdminDeletePromptOverride(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if !store.ValidPromptOverrideKey(key) {
		errorResponse(w, "Invalid key", http.StatusNotFound)
		return
	}
	if err := s.Store.DeletePromptOverride(key); err != nil {
		errorResponse(w, "No override to reset", http.StatusNotFound)
		return
	}
	auditLog(r, "prompt_override.delete", key)
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}
