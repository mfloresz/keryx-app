package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

// Project workspace tools: the same six operations (and JSON schemas) as the
// eino ADK filesystem middleware, executed against the project's virtual
// directory in PocketBase. They are only offered to the model when the chat
// has a project attached; every operation is scoped to that project AND its
// owner, so the sandbox is exactly "the chat's project".

const projectToolSchemaPath = `{"type":"object","properties":{"path":{"type":"string","description":"File path relative to the project root (e.g. 'personajes/ana.md')"}},"required":["path"]}`

const lsToolInputSchema = `{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Optional path prefix to filter by (e.g. 'personajes')"
    }
  }
}`

const readFileToolInputSchema = `{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "File path relative to the project root"
    },
    "offset": {
      "type": "integer",
      "description": "1-based line number to start reading from (default 1)"
    },
    "limit": {
      "type": "integer",
      "description": "Number of lines to read (default 200, max 1000)"
    }
  },
  "required": ["path"]
}`

const writeFileToolInputSchema = `{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "File path relative to the project root; directories are implicit (e.g. 'outline.md', 'personajes/ana.md')"
    },
    "content": {
      "type": "string",
      "description": "Full text content to write; overwrites the file if it exists"
    }
  },
  "required": ["path", "content"]
}`

const editFileToolInputSchema = `{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "File path relative to the project root"
    },
    "old_string": {
      "type": "string",
      "description": "Exact text to replace; must be unique in the file unless replace_all is set"
    },
    "new_string": {
      "type": "string",
      "description": "Replacement text"
    },
    "replace_all": {
      "type": "boolean",
      "description": "Replace every occurrence instead of requiring a unique match"
    }
  },
  "required": ["path", "old_string", "new_string"]
}`

const globToolInputSchema = `{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Glob pattern relative to the project root, e.g. '**/*.md', 'personajes/*'"
    }
  },
  "required": ["pattern"]
}`

const grepToolInputSchema = `{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Regular expression to search for"
    },
    "path_prefix": {
      "type": "string",
      "description": "Optional path prefix to limit the search (e.g. 'personajes/')"
    },
    "case_insensitive": {
      "type": "boolean",
      "description": "Ignore case when matching (default false)"
    }
  },
  "required": ["pattern"]
}`

// buildProjectToolDefinitions returns the workspace tool set for a chat with
// an attached project.
func buildProjectToolDefinitions() []ai.ToolDefinition {
	return []ai.ToolDefinition{
		{
			Name:        "ls",
			Description: "List the files in the project workspace, optionally filtered by a path prefix. Always call this first when you need to discover what exists.",
			InputSchema: lsToolInputSchema,
		},
		{
			Name:        "read_file",
			Description: "Read a text file from the project workspace, with optional line-based pagination for large files.",
			InputSchema: readFileToolInputSchema,
		},
		{
			Name:        "write_file",
			Description: "Create or overwrite a text file in the project workspace. Directories are implicit in the path.",
			InputSchema: writeFileToolInputSchema,
		},
		{
			Name:        "edit_file",
			Description: "Replace an exact string inside a workspace file. The old_string must match exactly and be unique unless replace_all is set; include enough surrounding context to make it unique.",
			InputSchema: editFileToolInputSchema,
		},
		{
			Name:        "glob",
			Description: "Find workspace files by glob pattern ('**', '*', '?', '[abc]').",
			InputSchema: globToolInputSchema,
		},
		{
			Name:        "grep",
			Description: "Search all workspace files with a regular expression and get file:line matches.",
			InputSchema: grepToolInputSchema,
		},
	}
}

// projectToolExec dispatches a tool call against the chat's project.
// Expected failures (missing file, no unique match, bad regex) come back as
// tool output so the model can correct course; only unexpected errors
// propagate as tool failures.
func projectToolExec(s *Server, projectID, userID string) ai.ToolExecFunc {
	return func(ctx context.Context, toolName string, input json.RawMessage) (string, error) {
		switch toolName {
		case "ls":
			var p struct {
				Path string `json:"path"`
			}
			if err := json.Unmarshal(input, &p); err != nil {
				return "", fmt.Errorf("invalid ls params: %w", err)
			}
			files, err := s.Store.ListProjectFiles(projectID, userID)
			if err != nil {
				return "", err
			}
			var out []string
			for _, f := range files {
				if p.Path != "" && !strings.HasPrefix(f.Path, strings.TrimSuffix(p.Path, "/")+"/") && f.Path != p.Path {
					continue
				}
				out = append(out, fmt.Sprintf("%s (%d bytes)", f.Path, f.Size))
			}
			if len(out) == 0 {
				return "The workspace has no files yet. Use write_file to create one.", nil
			}
			return fmt.Sprintf("Workspace files:\n%s", strings.Join(out, "\n")), nil

		case "read_file":
			var p struct {
				Path   string `json:"path"`
				Offset int    `json:"offset"`
				Limit  int    `json:"limit"`
			}
			if err := json.Unmarshal(input, &p); err != nil {
				return "", fmt.Errorf("invalid read_file params: %w", err)
			}
			text, total, start, err := s.Store.ReadProjectFileLines(projectID, userID, p.Path, p.Offset, p.Limit)
			if err == store.ErrNotFound {
				return fmt.Sprintf("File not found: %s. Use ls to see the workspace files.", p.Path), nil
			}
			if err != nil {
				return "", err
			}
			if text == "" && total == 0 {
				return fmt.Sprintf("%s is empty.", p.Path), nil
			}
			if total > start+len(strings.Split(text, "\n"))-1 {
				return fmt.Sprintf("%s (lines %d–%d of %d; use offset to continue):\n%s", p.Path, start, start+len(strings.Split(text, "\n"))-1, total, text), nil
			}
			return fmt.Sprintf("%s (lines %d–%d of %d):\n%s", p.Path, start, start+len(strings.Split(text, "\n"))-1, total, text), nil

		case "write_file":
			var p struct {
				Path    string `json:"path"`
				Content string `json:"content"`
			}
			if err := json.Unmarshal(input, &p); err != nil {
				return "", fmt.Errorf("invalid write_file params: %w", err)
			}
			file, err := s.Store.WriteProjectFile(projectID, userID, p.Path, p.Content)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("Wrote %s (%d bytes).", file.Path, file.Size), nil

		case "edit_file":
			var p struct {
				Path        string `json:"path"`
				OldString   string `json:"old_string"`
				NewString   string `json:"new_string"`
				ReplaceAll  bool   `json:"replace_all"`
			}
			if err := json.Unmarshal(input, &p); err != nil {
				return "", fmt.Errorf("invalid edit_file params: %w", err)
			}
			count, err := s.Store.EditProjectFile(projectID, userID, p.Path, p.OldString, p.NewString, p.ReplaceAll)
			if err == store.ErrNotFound {
				return fmt.Sprintf("File not found: %s. Use ls to see the workspace files.", p.Path), nil
			}
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("Edited %s: %d occurrence(s) replaced.", p.Path, count), nil

		case "glob":
			var p struct {
				Pattern string `json:"pattern"`
			}
			if err := json.Unmarshal(input, &p); err != nil {
				return "", fmt.Errorf("invalid glob params: %w", err)
			}
			paths, err := s.Store.GlobProjectFiles(projectID, userID, p.Pattern)
			if err != nil {
				return "", err
			}
			if len(paths) == 0 {
				return fmt.Sprintf("No files match %s.", p.Pattern), nil
			}
			return strings.Join(paths, "\n"), nil

		case "grep":
			var p struct {
				Pattern        string `json:"pattern"`
				PathPrefix     string `json:"path_prefix"`
				CaseInsensitive bool  `json:"case_insensitive"`
			}
			if err := json.Unmarshal(input, &p); err != nil {
				return "", fmt.Errorf("invalid grep params: %w", err)
			}
			matches, err := s.Store.GrepProjectFiles(projectID, userID, p.Pattern, p.PathPrefix, p.CaseInsensitive, 50)
			if err != nil {
				return "", err
			}
			if len(matches) == 0 {
				return "No matches found.", nil
			}
			return strings.Join(matches, "\n"), nil

		default:
			return "", fmt.Errorf("unknown tool: %s", toolName)
		}
	}
}

// buildProjectWorkspacePrompt returns the system prompt section describing
// the project workspace: what it is, the rules, and the current files.
func buildProjectWorkspacePrompt(project *store.Project, files []store.ProjectFile) string {
	var b strings.Builder
	b.WriteString("\n\n---\n\n### Project Workspace\n\n")
	b.WriteString(fmt.Sprintf("You are working inside the project %q", project.Name))
	if project.Description != "" {
		b.WriteString(fmt.Sprintf(" — %s", project.Description))
	}
	b.WriteString(`. You have file tools (ls, read_file, write_file, edit_file, glob, grep) that operate exclusively inside this workspace.

Rules:
- Paths are relative to the project root and always use forward slashes (e.g. "outline.md", "personajes/ana.md").
- The workspace persists across messages in this conversation: read before rewriting, and use edit_file for targeted changes instead of rewriting whole files.
- Create an organized structure when starting from scratch (folders via path prefixes, a top-level outline, one file per topic/character).
- When you create or modify files, mention them by path in your answer.`)

	if len(files) > 0 {
		b.WriteString("\n\nCurrent files:\n")
		for _, f := range files {
			b.WriteString(fmt.Sprintf("- %s (%d bytes)\n", f.Path, f.Size))
		}
	} else {
		b.WriteString("\n\nThe workspace is currently empty.")
	}
	return b.String()
}
