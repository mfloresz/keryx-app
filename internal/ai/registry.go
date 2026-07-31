package ai

import (
	"fmt"
	"strings"
)

// ProviderInfo describes a known AI provider and its model catalog.
// This is the single source of truth for provider and model metadata;
// the database model catalog is seeded from this list.
type ProviderInfo struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	BaseURL      string         `json:"baseUrl"`
	Models       []ModelInfo    `json:"models"`
	DefaultModel string         `json:"defaultModel"`
	OpenAICompat bool           `json:"openaiCompat"`
	GoAIOptions  map[string]any `json:"goaiOptions,omitempty"`
}

// ModelInfo describes a single model exposed by a provider.
// ID is the public model ID used by clients (e.g. "venice/e2ee-deepseek-v4-flash");
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
		ID:           "venice",
		Name:         "Venice",
		BaseURL:      "https://api.venice.ai/api/v1",
		OpenAICompat: true,
		DefaultModel: "e2ee-deepseek-v4-flash",
		GoAIOptions: map[string]any{
			"useResponsesAPI":  false,
			"strictJsonSchema": true,
			"venice_parameters": map[string]any{
				"include_venice_system_prompt": false,
			},
		},
		Models: []ModelInfo{
			{ID: "venice/e2ee-deepseek-v4-flash", UpstreamID: "e2ee-deepseek-v4-flash", Provider: "venice", DisplayName: "DeepSeek V4 Flash (E2EE)", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/mistral-small-3-2-24b-instruct", UpstreamID: "mistral-small-3-2-24b-instruct", Provider: "venice", DisplayName: "Mistral Small 3.2 24B", SupportsImages: true, SupportsSearch: true, MaxContext: 128000, MaxOutput: 0},
			{ID: "venice/google-gemma-4-31b-it:disable_thinking=true", UpstreamID: "google-gemma-4-31b-it:disable_thinking=true", Provider: "venice", DisplayName: "Google Gemma 4 31B IT", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/e2ee-gpt-oss-20b-p", UpstreamID: "e2ee-gpt-oss-20b-p", Provider: "venice", DisplayName: "GPT OSS 20B (E2EE)", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/aion-labs-aion-3-0-mini", UpstreamID: "aion-labs-aion-3-0-mini", Provider: "venice", DisplayName: "Aion 3.0 Mini", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/e2ee-gemma-4-26b-a4b-uncensored-p", UpstreamID: "e2ee-gemma-4-26b-a4b-uncensored-p", Provider: "venice", DisplayName: "Gemma 4 26B A4B Uncensored (E2EE)", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/google-gemma-4-26b-a4b-it:disable_thinking=true", UpstreamID: "google-gemma-4-26b-a4b-it:disable_thinking=true", Provider: "venice", DisplayName: "Google Gemma 4 26B A4B IT", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/xiaomi-mimo-v2-5", UpstreamID: "xiaomi-mimo-v2-5", Provider: "venice", DisplayName: "Xiaomi Mimo V2.5", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/mistral-small-2603", UpstreamID: "mistral-small-2603", Provider: "venice", DisplayName: "Mistral Small 2603", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/openai-gpt-oss-120b", UpstreamID: "openai-gpt-oss-120b", Provider: "venice", DisplayName: "OpenAI GPT OSS 120B", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "venice/deepseek-v4-flash-0731", UpstreamID: "DeepSeek V4 Flash 0731", Provider: "venice", DisplayName: "DeepSeek V4 Flash 0731", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
		},
	},
	{
		ID:           "opencode-go",
		Name:         "OpenCode Go",
		BaseURL:      "https://opencode.ai/zen/go/v1",
		OpenAICompat: true,
		DefaultModel: "mimo-v2.5",
		GoAIOptions: map[string]any{
			"useResponsesAPI":  false,
			"strictJsonSchema": true,
		},
		Models: []ModelInfo{
			{ID: "opencode-go/mimo-v2.5", UpstreamID: "mimo-v2.5", Provider: "opencode-go", DisplayName: "Mimo V2.5", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "opencode-go/deepseek-v4-flash", UpstreamID: "deepseek-v4-flash", Provider: "opencode-go", DisplayName: "DeepSeek V4 Flash", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
		},
	},
	{
		ID:           "lmstudio",
		Name:         "LM Studio",
		BaseURL:      "http://localhost:1234/v1",
		OpenAICompat: true,
		DefaultModel: "local-model",
		GoAIOptions: map[string]any{
			"useResponsesAPI":  false,
			"strictJsonSchema": false,
		},
		Models: []ModelInfo{
			{ID: "lmstudio/local-model", UpstreamID: "local-model", Provider: "lmstudio", DisplayName: "Local Model", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
		},
	},
	{
		ID:           "chutes",
		Name:         "Chutes",
		BaseURL:      "https://llm.chutes.ai/v1",
		OpenAICompat: true,
		DefaultModel: "google/gemma-4-31B-turbo-TEE",
		GoAIOptions: map[string]any{
			"useResponsesAPI":  false,
		},
		Models: []ModelInfo{
			{ID: "chutes/gemma-4-31B-turbo-TEE", UpstreamID: "google/gemma-4-31B-turbo-TEE", Provider: "chutes", DisplayName: "Google Gemma 4 31B Turbo TEE", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "chutes/nemotron-3-nano-omni-30B-TEE", UpstreamID: "Nemotron-3-Nano-Omni-30B-TEE", Provider: "chutes", DisplayName: "Nemotron 3 Nano Omni 30B TEE", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "chutes/mistral-nemo-instruct-2407-TEE", UpstreamID: "unsloth/Mistral-Nemo-Instruct-2407-TEE", Provider: "chutes", DisplayName: "Mistral Nemo Instruct 2407 TEE", SupportsImages: false, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "chutes/Qwen/Qwen3.6-27B-TEE", UpstreamID: "Qwen/Qwen3.6-27B-TEE", Provider: "chutes", DisplayName: "Qwen 3.6 27B TEE", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
		},
	},
	{
		ID:           "google",
		Name:         "Google Gemma",
		BaseURL:      "https://generativelanguage.googleapis.com",
		OpenAICompat: false,
		DefaultModel: "gemma-4-31b-it",
		Models: []ModelInfo{
			{ID: "google/gemma-4-26b-a4b-it", UpstreamID: "gemma-4-26b-a4b-it", Provider: "google", DisplayName: "Gemma 4 26B A4B IT", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
			{ID: "google/gemma-4-31b-it", UpstreamID: "gemma-4-31b-it", Provider: "google", DisplayName: "Gemma 4 31B IT", SupportsImages: true, SupportsSearch: true, MaxContext: 0, MaxOutput: 0},
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


// ResolveModel maps a public model ID to its provider and upstream model ID.
//
// IDs with a known provider prefix (e.g. "venice/e2ee-deepseek-v4-flash")
// resolve to that provider with the remainder as the upstream model ID.
// Unknown prefixes or unprefixed IDs return an error (no gateway fallback).
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
		return ProviderInfo{}, "", fmt.Errorf("unknown provider prefix: %s", modelID[:i])
	}

	return ProviderInfo{}, "", fmt.Errorf("model ID must include provider prefix (e.g. venice/model-name): %s", modelID)
}
