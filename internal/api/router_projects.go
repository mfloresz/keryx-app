package api

import (
	"net/http"

	"keryx-server/internal/store"
)

// ---- Project endpoints ----

// handleListProjects returns the authenticated user's projects with
// workspace stats (file count, total size).
func (s *Server) handleListProjects(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	projects, err := s.Store.ListProjectsWithStats(userID)
	if err != nil {
		internalError(w, r, "Failed to list projects", err)
		return
	}
	if projects == nil {
		projects = []store.ProjectSummary{}
	}
	jsonResponse(w, projects, http.StatusOK)
}

func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	project, err := s.Store.CreateProject(&store.Project{Name: req.Name, Description: req.Description}, userID)
	if err == store.ErrInvalid {
		errorResponse(w, "Invalid project name or description", http.StatusBadRequest)
		return
	}
	if err == store.ErrLimitReached {
		errorResponse(w, "Project limit reached", http.StatusBadRequest)
		return
	}
	if err != nil {
		internalError(w, r, "Failed to create project", err)
		return
	}
	jsonResponse(w, project, http.StatusCreated)
}

func (s *Server) handleUpdateProject(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	project, err := s.Store.UpdateProject(id, userID, req.Name, req.Description)
	if err == store.ErrNotFound {
		errorResponse(w, "Project not found", http.StatusNotFound)
		return
	}
	if err == store.ErrInvalid {
		errorResponse(w, "Invalid project name or description", http.StatusBadRequest)
		return
	}
	if err != nil {
		internalError(w, r, "Failed to update project", err)
		return
	}
	jsonResponse(w, project, http.StatusOK)
}

func (s *Server) handleDeleteProject(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	if err := s.Store.DeleteProject(id, userID); err != nil {
		if err == store.ErrNotFound {
			errorResponse(w, "Project not found", http.StatusNotFound)
			return
		}
		internalError(w, r, "Failed to delete project", err)
		return
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// ---- Project file endpoints ----

func (s *Server) handleListProjectFiles(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	if _, err := s.Store.GetProjectForOwner(id, userID); err != nil {
		errorResponse(w, "Project not found", http.StatusNotFound)
		return
	}
	files, err := s.Store.ListProjectFiles(id, userID)
	if err != nil {
		internalError(w, r, "Failed to list project files", err)
		return
	}
	if files == nil {
		files = []store.ProjectFile{}
	}
	jsonResponse(w, files, http.StatusOK)
}

func (s *Server) handleGetProjectFile(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	path := r.URL.Query().Get("path")
	if path == "" {
		errorResponse(w, "Missing path", http.StatusBadRequest)
		return
	}
	if _, err := s.Store.GetProjectForOwner(id, userID); err != nil {
		errorResponse(w, "Project not found", http.StatusNotFound)
		return
	}
	content, err := s.Store.GetProjectFileContent(id, userID, path)
	if err == store.ErrNotFound {
		errorResponse(w, "File not found", http.StatusNotFound)
		return
	}
	if err != nil {
		internalError(w, r, "Failed to read project file", err)
		return
	}
	jsonResponse(w, map[string]any{"path": path, "content": content}, http.StatusOK)
}

func (s *Server) handlePutProjectFile(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if _, err := s.Store.GetProjectForOwner(id, userID); err != nil {
		errorResponse(w, "Project not found", http.StatusNotFound)
		return
	}
	file, err := s.Store.WriteProjectFile(id, userID, req.Path, req.Content)
	if err == store.ErrInvalid {
		errorResponse(w, "Invalid path or content", http.StatusBadRequest)
		return
	}
	if err == store.ErrLimitReached {
		errorResponse(w, "File or project limit reached", http.StatusBadRequest)
		return
	}
	if err != nil {
		internalError(w, r, "Failed to write project file", err)
		return
	}
	jsonResponse(w, file, http.StatusOK)
}

func (s *Server) handleDeleteProjectFile(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	id := r.PathValue("id")
	path := r.URL.Query().Get("path")
	if path == "" {
		errorResponse(w, "Missing path", http.StatusBadRequest)
		return
	}
	if err := s.Store.DeleteProjectFile(id, userID, path); err != nil {
		if err == store.ErrNotFound {
			errorResponse(w, "File not found", http.StatusNotFound)
			return
		}
		internalError(w, r, "Failed to delete project file", err)
		return
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}
