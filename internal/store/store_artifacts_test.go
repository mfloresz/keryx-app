package store

import (
	"errors"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
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

// PocketBase v0.39+ applies an implicit 5000-char cap to text fields whose Max
// is left at zero, which used to make update_artifact fail on real documents.
func TestChatArtifactContentHasNoImplicit5000Cap(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01"
	s.createTestUser(t, alice, "alice@test.local")
	chat := createTestChat(t, s, alice, "artifacts")

	content := strings.Repeat("<p>largo</p>", 2000) // 12000 chars > 5000
	if err := s.SaveChatArtifact(chat.ID, "art_big", "Big", "html", content, 1); err != nil {
		t.Fatalf("save oversized artifact: %v", err)
	}
	got, err := s.GetChatArtifact(chat.ID, "art_big", 0)
	if err != nil {
		t.Fatalf("get oversized artifact: %v", err)
	}
	if got.Content != content {
		t.Errorf("content roundtrip mismatch: got %d chars, want %d", len(got.Content), len(content))
	}
}

// A DB created before the explicit cap keeps Max=0 (5000 chars) until
// EnsureSchema reconciles it.
func TestChatArtifactsCollectionMigrationRaisesContentMax(t *testing.T) {
	s := newProjectsTestStore(t)

	collection, err := s.App.FindCollectionByNameOrId(ChatArtifactsCollection)
	if err != nil {
		t.Fatalf("chat_artifacts collection: %v", err)
	}
	content := collection.Fields.GetByName("content").(*core.TextField)
	content.Max = 0 // simulate the legacy schema
	if err := s.App.Save(collection); err != nil {
		t.Fatalf("simulate legacy schema: %v", err)
	}

	if err := s.EnsureSchema(); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}
	collection, err = s.App.FindCollectionByNameOrId(ChatArtifactsCollection)
	if err != nil {
		t.Fatalf("chat_artifacts collection: %v", err)
	}
	if got := collection.Fields.GetByName("content").(*core.TextField).Max; got != maxLongTextChars {
		t.Errorf("content Max = %d, want %d", got, maxLongTextChars)
	}
}
