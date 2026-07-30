package api

import (
	"context"
	"fmt"
	"net/http"
	"sync"
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

	// chatLocks serializes read-modify-write cycles per chat so concurrent
	// handlers (stream persist, votes, message edits) can't clobber each
	// other's changes.
	chatLocks sync.Map

	// invitationMu serializes invitation acceptance so two concurrent requests
	// can't consume the same invitation (check-then-use race).
	invitationMu sync.Mutex

	// bootstrapMu serializes first-user registration so two concurrent requests
	// can't both observe an empty users table and both become admin.
	bootstrapMu sync.Mutex

	// Rate limiters for public/sensitive endpoints. Behind a tunnel the real
	// client IP comes from proxy headers (see clientIP).
	loginLimiter      *rateLimiter
	invitationLimiter *rateLimiter
	streamLimiter     *rateLimiter
	accountLimiter    *rateLimiter
	adminLimiter      *rateLimiter
}

func New(st *store.Store, cfg *config.Config) *Server {
	return &Server{
		Store:             st,
		Cfg:               cfg,
		AIProviders:       make(map[string]ai.Provider),
		loginLimiter:      newRateLimiter(5),  // 5 login attempts/min per IP
		invitationLimiter: newRateLimiter(10), // 10 invitation ops/min per IP
		streamLimiter:     newRateLimiter(10), // 10 stream starts/min per user
		accountLimiter:    newRateLimiter(10), // 10 account changes/min per user
		adminLimiter:      newRateLimiter(30), // 30 admin ops/min per user
	}
}

// lockChat locks the per-chat mutex and returns the unlock function.
func (s *Server) lockChat(chatID string) func() {
	v, _ := s.chatLocks.LoadOrStore(chatID, &sync.Mutex{})
	m := v.(*sync.Mutex)
	m.Lock()
	return m.Unlock
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, map[string]bool{"ok": true}, http.StatusOK)
	})

	// Public auth routes
	mux.HandleFunc("POST /api/auth/login", s.withRateLimit(s.loginLimiter, clientIP, s.handleLogin))
	mux.HandleFunc("GET /api/auth/setup-status", s.withRateLimit(s.loginLimiter, clientIP, s.handleSetupStatus))
	mux.HandleFunc("POST /api/auth/register", s.withRateLimit(s.invitationLimiter, clientIP, s.handleRegister))
	mux.HandleFunc("GET /api/auth/me", s.withAuth(s.handleAuthMe))
	mux.HandleFunc("POST /api/auth/logout", s.withRateLimit(s.accountLimiter, clientIP, s.handleLogout))
	mux.HandleFunc("PATCH /api/auth/profile", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleUpdateProfile)))
	mux.HandleFunc("POST /api/auth/password", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleChangePassword)))
	mux.HandleFunc("GET /api/auth/avatar/{id}", s.handleGetAvatar)

	// Invitation routes (some public, some admin)
	mux.HandleFunc("POST /api/invitations/validate", s.withRateLimit(s.invitationLimiter, clientIP, s.handleInvitationValidate))
	mux.HandleFunc("POST /api/invitations/accept", s.withRateLimit(s.invitationLimiter, clientIP, s.handleInvitationAccept))

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
	mux.HandleFunc("POST /api/chats/{id}/stream", s.withAuth(s.withRateLimit(s.streamLimiter, userKey, s.handleChatStream)))
	mux.HandleFunc("POST /api/chats/{id}/attachments", s.withAuth(s.handleUploadAttachments))
	mux.HandleFunc("GET /api/attachments/{id}", s.withAuth(s.handleGetAttachment))

	// Model routes
	mux.HandleFunc("GET /api/models/allowed", s.withAuth(s.handleAllowedModels))

	// Admin routes
	mux.HandleFunc("GET /api/admin/users", s.adminRoute(s.handleAdminListUsers))
	mux.HandleFunc("PATCH /api/admin/users/{id}", s.adminRoute(s.handleAdminUpdateUserRole))
	mux.HandleFunc("GET /api/admin/models", s.adminRoute(s.handleAdminListModels))
	mux.HandleFunc("PATCH /api/admin/models/{id}", s.adminRoute(s.handleAdminUpdateModel))
	mux.HandleFunc("GET /api/admin/models/catalog", s.adminRoute(s.handleAdminModelCatalog))
	mux.HandleFunc("GET /api/admin/invitations", s.adminRoute(s.handleAdminListInvitations))
	mux.HandleFunc("POST /api/admin/invitations", s.adminRoute(s.handleAdminCreateInvitation))
	mux.HandleFunc("DELETE /api/admin/invitations/{id}", s.adminRoute(s.handleAdminDeleteInvitation))

	// Admin provider key routes
	mux.HandleFunc("GET /api/admin/provider-keys", s.adminRoute(s.handleAdminListProviderKeys))
	mux.HandleFunc("PUT /api/admin/provider-keys/{provider}", s.adminRoute(s.handleAdminUpsertProviderKey))
	mux.HandleFunc("DELETE /api/admin/provider-keys/{provider}", s.adminRoute(s.handleAdminDeleteProviderKey))

	// Admin title generation policy routes
	mux.HandleFunc("GET /api/admin/title-generation-policy", s.adminRoute(s.handleAdminGetTitleGenerationPolicy))
	mux.HandleFunc("PUT /api/admin/title-generation-policy", s.adminRoute(s.handleAdminSetTitleGenerationPolicy))

	// SPA static files (catch-all)
	mux.HandleFunc("/", StaticHandler(s.Cfg.StaticDir))

	return withCORS(withSecurityHeaders(mux))
}

// adminRoute composes admin-only routes: auth + role check first (so the
// user ID is in context), then per-user rate limiting.
func (s *Server) adminRoute(next http.HandlerFunc) http.HandlerFunc {
	return s.withAdminAuth(s.withRateLimit(s.adminLimiter, userKey, next))
}

// withSecurityHeaders sets baseline security headers on every response so
// non-Vercel deployments (Docker, self-hosted) are protected too. HSTS is
// only sent over HTTPS so local HTTP development keeps working.
func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' blob: data: attachment: https://models.dev; font-src 'self' data:; "+
				"media-src 'self' blob: data: attachment:; "+
				"connect-src 'self' https://ai-gateway.vercel.sh https://*.supabase.co ws: wss: blob: data:; "+
				"worker-src 'self' blob:; object-src 'none'; "+
				"base-uri 'self'; frame-ancestors 'none'; form-action 'self'; manifest-src 'self'")
		if isSecureRequest(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
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


// userKey keys rate limiters by authenticated user ID, falling back to IP.
func userKey(r *http.Request) string {
	if id, ok := userIDFromContext(r); ok && id != "" {
		return "user:" + id
	}
	return "ip:" + clientIP(r)
}

// getProviderForModel returns the appropriate AI provider and upstream model
// ID for a public model ID, resolving against the static catalog in the ai
// package.
//
// Known provider prefixes resolve directly (e.g. "venice/e2ee-deepseek-v4-flash"
// sends "e2ee-deepseek-v4-flash" to the Venice API, "google/gemma-4-31b-it"
// sends "gemma-4-31b-it" to the Google API).
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

	var p ai.Provider
	if info.ID == "google" {
		p = &ai.GoogleProvider{
			APIKey:  apiKey,
			Model:   upstreamModel,
			Timeout: 120 * time.Second,
		}
	} else {
		p = &ai.OpenAIProvider{
			APIKey:      apiKey,
			BaseURL:     info.BaseURL,
			Model:       upstreamModel,
			Timeout:     120 * time.Second,
			GoAIOptions: info.GoAIOptions,
		}
	}
	s.AIProviders[info.ID] = p
	return p, upstreamModel, nil
}

// apiKeyForProvider returns the API key for a provider.
// It first checks the encrypted store (set by admin via UI), then falls back
// to the environment variable configured at startup.
func (s *Server) apiKeyForProvider(providerID string) (string, error) {
	// 1. Try the encrypted DB store first (admin-configured keys).
	if dbKey, err := s.Store.GetDecryptedAPIKey(providerID); err != nil {
		return "", fmt.Errorf("read stored key for %s: %w", providerID, err)
	} else if dbKey != "" {
		return dbKey, nil
	}

	// 2. Fall back to env vars.
	switch providerID {
	case "venice":
		if s.Cfg.VeniceAPIKey == "" {
			return "", fmt.Errorf("Venice API key not configured (set VENICE_API_KEY or configure via admin UI)")
		}
		return s.Cfg.VeniceAPIKey, nil
	case "opencode-go":
		if s.Cfg.OpenCodeGoAPIKey == "" {
			return "", fmt.Errorf("OpenCode Go API key not configured (set OPENCODEGO_API_KEY or configure via admin UI)")
		}
		return s.Cfg.OpenCodeGoAPIKey, nil
	case "google":
		if s.Cfg.GoogleAPIKey == "" {
			return "", fmt.Errorf("Google API key not configured (set GOOGLE_API_KEY or configure via admin UI)")
		}
		return s.Cfg.GoogleAPIKey, nil
	case "chutes":
		if s.Cfg.ChutesAPIKey == "" {
			return "", fmt.Errorf("Chutes API key not configured (set CHUTES_API_KEY or configure via admin UI)")
		}
		return s.Cfg.ChutesAPIKey, nil
	case "lmstudio":
		return "", nil // local, no API key needed
	default:
		return "", fmt.Errorf("unknown provider: %s", providerID)
	}
}
