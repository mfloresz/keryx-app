package config

import (
	"strings"
	"testing"
)

func TestBaseSystemPromptHasComarkCapabilities(t *testing.T) {
	p := defaultBaseSystemPrompt

	required := []string{
		"### Output Capabilities (Comark Rendering)",
		"> [!NOTE]", "> [!TIP]", "> [!IMPORTANT]", "> [!WARNING]", "> [!CAUTION]",
		":smile:",
		"```mermaid",
		"::component{prop=\"value\"}",
		":component{prop=\"value\"}",
		"{{ path || default }}",
		"frontmatter.*",
		"[text]{...}",
		"{1-3,5}",
		"#slot-name",
		"$inline math$",
		"$$block math$$",
		"KaTeX",
		"Footnotes",
		"[^label]",
		"only the `alert` component",
		"render as plain text",
		"always provide a `|| default` fallback",
		"never interpreted",
	}
	for _, s := range required {
		if !strings.Contains(p, s) {
			t.Errorf("missing %q in base system prompt", s)
		}
	}

	// sanity: prompt still has placeholders for the renderer
	for _, s := range []string{"{username}", "{datetime}", "{language}"} {
		if !strings.Contains(p, s) {
			t.Errorf("missing placeholder %q", s)
		}
	}

	if !strings.HasPrefix(p, "Role\n") {
		t.Errorf("prompt should start with Role block")
	}
}
