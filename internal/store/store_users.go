package store

import (
	"github.com/pocketbase/dbx"
)

func (s *Store) GetUserByID(userID string) (*User, error) {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return nil, ErrNotFound
	}
	u := userFromRecord(record)
	return &u, nil
}

func (s *Store) GetUserByEmail(email string) (*User, error) {
	record, err := s.App.FindAuthRecordByEmail(UsersCollection, email)
	if err != nil {
		return nil, ErrNotFound
	}
	u := userFromRecord(record)
	return &u, nil
}

func (s *Store) ListUsers() ([]User, error) {
	records, err := s.App.FindRecordsByFilter(
		UsersCollection,
		"",
		"+created",
		200, 0,
	)
	if err != nil {
		return nil, err
	}
	out := make([]User, 0, len(records))
	for _, r := range records {
		u := userFromRecord(r)
		u.CreatedAt = r.GetString("created")
		u.UpdatedAt = r.GetString("updated")
		out = append(out, u)
	}
	return out, nil
}

func (s *Store) UpdateUserRole(userID, role string) error {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return ErrNotFound
	}
	record.Set("role", role)
	return s.App.Save(record)
}

func (s *Store) CountUsers() (int, error) {
	records, err := s.App.FindRecordsByFilter(UsersCollection, "1=1", "", 200, 0)
	if err != nil {
		return 0, err
	}
	return len(records), nil
}

func (s *Store) CountAdmins() (int, error) {
	records, err := s.App.FindRecordsByFilter(
		UsersCollection,
		"role = {:role}",
		"",
		200, 0,
		dbx.Params{"role": RoleAdmin},
	)
	if err != nil {
		return 0, err
	}
	return len(records), nil
}

func (s *Store) GetUserRole(userID string) (string, error) {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return "", ErrNotFound
	}
	return record.GetString("role"), nil
}
