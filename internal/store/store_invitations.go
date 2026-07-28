package store

import (
	"encoding/json"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func (s *Store) ListInvitations() ([]InvitationRecord, error) {
	records, err := s.App.FindRecordsByFilter(
		InvitationsCollection,
		"",
		"-created",
		200, 0,
	)
	if err != nil {
		return nil, err
	}
	out := make([]InvitationRecord, 0, len(records))
	for _, r := range records {
		out = append(out, invitationFromRecord(r))
	}
	return out, nil
}

func (s *Store) CreateInvitation(inv *InvitationRecord) error {
	collection, err := s.App.FindCollectionByNameOrId(InvitationsCollection)
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("id", inv.ID)
	record.Set("email", inv.Email)
	record.Set("token_hash", inv.TokenHash)
	record.Set("role", inv.Role)
	record.Set("expires_at", inv.ExpiresAt)
	record.Set("created_by", inv.CreatedBy)
	if len(inv.InitialModelAccess) > 0 {
		record.Set("initial_model_access", inv.InitialModelAccess)
	}
	return s.App.Save(record)
}

func (s *Store) GetInvitationByTokenHash(tokenHash string) (*InvitationRecord, error) {
	record, err := s.App.FindFirstRecordByFilter(
		InvitationsCollection,
		"token_hash = {:hash}",
		dbx.Params{"hash": tokenHash},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	inv := invitationFromRecord(record)
	return &inv, nil
}

func (s *Store) MarkInvitationUsed(invitationID string, usedAt string) error {
	record, err := s.App.FindRecordById(InvitationsCollection, invitationID)
	if err != nil {
		return ErrNotFound
	}
	record.Set("used_at", usedAt)
	return s.App.Save(record)
}

func (s *Store) DeleteInvitation(invitationID string) error {
	record, err := s.App.FindRecordById(InvitationsCollection, invitationID)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}

func invitationFromRecord(r *core.Record) InvitationRecord {
	inv := InvitationRecord{
		ID:        r.Id,
		Email:     r.GetString("email"),
		TokenHash: r.GetString("token_hash"),
		Role:      r.GetString("role"),
		ExpiresAt: r.GetString("expires_at"),
		CreatedBy: r.GetString("created_by"),
		CreatedAt: r.GetString("created"),
	}
	if usedAt := r.GetString("used_at"); usedAt != "" {
		inv.UsedAt = &usedAt
	}
	if modelAccess := r.GetString("initial_model_access"); modelAccess != "" {
		var ids []string
		if err := json.Unmarshal([]byte(modelAccess), &ids); err == nil {
			inv.InitialModelAccess = ids
		}
	}
	return inv
}
