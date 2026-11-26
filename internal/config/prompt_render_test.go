package config

import (
	"strings"
	"testing"
)

func TestBaseSystemPromptHasFlowdownCapabilities(t *testing.T) {
	p := defaultBaseSystemPrompt

	required := []string{
		"# Answer formatting",
		"> [!KIND]", "[!NOTE]", "[!TIP]", "[!IMPORTANT]", "[!WARNING]", "[!CAUTION]",
		"> [!TABS]", "> [!PROS]", "> [!CONS]",
		"> [!STEPS]", "> [!STATS]", "> [!DETAILS]", "> [!SOURCES]",
		"```mermaid",
		"```tree",
		"```diff",
		"```ts title=\"src/app.ts\"",
		"$…$ math",
		"— Author",
	}
	for _, s := range required {
		if !strings.Contains(p, s) {
			t.Errorf("missing %q in base system prompt", s)
		}
	}

	// sanity: prompt still has placeholders for the renderer
	for _, s := range []string{"{username}", "{date}", "{language}"} {
		if !strings.Contains(p, s) {
			t.Errorf("missing placeholder %q", s)
		}
	}

	// The base prompt must not embed time-granular context: it would change
	// the system prefix on every request and defeat prompt caching.
	if strings.Contains(p, "{datetime}") {
		t.Errorf("base prompt must use {date} instead of {datetime} for cache stability")
	}

	if !strings.HasPrefix(p, "Role\n") {
		t.Errorf("prompt should start with Role block")
	}
}
