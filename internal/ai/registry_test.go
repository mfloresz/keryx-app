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
		{name: "opencode catalog model", modelID: "opencode/mimo-v2.5", wantProvider: "opencode", wantUpstream: "mimo-v2.5"},
		{name: "opencode catalog model qwen", modelID: "opencode/qwen3.5-plus", wantProvider: "opencode", wantUpstream: "qwen3.5-plus"},
		{name: "gateway model keeps full ID", modelID: "openai/gpt-5.4-nano", wantProvider: "vercel-ai-gateway", wantUpstream: "openai/gpt-5.4-nano"},
		{name: "unknown prefix routes via gateway", modelID: "anthropic/claude-x", wantProvider: "vercel-ai-gateway", wantUpstream: "anthropic/claude-x"},
		{name: "unprefixed routes via gateway", modelID: "gpt-5.4-nano", wantProvider: "vercel-ai-gateway", wantUpstream: "gpt-5.4-nano"},
		{name: "title model ref", modelID: TitleModelRef(), wantProvider: "vercel-ai-gateway", wantUpstream: "mistral/ministral-8b"},
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
	info, ok := ProviderByID("opencode")
	if !ok {
		t.Fatal("opencode provider not found")
	}
	if info.BaseURL != "https://opencode.ai/zen/go/v1" {
		t.Errorf("BaseURL = %q", info.BaseURL)
	}
	if _, ok := ProviderByID("nope"); ok {
		t.Error("unexpected provider found")
	}
}

func TestModelCatalogCoversSeeds(t *testing.T) {
	catalog := ModelCatalog()
	if len(catalog) != 6 {
		t.Fatalf("catalog len = %d, want 6", len(catalog))
	}
	for _, m := range catalog {
		if info, ok := ProviderByID(m.Provider); !ok {
			t.Errorf("model %q references unknown provider %q", m.ID, m.Provider)
		} else if m.UpstreamID == "" {
			t.Errorf("model %q has empty UpstreamID", info.ID)
		}
	}
}
