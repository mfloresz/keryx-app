package api

import (
	"errors"
	"net/http"

	"keryx-server/internal/store"
)

// isRequestAdmin reports whether the authenticated user has the admin role.
func (s *Server) isRequestAdmin(r *http.Request) bool {
	role, _ := r.Context().Value(contextKeyUserRole).(string)
	return role == store.RoleAdmin
}

// agentVisibilityError maps store errors to HTTP responses.
func agentErrorResponse(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		errorResponse(w, "Agent not found", http.StatusNotFound)
	case errors.Is(err, store.ErrInvalid):
		errorResponse(w, "Invalid agent data (check lengths: name 1-80, prompt 1-10000)", http.StatusBadRequest)
	case errors.Is(err, store.ErrLimitReached):
		errorResponse(w, "Agent limit reached (50)", http.StatusBadRequest)
	case errors.Is(err, store.ErrForbidden):
		errorResponse(w, "Not allowed", http.StatusForbidden)
	default:
		errorResponse(w, fallback, http.StatusInternalServerError)
	}
}

// canManageAgent reports whether userID may update/delete the record:
// own records always; global records only for admins.
func canManageAgent(record *store.AgentRecordView, userID string, isAdmin bool) bool {
	if record.OwnerID == userID {
		return true
	}
	return isAdmin && record.OwnerID == ""
}

// ---- User routes (/api/agents) ----

func (s *Server) handleListAgents(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	isAdmin := s.isRequestAdmin(r)
	agents, err := s.Store.ListEffectiveAgents(userID, isAdmin)
	if err != nil {
		agentErrorResponse(w, err, "Failed to list agents")
		return
	}
	out := make([]agentJSON, 0, len(agents))
	for i := range agents {
		out = append(out, s.agentResponse(&agents[i], userID))
	}
	jsonResponse(w, out, http.StatusOK)
}

func (s *Server) handleGetAgent(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	ag, err := s.Store.GetAgentForStream(id, userID)
	if err != nil {
		agentErrorResponse(w, err, "Failed to get agent")
		return
	}
	jsonResponse(w, s.agentResponse(ag, userID), http.StatusOK)
}

// agentBundleFields is the bundle part of the agent create/update bodies.
// Store.CreateAgent/UpdateAgent validate the values (allowed tools, sizes,
// caps) and reject violations with store.ErrInvalid.
type agentBundleFields struct {
	Tools          []string `json:"tools"`
	Skills         []string `json:"skills"`
	Knowledge      []string `json:"knowledge"`
	StarterPrompts []string `json:"starterPrompts"`
}

func (s *Server) handleCreateAgent(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	var req struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		SystemPrompt string `json:"systemPrompt"`
		Icon         string `json:"icon"`
		agentBundleFields
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	ag, err := s.Store.CreateAgent(&store.Agent{
		Name:           req.Name,
		Description:    req.Description,
		Icon:           req.Icon,
		SystemPrompt:   req.SystemPrompt,
		Tools:          req.Tools,
		Skills:         req.Skills,
		Knowledge:      req.Knowledge,
		StarterPrompts: req.StarterPrompts,
	}, userID, "")
	if err != nil {
		agentErrorResponse(w, err, "Failed to create agent")
		return
	}
	auditLog(r, "agent.create", ag.ID, "owner", userID)
	ag.Source = store.AgentSourceUserCustom
	jsonResponse(w, s.agentResponse(ag, userID), http.StatusCreated)
}

func (s *Server) handleUpdateAgent(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	isAdmin := s.isRequestAdmin(r)
	id := r.PathValue("id")

	record, err := s.Store.GetAgentRecord(id)
	if err != nil {
		errorResponse(w, "Agent not found", http.StatusNotFound)
		return
	}
	view := &store.AgentRecordView{
		ID:      record.Id,
		OwnerID: record.GetString("owner"),
	}
	if !canManageAgent(view, userID, isAdmin) {
		errorResponse(w, "Not allowed", http.StatusForbidden)
		return
	}

	var req struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		SystemPrompt string `json:"systemPrompt"`
		Icon         string `json:"icon"`
		// Bundle fields are pointers so an omitted field keeps the stored
		// value while an explicit list (even empty) replaces it.
		Tools          *[]string `json:"tools"`
		Skills         *[]string `json:"skills"`
		Knowledge      *[]string `json:"knowledge"`
		StarterPrompts *[]string `json:"starterPrompts"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	updated, err := s.Store.UpdateAgent(id, func(cur *store.Agent) (*store.Agent, error) {
		next := *cur
		if req.Name != "" {
			next.Name = req.Name
		}
		if req.Description != "" || req.SystemPrompt != "" || req.Name != "" {
			next.Description = req.Description
		}
		if req.Icon != "" || req.Name != "" {
			next.Icon = req.Icon
		}
		if req.SystemPrompt != "" {
			next.SystemPrompt = req.SystemPrompt
		}
		if req.Tools != nil {
			next.Tools = *req.Tools
		}
		if req.Skills != nil {
			next.Skills = *req.Skills
		}
		if req.Knowledge != nil {
			next.Knowledge = *req.Knowledge
		}
		if req.StarterPrompts != nil {
			next.StarterPrompts = *req.StarterPrompts
		}
		return &next, nil
	})
	if err != nil {
		agentErrorResponse(w, err, "Failed to update agent")
		return
	}
	if view.OwnerID == "" && view.ID != "" {
		// Editing a global custom in place; source stays global_custom.
		updated.Source = store.AgentSourceGlobalCustom
	} else {
		updated.Source = store.AgentSourceUserCustom
	}
	auditLog(r, "agent.update", id, "owner", view.OwnerID)
	jsonResponse(w, s.agentResponse(updated, userID), http.StatusOK)
}

func (s *Server) handleDeleteAgent(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	isAdmin := s.isRequestAdmin(r)
	id := r.PathValue("id")

	record, err := s.Store.GetAgentRecord(id)
	if err != nil {
		errorResponse(w, "Agent not found", http.StatusNotFound)
		return
	}
	view := &store.AgentRecordView{
		ID:        record.Id,
		OwnerID:   record.GetString("owner"),
		BuiltinID: record.GetString("builtin_id"),
	}
	if !canManageAgent(view, userID, isAdmin) {
		errorResponse(w, "Not allowed", http.StatusForbidden)
		return
	}

	if err := s.Store.DeleteAgent(id); err != nil {
		agentErrorResponse(w, err, "Failed to delete agent")
		return
	}
	auditLog(r, "agent.delete", id, "builtinId", view.BuiltinID, "owner", view.OwnerID)
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleDuplicateAgent(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	ag, err := s.Store.DuplicateAgent(id, userID)
	if err != nil {
		agentErrorResponse(w, err, "Failed to duplicate agent")
		return
	}
	ag.Source = store.AgentSourceUserCustom
	auditLog(r, "agent.duplicate", id, "newId", ag.ID, "owner", userID)
	jsonResponse(w, ag, http.StatusCreated)
}

// ---- Admin routes (/api/admin/agents) ----

func (s *Server) handleAdminListAgents(w http.ResponseWriter, r *http.Request) {
	s.handleListAgents(w, r)
}

func (s *Server) handleAdminCreateAgent(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name         string `json:"name"`
		Description  string `json:"description"`
		SystemPrompt string `json:"systemPrompt"`
		Icon         string `json:"icon"`
		BuiltinID    string `json:"builtinId"`
		agentBundleFields
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	ag, err := s.Store.CreateAgent(&store.Agent{
		Name:           req.Name,
		Description:    req.Description,
		Icon:           req.Icon,
		SystemPrompt:   req.SystemPrompt,
		Tools:          req.Tools,
		Skills:         req.Skills,
		Knowledge:      req.Knowledge,
		StarterPrompts: req.StarterPrompts,
	}, "", req.BuiltinID)
	if err != nil {
		agentErrorResponse(w, err, "Failed to create agent")
		return
	}
	if req.BuiltinID != "" {
		ag.ID = req.BuiltinID
		ag.BuiltinID = req.BuiltinID
		ag.Source = store.AgentSourceOverride
	} else {
		ag.Source = store.AgentSourceGlobalCustom
	}
	auditLog(r, "agent.create_global", ag.ID, "builtinId", req.BuiltinID)
	adminID, _ := userIDFromContext(r)
	jsonResponse(w, s.agentResponse(ag, adminID), http.StatusCreated)
}

func (s *Server) handleAdminUpdateAgent(w http.ResponseWriter, r *http.Request) {
	// Admins edit globals via the same handler; authorization allows admin on globals.
	s.handleUpdateAgent(w, r)
}

func (s *Server) handleAdminDeleteAgent(w http.ResponseWriter, r *http.Request) {
	// Deleting a builtin override resets to catalog; deleting a global custom removes it.
	s.handleDeleteAgent(w, r)
}
