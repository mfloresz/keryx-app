package store

import (
	"github.com/pocketbase/pocketbase/core"
)

func (s *Store) ensureAgentsCollection(users *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(AgentsCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(AgentsCollection)
	// Visibility: everyone authenticated sees globals; users see their own.
	listViewRule := "@request.auth.id != '' && (owner = null || owner = '' || owner = @request.auth.id)"
	createRule := "@request.auth.id != '' && (owner = @request.auth.id || (@request.auth.role='admin' && (owner = null || owner = '')))"
	updateDeleteRule := "@request.auth.id != '' && (owner = @request.auth.id || (@request.auth.role='admin' && (owner = null || owner = '')))"
	c.ListRule = new(listViewRule)
	c.ViewRule = new(listViewRule)
	c.CreateRule = new(createRule)
	c.UpdateRule = new(updateDeleteRule)
	c.DeleteRule = new(updateDeleteRule)

	c.Fields.Add(&core.TextField{Name: "builtin_id", Max: 80})
	c.Fields.Add(&core.RelationField{Name: "owner", CollectionId: users.Id, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 80})
	c.Fields.Add(&core.TextField{Name: "description", Max: 300})
	c.Fields.Add(&core.TextField{Name: "system_prompt", Required: true, Max: 10000})
	c.Fields.Add(&core.TextField{Name: "icon", Max: 40})
	addSystemDateFields(c)

	// One override per builtin per owner; unique name per owner. SQLite partial
	// index semantics: NULL owner rows still dedupe among themselves.
	c.AddIndex("idx_agents_owner_builtin_unique", true, "owner", "builtin_id")
	c.AddIndex("idx_agents_owner_name_unique", true, "owner", "name")

	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

// migrateChatsCollectionForAgents adds agent_id to an existing chats collection.
func (s *Store) migrateChatsCollectionForAgents(c *core.Collection) error {
	return s.ensureField(c, &core.TextField{Name: "agent_id", Max: 80})
}
