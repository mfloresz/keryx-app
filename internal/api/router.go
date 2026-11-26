package api

import (
	"context"
	"fmt"
	"net/http"
	"sync"

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
	providersMu sync.RWMutex

	// chatLocks serializes read-modify-write cycles per chat so concurrent
	// handlers (stream persist, votes, message edits) can't clobber each
	// other's changes.
	chatLocks sync.Map

	// activeStreams tracks in-progress chat completions so clients can
	// reconnect (GET /api/chats/{id}/stream) after navigating away or
	// reloading the page mid-response.
	activeStreams *streamRegistry

	// toolApprovals holds tool calls that are waiting for the user to
	// approve or deny them (write_file / edit_file).
	toolApprovals *approvalRegistry

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

	// artifacts holds published HTML preview documents (short-lived,
	// capability-URL addressed; see artifacts.go).
	artifacts *artifactStore
}

func New(st *store.Store, cfg *config.Config) *Server {
	return &Server{
		Store:             st,
		Cfg:               cfg,
		AIProviders:       make(map[string]ai.Provider),
		activeStreams:     newStreamRegistry(),
		toolApprovals:     newApprovalRegistry(),
		loginLimiter:      newRateLimiter(5),  // 5 login attempts/min per IP
		invitationLimiter: newRateLimiter(10), // 10 invitation ops/min per IP
		streamLimiter:     newRateLimiter(10), // 10 stream starts/min per user
		accountLimiter:    newRateLimiter(10), // 10 account changes/min per user
		adminLimiter:      newRateLimiter(30), // 30 admin ops/min per user
		artifacts:         newArtifactStore(),
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

	// Public chat routes
	mux.HandleFunc("GET /api/public/chats/{id}", s.handleGetPublicChat)
	mux.HandleFunc("GET /api/public/chats/{id}/attachments/{attachmentId}", s.handleGetPublicChatAttachment)

	// Protected chat routes
	mux.HandleFunc("GET /api/chats", s.withAuth(s.handleListChats))
	mux.HandleFunc("GET /api/chats/search", s.withAuth(s.handleSearchChatMessages))
	mux.HandleFunc("POST /api/chats", s.withAuth(s.handleSaveChat))

	// Agent routes (user)
	mux.HandleFunc("GET /api/agents", s.withAuth(s.handleListAgents))
	mux.HandleFunc("GET /api/agents/{id}", s.withAuth(s.handleGetAgent))
	mux.HandleFunc("POST /api/agents", s.withAuth(s.handleCreateAgent))
	mux.HandleFunc("PUT /api/agents/{id}", s.withAuth(s.handleUpdateAgent))
	mux.HandleFunc("DELETE /api/agents/{id}", s.withAuth(s.handleDeleteAgent))
	mux.HandleFunc("POST /api/agents/{id}/duplicate", s.withAuth(s.handleDuplicateAgent))
	mux.HandleFunc("POST /api/agents/{id}/knowledge", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleUploadAgentKnowledge)))
	mux.HandleFunc("GET /api/agents/{id}/knowledge", s.withAuth(s.handleListAgentKnowledge))
	mux.HandleFunc("DELETE /api/agents/{id}/knowledge/{attachmentId}", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleDeleteAgentKnowledge)))

	// Skills (user): enabled skills available for pinning into a stream.
	mux.HandleFunc("GET /api/skills", s.withAuth(s.handleListSkills))

	// Automation routes (user)
	mux.HandleFunc("GET /api/automations", s.withAuth(s.handleListAutomations))
	mux.HandleFunc("POST /api/automations", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleCreateAutomation)))
	mux.HandleFunc("PUT /api/automations/{id}", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleUpdateAutomation)))
	mux.HandleFunc("DELETE /api/automations/{id}", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleDeleteAutomation)))
	mux.HandleFunc("POST /api/automations/{id}/trigger", s.withAuth(s.withRateLimit(s.accountLimiter, userKey, s.handleTriggerAutomation)))
	mux.HandleFunc("GET /api/automations/{id}/runs", s.withAuth(s.handleListAutomationRuns))

	// Project workspace routes (user)
	mux.HandleFunc("GET /api/projects", s.withAuth(s.handleListProjects))
	mux.HandleFunc("POST /api/projects", s.withAuth(s.handleCreateProject))
	mux.HandleFunc("PATCH /api/projects/{id}", s.withAuth(s.handleUpdateProject))
	mux.HandleFunc("DELETE /api/projects/{id}", s.withAuth(s.handleDeleteProject))
	mux.HandleFunc("GET /api/projects/{id}/files", s.withAuth(s.handleListProjectFiles))
	mux.HandleFunc("GET /api/projects/{id}/file", s.withAuth(s.handleGetProjectFile))
	mux.HandleFunc("PUT /api/projects/{id}/file", s.withAuth(s.handlePutProjectFile))
	mux.HandleFunc("DELETE /api/projects/{id}/file", s.withAuth(s.handleDeleteProjectFile))

	mux.HandleFunc("DELETE /api/chats", s.withAuth(s.handleDeleteAllChats))
	mux.HandleFunc("GET /api/favorites", s.withAuth(s.handleListFavorites))

	// Chat detail routes
	mux.HandleFunc("GET /api/chats/{id}", s.withAuth(s.handleGetChat))
	mux.HandleFunc("DELETE /api/chats/{id}", s.withAuth(s.handleDeleteChat))
	mux.HandleFunc("PATCH /api/chats/{id}/title", s.withAuth(s.handleUpdateChatTitle))
	mux.HandleFunc("PATCH /api/chats/{id}/visibility", s.withAuth(s.handleUpdateChatVisibility))
	mux.HandleFunc("DELETE /api/chats/{id}/messages", s.withAuth(s.handleDeleteMessages))
	mux.HandleFunc("POST /api/chats/{id}/branches", s.withAuth(s.handleSwitchBranch))
	mux.HandleFunc("POST /api/chats/{id}/fork", s.withAuth(s.handleForkChat))
	mux.HandleFunc("GET /api/chats/{id}/votes", s.withAuth(s.handleGetVotes))
	mux.HandleFunc("POST /api/chats/{id}/votes", s.withAuth(s.handleSaveVote))
	mux.HandleFunc("POST /api/chats/{id}/stream", s.withAuth(s.withRateLimit(s.streamLimiter, userKey, s.handleChatStream)))
	// Cancel is deliberately NOT behind the stream limiter: stopping a
	// stream must never be rate-limited away.
	mux.HandleFunc("POST /api/chats/{id}/cancel", s.withAuth(s.handleCancelStream))
	mux.HandleFunc("PATCH /api/chats/{id}/agent", s.withAuth(s.handleUpdateChatAgent))
	mux.HandleFunc("PATCH /api/chats/{id}/preset", s.withAuth(s.handleUpdateChatPreset))
	mux.HandleFunc("PATCH /api/chats/{id}/project", s.withAuth(s.handleUpdateChatProject))
	mux.HandleFunc("GET /api/chats/{id}/stream", s.withAuth(s.handleReconnectStream))
	mux.HandleFunc("POST /api/chats/{id}/tool-approval", s.withAuth(s.handleToolApproval))
	mux.HandleFunc("POST /api/chats/{id}/attachments", s.withAuth(s.handleUploadAttachments))
	mux.HandleFunc("GET /api/chats/{id}/artifacts/{artifactId}", s.withAuth(s.handleGetChatArtifact))
	mux.HandleFunc("GET /api/attachments/{id}", s.withAuth(s.handleGetAttachment))

	// Model routes
	mux.HandleFunc("GET /api/models/presets", s.withAuth(s.handleModelPresets))
	mux.HandleFunc("GET /api/models/allowed", s.adminRoute(s.handleAllowedModels))

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

	// Admin web search config routes
	mux.HandleFunc("GET /api/admin/web-search-config", s.adminRoute(s.handleAdminGetWebSearchConfig))
	mux.HandleFunc("PUT /api/admin/web-search-config", s.adminRoute(s.handleAdminSetWebSearchConfig))

	// Admin model preset routes
	mux.HandleFunc("GET /api/admin/model-presets", s.adminRoute(s.handleAdminListModelPresets))
	mux.HandleFunc("PUT /api/admin/model-presets/{preset}", s.adminRoute(s.handleAdminUpdateModelPreset))

	// Admin prompt override routes (base/title system prompts)
	mux.HandleFunc("GET /api/admin/prompt-overrides", s.adminRoute(s.handleAdminGetPromptOverrides))
	mux.HandleFunc("PUT /api/admin/prompt-overrides/{key}", s.adminRoute(s.handleAdminSetPromptOverride))
	mux.HandleFunc("DELETE /api/admin/prompt-overrides/{key}", s.adminRoute(s.handleAdminDeletePromptOverride))

	// Admin agent routes (global agents / catalog overrides)
	mux.HandleFunc("GET /api/admin/agents", s.adminRoute(s.handleAdminListAgents))
	mux.HandleFunc("POST /api/admin/agents", s.adminRoute(s.handleAdminCreateAgent))
	mux.HandleFunc("PUT /api/admin/agents/{id}", s.adminRoute(s.handleAdminUpdateAgent))
	mux.HandleFunc("DELETE /api/admin/agents/{id}", s.adminRoute(s.handleAdminDeleteAgent))

	// Admin skill routes (instruction packs injected into chat streams)
	mux.HandleFunc("GET /api/admin/skills", s.adminRoute(s.handleAdminListSkills))
	mux.HandleFunc("POST /api/admin/skills", s.adminRoute(s.handleAdminCreateSkill))
	mux.HandleFunc("PUT /api/admin/skills/{id}", s.adminRoute(s.handleAdminUpdateSkill))
	mux.HandleFunc("DELETE /api/admin/skills/{id}", s.adminRoute(s.handleAdminDeleteSkill))

	// Public web search config endpoint (no auth required — exposes only a
	// boolean feature flag, and chat pages fetch it without auth headers)
	mux.HandleFunc("GET /api/web-search/config", s.handleWebSearchConfig)

	// HTML artifact previews: POST requires auth; GET is addressed by an
	// unguessable capability token and served with framing-friendly headers
	// (see artifacts.go).
	mux.HandleFunc("POST /api/artifacts", s.withAuth(s.handlePublishArtifact))
	mux.HandleFunc("GET /api/artifacts/{token}", s.handleGetArtifact)

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
			"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; "+
				"frame-src 'self' blob: data:; child-src 'self' blob: data:; "+
				"img-src 'self' blob: data: https:; font-src 'self' data:; "+
				"media-src 'self' blob: data: https:; "+
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
//
// sessionID carries the opaque OpenCode session for cache grouping (see
// ai.SessionForChat). Only opencode-go/opencode-zen consume it; it is ignored
// for every other provider. Opencode providers always get a fresh instance
// (never the shared cache) so concurrent chats can't share a session.
func (s *Server) getProviderForModel(modelID, sessionID string) (ai.Provider, string, error) {
	info, upstreamModel, err := ai.ResolveModel(modelID)
	if err != nil {
		return nil, "", err
	}

	if !ai.IsOpencodeProvider(info.ID) {
		s.providersMu.RLock()
		p, ok := s.AIProviders[info.ID]
		s.providersMu.RUnlock()
		if ok {
			return p, upstreamModel, nil
		}
	}

	apiKey, err := s.apiKeyForProvider(info.ID)
	if err != nil {
		return nil, "", err
	}

	var p ai.Provider
	if info.ID == "google" {
		// No explicit Timeout: the provider's default (10 minutes) applies,
		// sized for the full model→tool generation loop.
		p = &ai.GoogleProvider{
			APIKey: apiKey,
			Model:  upstreamModel,
		}
	} else {
		// The OpenCode session groups a chat's requests for prompt-cache
		// optimization. Only opencode-go/opencode-zen consume it.
		session := ""
		if ai.IsOpencodeProvider(info.ID) {
			session = sessionID
		}
		p = &ai.OpenAIProvider{
			APIKey:     apiKey,
			BaseURL:    info.BaseURL,
			Model:      upstreamModel,
			Options:    info.Options,
			SessionID:  session,
			OpenRouter: info.ID == "openrouter",
		}
	}
	if !ai.IsOpencodeProvider(info.ID) {
		s.providersMu.Lock()
		s.AIProviders[info.ID] = p
		s.providersMu.Unlock()
	}
	return p, upstreamModel, nil
}

// InvalidateProvider clears a cached provider instance (e.g. after API key change).
func (s *Server) InvalidateProvider(providerID string) {
	s.providersMu.Lock()
	delete(s.AIProviders, providerID)
	s.providersMu.Unlock()
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
	case "openrouter":
		if s.Cfg.OpenRouterAPIKey == "" {
			return "", fmt.Errorf("OpenRouter API key not configured (set OPENROUTER_API_KEY or configure via admin UI)")
		}
		return s.Cfg.OpenRouterAPIKey, nil
	case "inferx":
		if s.Cfg.InferXAPIKey == "" {
			return "", fmt.Errorf("InferX API key not configured (set INFERX_API_KEY or configure via admin UI)")
		}
		return s.Cfg.InferXAPIKey, nil
	case "liquid":
		if s.Cfg.LiquidAPIKey == "" {
			return "", fmt.Errorf("Liquid AI API key not configured (set LIQUID_API_KEY or configure via admin UI)")
		}
		return s.Cfg.LiquidAPIKey, nil
	case "lmstudio":
		return "", nil // local, no API key needed
	default:
		return "", fmt.Errorf("unknown provider: %s", providerID)
	}
}
