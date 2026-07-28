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
	if len(catalog) != 14 {
		t.Fatalf("catalog len = %d, want 14", len(catalog))
	}
	for _, m := range catalog {
		if info, ok := ProviderByID(m.Provider); !ok {
			t.Errorf("model %q references unknown provider %q", m.ID, m.Provider)
		} else if m.UpstreamID == "" {
			t.Errorf("model %q has empty UpstreamID", info.ID)
		}
	}
}

func TestDefaultProvider(t *testing.T) {
	dp := DefaultProvider()
	if dp.ID != "venice" {
		t.Errorf("DefaultProvider = %q, want %q", dp.ID, "venice")
	}
}
