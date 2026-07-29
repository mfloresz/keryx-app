package api

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"keryx-server/internal/ai"
	"keryx-server/internal/store"
)

func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.Store.ListUsers()
	if err != nil {
		errorResponse(w, "Failed to list users", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, users, http.StatusOK)
}

func (s *Server) handleAdminUpdateUserRole(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("id")

	var req struct {
		Role string `json:"role"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Role != store.RoleAdmin && req.Role != store.RoleUser {
		errorResponse(w, "Invalid role", http.StatusBadRequest)
		return
	}

	user, err := s.Store.GetUserByID(userID)
	if err != nil {
		errorResponse(w, "User not found", http.StatusNotFound)
		return
	}

	// Prevent removing last admin
	if user.Role == store.RoleAdmin && req.Role == store.RoleUser {
		adminCount, err := s.Store.CountAdmins()
		if err != nil {
			errorResponse(w, "Failed to check admin count", http.StatusInternalServerError)
			return
		}
		if adminCount <= 1 {
			errorResponse(w, "At least one admin user is required", http.StatusBadRequest)
			return
		}
	}

	if err := s.Store.UpdateUserRole(userID, req.Role); err != nil {
		errorResponse(w, "Failed to update role", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleAdminListModels(w http.ResponseWriter, r *http.Request) {
	models, err := s.Store.ListModels()
	if err != nil {
		errorResponse(w, "Failed to list models", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, models, http.StatusOK)
}

func (s *Server) handleAdminUpdateModel(w http.ResponseWriter, r *http.Request) {
	modelID := r.PathValue("id")

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := s.Store.SetModelEnabled(modelID, req.Enabled); err != nil {
		errorResponse(w, "Model not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func (s *Server) handleAdminModelCatalog(w http.ResponseWriter, r *http.Request) {
	catalog := store.GetCatalogModels()
	jsonResponse(w, catalog, http.StatusOK)
}

func (s *Server) handleAdminListInvitations(w http.ResponseWriter, r *http.Request) {
	invitations, err := s.Store.ListInvitations()
	if err != nil {
		errorResponse(w, "Failed to list invitations", http.StatusInternalServerError)
		return
	}
	// Sanitize: remove token_hash from response
	type sanitizedInvitation struct {
		ID                 string   `json:"id"`
		Email              string   `json:"email"`
		Role               string   `json:"role"`
		ExpiresAt          string   `json:"expiresAt"`
		UsedAt             *string  `json:"usedAt"`
		CreatedBy          string   `json:"createdBy"`
		CreatedAt          string   `json:"createdAt"`
		InitialModelAccess []string `json:"initialModelAccess"`
	}
	sanitized := make([]sanitizedInvitation, 0, len(invitations))
	for _, inv := range invitations {
		sanitized = append(sanitized, sanitizedInvitation{
			ID:                 inv.ID,
			Email:              inv.Email,
			Role:               inv.Role,
			ExpiresAt:          inv.ExpiresAt,
			UsedAt:             inv.UsedAt,
			CreatedBy:          inv.CreatedBy,
			CreatedAt:          inv.CreatedAt,
			InitialModelAccess: inv.InitialModelAccess,
		})
	}
	jsonResponse(w, sanitized, http.StatusOK)
}

func (s *Server) handleAdminCreateInvitation(w http.ResponseWriter, r *http.Request) {
	adminID, _ := userIDFromContext(r)

	var req struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" {
		errorResponse(w, "Missing invitation email", http.StatusBadRequest)
		return
	}

	// Check if user already exists
	if _, err := s.Store.GetUserByEmail(email); err == nil {
		errorResponse(w, "A user with this email already exists", http.StatusConflict)
		return
	}

	role := req.Role
	if role != store.RoleAdmin && role != store.RoleUser {
		role = store.RoleUser
	}

	rawToken := uuid.New().String() + uuid.New().String()
	tokenHash := sha256Hex(rawToken)

	inv := &store.InvitationRecord{
		ID:        uuid.New().String(),
		Email:     email,
		TokenHash: tokenHash,
		Role:      role,
		ExpiresAt: "9999-12-31T23:59:59.999Z",
		CreatedBy: adminID,
	}

	if err := s.Store.CreateInvitation(inv); err != nil {
		errorResponse(w, "Failed to create invitation: "+err.Error(), http.StatusInternalServerError)
		return
	}

	baseURL := s.Cfg.AppBaseURL
	if baseURL == "" {
		baseURL = fmt.Sprintf("http://%s", r.Host)
	}

	jsonResponse(w, map[string]any{
		"invitation": map[string]any{
			"id":        inv.ID,
			"email":     inv.Email,
			"role":      inv.Role,
			"expiresAt": inv.ExpiresAt,
			"usedAt":    nil,
			"createdBy": inv.CreatedBy,
			"createdAt": inv.CreatedAt,
		},
		"invitationUrl": fmt.Sprintf("%s/invite/%s", baseURL, rawToken),
	}, http.StatusOK)
}

func (s *Server) handleAdminDeleteInvitation(w http.ResponseWriter, r *http.Request) {
	invitationID := r.PathValue("id")

	if err := s.Store.DeleteInvitation(invitationID); err != nil {
		errorResponse(w, "Invitation not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

// ---- Provider key admin handlers ----

// providerKeyEntry is returned by list/GET — the actual key is never exposed.
type providerKeyEntry struct {
	Provider    string  `json:"provider"`
	Label       string  `json:"label"`
	Configured  bool    `json:"configured"`
	UpdatedAt   *string `json:"updatedAt,omitempty"`
}

func knownProvidersWithLabel() []providerKeyEntry {
	providers := ai.Providers()
	out := make([]providerKeyEntry, 0, len(providers))
	for _, p := range providers {
		out = append(out, providerKeyEntry{
			Provider: p.ID,
			Label:    p.Name,
		})
	}
	return out
}

func (s *Server) handleAdminListProviderKeys(w http.ResponseWriter, r *http.Request) {
	// Build the full list of known providers, overlaying DB-configured state.
	all := knownProvidersWithLabel()
	byProvider := make(map[string]int, len(all))
	for i, entry := range all {
		byProvider[entry.Provider] = i
	}

	stored, err := s.Store.ListProviderKeys()
	if err != nil {
		errorResponse(w, "Failed to list provider keys", http.StatusInternalServerError)
		return
	}
	for _, k := range stored {
		if idx, ok := byProvider[k.Provider]; ok {
			all[idx].Configured = k.Configured
			if k.UpdatedAt != "" {
				t := k.UpdatedAt
				all[idx].UpdatedAt = &t
			}
		}
	}

	jsonResponse(w, all, http.StatusOK)
}

func (s *Server) handleAdminUpsertProviderKey(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	if provider == "" {
		errorResponse(w, "Missing provider", http.StatusBadRequest)
		return
	}

	var req struct {
		APIKey string `json:"apiKey"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.APIKey) == "" {
		errorResponse(w, "API key cannot be empty", http.StatusBadRequest)
		return
	}

	info, err := s.Store.UpsertProviderAPIKey(provider, req.APIKey)
	if err != nil {
		errorResponse(w, "Failed to save API key: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, info, http.StatusOK)
}

func (s *Server) handleAdminDeleteProviderKey(w http.ResponseWriter, r *http.Request) {
	provider := r.PathValue("provider")
	if provider == "" {
		errorResponse(w, "Missing provider", http.StatusBadRequest)
		return
	}

	if err := s.Store.DeleteProviderAPIKey(provider); err != nil {
		errorResponse(w, "Failed to delete API key", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]bool{"success": true}, http.StatusOK)
}

func sha256Hex(input string) string {
	h := sha256.Sum256([]byte(input))
	return fmt.Sprintf("%x", h)
}

// ---- Title generation policy admin handlers ----

func (s *Server) handleAdminGetTitleGenerationPolicy(w http.ResponseWriter, r *http.Request) {
	policy, err := s.Store.GetTitleGenerationPolicy()
	if err != nil {
		errorResponse(w, "Failed to load title generation policy", http.StatusInternalServerError)
		return
	}
	// Include the model catalog so the admin UI can populate the model selector.
	catalog := store.GetCatalogModels()
	jsonResponse(w, map[string]any{
		"policy":  policy,
		"catalog": catalog,
	}, http.StatusOK)
}

func (s *Server) handleAdminSetTitleGenerationPolicy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode    string `json:"mode"`
		ModelID string `json:"modelId"`
	}
	if err := readJSONBody(r, &req); err != nil {
		errorResponse(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Mode != string(store.TitleModeChatModel) && req.Mode != string(store.TitleModeCustom) {
		errorResponse(w, "Invalid mode: must be 'chat_model' or 'custom'", http.StatusBadRequest)
		return
	}

	if req.Mode == string(store.TitleModeCustom) && req.ModelID == "" {
		errorResponse(w, "Model ID is required when mode is 'custom'", http.StatusBadRequest)
		return
	}

	policy, err := s.Store.SetTitleGenerationPolicy(&store.TitleGenerationPolicy{
		Mode:    store.TitleGenerationMode(req.Mode),
		ModelID: req.ModelID,
	})
	if err != nil {
		errorResponse(w, "Failed to save title generation policy: "+err.Error(), http.StatusInternalServerError)
		return
	}

	jsonResponse(w, policy, http.StatusOK)
}
