package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// chatRunParams carries everything a chat generation needs. The HTTP handler
// builds it after all synchronous validation; automations build the same
// struct with a different write policy and no approval hook.
type chatRunParams struct {
	chatID, userID string
	// model is the upstream model id already resolved by the provider.
	model    string
	messages []ai.ChatMessage
	// fullMessages is the pre-trim conversation, kept for the background
	// summarizer.
	fullMessages []ai.ChatMessage
	// contextBudget is the model's character budget (see contextBudgetFor);
	// it sizes the background summarizer's trigger window.
	contextBudget int
	systemPrompt  string
	tools         []ai.ToolDefinition
	// projectExec dispatches project workspace tools; nil without a project.
	// Unattended runs wrap it with guardWriteTools.
	projectExec        ai.ToolExecFunc
	webSearchActive    bool
	braveAPIKey        string
	provider           ai.Provider
	// providerID is the catalog id behind model (e.g. "venice"); used to
	// tell whether the title model runs on a different provider.
	providerID         string
	userMessageID      string
	assistantMessageID string
	// titleChat is the chat as loaded at request time; title generation runs
	// when it still has no title. Nil for automations.
	titleChat *store.ChatRecord
	language  string
	// approvalHook builds the interactive tool-approval hook from the
	// registered activeStream (HTTP path: write tools wait for the user).
	// Nil for unattended runs, which execute every allowed tool.
	approvalHook func(*activeStream) ai.ToolApprovalFunc
}

// chatToolOptions are the inputs of chatToolSet.
type chatToolOptions struct {
	webSearchActive bool
	project         bool
	loadSkill       bool
	// agentTools is the agent bundle's Tools whitelist (empty = defaults).
	agentTools []string
}

// chatToolSet assembles the final tool list for a chat run: update_artifact
// (default-on, whitelist-gated), web_search (only when the instance feature
// is active AND whitelisted), project tools (follow the chat's project, never
// agent-selectable) and load_skill (when enabled skills exist).
func chatToolSet(o chatToolOptions) []ai.ToolDefinition {
	tools := []ai.ToolDefinition{}
	if agentToolAllowed(store.AgentToolUpdateArtifact, o.agentTools) {
		tools = append(tools, buildArtifactToolDefinition())
	}
	if o.webSearchActive && agentToolAllowed(store.AgentToolWebSearch, o.agentTools) {
		tools = append(tools, buildSearchToolDefinition()...)
	}
	if o.project {
		tools = append(tools, buildProjectToolDefinitions()...)
	}
	if o.loadSkill {
		tools = append(tools, buildLoadSkillToolDefinition())
	}
	return tools
}

// chatToolExec builds the tool dispatcher for a run. The web_search citation
// callback and the update_artifact broadcast need the activeStream, so the
// dispatcher is constructed after registration, inside the run. sourceParts
// and artifactParts accumulate the parts persisted with the assistant
// message.
func (s *Server) chatToolExec(p *chatRunParams, active *activeStream, sourceParts, artifactParts *[]map[string]any) ai.ToolExecFunc {
	return func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
		switch toolName {
		case "web_search":
			// Each citation is streamed to the clients so the answer
			// can carry a clickable source list.
			return execWebSearchTool(p.braveAPIKey, p.chatID, p.userID, input, func(title, url string) {
				extra := map[string]string{
					"title": title,
					"url":   url,
				}
				active.broadcast("source", extra)
				// Persisted with the assistant message so the sources
				// survive a reload.
				*sourceParts = append(*sourceParts, map[string]any{
					"type":     "source-url",
					"sourceId": fmt.Sprintf("src_%d", len(*sourceParts)+1),
					"url":      url,
					"title":    title,
				})
			})
		case "update_artifact":
			// The artifact is versioned in the store and broadcast so
			// the client can render it live; the part is persisted with
			// the assistant message so it survives a reload.
			return s.execUpdateArtifactTool(p.chatID, input, func(upd artifactUpdate) {
				active.broadcast("artifact", map[string]string{
					"artifactId":   upd.ArtifactID,
					"title":        upd.Title,
					"artifactType": upd.ArtifactType,
					"version":      strconv.Itoa(upd.Version),
				})
				*artifactParts = append(*artifactParts, map[string]any{
					"type": "data-artifact",
					"id":   fmt.Sprintf("artpart-%s-v%d", upd.ArtifactID, upd.Version),
					"data": map[string]any{
						"artifactId":   upd.ArtifactID,
						"title":        upd.Title,
						"artifactType": upd.ArtifactType,
						"version":      upd.Version,
					},
				})
			})
		case "load_skill":
			return s.execLoadSkillTool(input)
		}
		if p.projectExec != nil {
			return p.projectExec(ctx, toolName, input)
		}
		return "", fmt.Errorf("unknown tool: %s", toolName)
	}
}

// startChatRun registers the activeStream, hands it to onActive (the HTTP
// handler subscribes there, BEFORE the goroutine starts, so no event can slip
// between registration and subscription), and spawns the detached generation
// goroutine. Callers that need the run's outcome use executeChatRun instead.
func (s *Server) startChatRun(p chatRunParams, onActive func(*activeStream)) *activeStream {
	// The generation runs on its own context, detached from the HTTP
	// request: a browser reload or navigation drops the observer without
	// killing the model run, which keeps streaming and can be rejoined via
	// GET /api/chats/{id}/stream. If the process exits mid-generation, the
	// periodic partial persistence inside the run bounds the loss to ~1.5s
	// of output.
	runCtx, runCancel := context.WithCancel(context.Background())
	active := s.activeStreams.register(p.chatID, p.assistantMessageID, runCancel)
	if onActive != nil {
		onActive(active)
	}
	go func() {
		defer runCancel()
		defer s.activeStreams.remove(p.chatID, active)
		s.streamChatRun(runCtx, p, active)
	}()
	return active
}

// executeChatRun runs a chat generation synchronously on ctx, registering an
// activeStream anyway so a user opening the chat mid-run can watch via
// GET /stream (broadcasts to zero subscribers are free). Automations use it
// to wait for the result.
func (s *Server) executeChatRun(ctx context.Context, p chatRunParams) (ai.ChatStreamResult, error) {
	runCtx, runCancel := context.WithCancel(ctx)
	defer runCancel()
	active := s.activeStreams.register(p.chatID, p.assistantMessageID, runCancel)
	defer s.activeStreams.remove(p.chatID, active)
	return s.streamChatRun(runCtx, p, active)
}

// streamChatRun is the shared generation body: stream from the provider,
// broadcast through the activeStream, persist the (possibly partial)
// assistant message on every exit path, then run the async title/summary
// hooks. Returns the accumulated result and the generation error, if any.
func (s *Server) streamChatRun(ctx context.Context, p chatRunParams, active *activeStream) (ai.ChatStreamResult, error) {
	// Accumulate partial output locally so an error or cancel can still
	// persist whatever was generated so far.
	var (
		partialText, partialReasoning strings.Builder
		toolParts                     []map[string]any
		sourceParts                   []map[string]any
		artifactParts                 []map[string]any
		streamStarted                 bool
	)

	// Persist the partial assistant message periodically while streaming,
	// so a client that (re)loads the chat mid-generation sees the text
	// generated so far instead of nothing. The final append after the
	// stream ends remains authoritative.
	lastPersist := time.Now()
	persistPartial := func() {
		if time.Since(lastPersist) < 1500*time.Millisecond {
			return
		}
		lastPersist = time.Now()
		text, reasoning := active.snapshot()
		if strings.TrimSpace(text) != "" || reasoning != "" || len(toolParts) > 0 || len(artifactParts) > 0 {
			s.appendAssistantMessage(p.chatID, p.userID, p.assistantMessageID, text, reasoning, toolParts, sourceParts, artifactParts)
		}
	}

	// Title generation: the admin-configured title model may live on a
	// different provider than the chat model. When it does, both requests
	// can run at the same time (there is no prompt cache to share); with the
	// same provider the title keeps running after the finish event, as before.
	var (
		titleTarget   titleGenerationTarget
		titleParallel bool
	)
	if p.titleChat != nil && p.titleChat.Title == "" {
		titleTarget = s.titleTargetFor(p.chatID, p.provider)
		titleParallel = titleTarget.providerID != "" && titleTarget.providerID != p.providerID
		if titleParallel {
			s.generateTitleAsync(p.chatID, p.userID, p.language, p.messages, titleTarget)
		}
	}

	toolExec := s.chatToolExec(&p, active, &sourceParts, &artifactParts)
	var approval ai.ToolApprovalFunc
	if p.approvalHook != nil {
		approval = p.approvalHook(active)
	}

	streamResult, err := p.provider.ChatStream(ctx, ai.ChatRequest{
		Model:    p.model,
		Messages: p.messages,
		System:   p.systemPrompt,
		// Stable per-chat grouping key for prompt-cache affinity
		// (prompt_cache_key on OpenAI-compat, session_id on OpenRouter).
		CacheKey: ai.SessionForChat(p.chatID),
		Tools:    p.tools,
		ToolExec: toolExec,
		// Tools that change the workspace wait for the user's approval
		// (nil for unattended runs).
		ToolApproval: approval,
	}, func(chunk ai.StreamChunk) {
		// Send the start event only when the first chunk actually arrives
		// from the provider, so the frontend doesn't create an empty
		// assistant message before the model starts generating.
		if !streamStarted {
			active.broadcast("start", map[string]string{
				"userMessageId":      p.userMessageID,
				"assistantMessageId": p.assistantMessageID,
			})
			streamStarted = true
		}

		switch chunk.Kind {
		case ai.StreamChunkReasoning:
			partialReasoning.WriteString(chunk.Text)
			active.append("reasoning", chunk.Text)
		case ai.StreamChunkToolCall:
			// Surface live tool activity: the execution stays server-side,
			// the client only learns that a tool was invoked and with what
			// arguments.
			active.broadcast("tool_call", map[string]string{
				"name":       chunk.ToolName,
				"toolCallId": chunk.ToolCallID,
				"input":      chunk.Input,
			})
		case ai.StreamChunkToolResult:
			part := map[string]any{
				"type":       "dynamic-tool",
				"toolCallId": chunk.ToolCallID,
				"toolName":   chunk.ToolName,
				"state":      "output-available",
				"output":     chunk.Output,
			}
			if json.Valid([]byte(chunk.Input)) {
				part["input"] = json.RawMessage(chunk.Input)
			} else {
				part["input"] = chunk.Input
			}
			toolParts = append(toolParts, part)
			active.broadcast("tool_result", map[string]string{
				"name":       chunk.ToolName,
				"toolCallId": chunk.ToolCallID,
				"output":     chunk.Output,
			})
		default:
			partialText.WriteString(chunk.Text)
			active.append("text", chunk.Text)
		}
		persistPartial()
	})

	fullText := streamResult.Text
	fullReasoning := streamResult.Reasoning
	if fullText == "" {
		fullText = partialText.String()
	}
	if fullReasoning == "" {
		fullReasoning = partialReasoning.String()
	}

	if err != nil {
		// Persist the partial assistant response (if any) instead of losing it.
		if strings.TrimSpace(fullText) != "" || fullReasoning != "" || len(toolParts) > 0 || len(artifactParts) > 0 {
			s.appendAssistantMessage(p.chatID, p.userID, p.assistantMessageID, fullText, fullReasoning, toolParts, sourceParts, artifactParts)
		}
		if ctx.Err() != nil {
			// The run itself was cancelled (Stop button, superseded by a
			// newer generation for this chat): a clean terminal state, not
			// a provider failure. Superseded subscribers were already
			// released by register(); Stop observers get a finish event.
			active.broadcastFinish("finish", nil)
			return streamResult, err
		}
		slog.Error("chat stream failed", "error", err, "chat", p.chatID, "user", p.userID, "model", p.model)
		active.broadcastFinish("error", map[string]string{"error": streamErrorMessage(err)})
		return streamResult, err
	}

	// The title (when the chat has none yet) is generated asynchronously after
	// the finish event, so the client no longer waits on it. Parallel runs
	// already started it above.
	savedTitle := s.appendAssistantMessage(p.chatID, p.userID, p.assistantMessageID, fullText, fullReasoning, toolParts, sourceParts, artifactParts)

	var finishExtra map[string]string
	if savedTitle != "" {
		finishExtra = map[string]string{"title": savedTitle}
	}
	active.broadcastFinish("finish", finishExtra)

	if titleTarget.provider != nil && !titleParallel {
		s.generateTitleAsync(p.chatID, p.userID, p.language, p.messages, titleTarget)
	}
	// Background memory: fold older history into the chat's summary once
	// the conversation grows past half the default context budget.
	s.maybeSummarizeAsync(p.chatID, p.userID, p.provider, p.fullMessages, p.contextBudget)
	return streamResult, nil
}
