package store

import (
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func (s *Store) ListModels() ([]ModelRecord, error) {
	records, err := s.App.FindRecordsByFilter(
		ModelsCollection,
		"",
		"provider,display_name",
		200, 0,
	)
	if err != nil {
		return nil, err
	}
	out := make([]ModelRecord, 0, len(records))
	for _, r := range records {
		out = append(out, ModelRecord{
			ID:            r.GetString("key"),
			Provider:      r.GetString("provider"),
			DisplayName:   r.GetString("display_name"),
			SupportsImages: r.GetBool("supports_images"),
			SupportsSearch: r.GetBool("supports_search"),
			Enabled:       r.GetBool("enabled"),
			CreatedAt:     r.GetString("created"),
			UpdatedAt:     r.GetString("updated"),
		})
	}
	return out, nil
}

func (s *Store) SetModelEnabled(modelKey string, enabled bool) error {
	record, err := s.App.FindFirstRecordByFilter(
		ModelsCollection,
		"key = {:key}",
		dbx.Params{"key": modelKey},
	)
	if err != nil {
		return ErrNotFound
	}
	record.Set("enabled", enabled)
	return s.App.Save(record)
}

func (s *Store) GetUserModelAccess(userID string) ([]string, error) {
	records, err := s.App.FindRecordsByFilter(
		UserModelAccessCollection,
		"user = {:user}",
		"+model_id",
		200, 0,
		dbx.Params{"user": userID},
	)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(records))
	for _, r := range records {
		out = append(out, r.GetString("model_id"))
	}
	return out, nil
}

func (s *Store) SetUserModelAccess(userID string, modelIDs []string) error {
	existing, err := s.App.FindRecordsByFilter(
		UserModelAccessCollection,
		"user = {:user}",
		"",
		200, 0,
		dbx.Params{"user": userID},
	)
	if err != nil {
		return err
	}
	for _, r := range existing {
		if err := s.App.Delete(r); err != nil {
			return err
		}
	}

	collection, err := s.App.FindCollectionByNameOrId(UserModelAccessCollection)
	if err != nil {
		return err
	}

	seen := make(map[string]struct{})
	for _, mid := range modelIDs {
		if _, ok := seen[mid]; ok {
			continue
		}
		seen[mid] = struct{}{}
		record := core.NewRecord(collection)
		record.Set("user", userID)
		record.Set("model_id", mid)
		if err := s.App.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetAllowedModels(userID string) ([]AllowedModel, error) {
	models, err := s.ListModels()
	if err != nil {
		return nil, err
	}

	user, err := s.GetUserByID(userID)
	if err != nil {
		return nil, err
	}

	if user.Role == RoleAdmin {
		out := make([]AllowedModel, 0, len(models))
		for _, m := range models {
			if !m.Enabled {
				continue
			}
			out = append(out, AllowedModel{
				ID:            m.ID,
				Provider:      m.Provider,
				DisplayName:   m.DisplayName,
				SupportsImages: m.SupportsImages,
				SupportsSearch: m.SupportsSearch,
			})
		}
		return out, nil
	}

	allowedIDs, err := s.GetUserModelAccess(userID)
	if err != nil {
		return nil, err
	}

	if len(allowedIDs) == 0 {
		out := make([]AllowedModel, 0, len(models))
		for _, m := range models {
			if !m.Enabled {
				continue
			}
			out = append(out, AllowedModel{
				ID:            m.ID,
				Provider:      m.Provider,
				DisplayName:   m.DisplayName,
				SupportsImages: m.SupportsImages,
				SupportsSearch: m.SupportsSearch,
			})
		}
		return out, nil
	}

	allowedSet := make(map[string]struct{}, len(allowedIDs))
	for _, id := range allowedIDs {
		allowedSet[id] = struct{}{}
	}

	out := make([]AllowedModel, 0, len(allowedIDs))
	for _, m := range models {
		if _, ok := allowedSet[m.ID]; !ok {
			continue
		}
		if !m.Enabled {
			continue
		}
		out = append(out, AllowedModel{
			ID:            m.ID,
			Provider:      m.Provider,
			DisplayName:   m.DisplayName,
			SupportsImages: m.SupportsImages,
			SupportsSearch: m.SupportsSearch,
		})
	}
	return out, nil
}

func (s *Store) AssertModelAllowed(userID, modelID string) error {
	models, err := s.GetAllowedModels(userID)
	if err != nil {
		return err
	}
	for _, m := range models {
		if m.ID == modelID {
			return nil
		}
	}
	return ErrForbidden
}

func (s *Store) GetModelPresets() ([]ModelPreset, error) {
	records, err := s.App.FindRecordsByFilter(
		ModelPresetsCollection,
		"",
		"preset_id",
		10, 0,
	)
	if err != nil {
		return nil, err
	}
	out := make([]ModelPreset, 0, len(records))
	for _, r := range records {
		out = append(out, ModelPreset{
			PresetID: r.GetString("preset_id"),
			ModelID:  r.GetString("model_id"),
			Label:    r.GetString("label"),
		})
	}
	return out, nil
}

func (s *Store) GetModelPreset(presetID string) (ModelPreset, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ModelPresetsCollection,
		"preset_id = {:pid}",
		dbx.Params{"pid": presetID},
	)
	if err != nil {
		return ModelPreset{}, ErrNotFound
	}
	return ModelPreset{
		PresetID: record.GetString("preset_id"),
		ModelID:  record.GetString("model_id"),
		Label:    record.GetString("label"),
	}, nil
}

func (s *Store) SetModelPreset(presetID, modelID string) error {
	record, err := s.App.FindFirstRecordByFilter(
		ModelPresetsCollection,
		"preset_id = {:pid}",
		dbx.Params{"pid": presetID},
	)
	if err != nil {
		return ErrNotFound
	}
	record.Set("model_id", modelID)
	return s.App.Save(record)
}
