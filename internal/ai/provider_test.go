package ai

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTruncateText(t *testing.T) {
	tests := []struct {
		name     string
		in       string
		maxChars int
		want     string
	}{
		{"under limit unchanged", "hola mundo", 20, "hola mundo"},
		{"multi-byte runes counted per rune", "áéíóúáéíóú", 5, "áéíóú\n…[truncated]"},
		{"cut mid-line appends marker", "abcdefghijklmnop", 10, "abcdefghij\n…[truncated]"},
		{"cut at last line boundary", "first\nsecond\nthird line here", 20, "first\nsecond\n\n…[truncated]"},
		{"newline too early keeps budget", strings.Repeat("a", 10) + "\n" + strings.Repeat("b", 20), 20, strings.Repeat("a", 10) + "\n" + strings.Repeat("b", 9) + "\n…[truncated]"},
		{"no partial rune", strings.Repeat("ñ", 15), 10, strings.Repeat("ñ", 10) + "\n…[truncated]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := TruncateText(tt.in, tt.maxChars)
			if got != tt.want {
				t.Errorf("TruncateText(%q, %d) = %q, want %q", tt.in, tt.maxChars, got, tt.want)
			}
			if !utf8.ValidString(got) {
				t.Errorf("result is not valid UTF-8: %q", got)
			}
		})
	}
}

func TestTitleUserMessage(t *testing.T) {
	// 'Q' and 'W' never appear in the file block format or the truncation
	// marker, so counting them measures exactly the attachment bytes inlined.
	big := strings.Repeat("Q", TextAttachmentBudget+500)

	t.Run("includes content and truncated text attachment", func(t *testing.T) {
		msg := TitleUserMessage(ChatMessage{
			Content:     "resume this",
			Attachments: []ChatAttachment{{Filename: "doc.txt", MediaType: "text/plain", Data: []byte(big)}},
		}, TextAttachmentBudget)
		if !strings.HasPrefix(msg, "resume this") {
			t.Errorf("message content missing: %q", msg[:20])
		}
		if !strings.Contains(msg, `<file name="doc.txt" media=text/plain>`) {
			t.Errorf("file block missing:\n%q", msg)
		}
		if !strings.Contains(msg, "…[truncated]") {
			t.Errorf("truncation marker missing")
		}
		if got := strings.Count(msg, "Q"); got > TextAttachmentBudget {
			t.Errorf("budget exceeded: %d chars", got)
		}
	})

	t.Run("budget shared across files", func(t *testing.T) {
		msg := TitleUserMessage(ChatMessage{
			Attachments: []ChatAttachment{
				{Filename: "one.txt", MediaType: "text/plain", Data: []byte(strings.Repeat("Q", 6000))},
				{Filename: "two.txt", MediaType: "text/plain", Data: []byte(strings.Repeat("W", 6000))},
			},
		}, TextAttachmentBudget)
		if got := strings.Count(msg, "Q"); got != 6000 {
			t.Errorf("first file should fit whole: %d", got)
		}
		if got := strings.Count(msg, "W"); got != 2000 {
			t.Errorf("second file should take the remaining budget: %d", got)
		}
	})

	t.Run("skips non-text and empty attachments", func(t *testing.T) {
		msg := TitleUserMessage(ChatMessage{
			Attachments: []ChatAttachment{
				{Filename: "img.png", MediaType: "image/png", Data: []byte("binary")},
				{Filename: "empty.txt", MediaType: "text/plain"},
			},
		}, TextAttachmentBudget)
		if msg != "" {
			t.Errorf("expected empty message, got %q", msg)
		}
	})
}
