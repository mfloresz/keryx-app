package store

import (
	"testing"
)

func createTestChat(t *testing.T, s *Store, ownerID, title string) *ChatRecord {
	t.Helper()
	chat, err := s.SaveChat(&ChatRecord{Title: title}, ownerID)
	if err != nil {
		t.Fatalf("save chat: %v", err)
	}
	return chat
}

func msgOf(id, role, text string) map[string]any {
	return map[string]any{
		"id":    id,
		"role":  role,
		"parts": []any{map[string]any{"type": "text", "text": text}},
	}
}

func TestChatMessagesUpsertRoundtrip(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")
	chat := createTestChat(t, s, alice, "roundtrip")

	for _, id := range []string{"m1", "m2", "m3"} {
		if err := s.UpsertChatMessage(chat.ID, msgOf(id, "user", "text "+id)); err != nil {
			t.Fatalf("upsert %s: %v", id, err)
		}
	}

	msgs, err := s.ChatMessages(chat.ID)
	if err != nil || len(msgs) != 3 {
		t.Fatalf("ChatMessages = %d msgs, %v; want 3", len(msgs), err)
	}
	for i, want := range []string{"m1", "m2", "m3"} {
		if msgs[i]["id"] != want {
			t.Errorf("msgs[%d].id = %v, want %s", i, msgs[i]["id"], want)
		}
	}

	// Replace by mid: no seq bump — m3 stays in place, m4 appends after it.
	updated := msgOf("m3", "assistant", "replaced")
	updated["createdAt"] = "2026-01-01T00:00:00Z"
	if err := s.UpsertChatMessage(chat.ID, updated); err != nil {
		t.Fatalf("replace m3: %v", err)
	}
	if err := s.UpsertChatMessage(chat.ID, msgOf("m4", "user", "text m4")); err != nil {
		t.Fatalf("upsert m4: %v", err)
	}
	msgs, err = s.ChatMessages(chat.ID)
	if err != nil || len(msgs) != 4 {
		t.Fatalf("after replace: %d msgs, %v; want 4", len(msgs), err)
	}
	for i, want := range []string{"m1", "m2", "m3", "m4"} {
		if msgs[i]["id"] != want {
			t.Errorf("msgs[%d].id = %v, want %s (replace must not bump seq)", i, msgs[i]["id"], want)
		}
	}
	if msgs[2]["createdAt"] != "2026-01-01T00:00:00Z" {
		t.Errorf("replaced message data not persisted: %v", msgs[2])
	}

	// Empty chat returns an empty non-nil slice.
	empty := createTestChat(t, s, alice, "empty")
	emptyMsgs, err := s.ChatMessages(empty.ID)
	if err != nil || emptyMsgs == nil || len(emptyMsgs) != 0 {
		t.Fatalf("ChatMessages(empty) = %v, %v; want empty non-nil", emptyMsgs, err)
	}

	// Batch form keeps order.
	batch := createTestChat(t, s, alice, "batch")
	if err := s.UpsertChatMessages(batch.ID, []map[string]any{msgOf("b1", "user", "1"), msgOf("b2", "assistant", "2")}); err != nil {
		t.Fatalf("batch upsert: %v", err)
	}
	msgs, _ = s.ChatMessages(batch.ID)
	if len(msgs) != 2 || msgs[0]["id"] != "b1" || msgs[1]["id"] != "b2" {
		t.Fatalf("batch order = %v; want b1,b2", msgs)
	}
}

func TestChatMessagesReplaceAndDelete(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")
	chat := createTestChat(t, s, alice, "replace")

	if err := s.ReplaceChatMessages(chat.ID, []map[string]any{msgOf("r1", "user", "1"), msgOf("r2", "assistant", "2"), msgOf("r3", "user", "3")}); err != nil {
		t.Fatalf("replace: %v", err)
	}
	msgs, _ := s.ChatMessages(chat.ID)
	if len(msgs) != 3 || msgs[0]["id"] != "r1" {
		t.Fatalf("after replace = %v", msgs)
	}

	// Exclusive delete: everything after r2.
	if err := s.DeleteChatMessagesAfter(chat.ID, "r2", false); err != nil {
		t.Fatalf("delete after: %v", err)
	}
	msgs, _ = s.ChatMessages(chat.ID)
	if len(msgs) != 2 || msgs[1]["id"] != "r2" {
		t.Fatalf("exclusive delete left %v; want r1,r2", msgs)
	}

	// Inclusive delete: r2 and everything after it.
	if err := s.UpsertChatMessage(chat.ID, msgOf("r3", "user", "3")); err != nil {
		t.Fatalf("re-upsert r3: %v", err)
	}
	if err := s.DeleteChatMessagesAfter(chat.ID, "r2", true); err != nil {
		t.Fatalf("inclusive delete: %v", err)
	}
	msgs, _ = s.ChatMessages(chat.ID)
	if len(msgs) != 1 || msgs[0]["id"] != "r1" {
		t.Fatalf("inclusive delete left %v; want r1", msgs)
	}

	// Unknown mid: no-op.
	if err := s.DeleteChatMessagesAfter(chat.ID, "nope", true); err != nil {
		t.Fatalf("unknown mid should be a no-op, got %v", err)
	}
	if err := s.DeleteChatMessagesAfter(chat.ID, "", true); err != nil {
		t.Fatalf("empty mid should be a no-op, got %v", err)
	}
	msgs, _ = s.ChatMessages(chat.ID)
	if len(msgs) != 1 {
		t.Fatalf("no-op deletes changed messages: %v", msgs)
	}
}

func TestMigrateChatsBlobToMessages(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")
	chat := createTestChat(t, s, alice, "blob")

	blob := `[{"id":"m1","role":"user","parts":[{"type":"text","text":"one"}]},{"id":"m2","role":"assistant","parts":[{"type":"text","text":"two"}]}]`
	record, err := s.App.FindRecordById(ChatsCollection, chat.ID)
	if err != nil {
		t.Fatalf("find chat: %v", err)
	}
	record.Set("messages", blob)
	if err := s.App.Save(record); err != nil {
		t.Fatalf("set blob: %v", err)
	}

	if err := s.migrateChatsBlobToMessages(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	msgs, err := s.ChatMessages(chat.ID)
	if err != nil || len(msgs) != 2 || msgs[0]["id"] != "m1" || msgs[1]["id"] != "m2" {
		t.Fatalf("migrated messages = %v, %v; want m1,m2 in order", msgs, err)
	}
	if raw, _ := s.App.FindRecordById(ChatsCollection, chat.ID); !isEmptyJSONValue(raw.GetString("messages")) {
		t.Fatalf("blob not cleared: %q", raw.GetString("messages"))
	}

	// Re-run: idempotent (no duplicate rows).
	if err := s.migrateChatsBlobToMessages(); err != nil {
		t.Fatalf("re-migrate: %v", err)
	}
	msgs, _ = s.ChatMessages(chat.ID)
	if len(msgs) != 2 {
		t.Fatalf("re-migrate duplicated rows: %d", len(msgs))
	}

	// Crashed-between case: rows exist AND blob is non-empty → just clear.
	record, _ = s.App.FindRecordById(ChatsCollection, chat.ID)
	record.Set("messages", blob)
	if err := s.App.Save(record); err != nil {
		t.Fatalf("reset blob: %v", err)
	}
	if err := s.migrateChatsBlobToMessages(); err != nil {
		t.Fatalf("crash-case migrate: %v", err)
	}
	msgs, _ = s.ChatMessages(chat.ID)
	if len(msgs) != 2 || msgs[0]["id"] != "m1" {
		t.Fatalf("crash-case duplicated rows: %v", msgs)
	}
	if raw, _ := s.App.FindRecordById(ChatsCollection, chat.ID); !isEmptyJSONValue(raw.GetString("messages")) {
		t.Fatalf("crash-case blob not cleared")
	}

	// Unparseable blob is left untouched.
	chat2 := createTestChat(t, s, alice, "badblob")
	record, _ = s.App.FindRecordById(ChatsCollection, chat2.ID)
	record.Set("messages", "not-json")
	_ = s.App.Save(record)
	if err := s.migrateChatsBlobToMessages(); err != nil {
		t.Fatalf("migrate with bad blob: %v", err)
	}
	if raw, _ := s.App.FindRecordById(ChatsCollection, chat2.ID); isEmptyJSONValue(raw.GetString("messages")) {
		t.Fatalf("bad blob should be left in place, got %q", raw.GetString("messages"))
	}

	// Chats with an empty blob are skipped entirely.
	chat3 := createTestChat(t, s, alice, "emptyblob")
	if exists, _ := s.ChatMessagesExist(chat3.ID); exists {
		t.Fatalf("empty-blob chat should have no message records")
	}
}
