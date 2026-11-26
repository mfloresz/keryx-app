package store

import (
	"errors"
	"testing"
)

func TestChatArtifactsVersions(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")
	chat := createTestChat(t, s, alice, "artifacts")

	if err := s.SaveChatArtifact(chat.ID, "art_1", "Draft", "html", "<p>v1</p>", 1); err != nil {
		t.Fatalf("save v1: %v", err)
	}
	if err := s.SaveChatArtifact(chat.ID, "art_1", "Draft", "html", "<p>v2</p>", 2); err != nil {
		t.Fatalf("save v2: %v", err)
	}
	if err := s.SaveChatArtifact(chat.ID, "art_2", "Notes", "markdown", "# notes", 1); err != nil {
		t.Fatalf("save art_2: %v", err)
	}

	latest, err := s.LatestChatArtifacts(chat.ID)
	if err != nil || len(latest) != 2 {
		t.Fatalf("LatestChatArtifacts = %v, %v; want 2 artifacts", latest, err)
	}
	if latest[0].ArtifactID != "art_1" || latest[0].Version != 2 || latest[0].Content != "<p>v2</p>" {
		t.Errorf("latest[0] = %+v; want art_1 v2", latest[0])
	}
	if latest[1].ArtifactID != "art_2" || latest[1].Version != 1 {
		t.Errorf("latest[1] = %+v; want art_2 v1", latest[1])
	}

	// By explicit version.
	v1, err := s.GetChatArtifact(chat.ID, "art_1", 1)
	if err != nil || v1.Content != "<p>v1</p>" || v1.Version != 1 || v1.Title != "Draft" || v1.Type != "html" {
		t.Fatalf("GetChatArtifact v1 = %+v, %v", v1, err)
	}
	// version <= 0 means latest.
	vLatest, err := s.GetChatArtifact(chat.ID, "art_1", 0)
	if err != nil || vLatest.Version != 2 || vLatest.Content != "<p>v2</p>" {
		t.Fatalf("GetChatArtifact latest = %+v, %v", vLatest, err)
	}
	// Unknown artifact / version.
	if _, err := s.GetChatArtifact(chat.ID, "art_missing", 0); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown artifact: got %v, want ErrNotFound", err)
	}
	if _, err := s.GetChatArtifact(chat.ID, "art_1", 9); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown version: got %v, want ErrNotFound", err)
	}
}
