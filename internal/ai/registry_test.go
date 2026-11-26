package ai

import (
	"testing"
)

func TestResolveModel(t *testing.T) {
	tests := []struct {
		name         string
		modelID      string
		wantProvider string
		wantUpstream string
		wantErr      bool
	}{
		{name: "venice catalog model", modelID: "venice/e2ee-deepseek-v4-flash", wantProvider: "venice", wantUpstream: "e2ee-deepseek-v4-flash"},
		{name: "venice mistral model", modelID: "venice/mistral-small-3-2-24b-instruct", wantProvider: "venice", wantUpstream: "mistral-small-3-2-24b-instruct"},
		{name: "venice qwen image model", modelID: "venice/qwen-3-8-27b", wantProvider: "venice", wantUpstream: "qwen-3-8-27b"},
		{name: "venice nemotron model", modelID: "venice/nvidia-nemotron-3-5-lightning-30b-a3b", wantProvider: "venice", wantUpstream: "nvidia-nemotron-3-5-lightning-30b-a3b"},
		{name: "venice qwen3 image model", modelID: "venice/qwen3-6-35b-a3b", wantProvider: "venice", wantUpstream: "qwen3-6-35b-a3b"},
		{name: "opencode-go catalog model", modelID: "opencode-go/mimo-v2.5", wantProvider: "opencode-go", wantUpstream: "mimo-v2.5"},
		{name: "opencode-go deepseek model", modelID: "opencode-go/deepseek-v4-flash", wantProvider: "opencode-go", wantUpstream: "deepseek-v4-flash"},
		{name: "opencode-go minimax model", modelID: "opencode-go/minimax-m3", wantProvider: "opencode-go", wantUpstream: "minimax-m3"},
		{name: "opencode-go glm model", modelID: "opencode-go/glm-5.2", wantProvider: "opencode-go", wantUpstream: "glm-5.2"},
		{name: "opencode-go reasoning variant keeps effort", modelID: "opencode-go/gpt-5.6-luna (reasoning: medium)", wantProvider: "opencode-go", wantUpstream: "gpt-5.6-luna (reasoning: medium)"},
		{name: "lmstudio local model", modelID: "lmstudio/local-model", wantProvider: "lmstudio", wantUpstream: "local-model"},
		{name: "google gemma model", modelID: "google/gemma-4-31b-it", wantProvider: "google", wantUpstream: "gemma-4-31b-it"},
		{name: "openrouter hy4 flash model", modelID: "openrouter/tencent/hy4-flash", wantProvider: "openrouter", wantUpstream: "tencent/hy4-flash"},
		{name: "openrouter muse spark model", modelID: "openrouter/meta/muse-spark-1.3-contributor", wantProvider: "openrouter", wantUpstream: "meta/muse-spark-1.3-contributor"},
		{name: "openrouter claude haiku model", modelID: "openrouter/anthropic/claude-haiku-5.5", wantProvider: "openrouter", wantUpstream: "anthropic/claude-haiku-5.5"},
		{name: "openrouter muse ember model", modelID: "openrouter/meta/muse-ember", wantProvider: "openrouter", wantUpstream: "meta/muse-ember"},
		{name: "openrouter inkling mini model", modelID: "openrouter/thinkingmachines/inkling-2-mini", wantProvider: "openrouter", wantUpstream: "thinkingmachines/inkling-2-mini"},
		{name: "openrouter reasoning variant keeps effort", modelID: "openrouter/openai/gpt-6-luna (reasoning: medium)", wantProvider: "openrouter", wantUpstream: "openai/gpt-6-luna (reasoning: medium)"},
		{name: "liquid lfm3 model", modelID: "liquid/lfm3-1.7b", wantProvider: "liquid", wantUpstream: "lfm3-1.7b"},
		{name: "unknown prefix errors", modelID: "unknown/model-x", wantErr: true},
		{name: "unprefixed errors (no gateway)", modelID: "gpt-5.4-nano", wantErr: true},
		{name: "empty model errors", modelID: " ", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, upstream, err := ResolveModel(tt.modelID)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got provider=%q upstream=%q", info.ID, upstream)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if info.ID != tt.wantProvider {
				t.Errorf("provider = %q, want %q", info.ID, tt.wantProvider)
			}
			if upstream != tt.wantUpstream {
				t.Errorf("upstream = %q, want %q", upstream, tt.wantUpstream)
			}
		})
	}
}

func TestProviderByID(t *testing.T) {
	info, ok := ProviderByID("venice")
	if !ok {
		t.Fatal("venice provider not found")
	}
	if info.BaseURL != "https://api.venice.ai/api/v1" {
		t.Errorf("BaseURL = %q", info.BaseURL)
	}
	if _, ok := ProviderByID("nope"); ok {
		t.Error("unexpected provider found")
	}
}

func TestModelCatalogCoversSeeds(t *testing.T) {
	catalog := ModelCatalog()
	if len(catalog) != 42 {
		t.Fatalf("catalog len = %d, want 42", len(catalog))
	}
	for _, m := range catalog {
		if info, ok := ProviderByID(m.Provider); !ok {
			t.Errorf("model %q references unknown provider %q", m.ID, m.Provider)
		} else if m.UpstreamID == "" {
			t.Errorf("model %q has empty UpstreamID", info.ID)
		}
	}
}

func TestVeniceCatalogMetadata(t *testing.T) {
	catalog := ModelCatalog()
	byID := make(map[string]ModelInfo, len(catalog))
	for _, m := range catalog {
		byID[m.ID] = m
	}

	for _, id := range []string{
		"venice/qwen-3-8-27b",
		"venice/qwen3-6-35b-a3b",
	} {
		if m, ok := byID[id]; !ok {
			t.Errorf("missing model %q", id)
		} else if !m.SupportsImages {
			t.Errorf("%s should support images", id)
		}
	}
	if m := byID["venice/nvidia-nemotron-3-5-lightning-30b-a3b"]; m.SupportsImages {
		t.Error("venice/nvidia-nemotron-3-5-lightning-30b-a3b should not support images")
	}
}

func TestReasoningVariants(t *testing.T) {
	base := "openai/gpt-5.6-luna"
	for _, effort := range []string{"none", "low", "medium"} {
		variant := base + " (reasoning: " + effort + ")"
		if got := reasoningEffort(variant); got != effort {
			t.Errorf("reasoningEffort(%q) = %q, want %q", variant, got, effort)
		}
		if got := reasoningBaseModel(variant); got != base {
			t.Errorf("reasoningBaseModel(%q) = %q, want %q", variant, got, base)
		}
	}

	for _, plain := range []string{base, "nvidia/nemotron-3.5-lightning", "meta/muse-glimmer-30b"} {
		if got := reasoningEffort(plain); got != "" {
			t.Errorf("reasoningEffort(%q) = %q, want empty", plain, got)
		}
		if got := reasoningBaseModel(plain); got != plain {
			t.Errorf("reasoningBaseModel(%q) = %q, want unchanged", plain, got)
		}
	}

	// Unsupported efforts are not treated as variants.
	unsupported := base + " (reasoning: high)"
	if got := reasoningEffort(unsupported); got != "" {
		t.Errorf("reasoningEffort(%q) = %q, want empty", unsupported, got)
	}
}

func TestOpenRouterCatalogMetadata(t *testing.T) {
	catalog := ModelCatalog()
	byID := make(map[string]ModelInfo, len(catalog))
	for _, m := range catalog {
		byID[m.ID] = m
	}

	if m := byID["openrouter/tencent/hy4-flash"]; !m.SupportsImages {
		t.Error("tencent/hy4-flash should support images")
	}
	if m := byID["openrouter/meta/muse-spark-1.3-contributor"]; !m.SupportsImages {
		t.Error("meta/muse-spark-1.3-contributor should support images")
	}
	if m := byID["openrouter/anthropic/claude-haiku-5.5"]; !m.SupportsImages {
		t.Error("anthropic/claude-haiku-5.5 should support images")
	}
	if m := byID["openrouter/meta/muse-ember"]; !m.SupportsImages {
		t.Error("meta/muse-ember should support images")
	}
	if m := byID["openrouter/thinkingmachines/inkling-2-mini"]; !m.SupportsImages {
		t.Error("thinkingmachines/inkling-2-mini should support images")
	}
	if m := byID["openrouter/tencent/hy4-flash"]; m.MaxContext != 512000 {
		t.Errorf("tencent/hy4-flash MaxContext = %d, want 512000", m.MaxContext)
	}
	if m := byID["openrouter/meta/muse-spark-1.3-contributor"]; m.MaxContext != 750000 {
		t.Errorf("meta/muse-spark-1.3-contributor MaxContext = %d, want 750000", m.MaxContext)
	}
	if m := byID["openrouter/openai/gpt-6-luna (reasoning: medium)"]; m.MaxContext != 262000 {
		t.Errorf("gpt-6-luna MaxContext = %d, want 262000", m.MaxContext)
	}
	for _, id := range []string{
		"openrouter/openai/gpt-6-luna (reasoning: none)",
		"openrouter/openai/gpt-6-luna (reasoning: low)",
		"openrouter/openai/gpt-6-luna (reasoning: medium)",
	} {
		if m, ok := byID[id]; !ok {
			t.Errorf("missing reasoning variant %q", id)
		} else if !m.SupportsImages {
			t.Errorf("%s should support images", id)
		}
	}
}

func TestOpenCodeGoCatalogMetadata(t *testing.T) {
	catalog := ModelCatalog()
	byID := make(map[string]ModelInfo, len(catalog))
	for _, m := range catalog {
		byID[m.ID] = m
	}

	if _, ok := ProviderByID("opencode-go"); !ok {
		t.Error("missing opencode-go provider")
	}

	if m := byID["opencode-go/minimax-m3"]; !m.SupportsImages {
		t.Error("opencode-go/minimax-m3 should support images")
	}
	if m := byID["opencode-go/glm-5.2"]; m.SupportsImages {
		t.Error("opencode-go/glm-5.2 should not support images")
	}
	for _, id := range []string{
		"opencode-go/gpt-5.6-luna (reasoning: none)",
		"opencode-go/gpt-5.6-luna (reasoning: low)",
		"opencode-go/gpt-5.6-luna (reasoning: medium)",
	} {
		if m, ok := byID[id]; !ok {
			t.Errorf("missing reasoning variant %q", id)
		} else if !m.SupportsImages {
			t.Errorf("%s should support images", id)
		}
	}
}

func TestLiquidCatalogMetadata(t *testing.T) {
	info, ok := ProviderByID("liquid")
	if !ok {
		t.Fatal("missing liquid provider")
	}
	if info.BaseURL != "https://api.liquid.ai/openai/v1" {
		t.Errorf("BaseURL = %q", info.BaseURL)
	}
	if !info.OpenAICompat {
		t.Error("liquid should be OpenAI compatible")
	}
	if info.DefaultModel != "lfm3-1.7b" {
		t.Errorf("DefaultModel = %q, want lfm3-1.7b", info.DefaultModel)
	}

	catalog := ModelCatalog()
	byID := make(map[string]ModelInfo, len(catalog))
	for _, m := range catalog {
		byID[m.ID] = m
	}

	m, ok := byID["liquid/lfm3-1.7b"]
	if !ok {
		t.Fatal("missing liquid/lfm3-1.7b")
	}
	if m.SupportsImages {
		t.Error("liquid/lfm3-1.7b should not support images")
	}
	if m.MaxContext != 256000 {
		t.Errorf("liquid/lfm3-1.7b MaxContext = %d, want 256000", m.MaxContext)
	}
}
