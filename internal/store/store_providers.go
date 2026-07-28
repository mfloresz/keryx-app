package store

import (
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ProviderKeyInfo is the public shape of a provider API key — the actual key
// is never exposed to the frontend, only whether one is configured and when it
// was last updated.
type ProviderKeyInfo struct {
	Provider        string `json:"provider"`
	Configured      bool   `json:"configured"`
	UpdatedAt       string `json:"updatedAt,omitempty"`
}

// ListProviderKeys returns all provider keys with the actual key stripped.
func (s *Store) ListProviderKeys() ([]ProviderKeyInfo, error) {
	records, err := s.App.FindRecordsByFilter(ProviderKeysCollection, "", "", 200, 0)
	if err != nil {
		return nil, err
	}
	out := make([]ProviderKeyInfo, 0, len(records))
	for _, r := range records {
		out = append(out, ProviderKeyInfo{
			Provider:   r.GetString("provider"),
			Configured: r.GetBool("configured"),
			UpdatedAt:  r.GetString("updated_at"),
		})
	}
	return out, nil
}

// GetDecryptedAPIKey returns the decrypted API key for the given provider.
// Returns empty string if no key is configured (caller should fall back to env).
func (s *Store) GetDecryptedAPIKey(provider string) (string, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ProviderKeysCollection,
		"provider = {:provider} && configured = true",
		dbx.Params{"provider": provider},
	)
	if err != nil {
		return "", nil // not found is not an error — caller may fall back to env
	}
	encrypted := record.GetString("api_key_encrypted")
	if encrypted == "" {
		return "", nil
	}
	return s.Encryptor.Decrypt(encrypted)
}

// UpsertProviderAPIKey encrypts and stores (or replaces) an API key for a provider.
func (s *Store) UpsertProviderAPIKey(provider, apiKey string) (*ProviderKeyInfo, error) {
	provider = strings.TrimSpace(provider)
	apiKey = strings.TrimSpace(apiKey)

	existing, err := s.App.FindFirstRecordByFilter(
		ProviderKeysCollection,
		"provider = {:provider}",
		dbx.Params{"provider": provider},
	)
	if err != nil {
		collection, cErr := s.App.FindCollectionByNameOrId(ProviderKeysCollection)
		if cErr != nil {
			return nil, cErr
		}
		existing = core.NewRecord(collection)
		existing.Set("provider", provider)
	}

	encrypted, err := s.Encryptor.Encrypt(apiKey)
	if err != nil {
		return nil, fmt.Errorf("encrypt api key: %w", err)
	}

	existing.Set("api_key_encrypted", encrypted)
	existing.Set("configured", apiKey != "")
	existing.Set("updated_at", time.Now().UTC().Format(time.RFC3339))

	if err := s.App.Save(existing); err != nil {
		return nil, err
	}

	return &ProviderKeyInfo{
		Provider:   provider,
		Configured: apiKey != "",
		UpdatedAt:  existing.GetString("updated_at"),
	}, nil
}

// DeleteProviderAPIKey removes the stored API key for a provider.
func (s *Store) DeleteProviderAPIKey(provider string) error {
	existing, err := s.App.FindFirstRecordByFilter(
		ProviderKeysCollection,
		"provider = {:provider}",
		dbx.Params{"provider": provider},
	)
	if err != nil {
		return nil // nothing to delete
	}
	return s.App.Delete(existing)
}
