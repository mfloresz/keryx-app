package ai

import "testing"

func TestOpenAIProviderRequestOptionsReasoning(t *testing.T) {
	provider := &OpenAIProvider{
		Model: "openai/gpt-5.6-luna (reasoning: medium)",
		GoAIOptions: map[string]any{
			"useResponsesAPI": false,
		},
	}

	// A reasoning-variant request carries the effort as a provider option.
	opts := provider.requestOptions(ChatRequest{Model: "openai/gpt-5.6-luna (reasoning: low)"})
	reasoning, ok := opts["reasoning"].(map[string]any)
	if !ok {
		t.Fatalf("expected reasoning option, got %v", opts["reasoning"])
	}
	if reasoning["effort"] != "low" {
		t.Errorf("effort = %v, want low", reasoning["effort"])
	}

	// A plain request has no reasoning option, even when the cached provider
	// was built for a reasoning variant (cached per provider ID).
	opts = provider.requestOptions(ChatRequest{Model: "nvidia/nemotron-3.5-lightning"})
	if _, ok := opts["reasoning"]; ok {
		t.Errorf("unexpected reasoning option for plain model: %v", opts["reasoning"])
	}
}

func TestOpenAIProviderModelIDStripsReasoningSuffix(t *testing.T) {
	provider := &OpenAIProvider{
		APIKey:  "test-key",
		BaseURL: "https://openrouter.ai/api/v1",
		Model:   "openai/gpt-5.6-luna (reasoning: medium)",
	}

	model, err := provider.model()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if model.ModelID() != "openai/gpt-5.6-luna" {
		t.Errorf("model ID = %q, want %q", model.ModelID(), "openai/gpt-5.6-luna")
	}
}
