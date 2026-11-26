package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// maxUserMessageBytes caps the client-sent user message blob persisted
// verbatim into the chat record.
const maxUserMessageBytes = 1 << 20 // 1 MiB

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

	// SaveChat ignores the Messages field (messages live in the
	// chat_messages collection), so remember whether this is a new chat and
	// import the client-sent messages after the row exists.
	isNew := chat.ID == "" || nilChatForOwner(s, chat.ID, userID)

	saved, err := s.Store.SaveChat(&chat, userID)
	if err != nil {
		internalError(w, r, "Failed to save chat", err)
		return
	}

	if isNew && len(chat.Messages) > 0 {
		var msgs []map[string]any
		if err := json.Unmarshal(chat.Messages, &msgs); err == nil && len(msgs) > 0 {
			if err := s.Store.UpsertChatMessages(saved.ID, msgs); err != nil {
				internalError(w, r, "Failed to save chat messages", err)
				return
			}
		}
	}
	jsonResponse(w, saved, http.StatusOK)
}

// nilChatForOwner reports whether no chat with the given ID exists for the
// owner, i.e. SaveChat will create a new record (PocketBase then assigns its
// own ID, even when the client sent one).
func nilChatForOwner(s *Server, chatID, userID string) bool {
	if chatID == "" {
		return true
	}
	_, err := s.Store.GetChat(chatID, userID)
	return err != nil
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

// publicChatResponse is the read-only shape served to anonymous visitors:
// the owner identity, votes and the private summary are never exposed.
type publicChatResponse struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	Messages  json.RawMessage `json:"messages"`
	CreatedAt string          `json:"createdAt"`
}

func (s *Server) handleGetPublicChat(w http.ResponseWriter, r *http.Request) {
	chatID := r.PathValue("id")
	chat, err := s.Store.GetPublicChat(chatID)
	if err != nil {
		errorResponse(w, "Public chat not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, publicChatResponse{
		ID:        chat.ID,
		Title:     chat.Title,
		Messages:  chat.Messages,
		CreatedAt: chat.CreatedAt,
	}, http.StatusOK)
}

func (s *Server) handleSearchChatMessages(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	q := r.URL.Query().Get("q")
	results, err := s.Store.SearchChatMessages(userID, q, 30)
	if err != nil {
		errorResponse(w, "Search failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	jsonResponse(w, results, http.StatusOK)
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

	unlock := s.lockChat(chatID)
	defer unlock()

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	// Messages live in the chat_messages collection; the branch snapshot
	// logic below operates on the loaded array.
	messages, err := s.Store.ChatMessages(chatID)
	if err != nil {
		errorResponse(w, "Failed to load messages", http.StatusInternalServerError)
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
		// Non-destructive regenerate: preserve previous response (and tail)
		// as a branch snapshot instead of discarding it.
		var branches map[string]any
		if chat.Branches != nil {
			_ = json.Unmarshal(chat.Branches, &branches)
		}
		if branches == nil {
			branches = make(map[string]any)
		}

		// Sync current snapshots to latest messages before branching
		syncBranchSnapshots(messages, branches)

		if targetIndex == 0 {
			errorResponse(w, "Cannot regenerate first message", http.StatusBadRequest)
			return
		}
		rootMsg := messages[targetIndex-1]
		rootID, _ := rootMsg["id"].(string)
		if rootID == "" {
			errorResponse(w, "Invalid branch root", http.StatusInternalServerError)
			return
		}

		// Ensure branch state for this regeneration point.
		branchStateRaw, hasBranch := branches[rootID]
		var branchState map[string]any
		if !hasBranch {
			// Create branch state with "Original" snapshot containing previous tail
			originalID := generateID()
			oldTail := cloneMessages(messages[targetIndex:])
			branchState = map[string]any{
				"rootMessageId":     rootID,
				"includeRoot":       false,
				"currentSnapshotId": originalID,
				"snapshots": []any{
					map[string]any{
						"id":        originalID,
						"label":     "Original",
						"createdAt": time.Now().UTC().Format(time.RFC3339),
						"messages":  oldTail,
					},
				},
			}
			branches[rootID] = branchState
		} else {
			if bs, ok := branchStateRaw.(map[string]any); ok {
				branchState = bs
			} else {
				// Corrupted branch state — reset
				originalID := generateID()
				oldTail := cloneMessages(messages[targetIndex:])
				branchState = map[string]any{
					"rootMessageId":     rootID,
					"includeRoot":       false,
					"currentSnapshotId": originalID,
					"snapshots": []any{
						map[string]any{
							"id":        originalID,
							"label":     "Original",
							"createdAt": time.Now().UTC().Format(time.RFC3339),
							"messages":  oldTail,
						},
					},
				}
				branches[rootID] = branchState
			}
		}

		// Create new empty snapshot for the regeneration variant
		snapshots, _ := branchState["snapshots"].([]any)
		newID := generateID()
		nextNum := len(snapshots) + 1
		newSnapshot := map[string]any{
			"id":        newID,
			"label":     fmt.Sprintf("Regeneration %d", nextNum),
			"createdAt": time.Now().UTC().Format(time.RFC3339),
			"messages":  []any{},
		}
		snapshots = append(snapshots, newSnapshot)
		branchState["snapshots"] = snapshots
		branchState["currentSnapshotId"] = newID
		branches[rootID] = branchState

		// Truncate messages to before the assistant message being regenerated:
		// the message itself and everything after it is deleted (inclusive).
		messages = messages[:targetIndex]
		chat.Branches, _ = json.Marshal(branches)
		if err := s.Store.DeleteChatMessagesAfter(chatID, req.MessageID, true); err != nil {
			errorResponse(w, "Failed to delete messages", http.StatusInternalServerError)
			return
		}
	} else {
		targetID, _ := messages[targetIndex]["id"].(string)
		messages = messages[:targetIndex+1]
		// Keep branches in sync after truncation for edit flow
		var branches map[string]any
		if chat.Branches != nil {
			_ = json.Unmarshal(chat.Branches, &branches)
		}
		if branches != nil {
			syncBranchSnapshots(messages, branches)
			chat.Branches, _ = json.Marshal(branches)
		}
		// Delete everything strictly after the kept target message.
		if err := s.Store.DeleteChatMessagesAfter(chatID, targetID, false); err != nil {
			errorResponse(w, "Failed to delete messages", http.StatusInternalServerError)
			return
		}
	}

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

	unlock := s.lockChat(chatID)
	defer unlock()

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

	var messages []map[string]any
	json.Unmarshal(chat.Messages, &messages)

	// Sync current snapshot before switching, so the tail being left behind is preserved
	syncBranchSnapshots(messages, branches)

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
	branchState["currentSnapshotId"] = req.SnapshotID
	branches[req.RootMessageID] = branchState
	chat.Branches, _ = json.Marshal(branches)

	// Messages live in the chat_messages collection: replace them wholesale,
	// then persist the branch bookkeeping on the chat row.
	if err := s.Store.ReplaceChatMessages(chatID, newMessages); err != nil {
		errorResponse(w, "Failed to switch branch", http.StatusInternalServerError)
		return
	}
	if _, err := s.Store.SaveChat(chat, userID); err != nil {
		errorResponse(w, "Failed to save chat", http.StatusInternalServerError)
		return
	}

	// Re-fetch so the response carries the messages as now stored.
	if updated, err := s.Store.GetChat(chatID, userID); err == nil {
		chat = updated
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

	unlock := s.lockChat(chatID)
	defer unlock()

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	messages, err := s.Store.ChatMessages(chatID)
	if err != nil {
		errorResponse(w, "Failed to load messages", http.StatusInternalServerError)
		return
	}

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
		Preset       string           `json:"preset"`
		Messages     []ai.ChatMessage `json:"messages"`
		System       string           `json:"system"`
		WebSearch    bool             `json:"webSearch"`
		SearchEngine string           `json:"searchEngine"`
		Language     string           `json:"language"`
		Username     string           `json:"username"`
		Datetime     string           `json:"datetime"`
		Timezone     string           `json:"timezone"`
		// UserMessage is the full client-side UI message object for the new
		// user message (id, role, createdAt, parts). The backend persists it
		// verbatim before streaming so it survives failed/aborted streams.
		UserMessage json.RawMessage `json:"userMessage"`
		// AgentID selects an Agent whose system prompt fully overrides the
		// base prompt. Empty = use base (or legacy System).
		AgentID string `json:"agentId"`
		// ProjectID attaches a project workspace: file tools become
		// available and a workspace section is appended to the prompt.
		// Empty = plain chat (no workspace tools).
		ProjectID string `json:"projectId"`
		// PinnedSkills requests up to maxPinnedSkills skills whose full
		// instructions are preloaded into this run's prompt.
		PinnedSkills []string `json:"pinnedSkills"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.PinnedSkills) > maxPinnedSkills {
		errorResponse(w, fmt.Sprintf("Too many pinned skills (max %d)", maxPinnedSkills), http.StatusBadRequest)
		return
	}

	// Resolve preset to model ID if provided.
	if req.Preset != "" {
		preset, err := s.Store.GetModelPreset(req.Preset)
		if err != nil {
			errorResponse(w, "Invalid preset", http.StatusBadRequest)
			return
		}
		req.Model = preset.ModelID
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
		if strings.TrimSpace(m.Content) == "" && len(m.Attachments) == 0 && len(m.ToolCalls) == 0 {
			continue
		}
		resolved, err := s.resolveAttachments(userID, m)
		if err != nil {
			errorResponse(w, "Failed to load attachments", http.StatusBadRequest)
			return
		}
		filtered = append(filtered, resolved)
	}
	if len(filtered) == 0 || filtered[len(filtered)-1].Role != "user" {
		errorResponse(w, "Last message must be a non-empty user message", http.StatusBadRequest)
		return
	}
	req.Messages = filtered

	// Keep the full (pre-trim) conversation for the background summarizer,
	// then apply the model's context budget: keep the newest messages that
	// fit the model's window (~4 chars/token), so long conversations stay
	// under the provider's prompt limit instead of failing outright.
	fullMessages := req.Messages
	req.Messages = ai.FitMessagesToBudget(req.Messages, contextBudgetFor(req.Model))

	if err := s.Store.AssertModelAllowed(userID, req.Model); err != nil {
		errorResponse(w, "Model not allowed", http.StatusForbidden)
		return
	}

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	// Resolve the project workspace. An invalid project degrades gracefully
	// to a plain chat (same policy as missing agents) so an old selection
	// never breaks the stream.
	var project *store.Project
	if req.ProjectID != "" {
		if p, pErr := s.Store.GetProjectForOwner(req.ProjectID, userID); pErr == nil {
			project = p
		} else {
			slog.Warn("project not found, streaming without workspace", "projectId", req.ProjectID, "chat", chatID, "user", userID)
			// Don't persist an invalid selection.
			req.ProjectID = ""
		}
	}

	// Resolve the Brave API key for web search. The feature only activates when
	// the admin both configured a key and enabled it; otherwise we silently
	// degrade to a normal chat (the tool and its prompt section are skipped).
	webSearchActive := false
	var braveAPIKey string
	if req.WebSearch {
		wc, err := s.Store.GetWebSearchConfig()
		if err == nil && wc != nil && wc.Enabled && wc.APIKey != "" {
			braveAPIKey = wc.APIKey
			webSearchActive = true
		} else {
			slog.Warn("Web search requested but not active (disabled or missing API key)", "chat", chatID, "user", userID)
		}
	}

	// Persist the new user message and the web-search flag BEFORE streaming,
	// so the user's input is durable even if the stream fails or the client
	// disconnects mid-response. Upsert by message id keeps edit/regenerate
	// flows from duplicating the message. Preset and agent selection travel
	// with every stream so closing/reopening a chat restores them.
	userMessageID := s.persistUserMessage(chatID, userID, req.UserMessage, req.WebSearch, req.Preset, req.AgentID, req.ProjectID)
	assistantMessageID := generateID()

	// The OpenCode session groups a chat's requests for prompt-cache
	// optimization. Stable per chat (including retries); a fork gets a fresh
	// session via its new chat ID. Restarts must create a new chat.
	provider, resolvedModel, err := s.getProviderForModel(req.Model, ai.SessionForChat(chatID))
	if err != nil {
		// getProviderForModel errors are operator-facing configuration issues
		// (e.g. missing API key), so they're safe and useful to surface.
		errorResponse(w, "Failed to get provider: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// System prompt resolution priority: agent > legacy client system > base.
	// An agent's prompt fully overrides the base prompt; search section and
	// user context are appended afterwards either way. A missing/inaccessible
	// agent degrades gracefully to the effective base prompt.
	var ag *store.Agent
	var systemPrompt string
	if req.AgentID != "" {
		if resolved, agErr := s.Store.GetAgentForStream(req.AgentID, userID); agErr == nil {
			ag = resolved
			systemPrompt = ag.SystemPrompt
			slog.Info("stream agent", "agentId", ag.ID, "source", string(ag.Source), "chat", chatID)
		} else {
			slog.Warn("agent not found, fallback to base", "agentId", req.AgentID, "chat", chatID)
			systemPrompt = s.Store.GetEffectiveBasePrompt(s.Cfg.BaseSystemPrompt).Prompt
		}
	} else if req.System != "" {
		// Backward compat: only honored when no agent is selected; the
		// frontend never sends `system` alongside an agent (see PLAN_AGENTES.md §5).
		systemPrompt = req.System
	} else {
		systemPrompt = s.Store.GetEffectiveBasePrompt(s.Cfg.BaseSystemPrompt).Prompt
	}
	// Agent bundle: bound skills (instructions preloaded) and knowledge files
	// are appended right after the agent's own prompt; unresolvable names are
	// skipped.
	if ag != nil {
		systemPrompt += renderSkillSections(s.resolveAgentSkills(ag.Skills), skillHeaderBound)
		systemPrompt += s.agentKnowledgeSection(ag, userID)
	}
	// Client-pinned skills: user-requested preloads for this run only.
	if len(req.PinnedSkills) > 0 {
		systemPrompt += renderSkillSections(s.resolveAgentSkills(req.PinnedSkills), skillHeaderPinned)
	}
	if webSearchActive {
		systemPrompt += s.buildSearchSystemPrompt()
	}

	// Conversation summary memory: remind the model of the older part of the
	// conversation that no longer fits the recent window (maintained by
	// maybeSummarizeAsync below).
	if chat.Summary != "" {
		systemPrompt += "\n\n---\n\n### Conversation Summary (earlier messages)\n" + chat.Summary
	}

	// Workspace prompt section, active only with a valid project (the tools
	// themselves are assembled in chatToolSet below).
	if project != nil {
		files, err := s.Store.ListProjectFiles(project.ID, userID)
		if err != nil {
			files = nil
		}
		systemPrompt += buildProjectWorkspacePrompt(project, files)
	}

	// Skills (progressive disclosure): names + descriptions go into the
	// prompt, full instructions are loaded on demand via load_skill. A store
	// error degrades to no skills.
	skills, err := s.Store.ListEnabledSkills()
	if err != nil {
		skills = nil
	}
	if len(skills) > 0 {
		systemPrompt += buildSkillsPrompt(skills)
	}

	// Inject the dynamic user context (preferred name, current datetime,
	// response language) into the system prompt. Values come from the chat
	// request; the backend falls back to the stored profile / server time
	// when the client sends none.
	systemPrompt = s.applyUserContext(systemPrompt, req.Username, req.Datetime, req.Language, req.Timezone, userID)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		errorResponse(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	var agentTools []string
	if ag != nil {
		agentTools = ag.Tools
	}
	var projectExec ai.ToolExecFunc
	if project != nil {
		projectExec = projectToolExec(s, project.ID, userID)
	}

	// The run's parameters: the tool set and dispatcher are finalized inside
	// startChatRun, where the activeStream exists (citations, artifacts and
	// the approval hook broadcast through it).
	params := chatRunParams{
		chatID:        chatID,
		userID:        userID,
		model:         resolvedModel,
		messages:      req.Messages,
		fullMessages:  fullMessages,
		contextBudget: contextBudgetFor(req.Model),
		systemPrompt:  systemPrompt,
		tools: chatToolSet(chatToolOptions{
			webSearchActive: webSearchActive,
			project:         project != nil,
			loadSkill:       len(skills) > 0,
			agentTools:      agentTools,
		}),
		projectExec:        projectExec,
		webSearchActive:    webSearchActive,
		braveAPIKey:        braveAPIKey,
		provider:           provider,
		providerID:         providerIDForModel(req.Model),
		userMessageID:      userMessageID,
		assistantMessageID: assistantMessageID,
		titleChat:          chat,
		language:           req.Language,
		approvalHook: func(active *activeStream) ai.ToolApprovalFunc {
			return s.toolApprovalHook(chatID, active)
		},
	}

	// Register the stream so clients that navigate away or reload can
	// reconnect to it via GET /api/chats/{id}/stream. The run goroutine
	// removes the entry on every exit path. This request becomes an SSE
	// observer: it subscribes (via onActive) BEFORE the run goroutine starts
	// so no event can slip between registration and subscription.
	var events chan streamEvent
	active := s.startChatRun(params, func(a *activeStream) {
		events, _ = a.subscribe()
	})
	defer active.unsubscribe(events)

	// Forward the run's events to this request's observer until the run
	// finishes or the client disconnects. All client-facing emission goes
	// through the activeStream; nothing writes to w directly.
	followStream(w, flusher, r, active, events)
}

// streamErrorMessage maps a generation error to a user-facing message. The ai
// sentinel errors get specific copy; anything else stays generic so provider
// internals never leak to the client.
func streamErrorMessage(err error) string {
	switch {
	case errors.Is(err, ai.ErrOutputLimit):
		return "The response hit the model's output limit before completing. Try again or switch to a model with a higher output budget."
	case errors.Is(err, ai.ErrContentFilter):
		return "The response was blocked by the provider's content filter."
	case errors.Is(err, ai.ErrEmptyResponse):
		return "The model finished its reasoning without producing an answer. Please try again."
	case errors.Is(err, ai.ErrIdleTimeout):
		return "The model stopped sending data before finishing. Please try again."
	case errors.Is(err, ai.ErrTruncated):
		return "The response ended unexpectedly. Please try again."
	default:
		return "The model provider returned an error. Please try again."
	}
}

// contextBudgetFor returns the character budget for a model's context window
// (~4 chars per token), falling back to the package default when the catalog
// lists no limit for the model.
func contextBudgetFor(modelID string) int {
	lookup := func(mi ai.ModelInfo) int {
		if mi.MaxContext > 0 {
			return mi.MaxContext * 4
		}
		return ai.DefaultContextBudgetChars
	}
	if info, _, err := ai.ResolveModel(modelID); err == nil {
		for _, mi := range info.Models {
			if mi.ID == modelID {
				return lookup(mi)
			}
		}
	}
	// Fallback: scan the whole catalog (model IDs are globally unique).
	for _, mi := range ai.ModelCatalog() {
		if mi.ID == modelID {
			return lookup(mi)
		}
	}
	return ai.DefaultContextBudgetChars
}

// titleGenerationTarget is the resolved provider for a background title
// request, plus the catalog id it came from (empty when the chat's own
// provider is reused).
type titleGenerationTarget struct {
	provider ai.Provider
	// providerID is the title provider's catalog id; empty when the chat's
	// own provider is used, so callers can tell a custom model apart.
	providerID string
}

// generateTitleAsync generates the chat title in the background. The title is
// persisted under the chat lock only if the chat still has none; if the
// process dies before it lands, the next message regenerates it (same
// condition as when title generation was synchronous).
func (s *Server) generateTitleAsync(chatID, userID, language string, messages []ai.ChatMessage, target titleGenerationTarget) {
	var firstUserMsg *ai.ChatMessage
	for i := range messages {
		if messages[i].Role == "user" {
			firstUserMsg = &messages[i]
			break
		}
	}
	if firstUserMsg == nil || target.provider == nil {
		return
	}
	titleMsg := ai.TitleUserMessage(*firstUserMsg, ai.TextAttachmentBudget)
	if titleMsg == "" {
		return
	}
	lang := language
	if lang == "" {
		lang = "en"
	}

	go func() {
		titleCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		titlePrompt := s.Store.GetEffectiveTitlePrompt(s.Cfg.TitleGenerationSystemPrompt).Prompt
		titlePrompt = strings.ReplaceAll(titlePrompt, "{language}", languageName(lang))
		title, err := target.provider.GenerateTitle(titleCtx, titlePrompt, titleMsg, lang)
		if err != nil || title == "" {
			return
		}

		unlock := s.lockChat(chatID)
		defer unlock()
		chat, err := s.Store.GetChat(chatID, userID)
		if err != nil || chat.Title != "" {
			return
		}
		chat.Title = title
		if _, err := s.Store.SaveChat(chat, userID); err != nil {
			slog.Warn("failed to persist generated title", "chat", chatID, "error", err)
		}
	}()
}

// titleTargetFor resolves the provider to use for title generation: the
// admin-configured lightweight model when set, otherwise the chat's provider.
func (s *Server) titleTargetFor(chatID string, fallback ai.Provider) titleGenerationTarget {
	policy, err := s.Store.GetTitleGenerationPolicy()
	if err != nil || policy.Mode != store.TitleModeCustom || policy.ModelID == "" {
		return titleGenerationTarget{provider: fallback}
	}
	info, upstreamModel, err := ai.ResolveModel(policy.ModelID)
	if err != nil {
		return titleGenerationTarget{provider: fallback}
	}
	apiKey, err := s.apiKeyForProvider(info.ID)
	if err != nil {
		return titleGenerationTarget{provider: fallback}
	}
	if info.ID == "google" {
		return titleGenerationTarget{
			provider: &ai.GoogleProvider{
				APIKey:  apiKey,
				Model:   upstreamModel,
				Timeout: 120 * time.Second,
			},
			providerID: info.ID,
		}
	}
	// Titles share the chat's OpenCode session so they hit the same
	// prompt-cache grouping.
	session := ""
	if ai.IsOpencodeProvider(info.ID) {
		session = ai.SessionForChat(chatID)
	}
	return titleGenerationTarget{
		provider: &ai.OpenAIProvider{
			APIKey:     apiKey,
			BaseURL:    info.BaseURL,
			Model:      upstreamModel,
			Timeout:    120 * time.Second,
			Options:    info.Options,
			SessionID:  session,
			OpenRouter: info.ID == "openrouter",
		},
		providerID: info.ID,
	}
}

// titleProviderFor returns only the provider half of titleTargetFor.
func (s *Server) titleProviderFor(chatID string, fallback ai.Provider) ai.Provider {
	return s.titleTargetFor(chatID, fallback).provider
}

// providerIDForModel returns the catalog provider id behind a public model id,
// or "" when it can't be resolved.
func providerIDForModel(modelID string) string {
	info, _, err := ai.ResolveModel(modelID)
	if err != nil {
		return ""
	}
	return info.ID
}

// applyUserContext replaces the {username}, {date}, {datetime} and
// {language} placeholders in the system prompt with values from the chat
// request. Falls back to the stored user profile / server time when the
// client sends empty values, so the prompt stays valid for any client.
// {date} is day granularity so the cached system prefix stays stable all
// day; {datetime} keeps full timestamp resolution for prompts that need it.
func (s *Server) applyUserContext(prompt, username, datetime, language, timezone, userID string) string {
	username = strings.TrimSpace(username)
	if username == "" {
		if u, err := s.Store.GetUserByID(userID); err == nil {
			username = strings.TrimSpace(u.Name)
			if username == "" {
				username = strings.TrimSpace(u.Email)
			}
		}
		if username == "" {
			username = "User"
		}
	}

	// Resolve the user's timezone (IANA name, e.g. "America/Mexico_City")
	// provided by the browser; fall back to UTC when invalid or absent.
	loc := time.UTC
	if timezone = strings.TrimSpace(timezone); timezone != "" {
		if l, err := time.LoadLocation(timezone); err == nil {
			loc = l
		}
	}

	// Prefer the client-sent instant (UTC ISO 8601), localized to the
	// user's timezone; fall back to the server clock.
	instant := time.Now().In(loc)
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(datetime)); err == nil {
		instant = t.In(loc)
	}
	datetime = instant.Format("2006-01-02 15:04:05") + " " + loc.String()
	date := instant.Format("2006-01-02")

	langName := languageName(language)

	prompt = strings.ReplaceAll(prompt, "{username}", username)
	prompt = strings.ReplaceAll(prompt, "{datetime}", datetime)
	prompt = strings.ReplaceAll(prompt, "{date}", date)
	prompt = strings.ReplaceAll(prompt, "{language}", langName)
	return prompt
}

// languageName maps a language code to a human-readable name for use in
// prompts. Unknown codes pass through unchanged; empty defaults to English.
func languageName(lang string) string {
	switch lang {
	case "", "en":
		return "English"
	case "es":
		return "Spanish"
	}
	return lang
}

// persistUserMessage upserts the client-provided user message into the chat
// and records the web-search flag, model preset, agent and project
// selection. Returns the persisted message id (empty when nothing was
// persisted). Serialized per chat via the chat lock.
func (s *Server) persistUserMessage(chatID, userID string, raw json.RawMessage, webSearch bool, preset, agentID, projectID string) string {
	unlock := s.lockChat(chatID)
	defer unlock()

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		return ""
	}
	chat.WebSearch = webSearch
	if preset != "" {
		chat.Preset = preset
	}
	// Persist the agent only when it is visible to the owner; a deleted or
	// foreign agent falls back to the base prompt for this stream without
	// overwriting the stored selection (the UI clears it explicitly via
	// PATCH /api/chats/{id}/agent once it detects the missing agent).
	if agentID != "" {
		if _, err := s.Store.GetAgentForStream(agentID, userID); err == nil {
			chat.AgentID = agentID
		}
	} else {
		chat.AgentID = ""
	}
	// The project selection is persisted only when valid (checked by the
	// caller); an invalid one degrades to a plain chat for the stream.
	chat.ProjectID = projectID

	messageID := ""
	if len(raw) > 0 {
		// The client controls this blob and it is persisted verbatim into
		// the chat record, so bound its size: an oversized payload is
		// rejected outright.
		if len(raw) > maxUserMessageBytes {
			return ""
		}
		var um map[string]any
		if err := json.Unmarshal(raw, &um); err == nil && um["role"] == "user" {
			// parts, when present, must be a JSON array: the UI renders it
			// verbatim and any other shape would corrupt the chat on load.
			if parts, ok := um["parts"]; ok && parts != nil {
				if _, isArray := parts.([]any); !isArray {
					return ""
				}
			}
			messageID, _ = um["id"].(string)
			if messageID == "" {
				messageID = generateID()
				um["id"] = messageID
			}
			// Messages live in the chat_messages collection: upsert by
			// message id (edit/regenerate reuse the id, so no duplicate).
			if err := s.Store.UpsertChatMessage(chatID, um); err != nil {
				return ""
			}
			// Keep branch snapshots in sync with the new tail.
			msgs, mErr := s.Store.ChatMessages(chatID)
			if mErr == nil {
				var branches map[string]any
				if chat.Branches != nil {
					_ = json.Unmarshal(chat.Branches, &branches)
				}
				if branches != nil {
					syncBranchSnapshots(msgs, branches)
					chat.Branches, _ = json.Marshal(branches)
				}
			}
		}
	}

	if _, err := s.Store.SaveChat(chat, userID); err != nil {
		return ""
	}
	return messageID
}

// appendAssistantMessage upserts (or replaces, on retry) the assistant
// message in the chat_messages collection and returns the persisted title.
// toolParts are the dynamic-tool parts (web search invocations) observed
// during the stream, sourceParts the citations the answer is based on, and
// artifactParts the artifacts the model published via update_artifact. The
// upsert is serialized per chat so it never clobbers votes, branches, or
// edits saved while the stream was running.
func (s *Server) appendAssistantMessage(chatID, userID, messageID, text, reasoning string, toolParts []map[string]any, sourceParts []map[string]any, artifactParts []map[string]any, titleOverride ...string) string {
	unlock := s.lockChat(chatID)
	defer unlock()

	parts := []map[string]any{}
	if reasoning != "" {
		parts = append(parts, map[string]any{"type": "reasoning", "text": reasoning})
	}
	parts = append(parts, sourceParts...)
	parts = append(parts, toolParts...)
	parts = append(parts, artifactParts...)
	parts = append(parts, map[string]any{"type": "text", "text": text})
	assistantMsg := map[string]any{
		"id":        messageID,
		"role":      "assistant",
		"createdAt": time.Now().UTC().Format(time.RFC3339),
		"parts":     parts,
	}

	// Upsert by message id: an insert appends, a repeat (retry) replaces in
	// place. SaveChat below ignores Messages — only branch snapshots and the
	// optional title override travel with the chat row.
	if err := s.Store.UpsertChatMessage(chatID, assistantMsg); err != nil {
		return ""
	}

	chat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		return ""
	}

	// Keep branch current snapshots in sync after appending new assistant message
	var messages []map[string]any
	json.Unmarshal(chat.Messages, &messages)
	var branches map[string]any
	if chat.Branches != nil {
		_ = json.Unmarshal(chat.Branches, &branches)
	}
	if branches != nil {
		syncBranchSnapshots(messages, branches)
		chat.Branches, _ = json.Marshal(branches)
	}

	if len(titleOverride) > 0 && titleOverride[0] != "" {
		chat.Title = titleOverride[0]
	}

	saved, err := s.Store.SaveChat(chat, userID)
	if err != nil {
		return ""
	}
	return saved.Title
}

// handleReconnectStream lets a client rejoin an in-progress chat stream
// (after navigating away, reloading the page, or opening the chat in
// another tab). It replays the text generated so far as a single snapshot
// event, then forwards live chunks until the stream finishes. Responds
// 204 when no active stream exists for the chat, so the client knows to
// just load the persisted messages.
func (s *Server) handleReconnectStream(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	// Verify ownership before revealing anything about the stream.
	if _, err := s.Store.GetChat(chatID, userID); err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	active := s.activeStreams.get(chatID)
	if active == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		errorResponse(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// `since` is how many characters of the assistant text the client
	// already has (from the incremental persistence). Only the remainder
	// is replayed, which avoids duplicating text the client loaded from
	// the store. `sinceSeq` is the alternative resume mechanism: the client
	// replays the stream's seq-numbered event log from where it left off.
	since := 0
	if v := r.URL.Query().Get("since"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			since = n
		}
	}
	sinceSeq := int64(0)
	if v := r.URL.Query().Get("sinceSeq"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			sinceSeq = n
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	// sinceSeq path: replay the seq-numbered event log from where the client
	// left off, then hand over to the shared live follow. Events emitted
	// after the subscribe above carry a seq greater than the captured
	// high-water mark and arrive through the channel instead, so there is no
	// gap and no overlap.
	if sinceSeq > 0 {
		events, highWater := active.subscribe()
		defer active.unsubscribe(events)

		// Prologue: let the client adopt the assistant message id. Seq 0 →
		// no id line, never replayed.
		writeSSEEvent(w, "start", map[string]string{
			"assistantMessageId": active.AssistantMessageID,
		})
		for _, ev := range active.replaySince(sinceSeq) {
			if ev.seq > highWater {
				break
			}
			writeSSEEventAt(w, ev.seq, ev.event, ev.extra)
		}
		flusher.Flush()

		// If the stream finished between the get() and the replay above, the
		// client already has everything; tell it we're done.
		select {
		case <-active.done:
			writeSSEEvent(w, "finish", nil)
			flusher.Flush()
			return
		default:
		}

		followStream(w, flusher, r, active, events)
		return
	}

	// Legacy chars-snapshot path (mount resume): subscribe BEFORE taking the
	// snapshot: any chunk emitted from now on is buffered in the channel, so
	// nothing is lost between snapshot and live forwarding.
	events, _ := active.subscribe()
	defer active.unsubscribe(events)

	// Replay: start event with the assistant message id (so the client
	// adopts it), followed by whatever part of the accumulated content the
	// client is missing.
	writeSSEEvent(w, "start", map[string]string{
		"assistantMessageId": active.AssistantMessageID,
	})
	text, reasoning := active.snapshot()
	if since < len(text) {
		text = text[since:]
	} else {
		text = ""
	}
	// A client that already has text implicitly has all reasoning emitted
	// before it, so only replay reasoning for fresh clients (since == 0).
	if since == 0 && reasoning != "" {
		writeSSEEvent(w, "reasoning_snapshot", map[string]string{"text": reasoning})
	}
	if text != "" {
		writeSSEEvent(w, "text_snapshot", map[string]string{"text": text})
	}
	flusher.Flush()

	// If the stream finished between the get() and the replay above, the
	// client already has the full content; tell it we're done.
	select {
	case <-active.done:
		writeSSEEvent(w, "finish", nil)
		flusher.Flush()
		return
	default:
	}

	// Live phase: shared with POST /api/chats/{id}/stream, whose observer
	// subscribes before the run starts and follows the same loop.
	followStream(w, flusher, r, active, events)
}

// followStream forwards live stream events to an SSE observer until the run
// finishes or the observer disconnects. It is the shared tail of both
// POST /api/chats/{id}/stream (which subscribes before the run starts) and
// GET /api/chats/{id}/stream (which first replays a snapshot prologue). The
// caller must already have subscribed and set the SSE headers.
func followStream(w http.ResponseWriter, flusher http.Flusher, r *http.Request, active *activeStream, events chan streamEvent) {
	// Pending-approval replay: a client that subscribes while a tool approval
	// is waiting must see the prompt again, or the run blocks forever with
	// nobody able to answer. Known race: if the approval is answered between
	// this replay and the client's answer, the answer endpoint returns 404
	// and the UI surfaces a toast — acceptable.
	if extra, ok := active.pendingApprovalEvent(); ok && !active.isDone() {
		writeSSEEvent(w, "tool_approval", extra)
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case <-active.done:
			writeSSEEvent(w, "finish", nil)
			flusher.Flush()
			return
		case ev := <-events:
			switch ev.event {
			case "error":
				e := "Unknown error"
				if ev.extra != nil {
					if v, ok := ev.extra["error"]; ok && v != "" {
						e = v
					}
				}
				if e == "superseded" {
					// This stream was replaced by a new generation; the
					// client should reload messages rather than show an
					// error. The closed done channel ends the loop with a
					// finish event.
					continue
				}
				writeSSEEventAt(w, ev.seq, "error", map[string]string{"error": e})
				flusher.Flush()
			case "finish":
				// Handled via done channel; ignore duplicates here.
			default:
				writeSSEEventAt(w, ev.seq, ev.event, ev.extra)
				flusher.Flush()
			}
		}
	}
}

// handleCancelStream stops an in-progress chat generation (the Stop button).
// Idempotent: with no active stream it still succeeds, so a stale or
// duplicated Stop press is harmless.
func (s *Server) handleCancelStream(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	// Same ownership check as the reconnect endpoint: cancelling another
	// user's generation must not even reveal whether one is running.
	if _, err := s.Store.GetChat(chatID, userID); err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	if active := s.activeStreams.get(chatID); active != nil {
		active.Cancel()
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// resolveAttachments loads attachment bytes for any message whose attachment
// refs carry an ID. Metadata sent by the client is trusted only for display;
// server-side data always wins for filename/mediaType. When the attachment
// has a stored Markdown conversion, up to ai.MarkdownAttachmentBudget chars
// are loaded for LLM context; a missing or unreadable conversion degrades to
// the raw-bytes behavior.
func (s *Server) resolveAttachments(userID string, m ai.ChatMessage) (ai.ChatMessage, error) {
	for i, a := range m.Attachments {
		if a.ID == "" || a.Data != nil {
			continue
		}
		info, data, err := s.Store.GetAttachmentData(a.ID, userID)
		if err != nil {
			return m, fmt.Errorf("attachment %s: %w", a.ID, err)
		}
		m.Attachments[i].Data = data
		m.Attachments[i].Filename = info.Filename
		m.Attachments[i].MediaType = info.MediaType
		if md, err := s.Store.GetAttachmentMarkdown(a.ID, userID, ai.MarkdownAttachmentBudget*utf8.UTFMax); err == nil {
			m.Attachments[i].Markdown = ai.TruncateText(md, ai.MarkdownAttachmentBudget)
		}
	}
	return m, nil
}

// writeSSEEvent writes a single SSE data frame with a JSON payload of the
// form {"type": <event>, ...extra} and no seq (prologue events).
func writeSSEEvent(w http.ResponseWriter, event string, extra map[string]string) {
	writeSSEEventAt(w, 0, event, extra)
}

// writeSSEEventAt writes a single SSE data frame; when seq > 0 it emits an
// "id: <seq>" line before "data:" and includes "seq" in the JSON payload so
// sinceSeq reconnects can resume without gaps. Payload fields are marshaled
// with encoding/json so special characters (newlines, quotes) are escaped
// exactly once.
func writeSSEEventAt(w http.ResponseWriter, seq int64, event string, extra map[string]string) {
	payload := map[string]string{"type": event}
	maps.Copy(payload, extra)
	if seq > 0 {
		payload["seq"] = strconv.FormatInt(seq, 10)
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if seq > 0 {
		fmt.Fprintf(w, "id: %d\n", seq)
	}
	fmt.Fprintf(w, "data: %s\n\n", data)
}

func generateID() string {
	return "msg_" + uuid.NewString()
}

// cloneMessages deep-copies a slice of message maps via JSON round-trip.
func cloneMessages(ms []map[string]any) []any {
	if len(ms) == 0 {
		return []any{}
	}
	out := make([]any, 0, len(ms))
	for _, m := range ms {
		// shallow copy is enough for branch snapshots because messages are
		// treated as opaque JSON; deep copy via JSON ensures no sharedrefs.
		data, _ := json.Marshal(m)
		var cpy map[string]any
		_ = json.Unmarshal(data, &cpy)
		out = append(out, cpy)
	}
	return out
}

// syncBranchSnapshots updates the current snapshot of each branch state to
// reflect the current live messages tail. This keeps branch history
// consistent after appends/truncations.
func syncBranchSnapshots(messages []map[string]any, branches map[string]any) {
	for _, rawState := range branches {
		state, ok := rawState.(map[string]any)
		if !ok {
			continue
		}
		rootID, _ := state["rootMessageId"].(string)
		if rootID == "" {
			continue
		}
		currentID, _ := state["currentSnapshotId"].(string)
		if currentID == "" {
			continue
		}
		includeRoot, _ := state["includeRoot"].(bool)
		// Find root index
		rootIndex := -1
		for i, msg := range messages {
			if id, _ := msg["id"].(string); id == rootID {
				rootIndex = i
				break
			}
		}
		if rootIndex == -1 {
			continue
		}
		startIndex := rootIndex
		if !includeRoot {
			startIndex = rootIndex + 1
		}
		if startIndex > len(messages) {
			startIndex = len(messages)
		}
		snapshots, _ := state["snapshots"].([]any)
		for idx, rawSnap := range snapshots {
			snap, ok := rawSnap.(map[string]any)
			if !ok {
				continue
			}
			if sid, _ := snap["id"].(string); sid == currentID {
				snap["messages"] = cloneMessages(messages[startIndex:])
				snapshots[idx] = snap
				break
			}
		}
		state["snapshots"] = snapshots
	}
}

// handleForkChat creates a new chat by forking from a specific message.
// Standard "New chat from here" behavior: copies messages[0..index] into a new chat.
func (s *Server) handleForkChat(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	var req struct {
		MessageID string `json:"messageId"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.MessageID == "" {
		errorResponse(w, "Missing messageId", http.StatusBadRequest)
		return
	}

	// Lock source chat for consistent read
	unlock := s.lockChat(chatID)
	defer unlock()

	srcChat, err := s.Store.GetChat(chatID, userID)
	if err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	var messages []map[string]any
	if err := json.Unmarshal(srcChat.Messages, &messages); err != nil {
		errorResponse(w, "Failed to parse messages", http.StatusInternalServerError)
		return
	}

	targetIndex := -1
	for i, msg := range messages {
		if id, _ := msg["id"].(string); id == req.MessageID {
			targetIndex = i
			break
		}
	}
	if targetIndex == -1 {
		errorResponse(w, "Message not found", http.StatusNotFound)
		return
	}

	// Slice up to and including the target message
	newMessages := messages[:targetIndex+1]

	// Prepare new chat record (let PocketBase auto-generate ID). SaveChat
	// ignores the Messages field — the forked messages are imported into the
	// chat_messages collection right after.
	newChat := &store.ChatRecord{
		Title:      srcChat.Title,
		Visibility: store.VisibilityPrivate,
		WebSearch:  srcChat.WebSearch,
		AgentID:    srcChat.AgentID,
		Preset:     srcChat.Preset,
		Votes:      json.RawMessage("[]"),
		Branches:   json.RawMessage("{}"),
	}

	saved, err := s.Store.SaveChat(newChat, userID)
	if err != nil {
		internalError(w, r, "Failed to fork chat", err)
		return
	}
	if err := s.Store.UpsertChatMessages(saved.ID, newMessages); err != nil {
		internalError(w, r, "Failed to fork chat messages", err)
		return
	}

	// Duplicate attachments referenced in the forked messages (best-effort)
	// If source messages referenced attachments by ID, those files remain
	// associated with the original chat. Forked chat copies the message
	// parts verbatim; attachment resolution by owner still works, but the
	// files are logically shared. No physical copy needed.

	jsonResponse(w, saved, http.StatusOK)
}
