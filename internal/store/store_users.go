package store

import (
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/tools/filesystem"
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

func (s *Store) UpdateUserName(userID, name string) (*User, error) {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return nil, ErrNotFound
	}
	record.Set("name", name)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	u := userFromRecord(record)
	return &u, nil
}

func (s *Store) UpdateUserAvatar(userID string, file *filesystem.File) (*User, error) {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return nil, ErrNotFound
	}
	record.Set("avatar", file)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	u := userFromRecord(record)
	return &u, nil
}

func (s *Store) RemoveUserAvatar(userID string) (*User, error) {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return nil, ErrNotFound
	}
	record.Set("avatar", nil)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	u := userFromRecord(record)
	return &u, nil
}

func (s *Store) GetUserAvatarData(userID string) ([]byte, string, error) {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return nil, "", ErrNotFound
	}
	avatar := record.GetString("avatar")
	if avatar == "" {
		return nil, "", ErrNotFound
	}
	fsys, err := s.App.NewFilesystem()
	if err != nil {
		return nil, "", err
	}
	defer fsys.Close()
	reader, err := fsys.GetFile(record.BaseFilesPath() + "/" + avatar)
	if err != nil {
		return nil, "", err
	}
	defer reader.Close()
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, "", err
	}
	mediaType := "image/webp"
	ext := strings.ToLower(filepath.Ext(avatar))
	switch ext {
	case ".jpg", ".jpeg":
		mediaType = "image/jpeg"
	case ".png":
		mediaType = "image/png"
	case ".gif":
		mediaType = "image/gif"
	case ".webp":
		mediaType = "image/webp"
	}
	return data, mediaType, nil
}

func (s *Store) ChangePassword(userID, currentPassword, newPassword string) error {
	record, err := s.App.FindRecordById(UsersCollection, userID)
	if err != nil {
		return ErrNotFound
	}
	if !record.ValidatePassword(currentPassword) {
		return ErrForbidden
	}
	if len(newPassword) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}
	record.SetPassword(newPassword)
	return s.App.Save(record)
}
