package api

import (
	"encoding/json"
	"net/http"
	"slices"

	"github.com/pocketbase/dbx"

	"keryx-server/internal/store"
)

// Agent knowledge: files uploaded to an agent live in the attachments
// collection with owner = uploading user and chat = "" (see the policy note
// on loadAgentKnowledge). Only users who canManageAgent may upload; deletes
// are owner-scoped to the attachment's owner.

// knowledgeMeta is the per-file metadata the agent form renders.
type knowledgeMeta struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
}

// agentJSON is the API representation of an agent: the store Agent fields
// plus its knowledge resolved to file metadata (best-effort; missing ids are
// dropped). The outer Knowledge field shadows the embedded id list.
type agentJSON struct {
	store.Agent
	Knowledge []knowledgeMeta `json:"knowledge"`
}

// agentKnowledgeMeta resolves attachment ids to metadata, owner-scoped to
// ownerID; unknown or foreign ids are silently dropped. Direct record lookups
// keep this cheap (no file bytes are read).
func (s *Server) agentKnowledgeMeta(ids []string, ownerID string) []knowledgeMeta {
	if len(ids) == 0 {
		return nil
	}
	out := make([]knowledgeMeta, 0, len(ids))
	for _, id := range ids {
		record, err := s.Store.App.FindFirstRecordByFilter(
			store.AttachmentsCollection,
			"id = {:id} && owner = {:owner}",
			dbx.Params{"id": id, "owner": ownerID},
		)
		if err != nil {
			continue
		}
		out = append(out, knowledgeMeta{
			ID:        record.Id,
			Filename:  record.GetString("filename"),
			MediaType: record.GetString("media_type"),
			Size:      int64(record.GetInt("size")),
		})
	}
	return out
}

// agentResponse wraps an agent for JSON responses. Knowledge metadata is
// resolved against the agent's owner when it has one (user-owned agents own
// their files); for global agents (no owner) it falls back to the requesting
// user, which is how an admin sees the files they uploaded to a global agent.
func (s *Server) agentResponse(ag *store.Agent, requesterID string) agentJSON {
	owner := ag.OwnerID
	if owner == "" {
		owner = requesterID
	}
	return agentJSON{Agent: *ag, Knowledge: s.agentKnowledgeMeta(ag.Knowledge, owner)}
}

// canManageAgentByID reports whether the caller may upload/delete knowledge
// on the agent record.
func (s *Server) canManageAgentByID(agentID, userID string, isAdmin bool) (*store.AgentRecordView, bool) {
	record, err := s.Store.GetAgentRecord(agentID)
	if err != nil {
		return nil, false
	}
	view := &store.AgentRecordView{
		ID:      record.Id,
		OwnerID: record.GetString("owner"),
	}
	return view, canManageAgent(view, userID, isAdmin)
}

// handleUploadAgentKnowledge accepts the same multipart shape as the chat
// attachment upload and stores the files as the uploading user's knowledge
// for the agent (chat = "").
func (s *Server) handleUploadAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	isAdmin := s.isRequestAdmin(r)
	agentID := r.PathValue("id")

	if _, ok := s.canManageAgentByID(agentID, userID, isAdmin); !ok {
		errorResponse(w, "Agent not found", http.StatusNotFound)
		return
	}

	uploaded, ok := s.saveUploadedFiles(w, r, "", userID)
	if !ok {
		return
	}
	jsonResponse(w, map[string]any{"attachments": uploaded}, http.StatusOK)
}

// handleListAgentKnowledge returns the metadata of the agent's knowledge
// files (best-effort; missing ids dropped), for the agent form.
func (s *Server) handleListAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	agentID := r.PathValue("id")

	ag, err := s.Store.GetAgentForStream(agentID, userID)
	if err != nil {
		errorResponse(w, "Agent not found", http.StatusNotFound)
		return
	}
	owner := ag.OwnerID
	if owner == "" {
		// Global agent: files resolve only against the requesting user
		// (the admin who uploaded them).
		owner = userID
	}
	meta := s.agentKnowledgeMeta(ag.Knowledge, owner)
	if meta == nil {
		meta = []knowledgeMeta{}
	}
	jsonResponse(w, meta, http.StatusOK)
}

// handleDeleteAgentKnowledge removes one knowledge attachment, owner-scoped.
func (s *Server) handleDeleteAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	isAdmin := s.isRequestAdmin(r)
	agentID := r.PathValue("id")
	attachmentID := r.PathValue("attachmentId")

	view, ok := s.canManageAgentByID(agentID, userID, isAdmin)
	if !ok {
		errorResponse(w, "Agent not found", http.StatusNotFound)
		return
	}

	// The attachment must belong to the agent's knowledge list and to the
	// agent's owner (the uploading user).
	ids := s.knowledgeOf(agentID)
	if !slices.Contains(ids, attachmentID) {
		errorResponse(w, "Attachment is not part of this agent's knowledge", http.StatusNotFound)
		return
	}
	owner := view.OwnerID
	if owner == "" {
		owner = userID
	}
	record, err := s.Store.App.FindFirstRecordByFilter(
		store.AttachmentsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": attachmentID, "owner": owner},
	)
	if err != nil {
		errorResponse(w, "Attachment not found", http.StatusNotFound)
		return
	}
	if err := s.Store.App.Delete(record); err != nil {
		internalError(w, r, "Failed to delete attachment", err)
		return
	}
	// Drop the id from the agent's knowledge list.
	remaining := make([]string, 0, len(ids))
	for _, id := range ids {
		if id != attachmentID {
			remaining = append(remaining, id)
		}
	}
	if _, err := s.Store.UpdateAgent(agentID, func(cur *store.Agent) (*store.Agent, error) {
		next := *cur
		next.Knowledge = remaining
		return &next, nil
	}); err != nil {
		internalError(w, r, "Failed to update agent knowledge", err)
		return
	}
	auditLog(r, "agent.knowledge.delete", agentID, "attachmentId", attachmentID, "owner", view.OwnerID)
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// knowledgeOf loads the agent record's current knowledge id list (empty when
// the record is gone).
func (s *Server) knowledgeOf(agentID string) []string {
	ag, err := s.Store.GetAgentRecord(agentID)
	if err != nil {
		return nil
	}
	raw := ag.GetString("knowledge")
	if raw == "" {
		return nil
	}
	var ids []string
	if json.Unmarshal([]byte(raw), &ids) != nil {
		return nil
	}
	return ids
}
