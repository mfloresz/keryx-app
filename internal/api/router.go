package api

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"keryx-server/internal/ai"
	"keryx-server/internal/config"
	"keryx-server/internal/store"
)

type contextKey string

const (
	contextKeyUserID   contextKey = "userID"
	contextKeyUserRole contextKey = "userRole"
)

type Server struct {
	Store       *store.Store
	Cfg         *config.Config
	AIProviders map[string]ai.Provider
}

func New(st *store.Store, cfg *config.Config) *Server {
	return &Server{
		Store:       st,
		Cfg:         cfg,
		AIProviders: make(map[string]ai.Provider),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]bool{"ok": true}, http.StatusOK)
	})

	// Public auth routes
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("GET /api/auth/me", s.withAuth(s.handleAuthMe))

	// Invitation routes (some public, some admin)
	mux.HandleFunc("POST /api/invitations/validate", s.handleInvitationValidate)
	mux.HandleFunc("POST /api/invitations/accept", s.handleInvitationAccept)

	// Protected chat routes
	mux.HandleFunc("GET /api/chats", s.withAuth(s.handleListChats))
	mux.HandleFunc("POST /api/chats", s.withAuth(s.handleSaveChat))
	mux.HandleFunc("DELETE /api/chats", s.withAuth(s.handleDeleteAllChats))
	mux.HandleFunc("GET /api/favorites", s.withAuth(s.handleListFavorites))

	// Chat detail routes
	mux.HandleFunc("GET /api/chats/{id}", s.withAuth(s.handleGetChat))
	mux.HandleFunc("DELETE /api/chats/{id}", s.withAuth(s.handleDeleteChat))
	mux.HandleFunc("PATCH /api/chats/{id}/title", s.withAuth(s.handleUpdateChatTitle))
	mux.HandleFunc("PATCH /api/chats/{id}/visibility", s.withAuth(s.handleUpdateChatVisibility))
	mux.HandleFunc("DELETE /api/chats/{id}/messages", s.withAuth(s.handleDeleteMessages))
	mux.HandleFunc("POST /api/chats/{id}/branches", s.withAuth(s.handleSwitchBranch))
	mux.HandleFunc("GET /api/chats/{id}/votes", s.withAuth(s.handleGetVotes))
	mux.HandleFunc("POST /api/chats/{id}/votes", s.withAuth(s.handleSaveVote))
	mux.HandleFunc("POST /api/chats/{id}/stream", s.withAuth(s.handleChatStream))

	// Model routes
	mux.HandleFunc("GET /api/models/allowed", s.withAuth(s.handleAllowedModels))

	// Admin routes
	mux.HandleFunc("GET /api/admin/users", s.withAdminAuth(s.handleAdminListUsers))
	mux.HandleFunc("PATCH /api/admin/users/{id}", s.withAdminAuth(s.handleAdminUpdateUserRole))
	mux.HandleFunc("GET /api/admin/models", s.withAdminAuth(s.handleAdminListModels))
	mux.HandleFunc("PATCH /api/admin/models/{id}", s.withAdminAuth(s.handleAdminUpdateModel))
	mux.HandleFunc("GET /api/admin/models/catalog", s.withAdminAuth(s.handleAdminModelCatalog))
	mux.HandleFunc("GET /api/admin/invitations", s.withAdminAuth(s.handleAdminListInvitations))
	mux.HandleFunc("POST /api/admin/invitations", s.withAdminAuth(s.handleAdminCreateInvitation))
	mux.HandleFunc("DELETE /api/admin/invitations/{id}", s.withAdminAuth(s.handleAdminDeleteInvitation))

	// SPA static files (catch-all)
	mux.HandleFunc("/", StaticHandler(s.Cfg.StaticDir))

	return withCORS(mux)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) withAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := getBearerToken(r)
		if token == "" {
			errorResponse(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		record, err := s.Store.FindAuthRecord(token)
		if err != nil || record == nil {
			errorResponse(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		ctx := context.WithValue(r.Context(), contextKeyUserID, record.Id)
		ctx = context.WithValue(ctx, contextKeyUserRole, record.GetString("role"))
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) withAdminAuth(next http.HandlerFunc) http.HandlerFunc {
	return s.withAuth(func(w http.ResponseWriter, r *http.Request) {
		role, _ := r.Context().Value(contextKeyUserRole).(string)
		if role != store.RoleAdmin {
			errorResponse(w, "Forbidden", http.StatusForbidden)
			return
		}
		next(w, r)
	})
}

func userIDFromContext(r *http.Request) (string, bool) {
	id, ok := r.Context().Value(contextKeyUserID).(string)
	return id, ok
}

func userRoleFromContext(r *http.Request) (string, bool) {
	role, ok := r.Context().Value(contextKeyUserRole).(string)
	return role, ok
}

// getProviderForModel returns the appropriate AI provider and upstream model
// ID for a public model ID, resolving against the static catalog in the ai
// package (same pattern as Yara's newAIProvider).
//
// Known provider prefixes resolve directly (e.g. "opencode/mimo-v2.5" sends
// "mimo-v2.5" to the OpenCode GO API). Any other ID is routed through the
// gateway provider, passing the full ID upstream (e.g. "openai/gpt-5.4-nano").
func (s *Server) getProviderForModel(modelID string) (ai.Provider, string, error) {
	info, upstreamModel, err := ai.ResolveModel(modelID)
	if err != nil {
		return nil, "", err
	}

	if p, ok := s.AIProviders[info.ID]; ok {
		return p, upstreamModel, nil
	}

	apiKey, err := s.apiKeyForProvider(info.ID)
	if err != nil {
		return nil, "", err
	}

	p := &ai.OpenAIProvider{
		APIKey:  apiKey,
		BaseURL: info.BaseURL,
		Timeout: 120 * time.Second,
	}
	s.AIProviders[info.ID] = p
	return p, upstreamModel, nil
}

// apiKeyForProvider maps a catalog provider ID to its configured API key.
func (s *Server) apiKeyForProvider(providerID string) (string, error) {
	switch providerID {
	case "vercel-ai-gateway":
		if s.Cfg.AIGatewayAPIKey == "" {
			return "", fmt.Errorf("AI Gateway API key not configured")
		}
		return s.Cfg.AIGatewayAPIKey, nil
	case "opencode":
		if s.Cfg.OpenCodeAPIKey == "" {
			return "", fmt.Errorf("OpenCode GO API key not configured")
		}
		return s.Cfg.OpenCodeAPIKey, nil
	default:
		return "", fmt.Errorf("unknown provider: %s", providerID)
	}
}
