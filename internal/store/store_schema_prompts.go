package store

import (
	"github.com/pocketbase/pocketbase/core"
)

func (s *Store) ensurePromptOverridesCollection() error {
	if _, err := s.App.FindCollectionByNameOrId(PromptOverridesCollection); err == nil {
		return nil
	}
	users, err := s.App.FindCollectionByNameOrId(UsersCollection)
	if err != nil {
		return err
	}
	c := core.NewBaseCollection(PromptOverridesCollection)
	adminOnly := "@request.auth.id != '' && @collection.users.id = @request.auth.id && @collection.users.role = 'admin'"
	c.ListRule = new(adminOnly)
	c.ViewRule = new(adminOnly)
	c.CreateRule = new(adminOnly)
	c.UpdateRule = new(adminOnly)
	c.DeleteRule = new(adminOnly)
	c.Fields.Add(&core.TextField{Name: "key", Required: true, Max: 20})
	c.Fields.Add(&core.TextField{Name: "prompt", Required: true, Max: 20000})
	c.Fields.Add(&core.RelationField{Name: "updated_by", CollectionId: users.Id, MaxSelect: 1})
	addSystemDateFields(c)
	c.AddIndex("idx_prompt_overrides_key_unique", true, "key", "")
	if err := s.App.Save(c); err != nil {
		return err
	}
	return nil
}
