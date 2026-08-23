package config

import (
	"strings"
	"testing"
)

func TestDefaultAgentsCatalog(t *testing.T) {
	if len(DefaultAgents) == 0 {
		t.Fatal("DefaultAgents must not be empty")
	}

	seen := make(map[string]bool, len(DefaultAgents))
	for _, ag := range DefaultAgents {
		if strings.TrimSpace(ag.ID) == "" {
			t.Errorf("agent %q has empty ID", ag.Name)
		}
		if seen[ag.ID] {
			t.Errorf("duplicate agent ID: %q", ag.ID)
		}
		seen[ag.ID] = true

		if strings.TrimSpace(ag.Name) == "" {
			t.Errorf("agent %q has empty Name", ag.ID)
		}
		if strings.TrimSpace(ag.SystemPrompt) == "" {
			t.Errorf("agent %q has empty SystemPrompt", ag.ID)
		}
		if len(ag.SystemPrompt) > 10000 {
			t.Errorf("agent %q SystemPrompt exceeds 10000 chars", ag.ID)
		}
	}

	// There must be no "general" agent: no selection = base prompt.
	for _, ag := range DefaultAgents {
		if ag.ID == "general" {
			t.Error("catalog must not contain a 'general' agent (base prompt is the default)")
		}
	}
}

func TestAvailablePromptTags(t *testing.T) {
	want := []string{"{username}", "{datetime}", "{language}"}
	if len(AvailablePromptTags) != len(want) {
		t.Fatalf("AvailablePromptTags = %v, want %v", AvailablePromptTags, want)
	}
	for i, tag := range want {
		if AvailablePromptTags[i] != tag {
			t.Errorf("AvailablePromptTags[%d] = %q, want %q", i, AvailablePromptTags[i], tag)
		}
	}
}
