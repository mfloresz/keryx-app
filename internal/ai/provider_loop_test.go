package ai

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

// scriptedStreamModel is a mock BaseChatModel whose Stream calls return the
// given per-attempt chunks in order (each attempt ends with io.EOF).
type scriptedStreamModel struct {
	attempts [][]*schema.Message
	calls    int
}

func (m *scriptedStreamModel) Generate(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.Message, error) {
	return nil, errors.New("generate not implemented")
}

func (m *scriptedStreamModel) Stream(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	i := m.calls
	m.calls++
	sr, sw := schema.Pipe[*schema.Message](1)
	go func() {
		defer sw.Close()
		for _, c := range m.attempts[i] {
			if sw.Send(c, nil) {
				return
			}
		}
	}()
	return sr, nil
}

// stalledStreamModel emits one reasoning chunk and then never sends again
// until its context is canceled, simulating a connection that stops sending
// data without dying.
type stalledStreamModel struct {
	streaming chan struct{}
}

func (m *stalledStreamModel) Generate(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.Message, error) {
	return nil, errors.New("generate not implemented")
}

func (m *stalledStreamModel) Stream(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	sr, sw := schema.Pipe[*schema.Message](1)
	close(m.streaming)
	go func() {
		defer sw.Close()
		sw.Send(&schema.Message{ReasoningContent: "thinking…"}, nil)
		<-ctx.Done()
		sw.Send(nil, ctx.Err())
	}()
	return sr, nil
}

// scriptedGenerateModel is a mock BaseChatModel whose Generate calls return
// the given messages in order.
type scriptedGenerateModel struct {
	msgs  []*schema.Message
	calls int
}

func (m *scriptedGenerateModel) Generate(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.Message, error) {
	i := m.calls
	m.calls++
	return m.msgs[i], nil
}

func (m *scriptedGenerateModel) Stream(ctx context.Context, in []*schema.Message, opts ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	return nil, errors.New("stream not implemented")
}

func TestRunToolLoopStreamRetriesThinkingOnlyDeath(t *testing.T) {
	m := &scriptedStreamModel{attempts: [][]*schema.Message{
		// First attempt: only reasoning, then a clean EOF with no finish
		// reason — indistinguishable from a connection that died.
		{{ReasoningContent: "pondering…"}},
		// Retry: the model actually answers.
		{{Content: "the answer"}, {ResponseMeta: &schema.ResponseMeta{FinishReason: "stop"}}},
	}}
	var chunks []StreamChunk
	result, err := runToolLoopStream(context.Background(), m,
		[]*schema.Message{{Role: "user", Content: "hi"}}, nil, ChatRequest{}, nil,
		func(c StreamChunk) { chunks = append(chunks, c) })
	if err != nil {
		t.Fatalf("runToolLoopStream failed: %v", err)
	}
	if m.calls != 2 {
		t.Errorf("expected 2 stream attempts, got %d", m.calls)
	}
	if result.Text != "the answer" {
		t.Errorf("result.Text = %q, want the answer", result.Text)
	}
	if result.Reasoning != "pondering…" {
		t.Errorf("result.Reasoning = %q, want pondering… (kept from the failed attempt)", result.Reasoning)
	}
}

func TestRunToolLoopStreamThinkingOnlyTwiceFailsWithErrEmptyResponse(t *testing.T) {
	m := &scriptedStreamModel{attempts: [][]*schema.Message{
		{{ReasoningContent: "pondering…"}},
		{{ReasoningContent: "pondering more…"}},
	}}
	_, err := runToolLoopStream(context.Background(), m,
		[]*schema.Message{{Role: "user", Content: "hi"}}, nil, ChatRequest{}, nil, nil)
	if !errors.Is(err, ErrEmptyResponse) {
		t.Fatalf("err = %v, want ErrEmptyResponse", err)
	}
	if m.calls != 2 {
		t.Errorf("expected exactly one retry (2 attempts), got %d", m.calls)
	}
}

func TestRunToolLoopStreamFinishReasonLengthReturnsErrOutputLimit(t *testing.T) {
	m := &scriptedStreamModel{attempts: [][]*schema.Message{
		{{Content: "partial ans"}, {ResponseMeta: &schema.ResponseMeta{FinishReason: "length"}}},
	}}
	result, err := runToolLoopStream(context.Background(), m,
		[]*schema.Message{{Role: "user", Content: "hi"}}, nil, ChatRequest{}, nil, nil)
	if !errors.Is(err, ErrOutputLimit) {
		t.Fatalf("err = %v, want ErrOutputLimit", err)
	}
	if result.Text != "partial ans" {
		t.Errorf("result.Text = %q, want partial text kept in result", result.Text)
	}
}

func TestRunToolLoopStreamIdleTimeout(t *testing.T) {
	old := idleChunkTimeout
	idleChunkTimeout = 50 * time.Millisecond
	defer func() { idleChunkTimeout = old }()

	m := &stalledStreamModel{streaming: make(chan struct{})}
	_, err := runToolLoopStream(context.Background(), m,
		[]*schema.Message{{Role: "user", Content: "hi"}}, nil, ChatRequest{}, nil, nil)
	if !errors.Is(err, ErrIdleTimeout) {
		t.Fatalf("err = %v, want ErrIdleTimeout", err)
	}
}

func TestRunToolLoopGenerateSentinels(t *testing.T) {
	t.Run("empty content with reasoning yields ErrEmptyResponse", func(t *testing.T) {
		m := &scriptedGenerateModel{msgs: []*schema.Message{
			{Role: "assistant", ReasoningContent: "hmm"},
		}}
		result, err := runToolLoopGenerate(context.Background(), m,
			[]*schema.Message{{Role: "user", Content: "hi"}}, nil, ChatRequest{}, nil)
		if !errors.Is(err, ErrEmptyResponse) {
			t.Fatalf("err = %v, want ErrEmptyResponse", err)
		}
		if result.Reasoning != "hmm" {
			t.Errorf("result.Reasoning = %q, want hmm", result.Reasoning)
		}
	})

	t.Run("finish reason length yields ErrOutputLimit with partial text", func(t *testing.T) {
		m := &scriptedGenerateModel{msgs: []*schema.Message{
			{Role: "assistant", Content: "partial",
				ResponseMeta: &schema.ResponseMeta{FinishReason: "length"}},
		}}
		result, err := runToolLoopGenerate(context.Background(), m,
			[]*schema.Message{{Role: "user", Content: "hi"}}, nil, ChatRequest{}, nil)
		if !errors.Is(err, ErrOutputLimit) {
			t.Fatalf("err = %v, want ErrOutputLimit", err)
		}
		if result.Text != "partial" {
			t.Errorf("result.Text = %q, want partial text kept in result", result.Text)
		}
	})

	t.Run("content filter yields ErrContentFilter", func(t *testing.T) {
		m := &scriptedGenerateModel{msgs: []*schema.Message{
			{Role: "assistant", Content: "",
				ResponseMeta: &schema.ResponseMeta{FinishReason: "content_filter"}},
		}}
		if _, err := runToolLoopGenerate(context.Background(), m,
			[]*schema.Message{{Role: "user", Content: "hi"}}, nil, ChatRequest{}, nil); !errors.Is(err, ErrContentFilter) {
			t.Fatalf("err = %v, want ErrContentFilter", err)
		}
	})
}

func TestChatStreamFinishReasonLengthOverTheWire(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	lengthStream := "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial ans\"}}]}\n\n" +
		"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"length\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":100}}\n\n" +
		"data: [DONE]\n\n"
	srv := scriptedServer(t, []string{lengthStream}, &bodies, &headers)

	provider := &OpenAIProvider{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"}
	result, err := provider.ChatStream(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}, nil)
	if !errors.Is(err, ErrOutputLimit) {
		t.Fatalf("err = %v, want ErrOutputLimit", err)
	}
	if result.Text != "partial ans" {
		t.Errorf("result.Text = %q, want partial ans kept for persistence", result.Text)
	}
}

func TestChatGenerateEmptyContentWithReasoningOverTheWire(t *testing.T) {
	var bodies []map[string]any
	var headers []http.Header
	thinkingOnly := `{"id":"test","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"","reasoning_content":"hmm"},"finish_reason":"stop"}]}`
	srv := scriptedServer(t, []string{thinkingOnly}, &bodies, &headers)

	provider := &OpenAIProvider{APIKey: "test-key", BaseURL: srv.URL, Model: "test-model"}
	if _, err := provider.Chat(context.Background(), ChatRequest{
		Messages: []ChatMessage{{Role: "user", Content: "hello"}},
	}); !errors.Is(err, ErrEmptyResponse) {
		t.Fatalf("err = %v, want ErrEmptyResponse", err)
	}
}

func TestFitMessagesToBudget(t *testing.T) {
	mk := func(content string) ChatMessage { return ChatMessage{Role: "user", Content: content} }

	t.Run("keeps newest suffix within budget", func(t *testing.T) {
		msgs := []ChatMessage{mk("aaaa"), mk("bb"), mk("cc"), mk("dddddd")}
		got := FitMessagesToBudget(msgs, 8) // cc + dddddd fit exactly; aaaa and bb do not
		if len(got) != 2 || got[0].Content != "cc" || got[1].Content != "dddddd" {
			t.Errorf("FitMessagesToBudget = %+v, want [cc dddddd]", got)
		}
	})

	t.Run("stops at the first message that would exceed the budget", func(t *testing.T) {
		// "e" is small, but "bbbbbbbb" hits the wall first and everything
		// older is dropped even though "e" would fit.
		msgs := []ChatMessage{mk("e"), mk("bbbbbbbb"), mk("cc")}
		got := FitMessagesToBudget(msgs, 4)
		if len(got) != 1 || got[0].Content != "cc" {
			t.Errorf("FitMessagesToBudget = %+v, want [cc]", got)
		}
	})

	t.Run("always keeps newest message even alone over budget", func(t *testing.T) {
		msgs := []ChatMessage{mk("aaaa"), mk("bbbbbbbbbb")}
		got := FitMessagesToBudget(msgs, 5)
		if len(got) != 1 || got[0].Content != "bbbbbbbbbb" {
			t.Errorf("FitMessagesToBudget = %+v, want newest message kept", got)
		}
	})

	t.Run("attachments count markdown or data plus overhead", func(t *testing.T) {
		msgs := []ChatMessage{
			{Content: "x", Attachments: []ChatAttachment{{Data: []byte(strings.Repeat("a", 100))}}},
			{Content: "y"},
		}
		// Newest (y, size 1) fits; the attachment message (1 + 100 + 64) does
		// not within 100.
		got := FitMessagesToBudget(msgs, 100)
		if len(got) != 1 || got[0].Content != "y" {
			t.Errorf("FitMessagesToBudget = %+v, want [y]", got)
		}
		// Markdown replaces the data estimate.
		msgs[0].Attachments[0].Markdown = strings.Repeat("m", 100)
		got = FitMessagesToBudget(msgs, 200)
		if len(got) != 2 {
			t.Errorf("expected both messages to fit with markdown sizing, got %d", len(got))
		}
	})

	t.Run("image attachments use token estimate instead of byte size", func(t *testing.T) {
		msgs := []ChatMessage{
			{Content: "older", Attachments: []ChatAttachment{{
				MediaType: "image/jpeg",
				Data:      make([]byte, 2_000_000), // 2 MB image
			}}},
			{Content: "newer"},
		}
		// With 2 MB raw bytes it would exceed 10_000 chars, but with ImageAttachmentCharEstimate (4000) it fits!
		got := FitMessagesToBudget(msgs, 10_000)
		if len(got) != 2 {
			t.Fatalf("expected both messages to fit within budget, got %d", len(got))
		}
	})

	t.Run("maxChars<=0 passthrough", func(t *testing.T) {
		msgs := []ChatMessage{mk("a"), mk("b")}
		if got := FitMessagesToBudget(msgs, 0); len(got) != 2 {
			t.Errorf("FitMessagesToBudget(0) = %+v, want passthrough", got)
		}
		if got := FitMessagesToBudget(msgs, -1); len(got) != 2 {
			t.Errorf("FitMessagesToBudget(-1) = %+v, want passthrough", got)
		}
	})

	t.Run("empty input", func(t *testing.T) {
		if got := FitMessagesToBudget(nil, 100); len(got) != 0 {
			t.Errorf("FitMessagesToBudget(nil) = %+v, want empty", got)
		}
	})
}
