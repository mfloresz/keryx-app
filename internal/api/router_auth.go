package api

import (
	"net/http"
	"strings"

	"keryx-server/internal/store"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)

	if req.Email == "" || req.Password == "" {
		errorResponse(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	result, err := s.Store.AuthenticateUser(req.Email, req.Password)
	if err != nil {
		errorResponse(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	jsonResponse(w, result, http.StatusOK)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.Password = strings.TrimSpace(req.Password)
	req.Name = strings.TrimSpace(req.Name)

	if req.Email == "" || req.Password == "" {
		errorResponse(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		errorResponse(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	// Check if user already exists
	if _, err := s.Store.GetUserByEmail(req.Email); err == nil {
		errorResponse(w, "A user with this email already exists", http.StatusConflict)
		return
	}

	result, err := s.Store.CreateUser(req.Email, req.Password, req.Name)
	if err != nil {
		errorResponse(w, "Failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// First registered user becomes admin automatically
	userCount, err := s.Store.CountUsers()
	if err == nil && userCount == 1 {
		if err := s.Store.UpdateUserRole(result.User.ID, store.RoleAdmin); err == nil {
			result.User.Role = store.RoleAdmin
			// Refresh token to include updated role
			fresh, err := s.Store.RefreshAuth(result.Token)
			if err == nil {
				result = fresh
			}
		}
	}

	jsonResponse(w, result, http.StatusCreated)
}

func (s *Server) handleAuthMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromContext(r)
	if !ok {
		errorResponse(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	user, err := s.Store.GetUserByID(userID)
	if err != nil {
		errorResponse(w, "User not found", http.StatusNotFound)
		return
	}

	jsonResponse(w, user, http.StatusOK)
}

func (s *Server) handleInvitationValidate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Token == "" {
		errorResponse(w, "Missing token", http.StatusBadRequest)
		return
	}

	tokenHash := sha256Hex(req.Token)
	invitation, err := s.Store.GetInvitationByTokenHash(tokenHash)
	if err != nil {
		jsonResponse(w, map[string]bool{"valid": false}, http.StatusOK)
		return
	}

	if invitation.UsedAt != nil {
		jsonResponse(w, map[string]bool{"valid": false}, http.StatusOK)
		return
	}

	jsonResponse(w, map[string]any{
		"valid":     true,
		"email":     invitation.Email,
		"role":      invitation.Role,
		"expiresAt": invitation.ExpiresAt,
		"modelIds":  invitation.InitialModelAccess,
	}, http.StatusOK)
}

func (s *Server) handleInvitationAccept(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Token = strings.TrimSpace(req.Token)
	req.Password = strings.TrimSpace(req.Password)

	if req.Token == "" || req.Password == "" {
		errorResponse(w, "Missing invitation token or password", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		errorResponse(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	tokenHash := sha256Hex(req.Token)
	invitation, err := s.Store.GetInvitationByTokenHash(tokenHash)
	if err != nil {
		errorResponse(w, "Invitation is invalid or expired", http.StatusBadRequest)
		return
	}

	if invitation.UsedAt != nil {
		errorResponse(w, "Invitation has already been used", http.StatusBadRequest)
		return
	}

	if _, err := s.Store.GetUserByEmail(invitation.Email); err == nil {
		errorResponse(w, "A user with this email already exists", http.StatusConflict)
		return
	}

	result, err := s.Store.CreateUser(invitation.Email, req.Password, "")
	if err != nil {
		errorResponse(w, "Failed to create user: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Set initial model access if configured
	if len(invitation.InitialModelAccess) > 0 {
		_ = s.Store.SetUserModelAccess(result.User.ID, invitation.InitialModelAccess)
	}

	// Mark invitation as used
	_ = s.Store.MarkInvitationUsed(invitation.ID, strings.Replace(invitation.CreatedAt, "Z", "", 1))

	jsonResponse(w, map[string]any{
		"success": true,
		"email":   invitation.Email,
	}, http.StatusOK)
}


