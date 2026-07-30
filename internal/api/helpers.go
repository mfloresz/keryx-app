package api

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"keryx-server/internal/store"
)

func jsonResponse(w http.ResponseWriter, data any, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func errorResponse(w http.ResponseWriter, message string, status int) {
	jsonResponse(w, map[string]string{"message": message}, status)
}

func readJSONBody(r *http.Request, v any) error {
	body, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, maxJSONBodyBytes))
	if err != nil {
		return err
	}
	return json.Unmarshal(body, v)
}

// maxJSONBodyBytes caps JSON request bodies to protect against oversized
// payload (memory exhaustion) attacks. Multipart uploads have their own
// stricter limits in the attachments handler.
const maxJSONBodyBytes = 1 << 20 // 1 MB

// internalError logs the real error server-side and returns a generic
// message to the client so database/constraint/path details never leak.
func internalError(w http.ResponseWriter, r *http.Request, message string, err error) {
	slog.Error(message, "error", err, "method", r.Method, "path", r.URL.Path)
	errorResponse(w, message, http.StatusInternalServerError)
}

func getBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	// Fall back to the HttpOnly session cookie (set by login/register).
	if c, err := r.Cookie(authCookieName); err == nil {
		return c.Value
	}
	return ""
}

// getUser extracts authenticated user ID from request context.
// The PocketBase middleware populates this context.
func getUser(r *http.Request) (string, string, error) {
	// PocketBase's auth middleware sets the auth record in the context
	// This is handled by the router's RequireAuth() binding
	// We extract it via the request context after PocketBase middleware processes it
	userID := r.Context().Value("authRecordID")
	if userID == nil {
		return "", "", store.ErrForbidden
	}
	id, ok := userID.(string)
	if !ok || id == "" {
		return "", "", store.ErrForbidden
	}
	return id, "", nil
}
