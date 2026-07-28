package ai

import (
	"fmt"
	"strings"
)

// ProviderInfo describes a known AI provider and its model catalog.
// This is the single source of truth for provider and model metadata;
// the database model catalog is seeded from this list.
type ProviderInfo struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	BaseURL      string      `json:"baseUrl"`
	Models       []ModelInfo `json:"models"`
	DefaultModel string      `json:"defaultModel"`
	// TitleModel is a lightweight model used for chat title generation.
	TitleModel string `json:"titleModel,omitempty"`
	// Gateway indicates the provider forwards unknown upstream model IDs
	// (e.g. "openai/...", "google/...") to their upstream provider.
	Gateway bool `json:"gateway"`
}

// ModelInfo describes a single model exposed by a provider.
// ID is the public model ID used by clients (e.g. "opencode/mimo-v2.5");
// UpstreamID is the identifier sent to the provider's API.
type ModelInfo struct {
	ID             string `json:"id"`
	UpstreamID     string `json:"upstreamId"`
	Provider       string `json:"provider"`
	DisplayName    string `json:"displayName"`
	SupportsImages bool   `json:"supportsImages"`
	SupportsSearch bool   `json:"supportsSearch"`
	MaxContext     int    `json:"maxContextTokens"`
	MaxOutput      int    `json:"maxOutputTokens"`
}

// knownProviders is the static provider catalog, mirroring Yara's registry.
var knownProviders = []ProviderInfo{
	{
		ID:           "vercel-ai-gateway",
		Name:         "Vercel AI Gateway",
		BaseURL:      "https://ai-gateway.vercel.sh/v3/ai",
		Gateway:      true,
		DefaultModel: "openai/gpt-5.4-nano",
		TitleModel:   "mistral/ministral-8b",
		Models: []ModelInfo{
			{ID: "openai/gpt-5.4-nano", UpstreamID: "openai/gpt-5.4-nano", Provider: "vercel-ai-gateway", DisplayName: "GPT-5.4 Nano", SupportsImages: true, SupportsSearch: true, MaxContext: 400000, MaxOutput: 128000},
			{ID: "google/gemini-3.5-flash", UpstreamID: "google/gemini-3.5-flash", Provider: "vercel-ai-gateway", DisplayName: "Gemini 3.5 Flash", SupportsImages: true, SupportsSearch: false, MaxContext: 1000000, MaxOutput: 64000},
			{ID: "deepseek/deepseek-v4-flash", UpstreamID: "deepseek/deepseek-v4-flash", Provider: "vercel-ai-gateway", DisplayName: "DeepSeek V4 Flash", SupportsImages: false, SupportsSearch: false, MaxContext: 390000, MaxOutput: 128000},
		},
	},
	{
		ID:           "opencode",
		Name:         "OpenCode GO",
		BaseURL:      "https://opencode.ai/zen/go/v1",
		DefaultModel: "opencode/mimo-v2.5",
		Models: []ModelInfo{
			{ID: "opencode/mimo-v2.5", UpstreamID: "mimo-v2.5", Provider: "opencode", DisplayName: "Mimo V2.5", SupportsImages: true, SupportsSearch: false, MaxContext: 1000000, MaxOutput: 128000},
			{ID: "opencode/qwen3.5-plus", UpstreamID: "qwen3.5-plus", Provider: "opencode", DisplayName: "Qwen 3.5 Plus", SupportsImages: true, SupportsSearch: false, MaxContext: 262144, MaxOutput: 65536},
			{ID: "opencode/deepseek-v4-flash", UpstreamID: "deepseek-v4-flash", Provider: "opencode", DisplayName: "DeepSeek V4 Flash", SupportsImages: false, SupportsSearch: false, MaxContext: 1000000, MaxOutput: 384000},
		},
	},
}

// Providers returns a copy of the static provider catalog.
func Providers() []ProviderInfo {
	out := make([]ProviderInfo, len(knownProviders))
	copy(out, knownProviders)
	return out
}

// ProviderByID looks up a provider by its ID.
func ProviderByID(id string) (ProviderInfo, bool) {
	for _, info := range knownProviders {
		if info.ID == id {
			return info, true
		}
	}
	return ProviderInfo{}, false
}

// ModelCatalog returns the flattened catalog of all provider models.
func ModelCatalog() []ModelInfo {
	var out []ModelInfo
	for _, info := range knownProviders {
		out = append(out, info.Models...)
	}
	return out
}

// TitleModelRef returns the public model ID to use for chat title generation
// (the gateway provider's lightweight title model), or "" if none is set.
func TitleModelRef() string {
	if info, ok := gatewayProvider(); ok && info.TitleModel != "" {
		return info.ID + "/" + info.TitleModel
	}
	return ""
}

// gatewayProvider returns the provider that forwards unknown upstream IDs.
func gatewayProvider() (ProviderInfo, bool) {
	for _, info := range knownProviders {
		if info.Gateway {
			return info, true
		}
	}
	return ProviderInfo{}, false
}

// ResolveModel maps a public model ID to its provider and upstream model ID.
//
// IDs with a known provider prefix (e.g. "opencode/mimo-v2.5") resolve to that
// provider with the remainder as the upstream model ID. Any other prefixed ID
// (e.g. "openai/gpt-5.4-nano") or unprefixed ID is routed through the gateway
// provider, passing the full ID upstream.
func ResolveModel(modelID string) (ProviderInfo, string, error) {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return ProviderInfo{}, "", fmt.Errorf("empty model ID")
	}

	if i := strings.IndexByte(modelID, '/'); i > 0 {
		if info, ok := ProviderByID(modelID[:i]); ok {
			// Known provider prefix: strip it and use the remainder upstream,
			// consulting the catalog for an explicit upstream ID if present.
			for _, m := range info.Models {
				if m.ID == modelID && m.UpstreamID != "" {
					return info, m.UpstreamID, nil
				}
			}
			return info, modelID[i+1:], nil
		}
	}

	if info, ok := gatewayProvider(); ok {
		return info, modelID, nil
	}
	return ProviderInfo{}, "", fmt.Errorf("unknown provider for model: %s", modelID)
}
