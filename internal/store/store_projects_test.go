package store

import (
	"errors"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func TestNormalizeProjectPath(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		want    string
		wantErr bool
	}{
		{name: "plain file", in: "outline.md", want: "outline.md"},
		{name: "nested", in: "personajes/ana.md", want: "personajes/ana.md"},
		{name: "backslashes normalized", in: "personajes\\ana.md", want: "personajes/ana.md"},
		{name: "inner dot cleaned", in: "personajes/./ana.md", want: "personajes/ana.md"},
		{name: "traversal rejected", in: "../escape.md", wantErr: true},
		{name: "inner traversal rejected", in: "a/../../escape.md", wantErr: true},
		{name: "absolute rejected", in: "/etc/passwd", wantErr: true},
		{name: "empty rejected", in: "  ", wantErr: true},
		{name: "control char rejected", in: "a\x01b.md", wantErr: true},
		{name: "too long rejected", in: strings.Repeat("a", 300), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeProjectPath(tt.in)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("NormalizeProjectPath(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

// newProjectsTestStore boots an in-memory PocketBase app with the full
// keryx schema and returns a Store bound to it.
func newProjectsTestStore(t *testing.T) *Store {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("test app: %v", err)
	}
	t.Cleanup(app.Cleanup)
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	s := New(app, nil)
	if err := s.EnsureSchema(); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}
	return s
}

// createTestUser inserts a minimal auth user so relation fields validate.
func (s *Store) createTestUser(t *testing.T, id, email string) {
	t.Helper()
	collection, err := s.App.FindCollectionByNameOrId(UsersCollection)
	if err != nil {
		t.Fatalf("users collection: %v", err)
	}
	record := core.NewRecord(collection)
	record.Id = id
	record.Set("email", email)
	record.SetPassword("test-password-123")
	if err := s.App.Save(record); err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
}

func TestProjectWorkspaceLifecycle(t *testing.T) {
	s := newProjectsTestStore(t)
	const alice = "alicetestuser01" // exactly 15 chars: PocketBase ID format
	const bob = "bobtestuser0001"
	s.createTestUser(t, alice, "alice@test.local")
	s.createTestUser(t, bob, "bob@test.local")

	project, err := s.CreateProject(&Project{Name: "Historia", Description: "novela"}, alice)
	if err != nil {
		t.Fatalf("create project: %v", err)
	}

	// Ownership: bob must not see or mutate alice's project.
	if _, err := s.GetProjectForOwner(project.ID, bob); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for foreign owner, got %v", err)
	}
	if _, err := s.WriteProjectFile(project.ID, bob, "x.md", "hi"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound writing as foreign owner, got %v", err)
	}

	if _, err := s.WriteProjectFile(project.ID, alice, "personajes/ana.md", "linea 1\nlinea 2\nlinea 3"); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if _, err := s.WriteProjectFile(project.ID, alice, "outline.md", "capitulo 1\ncapitulo 2"); err != nil {
		t.Fatalf("write file: %v", err)
	}

	files, err := s.ListProjectFiles(project.ID, alice)
	if err != nil || len(files) != 2 {
		t.Fatalf("list files = %v, %v; want 2 files", files, err)
	}

	// Read with pagination.
	text, total, start, err := s.ReadProjectFileLines(project.ID, alice, "personajes/ana.md", 2, 2)
	if err != nil || total != 3 || start != 2 || text != "linea 2\nlinea 3" {
		t.Fatalf("read lines = %q, %d, %d, %v", text, total, start, err)
	}

	// Edit requires a unique match unless replace_all.
	if _, err := s.EditProjectFile(project.ID, alice, "outline.md", "capitulo", "acto", false); err == nil {
		t.Fatal("expected non-unique edit to fail")
	}
	count, err := s.EditProjectFile(project.ID, alice, "outline.md", "capitulo", "acto", true)
	if err != nil || count != 2 {
		t.Fatalf("edit replace_all = %d, %v", count, err)
	}
	content, err := s.GetProjectFileContent(project.ID, alice, "outline.md")
	if err != nil || content != "acto 1\nacto 2" {
		t.Fatalf("content after edit = %q, %v", content, err)
	}

	// Glob and grep.
	paths, err := s.GlobProjectFiles(project.ID, alice, "**/*.md")
	if err != nil || len(paths) != 2 {
		t.Fatalf("glob = %v, %v; want 2 paths", paths, err)
	}

	// Listing stats: two files, sizes known.
	summaries, err := s.ListProjectsWithStats(alice)
	if err != nil || len(summaries) != 1 {
		t.Fatalf("summaries = %v, %v; want 1 project", summaries, err)
	}
	if summaries[0].FileCount != 2 {
		t.Errorf("fileCount = %d, want 2", summaries[0].FileCount)
	}
	wantSize := len("linea 1\nlinea 2\nlinea 3") + len("acto 1\nacto 2")
	if summaries[0].TotalSize != wantSize {
		t.Errorf("totalSize = %d, want %d", summaries[0].TotalSize, wantSize)
	}
	matches, err := s.GrepProjectFiles(project.ID, alice, "linea 3", "", false, 10)
	if err != nil || len(matches) != 1 || !strings.Contains(matches[0], "personajes/ana.md:3") {
		t.Fatalf("grep = %v, %v", matches, err)
	}
	ciMatches, err := s.GrepProjectFiles(project.ID, alice, "LINEA 3", "", true, 10)
	if err != nil || len(ciMatches) != 1 {
		t.Fatalf("case-insensitive grep = %v, %v", ciMatches, err)
	}

	// Delete file, then project.
	if err := s.DeleteProjectFile(project.ID, alice, "outline.md"); err != nil {
		t.Fatalf("delete file: %v", err)
	}
	files, _ = s.ListProjectFiles(project.ID, alice)
	if len(files) != 1 {
		t.Fatalf("files after delete = %d, want 1", len(files))
	}
	if err := s.DeleteProject(project.ID, alice); err != nil {
		t.Fatalf("delete project: %v", err)
	}
	if _, err := s.GetProjectForOwner(project.ID, alice); !errors.Is(err, ErrNotFound) {
		t.Fatalf("project should be gone, got %v", err)
	}
}
