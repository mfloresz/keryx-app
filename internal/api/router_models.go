package api

import (
	"net/http"

	"keryx-server/internal/ai"
)

func (s *Server) handleAllowedModels(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromContext(r)
	if !ok {
		errorResponse(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	models, err := s.Store.GetAllowedModels(userID)
	if err != nil {
		errorResponse(w, "Failed to get allowed models", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, models, http.StatusOK)
}

// presetResponse is returned to non-admin users — no model IDs exposed.
type presetResponse struct {
	Preset         string `json:"preset"`
	Label          string `json:"label"`
	SupportsImages bool   `json:"supportsImages"`
	SupportsSearch bool   `json:"supportsSearch"`
}

func (s *Server) handleModelPresets(w http.ResponseWriter, r *http.Request) {
	presets, err := s.Store.GetModelPresets()
	if err != nil {
		errorResponse(w, "Failed to get model presets", http.StatusInternalServerError)
		return
	}

	catalog := ai.ModelCatalog()
	catalogByID := make(map[string]ai.ModelInfo, len(catalog))
	for _, m := range catalog {
		catalogByID[m.ID] = m
	}

	out := make([]presetResponse, 0, len(presets))
	for _, p := range presets {
		info, ok := catalogByID[p.ModelID]
		out = append(out, presetResponse{
			Preset:         p.PresetID,
			Label:          p.Label,
			SupportsImages: ok && info.SupportsImages,
			SupportsSearch: ok && info.SupportsSearch,
		})
	}

	jsonResponse(w, out, http.StatusOK)
}
