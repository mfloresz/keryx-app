package store

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ensureChatArtifactsCollection creates the chat_artifacts collection: an
// append-only version log of generated artifacts. Each save appends a new row;
// the newest version per artifact_id is the live one.
func (s *Store) ensureChatArtifactsCollection(chats *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(ChatArtifactsCollection); err == nil {
		return s.migrateChatArtifactsCollection(existing)
	}
	c := core.NewBaseCollection(ChatArtifactsCollection)
	ownerOnly := "@request.auth.id != '' && chat.owner = @request.auth.id"
	c.ListRule = new(ownerOnly)
	c.ViewRule = new(ownerOnly)
	c.CreateRule = new(ownerOnly)
	c.UpdateRule = new(ownerOnly)
	c.DeleteRule = new(ownerOnly)
	c.Fields.Add(&core.RelationField{Name: "chat", Required: true, CollectionId: chats.Id, MaxSelect: 1, CascadeDelete: true})
	c.Fields.Add(&core.TextField{Name: "artifact_id", Required: true, Max: 200})
	c.Fields.Add(&core.TextField{Name: "title", Max: 500})
	c.Fields.Add(&core.TextField{Name: "type", Max: 20})
	c.Fields.Add(&core.TextField{Name: "content", Max: maxLongTextChars})
	c.Fields.Add(&core.NumberField{Name: "version", OnlyInt: true})
	addSystemDateFields(c)
	c.AddIndex("idx_chat_artifacts_chat_artifact_version_unique", true, "chat, artifact_id, version", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

// migrateChatArtifactsCollection reconciles an existing chat_artifacts
// collection with the current schema. Databases created before the content cap
// was made explicit keep PocketBase's implicit 5000-char text limit, which makes
// update_artifact fail with "content: Must be no more than 5000 character(s)".
func (s *Store) migrateChatArtifactsCollection(c *core.Collection) (*core.Collection, error) {
	if err := s.ensureField(c, &core.TextField{Name: "artifact_id", Required: true, Max: 200}); err != nil {
		return nil, err
	}
	if err := s.ensureField(c, &core.TextField{Name: "title", Max: 500}); err != nil {
		return nil, err
	}
	if err := s.ensureField(c, &core.TextField{Name: "type", Max: 20}); err != nil {
		return nil, err
	}
	if err := s.ensureField(c, &core.TextField{Name: "content", Max: maxLongTextChars}); err != nil {
		return nil, err
	}
	if err := s.ensureFieldMax(c, "content", maxLongTextChars); err != nil {
		return nil, err
	}
	return c, nil
}

// ChatArtifact is one version of a chat-generated artifact.
type ChatArtifact struct {
	ArtifactID string
	Title      string
	Type       string
	Content    string
	Version    int
	CreatedAt  string
}

func chatArtifactFromRecord(r *core.Record) *ChatArtifact {
	return &ChatArtifact{
		ArtifactID: r.GetString("artifact_id"),
		Title:      r.GetString("title"),
		Type:       r.GetString("type"),
		Content:    r.GetString("content"),
		Version:    int(r.GetFloat("version")),
		CreatedAt:  r.GetString("created"),
	}
}

// SaveChatArtifact appends a new version record.
func (s *Store) SaveChatArtifact(chatID, artifactID, title, typ, content string, version int) error {
	collection, err := s.App.FindCollectionByNameOrId(ChatArtifactsCollection)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("chat", chatID)
	record.Set("artifact_id", artifactID)
	record.Set("title", title)
	record.Set("type", typ)
	record.Set("content", content)
	record.Set("version", version)
	return s.App.Save(record)
}

// LatestChatArtifacts returns the newest version of every artifact in the
// chat, ordered by creation of that newest version.
func (s *Store) LatestChatArtifacts(chatID string) ([]ChatArtifact, error) {
	records, err := s.App.FindRecordsByFilter(
		ChatArtifactsCollection,
		"chat = {:chat}",
		"+created, +version",
		0, 0,
		dbx.Params{"chat": chatID},
	)
	if err != nil {
		return nil, err
	}
	latest := make(map[string]*ChatArtifact, len(records))
	order := make([]string, 0, len(records))
	for _, r := range records {
		art := chatArtifactFromRecord(r)
		if _, seen := latest[art.ArtifactID]; !seen {
			order = append(order, art.ArtifactID)
		}
		// Records arrive in +created order; a higher version (or a later row
		// at the same version) wins.
		if cur, ok := latest[art.ArtifactID]; !ok || art.Version >= cur.Version {
			latest[art.ArtifactID] = art
		}
	}
	out := make([]ChatArtifact, 0, len(order))
	for _, id := range order {
		out = append(out, *latest[id])
	}
	return out, nil
}

// GetChatArtifact returns one artifact; version <= 0 means latest.
// ErrNotFound otherwise.
func (s *Store) GetChatArtifact(chatID, artifactID string, version int) (*ChatArtifact, error) {
	if version <= 0 {
		records, err := s.App.FindRecordsByFilter(
			ChatArtifactsCollection,
			"chat = {:chat} && artifact_id = {:aid}",
			"-version, -created",
			1, 0,
			dbx.Params{"chat": chatID, "aid": artifactID},
		)
		if err != nil || len(records) == 0 {
			return nil, ErrNotFound
		}
		return chatArtifactFromRecord(records[0]), nil
	}
	record, err := s.App.FindFirstRecordByFilter(
		ChatArtifactsCollection,
		"chat = {:chat} && artifact_id = {:aid} && version = {:v}",
		dbx.Params{"chat": chatID, "aid": artifactID, "v": version},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	return chatArtifactFromRecord(record), nil
}
