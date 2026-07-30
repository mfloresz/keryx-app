package store

import (
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"keryx-server/internal/secure"
)

var ErrNotFound = errors.New("not found")
var ErrForbidden = errors.New("forbidden")

type Store struct {
	App       core.App
	Encryptor *secure.Encryptor
}

func New(app core.App, encryptor *secure.Encryptor) *Store {
	return &Store{App: app, Encryptor: encryptor}
}

func (s *Store) EnsureSchema() error {
	users, err := s.ensureUsersCollection()
	if err != nil {
		return fmt.Errorf("ensure users: %w", err)
	}
	if _, err := s.ensureModelsCollection(); err != nil {
		return fmt.Errorf("ensure models: %w", err)
	}
	if _, err := s.ensureUserModelAccessCollection(users); err != nil {
		return fmt.Errorf("ensure user_model_access: %w", err)
	}
	if _, err := s.ensureInvitationsCollection(users); err != nil {
		return fmt.Errorf("ensure invitations: %w", err)
	}
	chats, err := s.ensureChatsCollection(users)
	if err != nil {
		return fmt.Errorf("ensure chats: %w", err)
	}
	if _, err := s.ensureAttachmentsCollection(users, chats); err != nil {
		return fmt.Errorf("ensure attachments: %w", err)
	}
	if err := s.seedModels(); err != nil {
		return fmt.Errorf("seed models: %w", err)
	}
	if err := s.ensureProviderKeysCollection(); err != nil {
		return fmt.Errorf("ensure provider keys: %w", err)
	}
	if err := s.ensureTitleGenerationPolicyCollection(); err != nil {
		return fmt.Errorf("ensure title generation policy: %w", err)
	}
	// NOTE: no admin user is seeded here. On a fresh install the first user
	// registers via the browser and is promoted to admin by handleRegister.
	return nil
}

func (s *Store) ensureField(collection *core.Collection, field core.Field) error {
	if existing := collection.Fields.GetByName(field.GetName()); existing != nil {
		return nil
	}
	collection.Fields.Add(field)
	return s.App.Save(collection)
}

func addSystemDateFields(c *core.Collection) {
	if c.Fields.GetByName("created") == nil {
		c.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	}
	if c.Fields.GetByName("updated") == nil {
		c.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	}
}
