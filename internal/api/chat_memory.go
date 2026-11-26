package api

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"keryx-server/internal/ai"
)

// summarizeSystemPrompt instructs the model that produces the chat's rolling
// summary memory.
const summarizeSystemPrompt = "You maintain a rolling summary of a conversation for future context. " +
	"Write a compact, factual summary of at most 400 words, merging the previous summary (if any) with the new messages into one coherent text. " +
	"Preserve key facts, decisions, names, preferences, and unresolved questions. Output only the summary text."

// maxSummarizedMessageChars caps how many characters of one message are fed
// to the summarization prompt.
const maxSummarizedMessageChars = 8000

// uiMessageText concatenates the text parts of a stored UI message.
func uiMessageText(m map[string]any) string {
	parts, _ := m["parts"].([]any)
	var b strings.Builder
	for _, p := range parts {
		pm, ok := p.(map[string]any)
		if !ok {
			continue
		}
		if t, ok := pm["text"].(string); ok {
			b.WriteString(t)
		}
	}
	return b.String()
}

// uiMessageSize estimates a stored UI message's size from its text parts.
func uiMessageSize(m map[string]any) int {
	return len(uiMessageText(m))
}

// summarizeWindow splits stored chat messages into the recent window (the
// longest suffix whose text-part size fits budgetChars; the newest message is
// always kept) and the messages to summarize: those before the window that
// come after the mid the current summary already covers. throughMid empty (or
// unknown) means everything before the window is eligible.
func summarizeWindow(msgs []map[string]any, throughMid string, budgetChars int) (toSummarize, window []map[string]any) {
	if len(msgs) == 0 {
		return nil, nil
	}
	start := len(msgs) - 1
	total := uiMessageSize(msgs[start])
	for i := start - 1; i >= 0; i-- {
		s := uiMessageSize(msgs[i])
		if total+s > budgetChars {
			break
		}
		total += s
		start = i
	}
	window = msgs[start:]

	throughIdx := -1
	if throughMid != "" {
		for i, m := range msgs {
			if id, _ := m["id"].(string); id == throughMid {
				throughIdx = i
				break
			}
		}
	}
	for i := 0; i < start; i++ {
		if i > throughIdx {
			toSummarize = append(toSummarize, msgs[i])
		}
	}
	return toSummarize, window
}

// buildSummarizePrompt builds the user payload for the summarization call:
// the previous summary plus the role-labeled text of the messages to fold in.
func buildSummarizePrompt(prevSummary string, msgs []map[string]any) string {
	var b strings.Builder
	b.WriteString("Previous summary:\n")
	if strings.TrimSpace(prevSummary) == "" {
		b.WriteString("(none)")
	} else {
		b.WriteString(prevSummary)
	}
	b.WriteString("\n\nNew messages:\n")
	for _, m := range msgs {
		role, _ := m["role"].(string)
		text := uiMessageText(m)
		if strings.TrimSpace(text) == "" {
			continue
		}
		if len(text) > maxSummarizedMessageChars {
			text = text[:maxSummarizedMessageChars]
		}
		fmt.Fprintf(&b, "\n[%s]: %s\n", role, text)
	}
	return b.String()
}

// maybeSummarizeAsync folds older conversation history into the chat's
// summary memory once the exchange grows past half the model's context
// window. contextBudget is the model's character budget (see contextBudgetFor)
// so small-window models trigger the summary before FitMessagesToBudget drops
// their oldest messages. It runs detached, never blocks the stream, and
// persists the new summary under the chat lock.
func (s *Server) maybeSummarizeAsync(chatID, userID string, provider ai.Provider, fullMessages []ai.ChatMessage, contextBudget int) {
	if provider == nil {
		return
	}
	if contextBudget <= 0 {
		contextBudget = ai.DefaultContextBudgetChars
	}
	summaryBudget := contextBudget / 2
	go func() {
		if ai.EstimateChars(fullMessages) <= summaryBudget {
			return
		}

		unlock := s.lockChat(chatID)
		chat, err := s.Store.GetChat(chatID, userID)
		unlock()
		if err != nil {
			return
		}

		msgs, err := s.Store.ChatMessages(chatID)
		if err != nil {
			return
		}
		toSummarize, _ := summarizeWindow(msgs, chat.SummaryThrough, summaryBudget)
		if len(toSummarize) == 0 {
			return
		}

		summaryProvider := s.summaryProviderFor(chatID, provider)
		if summaryProvider == nil {
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		summary, err := summaryProvider.Chat(ctx, ai.ChatRequest{
			System:   summarizeSystemPrompt,
			Messages: []ai.ChatMessage{{Role: "user", Content: buildSummarizePrompt(chat.Summary, toSummarize)}},
		})
		if err != nil {
			slog.Warn("conversation summarization failed", "error", err, "chat", chatID)
			return
		}
		summary = strings.TrimSpace(summary)
		if summary == "" {
			return
		}

		unlock = s.lockChat(chatID)
		defer unlock()
		chat, err = s.Store.GetChat(chatID, userID)
		if err != nil {
			return
		}
		chat.Summary = summary
		chat.SummaryThrough, _ = toSummarize[len(toSummarize)-1]["id"].(string)
		if _, err := s.Store.SaveChat(chat, userID); err != nil {
			slog.Warn("failed to persist conversation summary", "error", err, "chat", chatID)
		}
	}()
}

// summaryProviderFor resolves the provider used to write the rolling
// conversation summary. It reuses the admin-configured lightweight model
// (the same "small model" knob as title generation) so a heavyweight
// reasoning model is never chosen for this background task; it falls back to
// the chat's own provider when no lightweight model is configured.
func (s *Server) summaryProviderFor(chatID string, fallback ai.Provider) ai.Provider {
	return s.titleProviderFor(chatID, fallback)
}
