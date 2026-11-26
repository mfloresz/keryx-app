package store

import (
	"encoding/json"
	"testing"
)

func TestSaveChatDoesNotWriteMessagesColumn(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")

	chat, err := s.SaveChat(&ChatRecord{
		Title:          "colcheck",
		Messages:       json.RawMessage(`[{"id":"m1"}]`),
		Summary:        "a summary",
		SummaryThrough: "m1",
	}, alice)
	if err != nil {
		t.Fatalf("SaveChat: %v", err)
	}

	// The legacy messages column must stay empty even when ChatRecord.Messages
	// is set — messages live in chat_messages now.
	record, err := s.App.FindRecordById(ChatsCollection, chat.ID)
	if err != nil {
		t.Fatalf("find chat: %v", err)
	}
	if got := record.GetString("messages"); !isEmptyJSONValue(got) {
		t.Fatalf("messages column written: %q", got)
	}
	// Summary fields persist normally.
	if record.GetString("summary") != "a summary" || record.GetString("summary_through") != "m1" {
		t.Fatalf("summary fields = %q / %q", record.GetString("summary"), record.GetString("summary_through"))
	}

	// GetChat still returns messages — assembled from chat_messages.
	if err := s.UpsertChatMessage(chat.ID, msgOf("m1", "user", "hello")); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err := s.GetChat(chat.ID, alice)
	if err != nil {
		t.Fatalf("GetChat: %v", err)
	}
	var msgs []map[string]any
	if err := json.Unmarshal(got.Messages, &msgs); err != nil {
		t.Fatalf("decode messages: %v", err)
	}
	if len(msgs) != 1 || msgs[0]["id"] != "m1" {
		t.Fatalf("GetChat messages = %v; want m1", msgs)
	}
	if got.Summary != "a summary" || got.SummaryThrough != "m1" {
		t.Fatalf("GetChat summary = %q / %q", got.Summary, got.SummaryThrough)
	}

	// A chat without messages reports [].
	empty, err := s.SaveChat(&ChatRecord{Title: "empty"}, alice)
	if err != nil {
		t.Fatalf("SaveChat empty: %v", err)
	}
	gotEmpty, err := s.GetChat(empty.ID, alice)
	if err != nil || string(gotEmpty.Messages) != "[]" {
		t.Fatalf("GetChat(empty) messages = %q, %v", gotEmpty.Messages, err)
	}
}
