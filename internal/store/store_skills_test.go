package store

import (
	"errors"
	"testing"
)

func TestSkillsCRUD(t *testing.T) {
	s := newProjectsTestStore(t)

	// Create with trimming; name is required.
	sk, err := s.CreateSkill(&Skill{Name: "  pdf  ", Description: "PDF tools", Instructions: "how to pdf", Enabled: true})
	if err != nil || sk.Name != "pdf" {
		t.Fatalf("CreateSkill = %+v, %v", sk, err)
	}
	if _, err := s.CreateSkill(&Skill{Name: "   "}); !errors.Is(err, ErrInvalid) {
		t.Errorf("empty name: got %v, want ErrInvalid", err)
	}
	if _, err := s.CreateSkill(&Skill{Name: "pdf"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("duplicate name: got %v, want ErrInvalid", err)
	}

	// A disabled skill.
	disabled, err := s.CreateSkill(&Skill{Name: "second", Enabled: false})
	if err != nil {
		t.Fatalf("CreateSkill second: %v", err)
	}

	// Lookup by name works regardless of enabled state.
	byName, err := s.GetSkillByName("pdf")
	if err != nil || byName.Instructions != "how to pdf" || !byName.Enabled {
		t.Fatalf("GetSkillByName = %+v, %v", byName, err)
	}
	if _, err := s.GetSkillByName("missing"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing skill: got %v, want ErrNotFound", err)
	}

	// Listings.
	all, err := s.ListSkills()
	if err != nil || len(all) != 2 {
		t.Fatalf("ListSkills = %v, %v; want 2", all, err)
	}
	enabled, err := s.ListEnabledSkills()
	if err != nil || len(enabled) != 1 || enabled[0].Name != "pdf" {
		t.Fatalf("ListEnabledSkills = %v, %v; want only pdf", enabled, err)
	}

	// Update: flip enabled, rename; duplicates rejected; missing id → ErrNotFound.
	updated, err := s.UpdateSkill(disabled.ID, &Skill{Name: "second", Description: "renamed desc", Enabled: true})
	if err != nil || !updated.Enabled || updated.Description != "renamed desc" {
		t.Fatalf("UpdateSkill = %+v, %v", updated, err)
	}
	if _, err := s.UpdateSkill(sk.ID, &Skill{Name: "second"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("rename to duplicate: got %v, want ErrInvalid", err)
	}
	if _, err := s.UpdateSkill("missing0000000", &Skill{Name: "x"}); !errors.Is(err, ErrNotFound) {
		t.Errorf("update missing: got %v, want ErrNotFound", err)
	}
	if _, err := s.UpdateSkill(sk.ID, &Skill{Name: "  "}); !errors.Is(err, ErrInvalid) {
		t.Errorf("update to empty name: got %v, want ErrInvalid", err)
	}

	enabled, _ = s.ListEnabledSkills()
	if len(enabled) != 2 {
		t.Fatalf("ListEnabledSkills after update = %d; want 2", len(enabled))
	}

	// Delete.
	if err := s.DeleteSkill(sk.ID); err != nil {
		t.Fatalf("DeleteSkill: %v", err)
	}
	if _, err := s.GetSkillByName("pdf"); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted skill still resolvable: %v", err)
	}
	if err := s.DeleteSkill(sk.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("delete missing: got %v, want ErrNotFound", err)
	}
	all, _ = s.ListSkills()
	if len(all) != 1 || all[0].Name != "second" {
		t.Fatalf("ListSkills after delete = %v; want only second", all)
	}
}
