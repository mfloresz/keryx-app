package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OpenAIProvider implements Provider for OpenAI-compatible APIs.
type OpenAIProvider struct {
	APIKey  string
	BaseURL string
	Timeout time.Duration
}

// chatCompletionRequest is the OpenAI-compatible chat completions request body.
type chatCompletionRequest struct {
	Model       string          `json:"model"`
	Messages    []chatMessage   `json:"messages"`
	Stream      bool            `json:"stream,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// chatCompletionResponse is the non-streaming response.
type chatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage,omitempty"`
}

// streamEvent is a single SSE event from a streaming response.
type streamEvent struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
}

func (p *OpenAIProvider) doRequest(ctx context.Context, req chatCompletionRequest) (*http.Response, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	baseURL := strings.TrimRight(p.BaseURL, "/")
	httpReq, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.APIKey)

	client := &http.Client{}
	if p.Timeout > 0 {
		client.Timeout = p.Timeout
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	return resp, nil
}

func (p *OpenAIProvider) Chat(ctx context.Context, req ChatRequest) (string, error) {
	chatReq := chatCompletionRequest{
		Model:       req.Model,
		Messages:    convertMessages(req.System, req.Messages),
		MaxTokens:   req.MaxTokens,
		Temperature: 0.7,
	}

	resp, err := p.doRequest(ctx, chatReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	var result chatCompletionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	if len(result.Choices) == 0 {
		return "", fmt.Errorf("no choices in response")
	}

	return strings.TrimSpace(result.Choices[0].Message.Content), nil
}

func (p *OpenAIProvider) ChatStream(ctx context.Context, req ChatRequest, onChunk func(string)) (string, error) {
	chatReq := chatCompletionRequest{
		Model:       req.Model,
		Messages:    convertMessages(req.System, req.Messages),
		Stream:      true,
		MaxTokens:   req.MaxTokens,
		Temperature: 0.7,
	}

	resp, err := p.doRequest(ctx, chatReq)
	if err != nil {
		return "", err
	}

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return "", fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	defer resp.Body.Close()

	var fullText strings.Builder
	scanner := bufio.NewScanner(resp.Body)

	for scanner.Scan() {
		line := scanner.Text()

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var event streamEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		if len(event.Choices) > 0 {
			content := event.Choices[0].Delta.Content
			if content != "" {
				fullText.WriteString(content)
				if onChunk != nil {
					onChunk(content)
				}
			}

			if event.Choices[0].FinishReason != nil {
				break
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return fullText.String(), fmt.Errorf("stream read error: %w", err)
	}

	return strings.TrimSpace(fullText.String()), nil
}

func (p *OpenAIProvider) GenerateTitle(ctx context.Context, userMessage string) (string, error) {
	titlePrompt := `Generate a very short, concise title (max 6 words) in Spanish for a chat conversation that starts with this user message. Respond with ONLY the title text, no quotes, no punctuation.

User message: ` + userMessage

	req := ChatRequest{
		Model: "mistral/ministral-8b", // lightweight model for titles
		Messages: []ChatMessage{
			{Role: "user", Content: titlePrompt},
		},
		MaxTokens: 20,
	}

	return p.Chat(ctx, req)
}

func convertMessages(system string, messages []ChatMessage) []chatMessage {
	var result []chatMessage

	if system != "" {
		result = append(result, chatMessage{Role: "system", Content: system})
	}

	for _, msg := range messages {
		result = append(result, chatMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	return result
}
