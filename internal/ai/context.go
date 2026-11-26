package ai

import "strings"

// DefaultContextBudgetChars approximates ~100k tokens (4 chars/token) of
// conversation context sent to the model when no per-model limit is known.
const DefaultContextBudgetChars = 400_000

// ImageAttachmentCharEstimate approximates the prompt token cost of an image
// (~1,000 tokens at 4 chars/token). Raw file byte length must not be used,
// as a 2 MB screenshot would otherwise consume the entire context budget.
const ImageAttachmentCharEstimate = 4_000

// AudioAttachmentCharEstimate approximates the prompt token cost of an audio snippet.
const AudioAttachmentCharEstimate = 8_000

// chatMessageSize estimates one message's prompt size in characters.
func chatMessageSize(m ChatMessage) int {
	n := len(m.Content)
	for _, a := range m.Attachments {
		if a.Markdown != "" {
			n += len(a.Markdown)
		} else if isTextMedia(a.MediaType) {
			n += len(a.Data) + 64
		} else if strings.HasPrefix(a.MediaType, "image/") {
			n += ImageAttachmentCharEstimate
		} else if strings.HasPrefix(a.MediaType, "audio/") {
			n += AudioAttachmentCharEstimate
		} else {
			n += 1_000
		}
	}
	for _, tc := range m.ToolCalls {
		n += len(tc.Name) + len(tc.Arguments) + 32
	}
	for _, tr := range m.ToolResults {
		n += len(tr.ToolName) + len(tr.Output) + 32
	}
	return n
}

// EstimateChars returns the estimated prompt size of msgs in characters,
// using the same per-message sizing as FitMessagesToBudget.
func EstimateChars(msgs []ChatMessage) int {
	total := 0
	for _, m := range msgs {
		total += chatMessageSize(m)
	}
	return total
}

// FitMessagesToBudget returns the newest suffix of msgs whose estimated
// prompt size fits maxChars. The newest message is always kept, even alone
// over budget. maxChars <= 0 returns msgs unchanged.
func FitMessagesToBudget(msgs []ChatMessage, maxChars int) []ChatMessage {
	if maxChars <= 0 || len(msgs) == 0 {
		return msgs
	}
	start := len(msgs) - 1 // the newest message is always kept
	total := chatMessageSize(msgs[start])
	for i := start - 1; i >= 0; i-- {
		s := chatMessageSize(msgs[i])
		if total+s > maxChars {
			break
		}
		total += s
		start = i
	}
	return msgs[start:]
}
