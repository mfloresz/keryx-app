package ai

import (
	"context"
	"fmt"
	"time"

	"github.com/cloudwego/eino/components/model"
	einogemini "github.com/cloudwego/eino-ext/components/model/gemini"
	"google.golang.org/genai"
)

// GoogleProvider implements Provider for Google's Gemini API (Gemma models)
// using the eino Gemini component, which maps multimodal parts natively and
// reports token usage — including cached-token counts — in message metadata.
type GoogleProvider struct {
	APIKey  string
	Model   string
	Timeout time.Duration
}

// chatModel builds a Gemini chat model for the given upstream model ID.
func (p *GoogleProvider) chatModel(ctx context.Context, modelID string) (model.BaseChatModel, error) {
	if p == nil || p.APIKey == "" {
		return nil, fmt.Errorf("google provider not configured: missing API key")
	}
	if modelID == "" {
		modelID = p.Model
	}
	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  p.APIKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		return nil, fmt.Errorf("create gemini client: %w", err)
	}
	return einogemini.NewChatModel(ctx, &einogemini.Config{
		Client: client,
		Model:  modelID,
	})
}

// requestModel returns the upstream model ID for a request.
func (p *GoogleProvider) requestModel(req ChatRequest) string {
	if req.Model != "" {
		return req.Model
	}
	return p.Model
}

func (p *GoogleProvider) requestTimeout(req ChatRequest) time.Duration {
	timeout := p.Timeout
	if req.Timeout > 0 {
		timeout = req.Timeout
	}
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	return timeout
}

func (p *GoogleProvider) Chat(ctx context.Context, req ChatRequest) (string, error) {
	// Caller-owned timeout: the HTTP client is left timeout-free so a long
	// tool-loop stream is never killed by the client before the chunk
	// channel is drained (see OpenAIProvider.Chat).
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	cm, err := p.chatModel(ctx, p.requestModel(req))
	if err != nil {
		return "", err
	}
	msgs := buildSchemaMessages(req, true)
	tools, err := toToolInfos(req.Tools)
	if err != nil {
		return "", err
	}
	result, err := runToolLoopGenerate(ctx, cm, msgs, tools, req, nil)
	if err != nil {
		return "", fmt.Errorf("google chat completion: %w", err)
	}
	return result.Text, nil
}

func (p *GoogleProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(StreamChunk)) (ChatStreamResult, error) {
	var result ChatStreamResult

	// Caller-owned timeout (see Chat).
	ctx, cancel := context.WithTimeout(ctx, p.requestTimeout(req))
	defer cancel()

	cm, err := p.chatModel(ctx, p.requestModel(req))
	if err != nil {
		return result, err
	}
	msgs := buildSchemaMessages(req, true)
	tools, err := toToolInfos(req.Tools)
	if err != nil {
		return result, err
	}
	result, err = runToolLoopStream(ctx, cm, msgs, tools, req, nil, onChunk)
	if err != nil {
		return result, fmt.Errorf("google chat stream: %w", err)
	}
	return result, nil
}

func (p *GoogleProvider) GenerateTitle(ctx context.Context, systemPrompt string, userMessage string, language string) (string, error) {
	return p.Chat(ctx, ChatRequest{
		System:   systemPrompt,
		Messages: []ChatMessage{{Role: "user", Content: userMessage}},
	})
}
