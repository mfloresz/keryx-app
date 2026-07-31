package store

import (
	"github.com/pocketbase/pocketbase/core"
)

// GetWebSearchConfig retrieves the web search config (Brave API key + enabled flag).
// Returns nil config if no record exists.
func (s *Store) GetWebSearchConfig() (*WebSearchConfig, error) {
	records, err := s.App.FindRecordsByFilter(
		WebSearchConfigCollection,
		"",
		"-created",
		1, 0,
	)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}

	record := records[0]
	encrypted := record.GetString("api_key_encrypted")

	var apiKey string
	if encrypted != "" {
		decrypted, err := s.Encryptor.Decrypt(encrypted)
		if err != nil {
			return nil, err
		}
		apiKey = decrypted
	}

	return &WebSearchConfig{
		APIKey:  apiKey,
		Enabled: record.GetBool("enabled"),
	}, nil
}

// UpsertWebSearchConfig saves the web search config (Brave API key + enabled flag).
// It encrypts the API key before storing. Updates the first existing record or
// creates a new one.
func (s *Store) UpsertWebSearchConfig(cfg *WebSearchConfig) error {
	records, err := s.App.FindRecordsByFilter(
		WebSearchConfigCollection,
		"",
		"-created",
		1, 0,
	)
	if err != nil {
		return err
	}

	var record *core.Record
	if len(records) > 0 {
		record = records[0]
	} else {
		collection, err := s.App.FindCollectionByNameOrId(WebSearchConfigCollection)
		if err != nil {
			return err
		}
		record = core.NewRecord(collection)
	}

	// Encrypt the API key if provided
	if cfg.APIKey != "" {
		encrypted, err := s.Encryptor.Encrypt(cfg.APIKey)
		if err != nil {
			return err
		}
		record.Set("api_key_encrypted", encrypted)
	}

	record.Set("enabled", cfg.Enabled)

	return s.App.Save(record)
}
