package store

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func (s *Store) ensureUsersCollection() (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(UsersCollection); err == nil {
		return s.migrateUsersCollection(existing)
	}
	c := core.NewAuthCollection(UsersCollection)
	c.ListRule = types.Pointer("@request.auth.id != '' && @request.auth.id = id")
	c.ViewRule = types.Pointer("@request.auth.id != '' && @request.auth.id = id")
	c.UpdateRule = types.Pointer("@request.auth.id != '' && @request.auth.id = id")
	c.DeleteRule = nil
	c.CreateRule = nil
	c.Fields.Add(&core.TextField{Name: "name", Max: 120})
	c.Fields.Add(&core.SelectField{Name: "role", Values: []string{RoleAdmin, RoleUser}, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "theme", Max: 20})
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) migrateUsersCollection(c *core.Collection) (*core.Collection, error) {
	if err := s.ensureField(c, &core.TextField{Name: "name", Max: 120}); err != nil {
		return nil, err
	}
	if err := s.ensureField(c, &core.SelectField{Name: "role", Values: []string{RoleAdmin, RoleUser}, MaxSelect: 1}); err != nil {
		return nil, err
	}
	if err := s.ensureField(c, &core.TextField{Name: "theme", Max: 20}); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) ensureModelsCollection() (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(ModelsCollection); err == nil {
		return s.migrateModelsCollection(existing)
	}
	c := core.NewBaseCollection(ModelsCollection)
	c.ListRule = types.Pointer("@request.auth.id != ''")
	c.ViewRule = types.Pointer("@request.auth.id != ''")
	c.CreateRule = nil
	c.UpdateRule = nil
	c.DeleteRule = nil
	c.Fields.Add(&core.TextField{Name: "key", Required: true, Max: 200})
	c.Fields.Add(&core.TextField{Name: "provider", Required: true, Max: 80})
	c.Fields.Add(&core.TextField{Name: "display_name", Required: true, Max: 200})
	c.Fields.Add(&core.BoolField{Name: "supports_images"})
	c.Fields.Add(&core.BoolField{Name: "supports_search"})
	c.Fields.Add(&core.BoolField{Name: "enabled"})
	c.AddIndex("idx_models_key_unique", true, "key", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) migrateModelsCollection(c *core.Collection) (*core.Collection, error) {
	if err := s.ensureField(c, &core.TextField{Name: "key", Required: true, Max: 200}); err != nil {
		return nil, err
	}
	// Populate key from id for existing records that were created before the key field existed
	records, err := s.App.FindRecordsByFilter(ModelsCollection, "key = '' || key = null", "", 200, 0)
	if err == nil {
		for _, r := range records {
			r.Set("key", r.Id)
			if err := s.App.Save(r); err != nil {
				return nil, err
			}
		}
	}
	return c, nil
}

func (s *Store) ensureUserModelAccessCollection(users *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(UserModelAccessCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(UserModelAccessCollection)
	ownerOnly := "@request.auth.id != '' && user = @request.auth.id"
	c.ListRule = types.Pointer(ownerOnly)
	c.ViewRule = types.Pointer(ownerOnly)
	c.CreateRule = types.Pointer(ownerOnly)
	c.UpdateRule = types.Pointer(ownerOnly)
	c.DeleteRule = types.Pointer(ownerOnly)
	c.Fields.Add(&core.RelationField{Name: "user", Required: true, CollectionId: users.Id, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "model_id", Required: true, Max: 200})
	c.AddIndex("idx_user_model_access_unique", true, "user,model_id", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) ensureInvitationsCollection(users *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(InvitationsCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(InvitationsCollection)
	adminOnly := "@request.auth.id != '' && @collection.users.id = @request.auth.id && @collection.users.role = 'admin'"
	c.ListRule = types.Pointer(adminOnly)
	c.ViewRule = types.Pointer(adminOnly)
	c.CreateRule = types.Pointer(adminOnly)
	c.UpdateRule = types.Pointer(adminOnly)
	c.DeleteRule = types.Pointer(adminOnly)
	c.Fields.Add(&core.EmailField{Name: "email", Required: true})
	c.Fields.Add(&core.TextField{Name: "token_hash", Required: true, Max: 128})
	c.Fields.Add(&core.SelectField{Name: "role", Values: []string{RoleAdmin, RoleUser}, MaxSelect: 1, Required: true})
	c.Fields.Add(&core.DateField{Name: "expires_at", Required: true})
	c.Fields.Add(&core.DateField{Name: "used_at"})
	c.Fields.Add(&core.RelationField{Name: "created_by", CollectionId: users.Id, MaxSelect: 1})
	c.Fields.Add(&core.JSONField{Name: "initial_model_access"})
	addSystemDateFields(c)
	c.AddIndex("idx_invitations_token_hash", true, "token_hash", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) ensureChatsCollection(users *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(ChatsCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(ChatsCollection)
	ownerOnly := "@request.auth.id != '' && owner = @request.auth.id"
	c.ListRule = types.Pointer(ownerOnly)
	c.ViewRule = types.Pointer(ownerOnly)
	c.CreateRule = types.Pointer(ownerOnly)
	c.UpdateRule = types.Pointer(ownerOnly)
	c.DeleteRule = types.Pointer(ownerOnly)
	c.Fields.Add(&core.RelationField{Name: "owner", Required: true, CollectionId: users.Id, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "title", Max: 500})
	c.Fields.Add(&core.SelectField{Name: "visibility", Values: []string{VisibilityPublic, VisibilityPrivate}, MaxSelect: 1})
	c.Fields.Add(&core.JSONField{Name: "messages"})
	c.Fields.Add(&core.JSONField{Name: "votes"})
	c.Fields.Add(&core.BoolField{Name: "web_search"})
	c.Fields.Add(&core.JSONField{Name: "branches"})
	c.Fields.Add(&core.JSONField{Name: "last_usage"})
	addSystemDateFields(c)
	c.AddIndex("idx_chats_owner", false, "owner", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) ensureAttachmentsCollection(users *core.Collection, chats *core.Collection) (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(AttachmentsCollection); err == nil {
		return existing, nil
	}
	c := core.NewBaseCollection(AttachmentsCollection)
	ownerOnly := "@request.auth.id != '' && owner = @request.auth.id"
	c.ListRule = types.Pointer(ownerOnly)
	c.ViewRule = types.Pointer(ownerOnly)
	c.CreateRule = types.Pointer(ownerOnly)
	c.UpdateRule = types.Pointer(ownerOnly)
	c.DeleteRule = types.Pointer(ownerOnly)
	c.Fields.Add(&core.RelationField{Name: "owner", Required: true, CollectionId: users.Id, MaxSelect: 1})
	c.Fields.Add(&core.RelationField{Name: "chat", CollectionId: chats.Id, MaxSelect: 1})
	c.Fields.Add(&core.TextField{Name: "filename", Required: true, Max: 500})
	c.Fields.Add(&core.TextField{Name: "media_type", Max: 200})
	c.Fields.Add(&core.NumberField{Name: "size"})
	c.Fields.Add(&core.FileField{Name: "file", Required: true, MaxSelect: 1, MaxSize: 50 << 20})
	addSystemDateFields(c)
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) seedModels() error {
	collection, err := s.App.FindCollectionByNameOrId(ModelsCollection)
	if err != nil {
		return err
	}
	catalog := GetCatalogModels()
	catalogKeys := make(map[string]struct{}, len(catalog))

	for _, info := range catalog {
		catalogKeys[info.ID] = struct{}{}
		record, err := s.App.FindFirstRecordByFilter(ModelsCollection, "key = {:key}", dbx.Params{"key": info.ID})
		if err != nil {
			record = core.NewRecord(collection)
			record.Set("enabled", true)
		}
		record.Set("key", info.ID)
		record.Set("provider", info.Provider)
		record.Set("display_name", info.DisplayName)
		record.Set("supports_images", info.SupportsImages)
		record.Set("supports_search", info.SupportsSearch)
		if err := s.App.Save(record); err != nil {
			return err
		}
	}

	// Disable models that are no longer in the catalog
	existing, err := s.App.FindRecordsByFilter(ModelsCollection, "", "", 200, 0)
	if err != nil {
		return err
	}
	for _, record := range existing {
		if _, ok := catalogKeys[record.GetString("key")]; ok {
			continue
		}
		record.Set("enabled", false)
		if err := s.App.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) seedInitialAdmin() error {
	count, err := s.CountUsers()
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	users, err := s.App.FindCollectionByNameOrId(UsersCollection)
	if err != nil {
		return err
	}
	record := core.NewRecord(users)
	record.SetEmail("admin@keryx.app")
	record.SetPassword("admin123")
	record.SetVerified(true)
	record.Set("name", "Admin")
	record.Set("role", RoleAdmin)
	record.Set("theme", "system")
	if err := s.App.Save(record); err != nil {
		return err
	}
	return nil
}
