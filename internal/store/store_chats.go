package store

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func (s *Store) ListChats(ownerID string) ([]ChatIndexEntry, error) {
	records, err := s.App.FindRecordsByFilter(
		ChatsCollection,
		"owner = {:owner}",
		"-created",
		200, 0,
		dbx.Params{"owner": ownerID},
	)
	if err != nil {
		return nil, err
	}
	out := make([]ChatIndexEntry, 0, len(records))
	for _, r := range records {
		out = append(out, ChatIndexEntry{
			ID:        r.Id,
			Title:     r.GetString("title"),
			CreatedAt: r.GetString("created"),
		})
	}
	return out, nil
}

func (s *Store) GetChat(chatID, ownerID string) (*ChatRecord, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ChatsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": chatID, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	return chatFromRecord(record), nil
}

// SaveChat creates or updates a chat record. For new records, PocketBase
// auto-generates a short ID (ignoring any long ID sent by the client).
// Returns the saved chat with the actual record ID.
func (s *Store) SaveChat(chat *ChatRecord, ownerID string) (*ChatRecord, error) {
	collection, err := s.App.FindCollectionByNameOrId(ChatsCollection)
	if err != nil {
		return nil, err
	}

	var record *core.Record
	existing, err := s.App.FindFirstRecordByFilter(
		ChatsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": chat.ID, "owner": ownerID},
	)
	if err != nil {
		record = core.NewRecord(collection)
		record.Set("owner", ownerID)
		// Do NOT set custom ID — let PocketBase auto-generate a short one
	} else {
		record = existing
	}

	record.Set("title", chat.Title)
	record.Set("visibility", defaultString(chat.Visibility, VisibilityPrivate))
	record.Set("web_search", chat.WebSearch)

	if chat.Messages != nil {
		record.Set("messages", string(chat.Messages))
	}
	if chat.Votes != nil {
		record.Set("votes", string(chat.Votes))
	}
	if chat.Branches != nil {
		record.Set("branches", string(chat.Branches))
	}
	if chat.LastUsage != nil {
		record.Set("last_usage", string(chat.LastUsage))
	}

	if err := s.App.Save(record); err != nil {
		return nil, err
	}

	return chatFromRecord(record), nil
}

func (s *Store) UpdateChatTitle(chatID, ownerID, title string) (*ChatRecord, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ChatsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": chatID, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	record.Set("title", title)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return chatFromRecord(record), nil
}

func (s *Store) UpdateChatVisibility(chatID, ownerID, visibility string) (*ChatRecord, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ChatsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": chatID, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	record.Set("visibility", visibility)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return chatFromRecord(record), nil
}

func (s *Store) DeleteChat(chatID, ownerID string) error {
	record, err := s.App.FindFirstRecordByFilter(
		ChatsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": chatID, "owner": ownerID},
	)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}

func (s *Store) DeleteAllChats(ownerID string) error {
	records, err := s.App.FindRecordsByFilter(
		ChatsCollection,
		"owner = {:owner}",
		"",
		200, 0,
		dbx.Params{"owner": ownerID},
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

func (s *Store) ListFavorites(ownerID string) ([]FavoriteMessageEntry, error) {
	records, err := s.App.FindRecordsByFilter(
		ChatsCollection,
		"owner = {:owner}",
		"-created",
		200, 0,
		dbx.Params{"owner": ownerID},
	)
	if err != nil {
		return nil, err
	}

	var favorites []FavoriteMessageEntry
	for _, r := range records {
		messagesJSON := r.GetString("messages")
		if messagesJSON == "" {
			continue
		}
		var messages []map[string]any
		if err := json.Unmarshal([]byte(messagesJSON), &messages); err != nil {
			continue
		}

		for _, msg := range messages {
			votes, _ := msg["votes"].([]any)
			isFavorite := false
			for _, v := range votes {
				if vm, ok := v.(map[string]any); ok {
					if vm["isUpvoted"] == true {
						isFavorite = true
						break
					}
				}
			}
			if !isFavorite {
				continue
			}

			preview := ""
			if parts, ok := msg["parts"].([]any); ok && len(parts) > 0 {
				if first, ok := parts[0].(map[string]any); ok {
					if text, ok := first["text"].(string); ok {
						preview = text
						if len(preview) > 200 {
							preview = preview[:200]
						}
					}
				}
			}

			msgID, _ := msg["id"].(string)
			createdAt, _ := msg["createdAt"].(string)
			if msgID == "" {
				msgID, _ = msg["id"].(string)
			}

			favorites = append(favorites, FavoriteMessageEntry{
				ChatID:          r.Id,
				ChatTitle:       r.GetString("title"),
				ChatCreatedAt:   r.GetString("created"),
				MessageID:       msgID,
				MessagePreview:  preview,
				MessageCreatedAt: createdAt,
			})
		}
	}
	return favorites, nil
}

func chatFromRecord(r *core.Record) *ChatRecord {
	c := &ChatRecord{
		ID:         r.Id,
		OwnerID:    r.GetString("owner"),
		Title:      r.GetString("title"),
		Visibility: r.GetString("visibility"),
		WebSearch:  r.GetBool("web_search"),
		CreatedAt:  r.GetString("created"),
		UpdatedAt:  r.GetString("updated"),
	}

	if msg := r.GetString("messages"); msg != "" {
		c.Messages = json.RawMessage(msg)
	} else {
		c.Messages = json.RawMessage("[]")
	}
	if votes := r.GetString("votes"); votes != "" {
		c.Votes = json.RawMessage(votes)
	} else {
		c.Votes = json.RawMessage("[]")
	}
	if branches := r.GetString("branches"); branches != "" {
		c.Branches = json.RawMessage(branches)
	} else {
		c.Branches = json.RawMessage("{}")
	}
	if usage := r.GetString("last_usage"); usage != "" {
		c.LastUsage = json.RawMessage(usage)
	}
	return c
}

func defaultString(s, def string) string {
	if s == "" {
		return def
	}
	return s
}
