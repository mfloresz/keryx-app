package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
	einojsonschema "github.com/eino-contrib/jsonschema"
)

// Provider is the interface for AI model providers.
type Provider interface {
	// Chat sends a chat completion request and returns the full response text.
	Chat(ctx context.Context, req ChatRequest) (string, error)
	// ChatStream sends a chat completion request and streams the response chunks.
	// The onChunk callback is called for each chunk (text, reasoning or tool
	// activity) received. Returns the full combined text and reasoning.
	ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (ChatStreamResult, error)
	// GenerateTitle generates a concise title for a chat based on a user message and language.
	// The systemPrompt provides the instructions for title generation.
	GenerateTitle(ctx context.Context, systemPrompt string, userMessage string, language string) (string, error)
}

// StreamChunkKind identifies the kind of a streamed chunk.
type StreamChunkKind string

const (
	StreamChunkText       StreamChunkKind = "text"
	StreamChunkReasoning  StreamChunkKind = "reasoning"
	StreamChunkToolCall   StreamChunkKind = "tool_call"
	StreamChunkToolResult StreamChunkKind = "tool_result"
)

// StreamChunk is a single streamed unit emitted during ChatStream.
// Text and reasoning chunks carry Text; tool chunks carry the tool identity
// (ToolCallID/ToolName) plus Input (raw JSON arguments) for calls and Output
// (result text) for results.
type StreamChunk struct {
	Kind StreamChunkKind
	Text string

	ToolCallID string
	ToolName   string
	Input      string
	Output     string
}

// ChatStreamResult is the accumulated output of a ChatStream call.
type ChatStreamResult struct {
	Text      string
	Reasoning string
	Usage     Usage
}

// Usage is the token accounting for one request, including prompt-cache
// hits when the provider reports them (e.g. OpenRouter usage.include).
type Usage struct {
	InputTokens      int
	OutputTokens     int
	ReasoningTokens  int
	CacheReadTokens  int
	CacheWriteTokens int
}

// add accumulates the token usage reported in a response meta (one step of
// the model→tool loop).
func (u *Usage) add(meta *schema.ResponseMeta) {
	if meta == nil || meta.Usage == nil {
		return
	}
	u.InputTokens += meta.Usage.PromptTokens
	u.OutputTokens += meta.Usage.CompletionTokens
	u.ReasoningTokens += meta.Usage.CompletionTokensDetails.ReasoningTokens
	u.CacheReadTokens += meta.Usage.PromptTokenDetails.CachedTokens
	u.CacheWriteTokens += meta.Usage.PromptTokenDetails.CacheWriteTokens
}

// ToolCall carries a tool invocation in a chat message history.
type ToolCall struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// ToolResult carries a tool execution result in a chat message history.
type ToolResult struct {
	ToolCallID string `json:"toolCallId"`
	ToolName   string `json:"toolName"`
	Output     string `json:"output"`
}

// ChatMessage represents a single message in a chat conversation.
type ChatMessage struct {
	Role        string           `json:"role"`
	Content     string           `json:"content"`
	Attachments []ChatAttachment `json:"attachments,omitempty"`
	ToolCalls   []ToolCall       `json:"toolCalls,omitempty"`
	ToolResults []ToolResult     `json:"toolResults,omitempty"`
}

// ChatAttachment is a file attached to a message, already resolved to bytes.
// Markdown, when set, is a text conversion of the document used as LLM
// context in place of the raw bytes; it is resolved server-side and never
// persisted with the message.
type ChatAttachment struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	MediaType string `json:"mediaType"`
	Data      []byte `json:"-"`
	Markdown  string `json:"-"`
}

// TextAttachmentBudget caps the total characters of text attachments inlined
// into a title prompt (~2000 tokens at ~4 chars/token).
const TextAttachmentBudget = 8000

// MarkdownAttachmentBudget caps the characters of a document's Markdown
// conversion inlined into a chat prompt (~50k tokens at ~4 chars/token).
const MarkdownAttachmentBudget = 200_000

// formatFileBlock renders a text attachment as a labeled file block for prompts.
func formatFileBlock(filename, mediaType, text string) string {
	return fmt.Sprintf("<file name=%q media=%s>\n%s\n</file>", filename, mediaType, text)
}

// TitleUserMessage builds the user message for title generation: the message
// text plus text attachments inlined as file blocks under a shared character
// budget (each file truncated line-safely with a marker). Non-text attachments
// are skipped.
func TitleUserMessage(m ChatMessage, maxAttachmentChars int) string {
	var b strings.Builder
	b.WriteString(m.Content)
	remaining := maxAttachmentChars
	for _, a := range m.Attachments {
		var text, media string
		if a.Markdown != "" {
			text, media = a.Markdown, "text/markdown"
		} else if len(a.Data) > 0 && isTextMedia(a.MediaType) {
			text, media = string(a.Data), a.MediaType
		}
		if remaining <= 0 || text == "" {
			continue
		}
		n := utf8.RuneCountInString(text)
		if n > remaining {
			text = TruncateText(text, remaining)
			n = remaining
		}
		remaining -= n
		b.WriteString("\n\n" + formatFileBlock(a.Filename, media, text))
	}
	return b.String()
}

// TruncateText cuts s to at most maxChars runes, preferring a line boundary
// (as long as it keeps at least half the budget), and appends a marker.
func TruncateText(s string, maxChars int) string {
	cut := -1
	runes := 0
	for i := range s {
		if runes == maxChars {
			cut = i
			break
		}
		runes++
	}
	if cut < 0 {
		return s
	}
	if nl := strings.LastIndexByte(s[:cut], '\n'); nl > cut/2 {
		cut = nl + 1
	}
	return s[:cut] + "\n…[truncated]"
}

func isTextMedia(mediaType string) bool {
	if strings.HasPrefix(mediaType, "text/") {
		return true
	}
	switch mediaType {
	case "application/json", "application/xml", "application/javascript",
		"application/typescript", "application/x-sh", "application/yaml",
		"image/svg+xml":
		return true
	}
	return false
}

// ToolDefinition defines a tool/function that the model can call.
type ToolDefinition struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// InputSchema is the JSON Schema for the tool's parameters.
	InputSchema string `json:"inputSchema"`
}

// ToolExecFunc executes a tool with the given name and JSON input, returning the result text.
type ToolExecFunc func(ctx context.Context, toolName string, input json.RawMessage) (string, error)

// ChatRequest is the input for a chat completion.
type ChatRequest struct {
	Model     string        `json:"model"`
	Messages  []ChatMessage `json:"messages"`
	System    string        `json:"system,omitempty"`
	MaxTokens int           `json:"maxTokens,omitempty"`
	Timeout   time.Duration `json:"timeout,omitempty"`
	// CacheKey is a stable per-chat ID for prompt-cache grouping. The
	// OpenAI-compatible provider sends it as the standard prompt_cache_key
	// and, for OpenRouter, as its native session_id. Empty disables it.
	CacheKey string `json:"-"`
	// Tools is an optional list of tool definitions for function calling.
	Tools []ToolDefinition `json:"tools,omitempty"`
	// ToolExec is the function that executes a tool by name when the model calls it.
	// If nil, tools are defined to the model but execution falls back to the
	// provider's default behaviour (e.g. OpenRouter server-side tools).
	ToolExec ToolExecFunc `json:"-"`
	// ToolApproval is called before a tool runs, for tools that require the
	// user's consent (e.g. writing files). It receives the tool call and
	// returns whether the tool may run. A nil hook means every tool runs
	// without asking.
	ToolApproval ToolApprovalFunc `json:"-"`
}

// ToolApprovalFunc decides whether a tool call may proceed. It is invoked
// before the tool executes; returning false skips the tool and feeds a
// denial message back to the model.
type ToolApprovalFunc func(ctx context.Context, toolCallID, toolName, input string) (approved bool, reason string)

// Sentinel errors surfaced by the model→tool loop. Callers match them with
// errors.Is; partial output (text already streamed) stays in the returned
// ChatStreamResult so it can be persisted.
var (
	// ErrTruncated means text was already streamed and then the connection
	// died with a transport error.
	ErrTruncated = errors.New("the response ended unexpectedly")
	// ErrOutputLimit means the provider reported finish_reason "length".
	ErrOutputLimit = errors.New("the response was cut off by the model's output token limit")
	// ErrContentFilter means the provider reported finish_reason "content_filter".
	ErrContentFilter = errors.New("the response was blocked by the provider's content filter")
	// ErrIdleTimeout means no chunk arrived within the idle window.
	ErrIdleTimeout = errors.New("the model stopped sending data")
	// ErrEmptyResponse means the model streamed only reasoning and then ended
	// without producing an answer, even after a retry.
	ErrEmptyResponse = errors.New("the model finished its reasoning without producing an answer")
)

// idleChunkTimeout is how long the stream may go without receiving any chunk
// before the request is aborted with ErrIdleTimeout. It is a var so tests can
// shrink it.
var idleChunkTimeout = 120 * time.Second

// totalLoopBudget is the default whole-request budget for a model→tool loop
// (generous enough for thinking models plus several tool round-trips).
const totalLoopBudget = 10 * time.Minute

// maxToolSteps bounds the model→tool→model loop within a single request.
// The previous engine capped it at 5; 8 leaves room for deeper research
// flows (search → read → refine → search …) without enabling runaway loops.
const maxToolSteps = 8

// toToolInfos converts tool definitions to eino tool infos.
func toToolInfos(defs []ToolDefinition) ([]*schema.ToolInfo, error) {
	if len(defs) == 0 {
		return nil, nil
	}
	out := make([]*schema.ToolInfo, 0, len(defs))
	for _, d := range defs {
		info := &schema.ToolInfo{Name: d.Name, Desc: d.Description}
		if strings.TrimSpace(d.InputSchema) != "" {
			var js einojsonschema.Schema
			if err := json.Unmarshal([]byte(d.InputSchema), &js); err != nil {
				return nil, fmt.Errorf("tool %s: invalid input schema: %w", d.Name, err)
			}
			info.ParamsOneOf = schema.NewParamsOneOfByJSONSchema(&js)
		}
		out = append(out, info)
	}
	return out, nil
}

// bindTools returns the options with the tool set bound, so the model can
// request tool calls.
func bindTools(tools []*schema.ToolInfo, opts []model.Option) []model.Option {
	if len(tools) == 0 {
		return opts
	}
	return append(slices.Clone(opts), model.WithTools(tools))
}

// runToolLoopGenerate drives the non-streaming model→tool→model loop. It ends
// when the model answers without tool calls, when maxToolSteps is reached
// (returning whatever content was produced) or on the first transport error.
// Provider finish reasons map to ErrOutputLimit / ErrContentFilter, and a
// message that carries only reasoning content maps to ErrEmptyResponse.
func runToolLoopGenerate(ctx context.Context, cm model.BaseChatModel, msgs []*schema.Message, tools []*schema.ToolInfo, req ChatRequest, opts []model.Option) (ChatStreamResult, error) {
	var result ChatStreamResult
	opts = bindTools(tools, opts)
	for step := 0; ; step++ {
		msg, err := cm.Generate(ctx, msgs, opts...)
		if err != nil {
			return result, err
		}
		result.Usage.add(msg.ResponseMeta)
		if len(msg.ToolCalls) == 0 || req.ToolExec == nil || step+1 >= maxToolSteps {
			result.Text = strings.TrimSpace(msg.Content)
			result.Reasoning = strings.TrimSpace(msg.ReasoningContent)
			finishReason := ""
			if msg.ResponseMeta != nil {
				finishReason = msg.ResponseMeta.FinishReason
			}
			switch finishReason {
			case "length":
				return result, fmt.Errorf("%w", ErrOutputLimit)
			case "content_filter":
				return result, fmt.Errorf("%w", ErrContentFilter)
			}
			if result.Text == "" && len(msg.ToolCalls) == 0 && result.Reasoning != "" {
				return result, fmt.Errorf("%w", ErrEmptyResponse)
			}
			return result, nil
		}
		msgs = append(msgs, msg)
		msgs, err = execToolCalls(ctx, req, msg.ToolCalls, msgs, nil)
		if err != nil {
			return result, err
		}
	}
}

// runToolLoopStream drives the streaming model→tool→model loop. Text and
// reasoning deltas stream through onChunk as they arrive; tool calls and
// results are emitted as StreamChunkToolCall / StreamChunkToolResult events
// so callers can surface live tool activity.
//
// The eino-ext go-openai fork reports io.EOF both for the real "[DONE]"
// sentinel and for a connection that died gracefully, so the loop inspects
// each step's finish reason and content: a stream that ends after only
// reasoning (no text, no tool calls, no finish reason) is retried once with
// the same messages; "length" and "content_filter" finish reasons map to
// ErrOutputLimit / ErrContentFilter while keeping any partial text in the
// result for persistence. An idle watchdog cancels the stream when the
// provider stops sending chunks (ErrIdleTimeout); it is paused while tools
// execute, since approval can legitimately block for minutes.
func runToolLoopStream(ctx context.Context, cm model.BaseChatModel, msgs []*schema.Message, tools []*schema.ToolInfo, req ChatRequest, opts []model.Option, onChunk func(StreamChunk)) (ChatStreamResult, error) {
	var result ChatStreamResult
	opts = bindTools(tools, opts)
	emit := func(c StreamChunk) {
		if onChunk != nil {
			onChunk(c)
		}
	}

	// Idle watchdog: a fresh context canceled only when no chunk arrives
	// within the idle window, so Recv cannot block forever on a dead
	// connection that the provider closed gracefully.
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	idleTimer := time.AfterFunc(idleChunkTimeout, cancel)
	defer idleTimer.Stop()
	resetIdle := func() { idleTimer.Reset(idleChunkTimeout) }
	// idleFired reports whether the watchdog (not the caller's context)
	// canceled the stream.
	idleFired := func() bool {
		return streamCtx.Err() != nil && ctx.Err() == nil
	}

	retriedThinkingStep := false
	for step := 0; ; step++ {
		sr, err := cm.Stream(streamCtx, msgs, opts...)
		if err != nil {
			return result, fmt.Errorf("chat stream: %w", err)
		}
		resetIdle()
		var chunks []*schema.Message
		var sawText bool
		for {
			m, recvErr := sr.Recv()
			resetIdle()
			if recvErr == io.EOF {
				break
			}
			if recvErr != nil {
				sr.Close()
				if idleFired() {
					return result, fmt.Errorf("%w", ErrIdleTimeout)
				}
				if result.Text != "" {
					// Partial text and then the connection died: surface the
					// truncation, keeping what was already emitted.
					return result, fmt.Errorf("%w: %w", ErrTruncated, recvErr)
				}
				return result, fmt.Errorf("stream error: %w", recvErr)
			}
			if m == nil {
				continue
			}
			if m.ReasoningContent != "" {
				result.Reasoning += m.ReasoningContent
				emit(StreamChunk{Kind: StreamChunkReasoning, Text: m.ReasoningContent})
			}
			if m.Content != "" {
				result.Text += m.Content
				sawText = true
				emit(StreamChunk{Kind: StreamChunkText, Text: m.Content})
			}
			chunks = append(chunks, m)
		}
		sr.Close()
		if idleFired() {
			// The watchdog canceled the stream and Recv surfaced it as a
			// clean EOF — do not mistake that for a complete response.
			return result, fmt.Errorf("%w", ErrIdleTimeout)
		}

		final, err := schema.ConcatMessages(chunks)
		if err != nil {
			return result, fmt.Errorf("concat stream chunks: %w", err)
		}
		result.Usage.add(final.ResponseMeta)
		if len(final.ToolCalls) > 0 && req.ToolExec != nil && step+1 < maxToolSteps {
			msgs = append(msgs, final)
			for _, tc := range final.ToolCalls {
				emit(StreamChunk{Kind: StreamChunkToolCall, ToolCallID: tc.ID, ToolName: tc.Function.Name, Input: tc.Function.Arguments})
			}
			// Tool execution (including approval) may block for minutes with
			// no model activity; pause the watchdog meanwhile.
			idleTimer.Stop()
			msgs, err = execToolCalls(ctx, req, final.ToolCalls, msgs, onChunk)
			resetIdle()
			if err != nil {
				return result, err
			}
			continue
		}

		finishReason := ""
		if final.ResponseMeta != nil {
			finishReason = final.ResponseMeta.FinishReason
		}
		switch finishReason {
		case "length":
			result.Text = strings.TrimSpace(result.Text)
			result.Reasoning = strings.TrimSpace(result.Reasoning)
			return result, fmt.Errorf("%w", ErrOutputLimit)
		case "content_filter":
			result.Text = strings.TrimSpace(result.Text)
			result.Reasoning = strings.TrimSpace(result.Reasoning)
			return result, fmt.Errorf("%w", ErrContentFilter)
		}

		// Thinking-model death: the stream "ended cleanly" after emitting only
		// reasoning — no text, no tool calls, no finish reason. Retry this
		// step once with the same messages (nothing is appended between
		// attempts); reasoning from the failed attempt stays accumulated.
		if !sawText && len(final.ToolCalls) == 0 && strings.TrimSpace(result.Reasoning) != "" {
			if !retriedThinkingStep {
				retriedThinkingStep = true
				continue
			}
			return result, fmt.Errorf("%w", ErrEmptyResponse)
		}

		// Ambiguous ending (some text, empty finish reason): accept it as a
		// completion — retrying would duplicate the text already emitted.
		result.Text = strings.TrimSpace(result.Text)
		result.Reasoning = strings.TrimSpace(result.Reasoning)
		return result, nil
	}
}

// execToolCalls executes every requested tool call, appending the results as
// tool messages and (when onChunk is set) emitting StreamChunkToolResult
// events. Tool failures are fed back to the model as tool output instead of
// failing the whole request, mirroring the previous engine's graceful
// degradation for transient tool outages.
//
// When the request carries a ToolApproval hook, it is consulted before each
// tool runs. A denied tool is not executed; the denial is fed back to the
// model as the tool output so it can adapt instead of failing the stream.
func execToolCalls(ctx context.Context, req ChatRequest, calls []schema.ToolCall, msgs []*schema.Message, onChunk func(StreamChunk)) ([]*schema.Message, error) {
	for _, tc := range calls {
		if req.ToolApproval != nil {
			approved, reason := req.ToolApproval(ctx, tc.ID, tc.Function.Name, tc.Function.Arguments)
			if !approved {
				output := fmt.Sprintf("The user denied the %s tool.", tc.Function.Name)
				if reason != "" {
					output = fmt.Sprintf("%s Reason: %s", output, reason)
				}
				if onChunk != nil {
					onChunk(StreamChunk{
						Kind:       StreamChunkToolResult,
						ToolCallID: tc.ID,
						ToolName:   tc.Function.Name,
						Input:      tc.Function.Arguments,
						Output:     output,
					})
				}
				msgs = append(msgs, schema.ToolMessage(output, tc.ID, schema.WithToolName(tc.Function.Name)))
				continue
			}
		}
		output, execErr := req.ToolExec(ctx, tc.Function.Name, json.RawMessage(tc.Function.Arguments))
		if execErr != nil {
			output = fmt.Sprintf("Tool %s failed: %v", tc.Function.Name, execErr)
		}
		if onChunk != nil {
			onChunk(StreamChunk{
				Kind:       StreamChunkToolResult,
				ToolCallID: tc.ID,
				ToolName:   tc.Function.Name,
				Input:      tc.Function.Arguments,
				Output:     output,
			})
		}
		msgs = append(msgs, schema.ToolMessage(output, tc.ID, schema.WithToolName(tc.Function.Name)))
	}
	return msgs, nil
}
