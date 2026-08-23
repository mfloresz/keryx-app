package api

import (
	"net/http"
)

// handleUpdateChatAgent persists (or clears) the agent selection for a chat.
// Body: {"agentId": string|null}. Owner-only, same pattern as visibility/title.
func (s *Server) handleUpdateChatAgent(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		AgentID *string `json:"agentId"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	agentID := ""
	if req.AgentID != nil {
		agentID = *req.AgentID
		if agentID != "" {
			// Validate the agent is visible to the chat owner before persisting.
			if _, err := s.Store.GetAgentForStream(agentID, userID); err != nil {
				errorResponse(w, "Agent not found or not visible", http.StatusBadRequest)
				return
			}
		}
	}

	unlock := s.lockChat(chatID)
	defer unlock()

	chat, err := s.Store.UpdateChatAgent(chatID, userID, agentID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, map[string]any{"success": true, "agentId": chat.AgentID}, http.StatusOK)
}
