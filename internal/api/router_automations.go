package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// Automations: scheduled agent runs. Execution reuses the shared chat runner
// (chat_runner.go) with a different write policy; the REST endpoints here are
// owner-scoped through the store methods.

// schedulerInterval is how often the scheduler looks for due automations.
const schedulerInterval = 30 * time.Second

// StartScheduler launches the automation scheduler goroutine. It ticks every
// schedulerInterval forever (context.Background: process exit kills it), with
// the first tick firing immediately so overdue runs execute once on startup.
func (s *Server) StartScheduler() {
	go func() {
		s.schedulerTick()
		ticker := time.NewTicker(schedulerInterval)
		defer ticker.Stop()
		for range ticker.C {
			s.schedulerTick()
		}
	}()
}

// schedulerTick runs every due automation serially, recovering panics per
// automation so one bad run cannot kill the loop.
func (s *Server) schedulerTick() {
	due, err := s.Store.ListDueAutomations(time.Now())
	if err != nil {
		slog.Error("scheduler: list due automations failed", "error", err)
		return
	}
	for _, auto := range due {
		s.runAutomationSafely(auto)
	}
}

func (s *Server) runAutomationSafely(auto store.Automation) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("automation run panicked", "automation", auto.ID, "panic", r)
		}
	}()
	s.runAutomationOnce(auto, "schedule")
}

// automationJSON is the API representation of an automation, enriched with
// the agent's name (best-effort; empty when the agent is gone).
type automationJSON struct {
	store.Automation
	AgentName string `json:"agentName"`
}

func (s *Server) automationResponse(auto store.Automation) automationJSON {
	name := ""
	if ag, err := s.Store.GetAgentForStream(auto.AgentID, auto.OwnerID); err == nil {
		name = ag.Name
	}
	return automationJSON{Automation: auto, AgentName: name}
}

// automationErrorResponse maps store errors to HTTP responses.
func automationErrorResponse(w http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		errorResponse(w, "Automation not found", http.StatusNotFound)
	case errors.Is(err, store.ErrInvalid):
		errorResponse(w, "Invalid automation (schedule must be every:15m..168h or daily:HH:MM)", http.StatusBadRequest)
	case errors.Is(err, store.ErrLimitReached):
		errorResponse(w, "Automation limit reached (20)", http.StatusBadRequest)
	default:
		errorResponse(w, fallback, http.StatusInternalServerError)
	}
}

func (s *Server) handleListAutomations(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	autos, err := s.Store.ListAutomations(userID)
	if err != nil {
		automationErrorResponse(w, err, "Failed to list automations")
		return
	}
	out := make([]automationJSON, 0, len(autos))
	for _, auto := range autos {
		out = append(out, s.automationResponse(auto))
	}
	jsonResponse(w, out, http.StatusOK)
}

func (s *Server) handleCreateAutomation(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	var req struct {
		AgentID         string `json:"agentId"`
		TaskPrompt      string `json:"taskPrompt"`
		Schedule        string `json:"schedule"`
		WebhookOutURL   string `json:"webhookOutUrl"`
		AllowWriteTools bool   `json:"allowWriteTools"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	// The agent must be visible to the owner (same rule as chat streams).
	if _, err := s.Store.GetAgentForStream(req.AgentID, userID); err != nil {
		errorResponse(w, "Agent not found or not visible", http.StatusBadRequest)
		return
	}

	auto, err := s.Store.CreateAutomation(&store.Automation{
		AgentID:         req.AgentID,
		TaskPrompt:      req.TaskPrompt,
		Schedule:        req.Schedule,
		WebhookOutURL:   req.WebhookOutURL,
		AllowWriteTools: req.AllowWriteTools,
	}, userID)
	if err != nil {
		automationErrorResponse(w, err, "Failed to create automation")
		return
	}
	// Seed next_run so the scheduler picks the automation up (store has no
	// dedicated setter; MarkAutomationRan(true, ...) initializes the runtime
	// bookkeeping without counting a failure).
	schedule, pErr := store.ParseSchedule(auto.Schedule)
	if pErr == nil {
		if mErr := s.Store.MarkAutomationRan(auto.ID, true, schedule.Next(time.Now())); mErr != nil {
			slog.Warn("failed to seed automation next_run", "automation", auto.ID, "error", mErr)
		}
	}
	auditLog(r, "automation.create", auto.ID, "owner", userID)
	jsonResponse(w, s.automationResponse(*auto), http.StatusCreated)
}

func (s *Server) handleUpdateAutomation(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")

	current, err := s.Store.GetAutomation(id, userID)
	if err != nil {
		errorResponse(w, "Automation not found", http.StatusNotFound)
		return
	}

	// Runtime fields (lastRun/nextRun/chatId) only change via the server.
	var req struct {
		AgentID         *string `json:"agentId"`
		TaskPrompt      *string `json:"taskPrompt"`
		Schedule        *string `json:"schedule"`
		WebhookOutURL   *string `json:"webhookOutUrl"`
		AllowWriteTools *bool   `json:"allowWriteTools"`
		Enabled         *bool   `json:"enabled"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	next := *current
	if req.AgentID != nil && *req.AgentID != "" && *req.AgentID != current.AgentID {
		if _, err := s.Store.GetAgentForStream(*req.AgentID, userID); err != nil {
			errorResponse(w, "Agent not found or not visible", http.StatusBadRequest)
			return
		}
		next.AgentID = *req.AgentID
	}
	if req.TaskPrompt != nil {
		next.TaskPrompt = *req.TaskPrompt
	}
	if req.Schedule != nil {
		next.Schedule = *req.Schedule
	}
	if req.WebhookOutURL != nil {
		next.WebhookOutURL = *req.WebhookOutURL
	}
	if req.AllowWriteTools != nil {
		next.AllowWriteTools = *req.AllowWriteTools
	}
	if req.Enabled != nil {
		next.Enabled = *req.Enabled
	}

	updated, err := s.Store.UpdateAutomation(id, userID, &next)
	if err != nil {
		automationErrorResponse(w, err, "Failed to update automation")
		return
	}
	// A schedule change re-seeds next_run from now.
	if req.Schedule != nil {
		if schedule, pErr := store.ParseSchedule(updated.Schedule); pErr == nil {
			if mErr := s.Store.MarkAutomationRan(updated.ID, true, schedule.Next(time.Now())); mErr != nil {
				slog.Warn("failed to re-seed automation next_run", "automation", updated.ID, "error", mErr)
			}
		}
	}
	auditLog(r, "automation.update", id, "owner", userID)
	jsonResponse(w, s.automationResponse(*updated), http.StatusOK)
}

func (s *Server) handleDeleteAutomation(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	if err := s.Store.DeleteAutomation(id, userID); err != nil {
		automationErrorResponse(w, err, "Failed to delete automation")
		return
	}
	auditLog(r, "automation.delete", id, "owner", userID)
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// handleTriggerAutomation fires one unattended run in the background and
// returns immediately; the outcome lands in the run history and the chat.
func (s *Server) handleTriggerAutomation(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")

	auto, err := s.Store.GetAutomation(id, userID)
	if err != nil {
		errorResponse(w, "Automation not found", http.StatusNotFound)
		return
	}
	go func() {
		defer func() {
			if p := recover(); p != nil {
				slog.Error("manual automation run panicked", "automation", auto.ID, "panic", p)
			}
		}()
		s.runAutomationOnce(*auto, "manual")
	}()
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleListAutomationRuns(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	// Ownership check before revealing any run history.
	if _, err := s.Store.GetAutomation(id, userID); err != nil {
		errorResponse(w, "Automation not found", http.StatusNotFound)
		return
	}
	runs, err := s.Store.ListAutomationRuns(id, 50)
	if err != nil {
		automationErrorResponse(w, err, "Failed to list automation runs")
		return
	}
	if runs == nil {
		runs = []store.AutomationRun{}
	}
	jsonResponse(w, runs, http.StatusOK)
}

// webSearchAvailabilityFor reports whether web search may run for an agent
// bundle in an unattended run: the instance feature must be active and the
// agent's whitelist must allow the tool (empty whitelist = defaults allow it).
func (s *Server) webSearchAvailabilityFor(agentTools []string) (bool, string) {
	if !agentToolAllowed(store.AgentToolWebSearch, agentTools) {
		return false, ""
	}
	wc, err := s.Store.GetWebSearchConfig()
	if err != nil || wc == nil || !wc.Enabled || wc.APIKey == "" {
		return false, ""
	}
	return true, wc.APIKey
}

// automationModelID resolves the model for an unattended run: the chat's
// stored preset when set, else the instance default preset ("fast"), else any
// seeded preset. The model-allowance check is skipped: the model comes from
// the owner's own chat preset or the instance default.
func (s *Server) automationModelID(chat *store.ChatRecord) (string, bool) {
	presetID := chat.Preset
	if presetID == "" {
		presetID = "fast"
	}
	if preset, err := s.Store.GetModelPreset(presetID); err == nil {
		return preset.ModelID, true
	}
	if presets, err := s.Store.GetModelPresets(); err == nil && len(presets) > 0 {
		return presets[0].ModelID, true
	}
	return "", false
}

// nextRunAfter parses the schedule and returns the next run strictly after
// `after`. An unparseable stored schedule backs off by a week (the store
// validates schedules on create/update, so this is defensive only).
func nextRunAfter(spec string, after time.Time) time.Time {
	if sc, err := store.ParseSchedule(spec); err == nil {
		return sc.Next(after)
	}
	return after.Add(168 * time.Hour)
}

// guardWriteTools wraps a project tool dispatcher with the unattended write
// policy: write_file / edit_file are denied unless the automation allows
// write tools. Read tools pass through.
func guardWriteTools(exec ai.ToolExecFunc, allowWrite bool) ai.ToolExecFunc {
	if allowWrite {
		return exec
	}
	return func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
		switch toolName {
		case "write_file", "edit_file":
			return "denied: unattended run", nil
		}
		return exec(ctx, toolName, input)
	}
}

// truncateRunes cuts s to at most max runes.
func truncateRunes(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max])
}

// runAutomationOnce executes one automation run end to end: resolve the
// agent, ensure the automation's chat, render and persist the task prompt,
// stream the response synchronously via executeChatRun, then record the run,
// update the schedule bookkeeping and fire the outbound webhook.
func (s *Server) runAutomationOnce(auto store.Automation, trigger string) {
	started := time.Now()
	next := nextRunAfter(auto.Schedule, started)

	// 1. Resolve the agent for the automation's owner.
	ag, err := s.Store.GetAgentForStream(auto.AgentID, auto.OwnerID)
	if err != nil {
		s.recordAutomationOutcome(auto, false, "agent unavailable", "", 0, next)
		return
	}

	// 2. Ensure the automation's chat exists.
	chatID := auto.ChatID
	if chatID == "" {
		saved, cErr := s.Store.SaveChat(&store.ChatRecord{
			Title:   ag.Name + " ⚡",
			AgentID: auto.AgentID,
		}, auto.OwnerID)
		if cErr != nil {
			slog.Error("automation: failed to create chat", "automation", auto.ID, "error", cErr)
			s.recordAutomationOutcome(auto, false, "failed to create chat", "", 0, next)
			return
		}
		chatID = saved.ID
		if sErr := s.Store.SetAutomationChat(auto.ID, chatID); sErr != nil {
			slog.Warn("automation: failed to link chat", "automation", auto.ID, "error", sErr)
		}
	}
	chat, err := s.Store.GetChat(chatID, auto.OwnerID)
	if err != nil {
		s.recordAutomationOutcome(auto, false, "automation chat unavailable", "", 0, next)
		return
	}

	// 3. Render the task prompt ({date}/{time} against server-local now) and
	// persist it as the run's user message.
	now := time.Now()
	rendered := renderTaskPrompt(auto.TaskPrompt, now)
	userMessageID := generateID()
	userMsg := map[string]any{
		"id":        userMessageID,
		"role":      "user",
		"createdAt": now.UTC().Format(time.RFC3339),
		"parts":     []any{map[string]any{"type": "text", "text": rendered}},
	}
	if err := s.Store.UpsertChatMessage(chatID, userMsg); err != nil {
		slog.Error("automation: failed to persist task prompt", "automation", auto.ID, "error", err)
		s.recordAutomationOutcome(auto, false, "failed to persist task prompt", "", 0, next)
		return
	}

	// 4. Resolve the model through the chat's preset (or the instance
	// default) exactly like the HTTP path.
	modelID, ok := s.automationModelID(chat)
	if !ok {
		s.recordAutomationOutcome(auto, false, "no model preset configured", "", 0, next)
		return
	}
	provider, resolvedModel, err := s.getProviderForModel(modelID, ai.SessionForChat(chatID))
	if err != nil {
		slog.Error("automation: provider unavailable", "automation", auto.ID, "model", modelID, "error", err)
		s.recordAutomationOutcome(auto, false, "provider unavailable", "", 0, next)
		return
	}

	// 5. System prompt: agent prompt + bundle (skills, knowledge), web search
	// section, summary memory, workspace section, skills disclosure and user
	// context — the same shape as the HTTP stream path.
	systemPrompt := ag.SystemPrompt
	systemPrompt += renderSkillSections(s.resolveAgentSkills(ag.Skills), skillHeaderBound)
	systemPrompt += s.agentKnowledgeSection(ag, auto.OwnerID)
	webSearchActive, braveAPIKey := s.webSearchAvailabilityFor(ag.Tools)
	if webSearchActive {
		systemPrompt += s.buildSearchSystemPrompt()
	}
	if chat.Summary != "" {
		systemPrompt += "\n\n---\n\n### Conversation Summary (earlier messages)\n" + chat.Summary
	}
	var project *store.Project
	if chat.ProjectID != "" {
		if p, pErr := s.Store.GetProjectForOwner(chat.ProjectID, auto.OwnerID); pErr == nil {
			project = p
		}
	}
	skills, err := s.Store.ListEnabledSkills()
	if err != nil {
		skills = nil
	}
	if len(skills) > 0 {
		systemPrompt += buildSkillsPrompt(skills)
	}
	if project != nil {
		files, fErr := s.Store.ListProjectFiles(project.ID, auto.OwnerID)
		if fErr != nil {
			files = nil
		}
		systemPrompt += buildProjectWorkspacePrompt(project, files)
	}
	systemPrompt = s.applyUserContext(systemPrompt, "", "", "", "", auto.OwnerID)

	// 6. Run synchronously on the shared runner. Write policy: workspace
	// writes are denied unless the automation allows them; no approval hook
	// (unattended).
	var projectExec ai.ToolExecFunc
	if project != nil {
		projectExec = guardWriteTools(projectToolExec(s, project.ID, auto.OwnerID), auto.AllowWriteTools)
	}
	assistantMessageID := generateID()
	params := chatRunParams{
		chatID:        chatID,
		userID:        auto.OwnerID,
		model:         resolvedModel,
		messages:      []ai.ChatMessage{{Role: "user", Content: rendered}},
		fullMessages:  []ai.ChatMessage{{Role: "user", Content: rendered}},
		contextBudget: contextBudgetFor(modelID),
		systemPrompt:  systemPrompt,
		tools: chatToolSet(chatToolOptions{
			webSearchActive: webSearchActive,
			project:         project != nil,
			loadSkill:       len(skills) > 0,
			agentTools:      ag.Tools,
		}),
		projectExec:        projectExec,
		webSearchActive:    webSearchActive,
		braveAPIKey:        braveAPIKey,
		provider:           provider,
		providerID:         providerIDForModel(modelID),
		userMessageID:      userMessageID,
		assistantMessageID: assistantMessageID,
		titleChat:          nil, // the automation chat already has a title
		approvalHook:       nil, // unattended: no interactive approvals
	}
	result, runErr := s.executeChatRun(context.Background(), params)

	// 7. Record the outcome, advance the schedule and fire the webhook.
	summary := result.Text
	if runErr != nil && summary == "" {
		summary = runErr.Error()
	}
	summary = truncateRunes(summary, 500)
	s.recordAutomationOutcome(auto, runErr == nil, summary, assistantMessageID, result.Usage.OutputTokens, next)
	if auto.WebhookOutURL != "" {
		status := store.AutomationRunStatusSuccess
		if runErr != nil {
			status = store.AutomationRunStatusError
		}
		s.postAutomationWebhook(auto, status, summary, chatID)
	}
	slog.Info("automation run finished", "automation", auto.ID, "trigger", trigger,
		"success", runErr == nil, "chat", chatID, "elapsed", time.Since(started).Round(time.Millisecond))
}

// recordAutomationOutcome persists the run record and advances the schedule.
func (s *Server) recordAutomationOutcome(auto store.Automation, success bool, summary, outputMessageID string, tokens int, next time.Time) {
	status := store.AutomationRunStatusSuccess
	if !success {
		status = store.AutomationRunStatusError
	}
	if err := s.Store.RecordAutomationRun(auto.ID, status, summary, outputMessageID, tokens); err != nil {
		slog.Error("automation: failed to record run", "automation", auto.ID, "error", err)
	}
	if err := s.Store.MarkAutomationRan(auto.ID, success, next); err != nil {
		slog.Error("automation: failed to mark run", "automation", auto.ID, "error", err)
	}
}

// postAutomationWebhook delivers the run outcome to the automation's outbound
// webhook (10s timeout; failures are logged only).
func (s *Server) postAutomationWebhook(auto store.Automation, status, summary, chatID string) {
	payload, err := json.Marshal(map[string]string{
		"automationId": auto.ID,
		"agentId":      auto.AgentID,
		"status":       status,
		"summary":      summary,
		"chatId":       chatID,
	})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, auto.WebhookOutURL, bytes.NewReader(payload))
	if err != nil {
		slog.Warn("automation webhook: invalid URL", "automation", auto.ID, "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Warn("automation webhook failed", "automation", auto.ID, "error", err)
		return
	}
	resp.Body.Close()
}
