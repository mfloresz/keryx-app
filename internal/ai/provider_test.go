package ai

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/cloudwego/eino/schema"
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

	t.Run("uses markdown conversion for documents", func(t *testing.T) {
		msg := TitleUserMessage(ChatMessage{
			Attachments: []ChatAttachment{
				{Filename: "report.pdf", MediaType: "application/pdf", Data: []byte("raw pdf bytes"), Markdown: "PDF content"},
			},
		}, TextAttachmentBudget)
		if !strings.Contains(msg, `<file name="report.pdf" media=text/markdown>`) {
			t.Errorf("markdown block missing:\n%q", msg)
		}
		if !strings.Contains(msg, "PDF content") {
			t.Errorf("markdown content missing:\n%q", msg)
		}
	})
}

func TestBuildSchemaMessagesMarkdown(t *testing.T) {
	t.Run("markdown conversion inlines as text block", func(t *testing.T) {
		msgs := buildSchemaMessages(ChatRequest{
			Messages: []ChatMessage{{
				Role: "user",
				Attachments: []ChatAttachment{{
					Filename:  "report.pdf",
					MediaType: "application/pdf",
					Data:      []byte("raw pdf bytes"),
					Markdown:  "# Title\n\nBody",
				}},
			}},
		}, false)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		parts := msgs[0].UserInputMultiContent
		if len(parts) != 1 {
			t.Fatalf("expected 1 part, got %d", len(parts))
		}
		p := parts[0]
		if p.Type != schema.ChatMessagePartTypeText {
			t.Errorf("expected text part, got %q", p.Type)
		}
		if !strings.HasPrefix(p.Text, `<file name="report.pdf" media=text/markdown>`) {
			t.Errorf("unexpected text part: %q", p.Text)
		}
	})

	t.Run("no markdown stages file part for payload injection", func(t *testing.T) {
		msgs := buildSchemaMessages(ChatRequest{
			Messages: []ChatMessage{{
				Role: "user",
				Attachments: []ChatAttachment{{
					Filename:  "report.pdf",
					MediaType: "application/pdf",
					Data:      []byte("raw pdf bytes"),
				}},
			}},
		}, false)
		if len(msgs) != 1 {
			t.Fatalf("expected 1 message, got %d", len(msgs))
		}
		if n := len(msgs[0].UserInputMultiContent); n != 0 {
			t.Errorf("expected no inline parts, got %d", n)
		}
		files, ok := msgs[0].Extra[extraFilePartsKey].([]wireFilePart)
		if !ok || len(files) != 1 {
			t.Fatalf("expected staged wire file part, got %v", msgs[0].Extra)
		}
		if files[0].MediaType != "application/pdf" || files[0].Name != "report.pdf" {
			t.Errorf("unexpected wire file part: %+v", files[0])
		}
		if !strings.HasPrefix(files[0].DataURL, "data:application/pdf;base64,") {
			t.Errorf("expected pdf data URL, got %q", files[0].DataURL)
		}
	})

	t.Run("images stay inline parts", func(t *testing.T) {
		msgs := buildSchemaMessages(ChatRequest{
			Messages: []ChatMessage{{
				Role: "user",
				Attachments: []ChatAttachment{{
					Filename:  "pic.png",
					MediaType: "image/png",
					Data:      []byte("raw"),
				}},
			}},
		}, false)
		parts := msgs[0].UserInputMultiContent
		if len(parts) != 1 || parts[0].Type != schema.ChatMessagePartTypeImageURL {
			t.Fatalf("expected one image part, got %+v", parts)
		}
		if parts[0].Image == nil || parts[0].Image.URL == nil ||
			!strings.HasPrefix(*parts[0].Image.URL, "data:image/png;base64,") {
			t.Errorf("expected png data URL, got %+v", parts[0].Image)
		}
	})

	t.Run("inline file parts for native-file providers", func(t *testing.T) {
		msgs := buildSchemaMessages(ChatRequest{
			Messages: []ChatMessage{{
				Role: "user",
				Attachments: []ChatAttachment{{
					Filename:  "report.pdf",
					MediaType: "application/pdf",
					Data:      []byte("raw pdf bytes"),
				}},
			}},
		}, true)
		parts := msgs[0].UserInputMultiContent
		if len(parts) != 1 || parts[0].Type != schema.ChatMessagePartTypeFileURL {
			t.Fatalf("expected one file part, got %+v", parts)
		}
		if parts[0].File == nil || parts[0].File.Base64Data == nil || parts[0].File.Name != "report.pdf" {
			t.Errorf("unexpected file part: %+v", parts[0].File)
		}
		if _, staged := msgs[0].Extra[extraFilePartsKey]; staged {
			t.Error("file part should not be staged when inlined")
		}
	})
}
