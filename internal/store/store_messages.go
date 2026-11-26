package store

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// isEmptyJSONValue reports whether a JSON field's raw text counts as empty.
// PocketBase normalizes unset/"" JSON values to null, "" or similar, and
// never stores an empty string column.
func isEmptyJSONValue(raw string) bool {
	switch strings.TrimSpace(raw) {
	case "", "null", `""`, "[]", "{}":
		return true
	}
	return false
}

// ensureChatMessagesCollection creates the chat_messages collection: one row
// per message, holding the full message JSON exactly as the API serves it.
// Messages used to live in the chats.messages blob (see
// migrateChatsBlobToMessages); the column remains for rollback but is no
// longer written.
func (s *Store) ensureChatMessagesCollection(chats *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(ChatMessagesCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(ChatMessagesCollection)
	ownerOnly := "@request.auth.id != '' && chat.owner = @request.auth.id"
	c.ListRule = new(ownerOnly)
	c.ViewRule = new(ownerOnly)
	c.CreateRule = new(ownerOnly)
	c.UpdateRule = new(ownerOnly)
	c.DeleteRule = new(ownerOnly)
	c.Fields.Add(&core.RelationField{Name: "chat", Required: true, CollectionId: chats.Id, MaxSelect: 1, CascadeDelete: true})
	c.Fields.Add(&core.TextField{Name: "mid", Max: 200})
	c.Fields.Add(&core.NumberField{Name: "seq", OnlyInt: true})
	c.Fields.Add(&core.JSONField{Name: "data"})
	addSystemDateFields(c)
	c.AddIndex("idx_chat_messages_chat_seq_unique", true, "chat, seq", "")
	c.AddIndex("idx_chat_messages_chat_mid", false, "chat, mid", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

// ChatMessages returns the chat's messages ordered by seq, decoded from data.
// Empty (non-nil) slice for a chat with no messages.
func (s *Store) ChatMessages(chatID string) ([]map[string]any, error) {
	records, err := s.App.FindRecordsByFilter(
		ChatMessagesCollection,
		"chat = {:chat}",
		"seq",
		0, 0,
		dbx.Params{"chat": chatID},
	)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(records))
	for _, r := range records {
		var msg map[string]any
		if err := json.Unmarshal([]byte(r.GetString("data")), &msg); err != nil {
			return nil, fmt.Errorf("decode message %s: %w", r.Id, err)
		}
		out = append(out, msg)
	}
	return out, nil
}

// nextChatSeq returns the next per-chat sequence number (max seq + 1).
func (s *Store) nextChatSeq(chatID string) (int, error) {
	records, err := s.App.FindRecordsByFilter(
		ChatMessagesCollection,
		"chat = {:chat}",
		"-seq",
		1, 0,
		dbx.Params{"chat": chatID},
	)
	if err != nil {
		return 0, err
	}
	if len(records) == 0 {
		return 1, nil
	}
	return int(records[0].GetFloat("seq")) + 1, nil
}

// UpsertChatMessage inserts or replaces (by mid) ONE message, assigning the
// next per-chat seq on insert. O(1) for the streaming persist path. Replacing
// an existing mid keeps its seq (no reordering). Callers own message ids.
func (s *Store) UpsertChatMessage(chatID string, msg map[string]any) error {
	mid, _ := msg["id"].(string)

	collection, err := s.App.FindCollectionByNameOrId(ChatMessagesCollection)
	if err != nil {
		return err
	}

	var record *core.Record
	if mid != "" {
		if existing, err := s.App.FindFirstRecordByFilter(
			ChatMessagesCollection,
			"chat = {:chat} && mid = {:mid}",
			dbx.Params{"chat": chatID, "mid": mid},
		); err == nil {
			record = existing
		}
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	if record == nil {
		seq, err := s.nextChatSeq(chatID)
		if err != nil {
			return err
		}
		record = core.NewRecord(collection)
		record.Set("chat", chatID)
		record.Set("mid", mid)
		record.Set("seq", seq)
	}
	record.Set("data", string(data))
	return s.App.Save(record)
}

// UpsertChatMessages is the batch form (fork import, branch switch), seqs in
// order: each new message gets the next per-chat seq.
func (s *Store) UpsertChatMessages(chatID string, msgs []map[string]any) error {
	for _, msg := range msgs {
		if err := s.UpsertChatMessage(chatID, msg); err != nil {
			return err
		}
	}
	return nil
}

// ReplaceChatMessages deletes all of the chat's messages then inserts msgs
// (branch switch), seqs 1..n in array order.
func (s *Store) ReplaceChatMessages(chatID string, msgs []map[string]any) error {
	records, err := s.App.FindRecordsByFilter(
		ChatMessagesCollection,
		"chat = {:chat}",
		"",
		0, 0,
		dbx.Params{"chat": chatID},
	)
	if err != nil {
		return err
	}
	for _, r := range records {
		if err := s.App.Delete(r); err != nil {
			return err
		}
	}
	return s.UpsertChatMessages(chatID, msgs)
}

// DeleteChatMessagesAfter deletes messages AFTER the one identified by mid
// (inclusive=true also deletes that one). No-op when mid is unknown.
func (s *Store) DeleteChatMessagesAfter(chatID, mid string, inclusive bool) error {
	if mid == "" {
		return nil
	}
	anchor, err := s.App.FindFirstRecordByFilter(
		ChatMessagesCollection,
		"chat = {:chat} && mid = {:mid}",
		dbx.Params{"chat": chatID, "mid": mid},
	)
	if err != nil {
		return nil // unknown mid: no-op
	}
	op := ">"
	if inclusive {
		op = ">="
	}
	records, err := s.App.FindRecordsByFilter(
		ChatMessagesCollection,
		"chat = {:chat} && seq "+op+" {:seq}",
		"seq",
		0, 0,
		dbx.Params{"chat": chatID, "seq": anchor.GetFloat("seq")},
	)
	if err != nil {
		return err
	}
	for _, r := range records {
		if err := s.App.Delete(r); err != nil {
			return err
		}
	}
	return nil
}

// ChatMessagesExist reports whether the chat has any message records
// (migration probe).
func (s *Store) ChatMessagesExist(chatID string) (bool, error) {
	count, err := s.App.CountRecords(
		ChatMessagesCollection,
		dbx.NewExp("chat = {:chat}", dbx.Params{"chat": chatID}),
	)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// migrateChatsBlobToMessages moves each chat's legacy messages JSON blob into
// chat_messages rows. Idempotent: chats whose blob is empty are skipped; a
// chat with existing rows keeps them and only the blob is cleared (covers a
// crash between insert and clear).
func (s *Store) migrateChatsBlobToMessages() error {
	var rows []struct {
		ID       string `db:"id"`
		Messages string `db:"messages"`
	}
	if err := s.App.DB().NewQuery(
		"SELECT {{id}} AS id, {{messages}} AS messages FROM {{chats}} WHERE {{messages}} IS NOT NULL AND TRIM({{messages}}) NOT IN ('', 'null', '\"\"', '[]', '{}')",
	).All(&rows); err != nil {
		return err
	}

	for _, row := range rows {
		var msgs []map[string]any
		if err := json.Unmarshal([]byte(row.Messages), &msgs); err != nil {
			// Unparseable blob: leave it in place rather than lose data.
			continue
		}
		exists, err := s.ChatMessagesExist(row.ID)
		if err != nil {
			return err
		}
		if !exists {
			for i, msg := range msgs {
				collection, err := s.App.FindCollectionByNameOrId(ChatMessagesCollection)
				if err != nil {
					return err
				}
				mid, _ := msg["id"].(string)
				data, err := json.Marshal(msg)
				if err != nil {
					return err
				}
				record := core.NewRecord(collection)
				record.Set("chat", row.ID)
				record.Set("mid", mid)
				record.Set("seq", i+1)
				record.Set("data", string(data))
				if err := s.App.Save(record); err != nil {
					return err
				}
			}
		}
		chat, err := s.App.FindRecordById(ChatsCollection, row.ID)
		if err != nil {
			return err
		}
		chat.Set("messages", "")
		if err := s.App.Save(chat); err != nil {
			return err
		}
	}
	return nil
}

// ChatMessageSearchResult represents one search hit across a user's conversations.
type ChatMessageSearchResult struct {
	ChatID    string `json:"chatId"`
	ChatTitle string `json:"chatTitle"`
	MessageID string `json:"messageId"`
	Role      string `json:"role"`
	Snippet   string `json:"snippet"`
	CreatedAt string `json:"createdAt"`
}

func extractSnippet(data string, query string) (role string, snippet string) {
	var m struct {
		Role  string `json:"role"`
		Parts []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"parts"`
		Content string `json:"content"`
	}
	_ = json.Unmarshal([]byte(data), &m)
	role = m.Role
	fullText := m.Content
	for _, p := range m.Parts {
		if p.Type == "text" && p.Text != "" {
			if fullText != "" {
				fullText += " "
			}
			fullText += p.Text
		}
	}
	if fullText == "" {
		fullText = data
	}

	lowerText := strings.ToLower(fullText)
	lowerQ := strings.ToLower(query)
	idx := strings.Index(lowerText, lowerQ)
	if idx < 0 {
		if len(fullText) > 140 {
			return role, fullText[:140] + "..."
		}
		return role, fullText
	}

	start := idx - 40
	if start < 0 {
		start = 0
	}
	end := idx + len(query) + 60
	if end > len(fullText) {
		end = len(fullText)
	}

	snip := fullText[start:end]
	if start > 0 {
		snip = "..." + snip
	}
	if end < len(fullText) {
		snip = snip + "..."
	}
	return role, snip
}

// SearchChatMessages searches for messages matching query across all chats owned by ownerID.
func (s *Store) SearchChatMessages(ownerID, query string, limit int) ([]ChatMessageSearchResult, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return []ChatMessageSearchResult{}, nil
	}
	if limit <= 0 || limit > 50 {
		limit = 30
	}

	var rows []struct {
		ChatID    string `db:"chat_id"`
		ChatTitle string `db:"chat_title"`
		MessageID string `db:"mid"`
		Data      string `db:"data"`
		Created   string `db:"created"`
	}

	err := s.App.DB().NewQuery(
		"SELECT m.{{chat}} AS chat_id, c.{{title}} AS chat_title, m.{{mid}} AS mid, m.{{data}} AS data, m.{{created}} AS created " +
			"FROM {{chat_messages}} m " +
			"JOIN {{chats}} c ON c.{{id}} = m.{{chat}} " +
			"WHERE c.{{owner}} = {:owner} AND m.{{data}} LIKE {:query} " +
			"ORDER BY m.{{created}} DESC " +
			"LIMIT {:limit}",
	).Bind(dbx.Params{
		"owner": ownerID,
		"query": "%" + query + "%",
		"limit": limit,
	}).All(&rows)
	if err != nil {
		return nil, err
	}

	out := make([]ChatMessageSearchResult, 0, len(rows))
	for _, r := range rows {
		role, snippet := extractSnippet(r.Data, query)
		title := r.ChatTitle
		if strings.TrimSpace(title) == "" {
			title = "Untitled Chat"
		}
		out = append(out, ChatMessageSearchResult{
			ChatID:    r.ChatID,
			ChatTitle: title,
			MessageID: r.MessageID,
			Role:      role,
			Snippet:   snippet,
			CreatedAt: r.Created,
		})
	}
	return out, nil
}
