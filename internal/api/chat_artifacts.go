package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"keryx-server/internal/ai"
)

// ---- update_artifact tool ----

// artifactToolInputSchema is the JSON Schema for the update_artifact tool.
const artifactToolInputSchema = `{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Short human-readable title of the artifact"
    },
    "artifactType": {
      "type": "string",
      "enum": ["html", "markdown"],
      "description": "Format of the artifact: 'html' for a single-file HTML page, 'markdown' for a Markdown document"
    },
    "content": {
      "type": "string",
      "description": "The complete artifact content (the full HTML page or Markdown document)"
    }
  },
  "required": ["title", "artifactType", "content"]
}`

// buildArtifactToolDefinition returns the tool the model uses to publish a
// standalone document for the user. Registered for every chat.
func buildArtifactToolDefinition() ai.ToolDefinition {
	return ai.ToolDefinition{
		Name: "update_artifact",
		Description: "Publish a standalone document (artifact) for the user: a single-file HTML page or a Markdown document. " +
			"Use it instead of pasting large documents into the chat reply — the artifact opens in a dedicated viewer and is kept as a versioned copy in the chat. " +
			"Send the complete content in one call; calling it again with the same title updates that artifact (a new version is kept).",
		InputSchema: artifactToolInputSchema,
	}
}

// artifactUpdate describes one saved artifact version, reported to the run
// goroutine so it can broadcast the event and persist the part with the
// assistant message.
type artifactUpdate struct {
	ArtifactID   string
	Title        string
	ArtifactType string
	Version      int
}

// execUpdateArtifactTool saves one artifact version. An existing artifact is
// matched by case-insensitive title and bumped to the next version; a new
// title starts a fresh artifact at version 1. onResult is invoked after a
// successful save.
func (s *Server) execUpdateArtifactTool(chatID string, input json.RawMessage, onResult func(artifactUpdate)) (string, error) {
	var params struct {
		Title        string `json:"title"`
		ArtifactType string `json:"artifactType"`
		Content      string `json:"content"`
	}
	if err := json.Unmarshal(input, &params); err != nil {
		return "", fmt.Errorf("invalid update_artifact params: %w", err)
	}
	title := strings.TrimSpace(params.Title)
	typ := strings.ToLower(strings.TrimSpace(params.ArtifactType))
	if title == "" || params.Content == "" {
		return "", fmt.Errorf("update_artifact requires a non-empty title and content")
	}
	if typ != "html" && typ != "markdown" {
		return "", fmt.Errorf(`update_artifact artifactType must be "html" or "markdown"`)
	}

	artifactID := ""
	version := 1
	if latest, err := s.Store.LatestChatArtifacts(chatID); err == nil {
		for _, a := range latest {
			if strings.EqualFold(a.Title, title) {
				artifactID = a.ArtifactID
				version = a.Version + 1
				break
			}
		}
	}
	if artifactID == "" {
		artifactID = "art_" + uuid.NewString()
	}

	if err := s.Store.SaveChatArtifact(chatID, artifactID, title, typ, params.Content, version); err != nil {
		return "", err
	}

	upd := artifactUpdate{ArtifactID: artifactID, Title: title, ArtifactType: typ, Version: version}
	if onResult != nil {
		onResult(upd)
	}
	return fmt.Sprintf("Artifact '%s' saved as version %d.", title, version), nil
}

// handleGetChatArtifact serves one stored artifact version
// (GET /api/chats/{id}/artifacts/{artifactId}?version=N, latest when absent).
func (s *Server) handleGetChatArtifact(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")
	artifactID := r.PathValue("artifactId")

	// Owner check: artifacts are only exposed to the chat's owner.
	if _, err := s.Store.GetChat(chatID, userID); err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	version := 0
	if v := r.URL.Query().Get("version"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			version = n
		}
	}

	art, err := s.Store.GetChatArtifact(chatID, artifactID, version)
	if err != nil {
		errorResponse(w, "Artifact not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, map[string]any{
		"artifactId": art.ArtifactID,
		"title":      art.Title,
		"type":       art.Type,
		"version":    art.Version,
		"content":    art.Content,
		"createdAt":  art.CreatedAt,
	}, http.StatusOK)
}
