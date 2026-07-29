package store

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// GetTitleGenerationPolicy returns the admin-defined title generation policy.
// Returns the default (TitleModeChatModel) when no policy record exists.
func (s *Store) GetTitleGenerationPolicy() (*TitleGenerationPolicy, error) {
	record, err := s.App.FindFirstRecordByFilter(
		TitleGenerationPolicyCollection,
		"",
		dbx.Params{},
	)
	if err != nil {
		return &TitleGenerationPolicy{Mode: TitleModeChatModel}, nil
	}

	return &TitleGenerationPolicy{
		Mode:    TitleGenerationMode(record.GetString("mode")),
		ModelID: record.GetString("model_id"),
	}, nil
}

// SetTitleGenerationPolicy saves or updates the title generation policy.
func (s *Store) SetTitleGenerationPolicy(policy *TitleGenerationPolicy) (*TitleGenerationPolicy, error) {
	existing, err := s.App.FindFirstRecordByFilter(
		TitleGenerationPolicyCollection,
		"",
		dbx.Params{},
	)
	if err != nil {
		collection, cErr := s.App.FindCollectionByNameOrId(TitleGenerationPolicyCollection)
		if cErr != nil {
			return nil, cErr
		}
		existing = core.NewRecord(collection)
	}

	existing.Set("mode", string(policy.Mode))
	existing.Set("model_id", policy.ModelID)

	if err := s.App.Save(existing); err != nil {
		return nil, err
	}

	return &TitleGenerationPolicy{
		Mode:    TitleGenerationMode(existing.GetString("mode")),
		ModelID: existing.GetString("model_id"),
	}, nil
}
