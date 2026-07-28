package ai

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/zendev-sh/goai"
	"github.com/zendev-sh/goai/provider"
	"github.com/zendev-sh/goai/provider/google"
)

// GoogleProvider implements Provider for Google's Gemini API using goai.
type GoogleProvider struct {
	APIKey  string
	Model   string
	Timeout time.Duration
}

func (p *GoogleProvider) model() (provider.LanguageModel, error) {
	if p == nil || p.APIKey == "" {
		return nil, fmt.Errorf("google provider not configured: missing API key")
	}
	return google.Chat(p.Model, google.WithAPIKey(p.APIKey)), nil
}

func (p *GoogleProvider) goaiOpts(req ChatRequest) []goai.Option {
	var o []goai.Option

	if req.System != "" {
		o = append(o, goai.WithSystem(req.System))
	}

	if len(req.Messages) > 0 {
		msgs := make([]provider.Message, 0, len(req.Messages))
		for _, m := range req.Messages {
			msgs = append(msgs, provider.Message{
				Role:    provider.Role(m.Role),
				Content: []provider.Part{{Type: provider.PartText, Text: m.Content}},
			})
		}
		o = append(o, goai.WithMessages(msgs...))
	}

	if req.MaxTokens > 0 {
		o = append(o, goai.WithMaxOutputTokens(req.MaxTokens))
	}

	timeout := p.Timeout
	if req.Timeout > 0 {
		timeout = req.Timeout
	}
	if timeout <= 0 {
		timeout = 120 * time.Second
	}
	o = append(o, goai.WithTimeout(timeout))

	return o
}

func (p *GoogleProvider) Chat(ctx context.Context, req ChatRequest) (string, error) {
	model, err := p.model()
	if err != nil {
		return "", err
	}

	if req.Model != "" {
		model = google.Chat(req.Model, google.WithAPIKey(p.APIKey))
	}

	result, err := goai.GenerateText(ctx, model, p.goaiOpts(req)...)
	if err != nil {
		return "", fmt.Errorf("google chat completion: %w", err)
	}
	return strings.TrimSpace(result.Text), nil
}

func (p *GoogleProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(string)) (string, error) {
	model, err := p.model()
	if err != nil {
		return "", err
	}

	if req.Model != "" {
		model = google.Chat(req.Model, google.WithAPIKey(p.APIKey))
	}

	stream, err := goai.StreamText(ctx, model, p.goaiOpts(req)...)
	if err != nil {
		return "", fmt.Errorf("google chat stream: %w", err)
	}

	var fullText strings.Builder
	for text := range stream.TextStream() {
		fullText.WriteString(text)
		if onChunk != nil {
			onChunk(text)
		}
	}

	if err := stream.Err(); err != nil {
		return fullText.String(), fmt.Errorf("google stream error: %w", err)
	}

	return strings.TrimSpace(fullText.String()), nil
}

func (p *GoogleProvider) GenerateTitle(ctx context.Context, userMessage string, language string) (string, error) {
	titlePrompt := fmt.Sprintf(`Summarize the conversation in a clear and concise title of no more than 10 words in "%s", without punctuation or special symbols. No markdown format. Return only the title.`, language)

	fullPrompt := titlePrompt + "\n\nUser message: " + userMessage

	return p.Chat(ctx, ChatRequest{
		Messages:  []ChatMessage{{Role: "user", Content: fullPrompt}},
		MaxTokens: 20,
	})
}
