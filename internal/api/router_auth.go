package api

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/tools/filesystem"

	"keryx-server/internal/store"
)

// invitationExpired reports whether an invitation is past its expiry. Empty
// or unparseable expiry values are treated as non-expiring (sentinel dates
// like 9999-12-31 parse fine and simply never expire).
func invitationExpired(inv *store.InvitationRecord) bool {
	if inv == nil || inv.ExpiresAt == "" {
		return false
	}
	sx, err := time.Parse(time.RFC3339, inv.ExpiresAt)
	if err != nil {
		return false
	}
	return time.Now().After(sx)
}

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

	setAuthCookie(w, r, result.Token)
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

	// Registration is invite-only. Only the very first user (bootstrap admin)
	// may register without an invitation; after that, use /api/invitations/accept.
	userCount, err := s.Store.CountUsers()
	if err != nil {
		errorResponse(w, "Failed to check users", http.StatusInternalServerError)
		return
	}
	if userCount > 0 {
		errorResponse(w, "Registration requires an invitation link", http.StatusForbidden)
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

	// This user is the first one (bootstrap admin).
	if err := s.Store.UpdateUserRole(result.User.ID, store.RoleAdmin); err == nil {
		result.User.Role = store.RoleAdmin
		// Refresh token to include updated role
		fresh, err := s.Store.RefreshAuth(result.Token)
		if err == nil {
			result = fresh
		}
	}

	setAuthCookie(w, r, result.Token)
	jsonResponse(w, result, http.StatusCreated)
}

// handleLogout clears the session cookie. The token itself remains valid
// until its natural expiry; the cookie is what the browser holds.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	clearAuthCookie(w, r)
	jsonResponse(w, map[string]bool{"ok": true}, http.StatusOK)
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

func (s *Server) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromContext(r)
	if !ok {
		errorResponse(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		// Multipart form: may include name and/or avatar
		if err := r.ParseMultipartForm(5 << 20); err != nil {
			errorResponse(w, "Invalid form data", http.StatusBadRequest)
			return
		}

		var user *store.User

		// Update name if provided
		if name := strings.TrimSpace(r.FormValue("name")); name != "" {
			u, err := s.Store.UpdateUserName(userID, name)
			if err != nil {
				errorResponse(w, "Failed to update name", http.StatusInternalServerError)
				return
			}
			user = u
		}

		// Update avatar if provided
		file, fh, err := r.FormFile("avatar")
		if err == nil {
			defer file.Close()
			data, err := io.ReadAll(io.LimitReader(file, 5<<20))
			if err != nil {
				errorResponse(w, "Failed to read avatar", http.StatusBadRequest)
				return
			}
			pbfile, err := filesystem.NewFileFromBytes(data, fh.Filename)
			if err != nil {
				errorResponse(w, "Invalid file", http.StatusBadRequest)
				return
			}
			u, err := s.Store.UpdateUserAvatar(userID, pbfile)
			if err != nil {
				errorResponse(w, "Failed to update avatar", http.StatusInternalServerError)
				return
			}
			user = u
		} else if r.FormValue("removeAvatar") == "true" {
			u, err := s.Store.RemoveUserAvatar(userID)
			if err != nil {
				errorResponse(w, "Failed to remove avatar", http.StatusInternalServerError)
				return
			}
			user = u
		}

		// If no user was returned, fetch current
		if user == nil {
			u, err := s.Store.GetUserByID(userID)
			if err != nil {
				errorResponse(w, "User not found", http.StatusNotFound)
				return
			}
			user = u
		}

		jsonResponse(w, user, http.StatusOK)
		return
	}

	// JSON fallback: only name update
	var req struct {
		Name string `json:"name,omitempty"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		errorResponse(w, "Name is required", http.StatusBadRequest)
		return
	}

	user, err := s.Store.UpdateUserName(userID, req.Name)
	if err != nil {
		errorResponse(w, "Failed to update profile", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, user, http.StatusOK)
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	userID, ok := userIDFromContext(r)
	if !ok {
		errorResponse(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.CurrentPassword = strings.TrimSpace(req.CurrentPassword)
	req.NewPassword = strings.TrimSpace(req.NewPassword)

	if req.CurrentPassword == "" || req.NewPassword == "" {
		errorResponse(w, "Current and new password are required", http.StatusBadRequest)
		return
	}

	if len(req.NewPassword) < 8 {
		errorResponse(w, "New password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	if err := s.Store.ChangePassword(userID, req.CurrentPassword, req.NewPassword); err != nil {
		if err == store.ErrForbidden {
			errorResponse(w, "Current password is incorrect", http.StatusForbidden)
			return
		}
		errorResponse(w, "Failed to change password", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleGetAvatar(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")
	if userID == "" {
		errorResponse(w, "User ID is required", http.StatusBadRequest)
		return
	}

	data, mediaType, err := s.Store.GetUserAvatarData(userID)
	if err != nil {
		// Return 204 No Content when no avatar is set
		w.WriteHeader(http.StatusNoContent)
		return
	}

	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
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

	if invitation.UsedAt != nil || invitationExpired(invitation) {
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

	// Serialize the check-then-use sequence so the same invitation can't be
	// consumed by two concurrent requests.
	s.invitationMu.Lock()
	defer s.invitationMu.Unlock()

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

	if invitationExpired(invitation) {
		errorResponse(w, "Invitation is invalid or expired", http.StatusBadRequest)
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

	// Set the role chosen at invitation time (defaults to member).
	if invitation.Role != "" {
		_ = s.Store.UpdateUserRole(result.User.ID, invitation.Role)
	}

	// Set initial model access if configured
	if len(invitation.InitialModelAccess) > 0 {
		_ = s.Store.SetUserModelAccess(result.User.ID, invitation.InitialModelAccess)
	}

	// Mark invitation as used (with the actual time, not the creation date).
	_ = s.Store.MarkInvitationUsed(invitation.ID, time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))

	jsonResponse(w, map[string]any{
		"success": true,
		"email":   invitation.Email,
	}, http.StatusOK)
}
