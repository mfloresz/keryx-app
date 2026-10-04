package ai

import (
	"context"
	"encoding/json"
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
	StreamChunkText      StreamChunkKind = "text"
	StreamChunkReasoning StreamChunkKind = "reasoning"
	StreamChunkToolCall  StreamChunkKind = "tool_call"
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

// ChatMessage represents a single message in a chat conversation.
type ChatMessage struct {
	Role        string           `json:"role"`
	Content     string           `json:"content"`
	Attachments []ChatAttachment `json:"attachments,omitempty"`
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
}

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
func runToolLoopStream(ctx context.Context, cm model.BaseChatModel, msgs []*schema.Message, tools []*schema.ToolInfo, req ChatRequest, opts []model.Option, onChunk func(StreamChunk)) (ChatStreamResult, error) {
	var result ChatStreamResult
	opts = bindTools(tools, opts)
	emit := func(c StreamChunk) {
		if onChunk != nil {
			onChunk(c)
		}
	}
	for step := 0; ; step++ {
		sr, err := cm.Stream(ctx, msgs, opts...)
		if err != nil {
			return result, fmt.Errorf("chat stream: %w", err)
		}
		var chunks []*schema.Message
		for {
			m, recvErr := sr.Recv()
			if recvErr == io.EOF {
				break
			}
			if recvErr != nil {
				sr.Close()
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
				emit(StreamChunk{Kind: StreamChunkText, Text: m.Content})
			}
			chunks = append(chunks, m)
		}
		sr.Close()

		final, err := schema.ConcatMessages(chunks)
		if err != nil {
			return result, fmt.Errorf("concat stream chunks: %w", err)
		}
		result.Usage.add(final.ResponseMeta)
		if len(final.ToolCalls) == 0 || req.ToolExec == nil || step+1 >= maxToolSteps {
			result.Text = strings.TrimSpace(result.Text)
			result.Reasoning = strings.TrimSpace(result.Reasoning)
			return result, nil
		}

		msgs = append(msgs, final)
		for _, tc := range final.ToolCalls {
			emit(StreamChunk{Kind: StreamChunkToolCall, ToolCallID: tc.ID, ToolName: tc.Function.Name, Input: tc.Function.Arguments})
		}
		msgs, err = execToolCalls(ctx, req, final.ToolCalls, msgs, onChunk)
		if err != nil {
			return result, err
		}
	}
}

// execToolCalls executes every requested tool call, appending the results as
// tool messages and (when onChunk is set) emitting StreamChunkToolResult
// events. Tool failures are fed back to the model as tool output instead of
// failing the whole request, mirroring the previous engine's graceful
// degradation for transient tool outages.
func execToolCalls(ctx context.Context, req ChatRequest, calls []schema.ToolCall, msgs []*schema.Message, onChunk func(StreamChunk)) ([]*schema.Message, error) {
	for _, tc := range calls {
		output, execErr := req.ToolExec(ctx, tc.Function.Name, json.RawMessage(tc.Function.Arguments))
		if execErr != nil {
			output = fmt.Sprintf("Tool %s failed: %v", tc.Function.Name, execErr)
		}
		if onChunk != nil {
			onChunk(StreamChunk{Kind: StreamChunkToolResult, ToolCallID: tc.ID, ToolName: tc.Function.Name, Output: output})
		}
		msgs = append(msgs, schema.ToolMessage(output, tc.ID, schema.WithToolName(tc.Function.Name)))
	}
	return msgs, nil
}
