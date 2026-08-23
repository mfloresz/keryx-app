package store

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// PromptOverrideKeys are the supported singleton override keys.
const (
	PromptOverrideKeyBase  = "base"
	PromptOverrideKeyTitle = "title"
)

// ValidPromptOverrideKey reports whether key is a supported override key.
func ValidPromptOverrideKey(key string) bool {
	return key == PromptOverrideKeyBase || key == PromptOverrideKeyTitle
}

// PromptOverride is an effective prompt with its origin.
type PromptOverride struct {
	Key       string `json:"key"`
	Prompt    string `json:"prompt"`
	Source    string `json:"source"` // "embedded" | "override"
	UpdatedAt string `json:"updatedAt,omitempty"`
}

func (s *Store) effectivePrompt(key, embedded string) PromptOverride {
	record, err := s.App.FindFirstRecordByFilter(
		PromptOverridesCollection,
		"key = {:key}",
		dbx.Params{"key": key},
	)
	if err != nil || record.GetString("prompt") == "" {
		return PromptOverride{Key: key, Prompt: embedded, Source: "embedded"}
	}
	return PromptOverride{
		Key:       key,
		Prompt:    record.GetString("prompt"),
		Source:    "override",
		UpdatedAt: record.GetString("updated"),
	}
}

// GetEffectiveBasePrompt returns the DB base-prompt override or the embedded default.
func (s *Store) GetEffectiveBasePrompt(embedded string) PromptOverride {
	return s.effectivePrompt(PromptOverrideKeyBase, embedded)
}

// GetEffectiveTitlePrompt returns the DB title-prompt override or the embedded default.
func (s *Store) GetEffectiveTitlePrompt(embedded string) PromptOverride {
	return s.effectivePrompt(PromptOverrideKeyTitle, embedded)
}

// SetPromptOverride creates or updates a prompt override. Empty prompts are rejected.
func (s *Store) SetPromptOverride(key, prompt, actorID string) error {
	if !ValidPromptOverrideKey(key) {
		return ErrNotFound
	}
	if len(prompt) == 0 || len(prompt) > 20000 {
		return ErrInvalid
	}
	collection, err := s.App.FindCollectionByNameOrId(PromptOverridesCollection)
	if err != nil {
		return err
	}
	record, err := s.App.FindFirstRecordByFilter(
		PromptOverridesCollection,
		"key = {:key}",
		dbx.Params{"key": key},
	)
	if err != nil {
		record = core.NewRecord(collection)
		record.Set("key", key)
	}
	record.Set("prompt", prompt)
	if actorID != "" {
		record.Set("updated_by", actorID)
	}
	return s.App.Save(record)
}

// DeletePromptOverride removes an override so the embedded default takes effect again.
func (s *Store) DeletePromptOverride(key string) error {
	if !ValidPromptOverrideKey(key) {
		return ErrNotFound
	}
	record, err := s.App.FindFirstRecordByFilter(
		PromptOverridesCollection,
		"key = {:key}",
		dbx.Params{"key": key},
	)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}
