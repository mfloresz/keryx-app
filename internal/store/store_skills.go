package store

import (
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// ensureSkillsCollection creates the skills collection: named instruction
// packs admins can toggle for stream injection.
func (s *Store) ensureSkillsCollection() (*core.Collection, error) {
	if existing, err := s.App.FindCollectionByNameOrId(SkillsCollection); err == nil {
		return s.migrateSkillsCollection(existing)
	}
	c := core.NewBaseCollection(SkillsCollection)
	adminOnly := "@request.auth.id != '' && @collection.users.id = @request.auth.id && @collection.users.role = 'admin'"
	c.ListRule = new(adminOnly)
	c.ViewRule = new(adminOnly)
	c.CreateRule = new(adminOnly)
	c.UpdateRule = new(adminOnly)
	c.DeleteRule = new(adminOnly)
	c.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 120})
	c.Fields.Add(&core.TextField{Name: "description", Max: 500})
	c.Fields.Add(&core.TextField{Name: "instructions", Max: maxLongTextChars})
	c.Fields.Add(&core.BoolField{Name: "enabled"})
	addSystemDateFields(c)
	c.AddIndex("idx_skills_name_unique", true, "name", "")
	if err := s.App.Save(c); err != nil {
		return nil, err
	}
	return c, nil
}

// migrateSkillsCollection reconciles an existing skills collection with the
// current schema: instructions are long free-form text, so they must not keep
// PocketBase's implicit 5000-char limit.
func (s *Store) migrateSkillsCollection(c *core.Collection) (*core.Collection, error) {
	if err := s.ensureField(c, &core.TextField{Name: "instructions", Max: maxLongTextChars}); err != nil {
		return nil, err
	}
	if err := s.ensureFieldMax(c, "instructions", maxLongTextChars); err != nil {
		return nil, err
	}
	return c, nil
}

// Skill is a named instruction pack that can be injected into chat streams.
type Skill struct {
	ID           string
	Name         string
	Description  string
	Instructions string
	Enabled      bool
	UpdatedAt    string
}

func skillFromRecord(r *core.Record) *Skill {
	return &Skill{
		ID:           r.Id,
		Name:         r.GetString("name"),
		Description:  r.GetString("description"),
		Instructions: r.GetString("instructions"),
		Enabled:      r.GetBool("enabled"),
		UpdatedAt:    r.GetString("updated"),
	}
}

// ListSkills returns all skills (admin view), sorted by name.
func (s *Store) ListSkills() ([]Skill, error) {
	records, err := s.App.FindRecordsByFilter(SkillsCollection, "", "name", 0, 0)
	if err != nil {
		return nil, err
	}
	out := make([]Skill, 0, len(records))
	for _, r := range records {
		out = append(out, *skillFromRecord(r))
	}
	return out, nil
}

// ListEnabledSkills returns the enabled skills sorted by name (stream
// injection).
func (s *Store) ListEnabledSkills() ([]Skill, error) {
	records, err := s.App.FindRecordsByFilter(SkillsCollection, "enabled = true", "name", 0, 0)
	if err != nil {
		return nil, err
	}
	out := make([]Skill, 0, len(records))
	for _, r := range records {
		out = append(out, *skillFromRecord(r))
	}
	return out, nil
}

// GetSkillByName resolves one skill regardless of enabled state (tool exec).
func (s *Store) GetSkillByName(name string) (*Skill, error) {
	record, err := s.App.FindFirstRecordByFilter(
		SkillsCollection,
		"name = {:name}",
		dbx.Params{"name": name},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	return skillFromRecord(record), nil
}

// CreateSkill inserts a skill. Name is required (trimmed); duplicate names
// are rejected.
func (s *Store) CreateSkill(sk *Skill) (*Skill, error) {
	sk.Name = strings.TrimSpace(sk.Name)
	sk.Description = strings.TrimSpace(sk.Description)
	if sk.Name == "" {
		return nil, ErrInvalid
	}
	if existing, err := s.GetSkillByName(sk.Name); err == nil && existing != nil {
		return nil, ErrInvalid
	}
	collection, err := s.App.FindCollectionByNameOrId(SkillsCollection)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	record.Set("name", sk.Name)
	record.Set("description", sk.Description)
	record.Set("instructions", sk.Instructions)
	record.Set("enabled", sk.Enabled)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return skillFromRecord(record), nil
}

// UpdateSkill edits an existing skill. Name is required (trimmed); duplicate
// names are rejected.
func (s *Store) UpdateSkill(id string, sk *Skill) (*Skill, error) {
	record, err := s.App.FindRecordById(SkillsCollection, id)
	if err != nil {
		return nil, ErrNotFound
	}
	sk.Name = strings.TrimSpace(sk.Name)
	sk.Description = strings.TrimSpace(sk.Description)
	if sk.Name == "" {
		return nil, ErrInvalid
	}
	if existing, err := s.GetSkillByName(sk.Name); err == nil && existing.ID != id {
		return nil, ErrInvalid
	}
	record.Set("name", sk.Name)
	record.Set("description", sk.Description)
	record.Set("instructions", sk.Instructions)
	record.Set("enabled", sk.Enabled)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return skillFromRecord(record), nil
}

// DeleteSkill removes a skill.
func (s *Store) DeleteSkill(id string) error {
	record, err := s.App.FindRecordById(SkillsCollection, id)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}
