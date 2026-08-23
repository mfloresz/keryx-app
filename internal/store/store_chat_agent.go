package store

import (
	"github.com/pocketbase/dbx"
)

// UpdateChatAgent persists (or clears) the selected agent for a chat.
// agentID empty string clears the selection.
func (s *Store) UpdateChatAgent(chatID, ownerID, agentID string) (*ChatRecord, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ChatsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": chatID, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	record.Set("agent_id", agentID)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return chatFromRecord(record), nil
}
