package store

import (
	"fmt"
	"path"
	"regexp"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Workspace limits guard against runaway tool use. They are generous for
// text projects (stories, docs, outlines) and enforced server-side on every
// operation, so the sandbox is "whatever fits in the project row set".
const (
	maxProjectsPerUser = 25
	maxFilesPerProject = 200
	maxFileChars       = 300_000 // ~75k tokens per file
	maxPathLen         = 200
	maxProjectNameLen  = 80
	maxProjectDescLen  = 300
)

// Project is a named workspace: a closed directory of text files owned by
// one user. Chat agents with a project attached get file tools that operate
// exclusively inside it — the model never sees absolute paths.
type Project struct {
	ID          string `json:"id"`
	OwnerID     string `json:"ownerId,omitempty"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

// ProjectFile is file metadata without content (listings stay cheap).
type ProjectFile struct {
	Path      string `json:"path"`
	Size      int    `json:"size"`
	UpdatedAt string `json:"updatedAt"`
}

func projectFromRecord(r *core.Record) *Project {
	return &Project{
		ID:          r.Id,
		OwnerID:     r.GetString("owner"),
		Name:        r.GetString("name"),
		Description: r.GetString("description"),
		CreatedAt:   r.GetString("created"),
		UpdatedAt:   r.GetString("updated"),
	}
}

// NormalizeProjectPath validates and cleans a workspace-relative path.
// Backslashes become slashes, the result is always slash-separated and
// relative to the project root; anything absolute, escaping the root
// ("..") or carrying control characters is rejected.
func NormalizeProjectPath(p string) (string, error) {
	p = strings.TrimSpace(strings.ReplaceAll(p, "\\", "/"))
	if p == "" {
		return "", ErrInvalid
	}
	clean := path.Clean(p)
	if strings.HasPrefix(clean, "/") || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", fmt.Errorf("%w: path escapes the project: %s", ErrInvalid, p)
	}
	if len(clean) > maxPathLen {
		return "", fmt.Errorf("%w: path too long", ErrInvalid)
	}
	for _, r := range clean {
		if r < 0x20 || r == 0x7f {
			return "", fmt.Errorf("%w: control character in path", ErrInvalid)
		}
	}
	return clean, nil
}

// migrateChatsCollectionForProjects adds project_id to an existing chats
// collection. It stays TextField (not Relation) so deleting a project never
// breaks existing chats — the stream just loses the workspace tools.
func (s *Store) migrateChatsCollectionForProjects(c *core.Collection) error {
	return s.ensureField(c, &core.TextField{Name: "project_id", Max: 80})
}

// UpdateChatProject persists (or clears) the project attached to a chat.
func (s *Store) UpdateChatProject(chatID, ownerID, projectID string) (*ChatRecord, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ChatsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": chatID, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	record.Set("project_id", projectID)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return chatFromRecord(record), nil
}

// ListProjects returns the user's projects, newest first.
func (s *Store) ListProjects(ownerID string) ([]Project, error) {
	records, err := s.App.FindRecordsByFilter(
		ProjectsCollection,
		"owner = {:owner}",
		"-created",
		maxProjectsPerUser, 0,
		dbx.Params{"owner": ownerID},
	)
	if err != nil {
		return nil, err
	}
	out := make([]Project, 0, len(records))
	for _, r := range records {
		out = append(out, *projectFromRecord(r))
	}
	return out, nil
}

// GetProjectForOwner resolves a project enforcing ownership.
func (s *Store) GetProjectForOwner(id, ownerID string) (*Project, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ProjectsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": id, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	return projectFromRecord(record), nil
}

// CreateProject inserts a project for the owner.
func (s *Store) CreateProject(p *Project, ownerID string) (*Project, error) {
	p.Name = strings.TrimSpace(p.Name)
	p.Description = strings.TrimSpace(p.Description)
	if p.Name == "" || len(p.Name) > maxProjectNameLen || len(p.Description) > maxProjectDescLen {
		return nil, ErrInvalid
	}
	count, err := s.App.CountRecords(ProjectsCollection, dbx.NewExp("owner = {:o}", dbx.Params{"o": ownerID}))
	if err != nil {
		return nil, err
	}
	if count >= maxProjectsPerUser {
		return nil, ErrLimitReached
	}
	collection, err := s.App.FindCollectionByNameOrId(ProjectsCollection)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	record.Set("owner", ownerID)
	record.Set("name", p.Name)
	record.Set("description", p.Description)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return projectFromRecord(record), nil
}

// UpdateProject edits name/description with ownership enforced.
func (s *Store) UpdateProject(id, ownerID, name, description string) (*Project, error) {
	record, err := s.App.FindFirstRecordByFilter(
		ProjectsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": id, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if name == "" || len(name) > maxProjectNameLen || len(description) > maxProjectDescLen {
		return nil, ErrInvalid
	}
	record.Set("name", name)
	record.Set("description", description)
	if err := s.App.Save(record); err != nil {
		return nil, err
	}
	return projectFromRecord(record), nil
}

// DeleteProject removes the project and all its files.
func (s *Store) DeleteProject(id, ownerID string) error {
	project, err := s.GetProjectForOwner(id, ownerID)
	if err != nil {
		return err
	}
	files, err := s.App.FindRecordsByFilter(
		ProjectFilesCollection,
		"project = {:p}",
		"", maxFilesPerProject, 0,
		dbx.Params{"p": project.ID},
	)
	if err != nil {
		return err
	}
	for _, r := range files {
		if err := s.App.Delete(r); err != nil {
			return err
		}
	}
	record, err := s.App.FindRecordById(ProjectsCollection, project.ID)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}

// ListProjectFiles returns file metadata (no content) sorted by path.
func (s *Store) ListProjectFiles(projectID, ownerID string) ([]ProjectFile, error) {
	records, err := s.App.FindRecordsByFilter(
		ProjectFilesCollection,
		"project = {:p} && owner = {:o}",
		"path",
		maxFilesPerProject, 0,
		dbx.Params{"p": projectID, "o": ownerID},
	)
	if err != nil {
		return nil, err
	}
	out := make([]ProjectFile, 0, len(records))
	for _, r := range records {
		out = append(out, ProjectFile{
			Path:      r.GetString("path"),
			Size:      int(r.GetFloat("size")),
			UpdatedAt: r.GetString("updated"),
		})
	}
	return out, nil
}

// GetProjectFileContent returns the full text of one workspace file.
func (s *Store) GetProjectFileContent(projectID, ownerID, path string) (string, error) {
	clean, err := NormalizeProjectPath(path)
	if err != nil {
		return "", err
	}
	record, err := s.App.FindFirstRecordByFilter(
		ProjectFilesCollection,
		"project = {:p} && owner = {:o} && path = {:path}",
		dbx.Params{"p": projectID, "o": ownerID, "path": clean},
	)
	if err != nil {
		return "", ErrNotFound
	}
	return record.GetString("content"), nil
}

// WriteProjectFile creates or overwrites one workspace file.
func (s *Store) WriteProjectFile(projectID, ownerID, path, content string) (*ProjectFile, error) {
	clean, err := NormalizeProjectPath(path)
	if err != nil {
		return nil, err
	}
	if len(content) > maxFileChars {
		return nil, fmt.Errorf("%w: file exceeds %d characters", ErrInvalid, maxFileChars)
	}
	if _, err := s.GetProjectForOwner(projectID, ownerID); err != nil {
		return nil, err
	}
	records, err := s.App.FindRecordsByFilter(
		ProjectFilesCollection,
		"project = {:p} && owner = {:o}",
		"", maxFilesPerProject, 0,
		dbx.Params{"p": projectID, "o": ownerID},
	)
	if err != nil {
		return nil, err
	}
	var existing *core.Record
	for _, r := range records {
		if r.GetString("path") == clean {
			existing = r
			break
		}
	}
	if existing == nil {
		if len(records) >= maxFilesPerProject {
			return nil, fmt.Errorf("%w: project is full (%d files)", ErrLimitReached, maxFilesPerProject)
		}
		collection, err := s.App.FindCollectionByNameOrId(ProjectFilesCollection)
		if err != nil {
			return nil, err
		}
		existing = core.NewRecord(collection)
		existing.Set("project", projectID)
		existing.Set("owner", ownerID)
		existing.Set("path", clean)
	}
	existing.Set("content", content)
	existing.Set("size", len(content))
	if err := s.App.Save(existing); err != nil {
		return nil, err
	}
	return &ProjectFile{Path: clean, Size: len(content), UpdatedAt: existing.GetString("updated")}, nil
}

// DeleteProjectFile removes one workspace file.
func (s *Store) DeleteProjectFile(projectID, ownerID, path string) error {
	clean, err := NormalizeProjectPath(path)
	if err != nil {
		return err
	}
	record, err := s.App.FindFirstRecordByFilter(
		ProjectFilesCollection,
		"project = {:p} && owner = {:o} && path = {:path}",
		dbx.Params{"p": projectID, "o": ownerID, "path": clean},
	)
	if err != nil {
		return ErrNotFound
	}
	return s.App.Delete(record)
}

// ReadProjectFileLines returns lines [offset, offset+limit) (1-based offset,
// like the eino filesystem read tool). It reports the total line count so
// callers can annotate truncation.
func (s *Store) ReadProjectFileLines(projectID, ownerID, path string, offset, limit int) (string, int, int, error) {
	content, err := s.GetProjectFileContent(projectID, ownerID, path)
	if err != nil {
		return "", 0, 0, err
	}
	lines := strings.Split(content, "\n")
	total := len(lines)
	if offset < 1 {
		offset = 1
	}
	if offset > total {
		return "", total, offset, nil
	}
	if limit <= 0 {
		limit = 200
	}
	if limit > 1000 {
		limit = 1000
	}
	end := offset - 1 + limit
	if end > total {
		end = total
	}
	return strings.Join(lines[offset-1:end], "\n"), total, offset, nil
}

// EditProjectFile replaces exact strings in a workspace file, mirroring the
// eino edit tool: old_string must exist and be unique unless replace_all.
func (s *Store) EditProjectFile(projectID, ownerID, path, oldString, newString string, replaceAll bool) (int, error) {
	if oldString == "" {
		return 0, fmt.Errorf("%w: old_string is required", ErrInvalid)
	}
	content, err := s.GetProjectFileContent(projectID, ownerID, path)
	if err != nil {
		return 0, err
	}
	count := strings.Count(content, oldString)
	if count == 0 {
		return 0, fmt.Errorf("old_string not found in %s", path)
	}
	if count > 1 && !replaceAll {
		return 0, fmt.Errorf("old_string appears %d times in %s; provide more surrounding context or set replace_all", count, path)
	}
	next := strings.ReplaceAll(content, oldString, newString)
	if len(next) > maxFileChars {
		return 0, fmt.Errorf("%w: edited file would exceed %d characters", ErrInvalid, maxFileChars)
	}
	if _, err := s.WriteProjectFile(projectID, ownerID, path, next); err != nil {
		return 0, err
	}
	return count, nil
}

// GlobProjectFiles returns the paths matching a doublestar pattern
// ("**", "*", "?", "[abc]") relative to the project root.
func (s *Store) GlobProjectFiles(projectID, ownerID, pattern string) ([]string, error) {
	pattern, err := NormalizeProjectPath(pattern)
	if err != nil {
		return nil, err
	}
	files, err := s.ListProjectFiles(projectID, ownerID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(files))
	for _, f := range files {
		ok, err := doublestar.Match(pattern, f.Path)
		if err != nil {
			return nil, fmt.Errorf("%w: bad glob pattern: %v", ErrInvalid, err)
		}
		if ok {
			out = append(out, f.Path)
		}
	}
	return out, nil
}

// GrepProjectFiles scans every file (optionally under a path prefix) with a
// RE2 regex and returns "path:line: text" matches.
//
// ponytail: full scan of every file per call, O(project size) — fine for
// text workspaces capped at maxFilesPerProject × maxFileChars; upgrade path
// is an index or ripgrep over a real directory if projects ever grow.
func (s *Store) GrepProjectFiles(projectID, ownerID, pattern, pathPrefix string, caseInsensitive bool, maxResults int) ([]string, error) {
	if strings.TrimSpace(pattern) == "" {
		return nil, fmt.Errorf("%w: empty pattern", ErrInvalid)
	}
	if caseInsensitive {
		pattern = "(?i)" + pattern
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("%w: bad regex: %v", ErrInvalid, err)
	}
	files, err := s.ListProjectFiles(projectID, ownerID)
	if err != nil {
		return nil, err
	}
	if maxResults <= 0 || maxResults > 100 {
		maxResults = 50
	}
	var matches []string
	for _, f := range files {
		if pathPrefix != "" && !strings.HasPrefix(f.Path, pathPrefix) {
			continue
		}
		content, err := s.GetProjectFileContent(projectID, ownerID, f.Path)
		if err != nil {
			continue
		}
		for i, line := range strings.Split(content, "\n") {
			if !re.MatchString(line) {
				continue
			}
			text := line
			if len(text) > 200 {
				text = text[:200] + "…"
			}
			matches = append(matches, fmt.Sprintf("%s:%d: %s", f.Path, i+1, text))
			if len(matches) >= maxResults {
				return matches, nil
			}
		}
	}
	return matches, nil
}
