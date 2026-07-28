package api

import (
	"net/http"
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
