package ai

import "testing"

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
		{name: "opencode-go catalog model", modelID: "opencode-go/mimo-v2.5", wantProvider: "opencode-go", wantUpstream: "mimo-v2.5"},
		{name: "opencode-go deepseek model", modelID: "opencode-go/deepseek-v4-flash", wantProvider: "opencode-go", wantUpstream: "deepseek-v4-flash"},
		{name: "lmstudio local model", modelID: "lmstudio/local-model", wantProvider: "lmstudio", wantUpstream: "local-model"},
		{name: "google gemma model", modelID: "google/gemma-4-31b-it", wantProvider: "google", wantUpstream: "gemma-4-31b-it"},
		{name: "openrouter nemotron model", modelID: "openrouter/nvidia/nemotron-3.5-lightning", wantProvider: "openrouter", wantUpstream: "nvidia/nemotron-3.5-lightning"},
		{name: "openrouter glimmer image model", modelID: "openrouter/meta/muse-glimmer-30b", wantProvider: "openrouter", wantUpstream: "meta/muse-glimmer-30b"},
		{name: "openrouter ministral model", modelID: "openrouter/mistralai/ministral-3b-2512", wantProvider: "openrouter", wantUpstream: "mistralai/ministral-3b-2512"},
		{name: "openrouter mistral small model", modelID: "openrouter/mistralai/mistral-small-2603", wantProvider: "openrouter", wantUpstream: "mistralai/mistral-small-2603"},
		{name: "openrouter reasoning variant keeps effort", modelID: "openrouter/openai/gpt-5.6-luna (reasoning: medium)", wantProvider: "openrouter", wantUpstream: "openai/gpt-5.6-luna (reasoning: medium)"},
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
	if len(catalog) != 28 {
		t.Fatalf("catalog len = %d, want 28", len(catalog))
	}
	for _, m := range catalog {
		if info, ok := ProviderByID(m.Provider); !ok {
			t.Errorf("model %q references unknown provider %q", m.ID, m.Provider)
		} else if m.UpstreamID == "" {
			t.Errorf("model %q has empty UpstreamID", info.ID)
		}
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

	if m := byID["openrouter/meta/muse-glimmer-30b"]; !m.SupportsImages {
		t.Error("meta/muse-glimmer-30b should support images")
	}
	if m := byID["openrouter/mistralai/ministral-3b-2512"]; !m.SupportsImages {
		t.Error("mistralai/ministral-3b-2512 should support images")
	}
	if m := byID["openrouter/mistralai/mistral-small-2603"]; !m.SupportsImages {
		t.Error("mistralai/mistral-small-2603 should support images")
	}
	for _, id := range []string{
		"openrouter/nvidia/nemotron-3.5-lightning",
		"openrouter/inclusionai/ling-3.0-flash",
	} {
		if m := byID[id]; m.SupportsImages {
			t.Errorf("%s should not support images", id)
		}
	}
	for _, id := range []string{
		"openrouter/openai/gpt-5.6-luna (reasoning: none)",
		"openrouter/openai/gpt-5.6-luna (reasoning: low)",
		"openrouter/openai/gpt-5.6-luna (reasoning: medium)",
	} {
		if m, ok := byID[id]; !ok {
			t.Errorf("missing reasoning variant %q", id)
		} else if !m.SupportsImages {
			t.Errorf("%s should support images", id)
		}
	}
}
