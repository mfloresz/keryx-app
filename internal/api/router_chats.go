package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

func (s *Server) handleListChats(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chats, err := s.Store.ListChats(userID)
	if err != nil {
		errorResponse(w, "Failed to list chats", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, chats, http.StatusOK)
}

func (s *Server) handleSaveChat(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	var chat store.ChatRecord
	if err := readJSONBody(r, &chat); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	saved, err := s.Store.SaveChat(&chat, userID)
	if err != nil {
		errorResponse(w, "Failed to save chat: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, saved, http.StatusOK)
}

func (s *Server) handleGetChat(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, chat, http.StatusOK)
}

func (s *Server) handleDeleteChat(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	if err := s.Store.DeleteChat(chatID, userID); err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleDeleteAllChats(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	if err := s.Store.DeleteAllChats(userID); err != nil {
		errorResponse(w, "Failed to delete chats", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleUpdateChatTitle(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		Title string `json:"title"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	chat, err := s.Store.UpdateChatTitle(chatID, userID, req.Title)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, chat, http.StatusOK)
}

func (s *Server) handleUpdateChatVisibility(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		Visibility string `json:"visibility"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Visibility != store.VisibilityPublic && req.Visibility != store.VisibilityPrivate {
		errorResponse(w, "Invalid visibility value", http.StatusBadRequest)
		return
	}

	chat, err := s.Store.UpdateChatVisibility(chatID, userID, req.Visibility)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, chat, http.StatusOK)
}

func (s *Server) handleDeleteMessages(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		MessageID string `json:"messageId"`
		Type      string `json:"type"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	var messages []map[string]any
	if err := json.Unmarshal(chat.Messages, &messages); err != nil {
		errorResponse(w, "Failed to parse messages", http.StatusInternalServerError)
		return
	}

	targetIndex := -1
	for i, msg := range messages {
		id, _ := msg["id"].(string)
		if id == req.MessageID {
			targetIndex = i
			break
		}
	}
	if targetIndex == -1 {
		errorResponse(w, "Message not found", http.StatusNotFound)
		return
	}

	targetRole, _ := messages[targetIndex]["role"].(string)
	if req.Type == "edit" && targetRole != "user" {
		errorResponse(w, "Can only edit user messages", http.StatusBadRequest)
		return
	}
	if req.Type == "regenerate" && targetRole != "assistant" {
		errorResponse(w, "Can only regenerate assistant messages", http.StatusBadRequest)
		return
	}

	if req.Type == "regenerate" {
		if targetIndex > 0 {
			messages = messages[:targetIndex]
		} else {
			messages = messages[:1]
		}
	} else {
		messages = messages[:targetIndex+1]
	}

	chat.Messages, _ = json.Marshal(messages)
	if _, err := s.Store.SaveChat(chat, userID); err != nil {
		errorResponse(w, "Failed to save chat", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleSwitchBranch(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		RootMessageID string `json:"rootMessageId"`
		SnapshotID    string `json:"snapshotId"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	var branches map[string]any
	if chat.Branches != nil {
		json.Unmarshal(chat.Branches, &branches)
	}
	if branches == nil {
		branches = make(map[string]any)
	}

	branchState, ok := branches[req.RootMessageID].(map[string]any)
	if !ok {
		errorResponse(w, "Branch not found", http.StatusNotFound)
		return
	}

	snapshots, _ := branchState["snapshots"].([]any)
	var snapshot map[string]any
	for _, s := range snapshots {
		if sm, ok := s.(map[string]any); ok {
			if sm["id"] == req.SnapshotID {
				snapshot = sm
				break
			}
		}
	}
	if snapshot == nil {
		errorResponse(w, "Snapshot not found", http.StatusNotFound)
		return
	}

	snapshotMessages, _ := snapshot["messages"].([]any)

	var messages []map[string]any
	json.Unmarshal(chat.Messages, &messages)

	rootIndex := -1
	for i, msg := range messages {
		id, _ := msg["id"].(string)
		if id == req.RootMessageID {
			rootIndex = i
			break
		}
	}
	if rootIndex == -1 {
		errorResponse(w, "Branch root not found", http.StatusNotFound)
		return
	}

	includeRoot, _ := branchState["includeRoot"].(bool)
	startIndex := rootIndex
	if !includeRoot {
		startIndex = rootIndex + 1
	}

	newMessages := messages[:startIndex]
	for _, sm := range snapshotMessages {
		newMessages = append(newMessages, sm.(map[string]any))
	}
	chat.Messages, _ = json.Marshal(newMessages)
	branchState["currentSnapshotId"] = req.SnapshotID
	branches[req.RootMessageID] = branchState
	chat.Branches, _ = json.Marshal(branches)

	if _, err := s.Store.SaveChat(chat, userID); err != nil {
		errorResponse(w, "Failed to save chat", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, chat, http.StatusOK)
}

func (s *Server) handleGetVotes(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	var votes []any
	if chat.Votes != nil {
		json.Unmarshal(chat.Votes, &votes)
	}
	if votes == nil {
		votes = make([]any, 0)
	}
	jsonResponse(w, votes, http.StatusOK)
}

func (s *Server) handleSaveVote(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		MessageID string `json:"messageId"`
		IsUpvoted *bool  `json:"isUpvoted"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	var messages []map[string]any
	json.Unmarshal(chat.Messages, &messages)

	found := false
	for _, msg := range messages {
		id, _ := msg["id"].(string)
		if id == req.MessageID {
			role, _ := msg["role"].(string)
			if role != "assistant" {
				errorResponse(w, "Can only vote on assistant messages", http.StatusBadRequest)
				return
			}
			found = true
			break
		}
	}
	if !found {
		errorResponse(w, "Message not found", http.StatusNotFound)
		return
	}

	var votes []map[string]any
	json.Unmarshal(chat.Votes, &votes)
	if votes == nil {
		votes = make([]map[string]any, 0)
	}

	if req.IsUpvoted == nil {
		var newVotes []map[string]any
		for _, v := range votes {
			if v["messageId"] != req.MessageID {
				newVotes = append(newVotes, v)
			}
		}
		votes = newVotes
	} else {
		existing := false
		for i, v := range votes {
			if v["messageId"] == req.MessageID {
				votes[i]["isUpvoted"] = *req.IsUpvoted
				existing = true
				break
			}
		}
		if !existing {
			votes = append(votes, map[string]any{
				"chatId":    chatID,
				"messageId": req.MessageID,
				"isUpvoted": *req.IsUpvoted,
			})
		}
	}

	chat.Votes, _ = json.Marshal(votes)
	if _, err := s.Store.SaveChat(chat, userID); err != nil {
		errorResponse(w, "Failed to save vote", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]any{
		"chatId":    chatID,
		"messageId": req.MessageID,
		"isUpvoted": req.IsUpvoted,
	}, http.StatusOK)
}

func (s *Server) handleListFavorites(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	favorites, err := s.Store.ListFavorites(userID)
	if err != nil {
		errorResponse(w, "Failed to list favorites", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, favorites, http.StatusOK)
}

// handleChatStream handles streaming chat completions via SSE.
func (s *Server) handleChatStream(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		Model        string           `json:"model"`
		Messages     []ai.ChatMessage `json:"messages"`
		System       string           `json:"system"`
		WebSearch    bool             `json:"webSearch"`
		SearchEngine string           `json:"searchEngine"`
		Language     string           `json:"language"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Model == "" {
		errorResponse(w, "Missing model", http.StatusBadRequest)
		return
	}

	if len(req.Messages) == 0 {
		errorResponse(w, "Missing messages", http.StatusBadRequest)
		return
	}
	var filtered []ai.ChatMessage
	for _, m := range req.Messages {
		if m.Role != "user" && m.Role != "assistant" {
			errorResponse(w, fmt.Sprintf("Invalid message role: %q", m.Role), http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(m.Content) == "" {
			continue
		}
		filtered = append(filtered, m)
	}
	if len(filtered) == 0 || filtered[len(filtered)-1].Role != "user" {
		errorResponse(w, "Last message must be a non-empty user message", http.StatusBadRequest)
		return
	}
	req.Messages = filtered

	if err := s.Store.AssertModelAllowed(userID, req.Model); err != nil {
		errorResponse(w, "Model not allowed", http.StatusForbidden)
		return
	}

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	provider, resolvedModel, err := s.getProviderForModel(req.Model)
	if err != nil {
		errorResponse(w, "Failed to get provider: "+err.Error(), http.StatusInternalServerError)
		return
	}

	systemPrompt := req.System
	if systemPrompt == "" {
		systemPrompt = baseSystemPrompt
	}
	if req.WebSearch {
		systemPrompt += webSearchPrompt
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		errorResponse(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// Send start event
	writeSSEEvent(w, "start", nil)
	flusher.Flush()

	var fullText string
	fullText, err = provider.ChatStream(r.Context(), ai.ChatRequest{
		Model:    resolvedModel,
		Messages: req.Messages,
		System:   systemPrompt,
	}, func(chunk string) {
		writeSSEEvent(w, "text", map[string]string{"text": chunk})
		flusher.Flush()
	})

	if err != nil {
		writeSSEEvent(w, "error", map[string]string{"error": err.Error()})
		flusher.Flush()
		return
	}

	writeSSEEvent(w, "finish", nil)
	flusher.Flush()

	// Generate title if chat has no title (using the same provider)
	if chat.Title == "" && len(req.Messages) > 0 && provider != nil {
		go func() {
			firstUserMsg := ""
			for _, m := range req.Messages {
				if m.Role == "user" {
					firstUserMsg = m.Content
					break
				}
			}
			if firstUserMsg != "" {
				lang := req.Language
				if lang == "" {
					lang = "en"
				}
				title, err := provider.GenerateTitle(context.Background(), firstUserMsg, lang)
				if err == nil && title != "" {
					s.Store.UpdateChatTitle(chatID, userID, title)
				}
			}
		}()
	}

	// Save chat with new messages in background
	go func() {
		updatedChat, err := s.Store.GetChat(chatID, userID)
		if err != nil {
			return
		}

		var existingMessages []map[string]any
		json.Unmarshal(updatedChat.Messages, &existingMessages)

		assistantMsg := map[string]any{
			"id":    generateID(),
			"role":  "assistant",
			"parts": []map[string]any{{"type": "text", "text": fullText}},
		}
		existingMessages = append(existingMessages, assistantMsg)
		updatedChat.Messages, _ = json.Marshal(existingMessages)
		_, _ = s.Store.SaveChat(updatedChat, userID)
	}()
}

const baseSystemPrompt = `Eres un asistente de IA útil, respetuoso y honesto. Respondes en el mismo idioma en que te hablan. Proporcionas respuestas claras, concisas y útiles.`

// writeSSEEvent writes a single SSE data frame with a JSON payload of the
// form {"type": <event>, ...extra}. Payload fields are marshaled with
// encoding/json so special characters (newlines, quotes) are escaped exactly
// once.
func writeSSEEvent(w http.ResponseWriter, event string, extra map[string]string) {
	payload := map[string]string{"type": event}
	for k, v := range extra {
		payload[k] = v
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
}

const webSearchPrompt = `

---

VII. Web Research

Web research is enabled for this conversation. Do not claim that you lack internet access or browsing/search capability when research tools are available. Use the available web research tool whenever the user asks for current, time-sensitive, or externally verifiable information, and cite the sources you use by referencing their URLs.`

func generateID() string {
	return fmt.Sprintf("msg_%d", time.Now().UnixNano())
}
