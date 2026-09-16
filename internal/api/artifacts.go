package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"sync"
	"time"
)

// HTML artifact previews are served as real network documents (not blob: or
// srcdoc) so the app's strict CSP is NOT inherited into them: Chrome applies
// the creator page's CSP to blob:/srcdoc subframes, which blocks the
// artifact's own inline <script> and event handlers. A network document gets
// its own response headers, set below to allow framing + inline scripts.
//
// Isolation still holds: the frontend frames previews with
// sandbox="allow-scripts ..." WITHOUT allow-same-origin, so the artifact
// runs in an opaque origin with no access to the parent DOM, cookies,
// storage or OPFS. The GET URL carries a 128-bit unguessable token and
// entries expire, so it doubles as a capability URL (no auth cookie needed
// inside the sandboxed frame).

const (
	// maxArtifactHTMLBytes caps a single artifact (2 MiB is plenty for
	// generated single-file pages and bounds memory per entry).
	maxArtifactHTMLBytes = 2 << 20
	// artifactTTL bounds how long a published preview stays retrievable.
	artifactTTL = time.Hour
)

type artifactEntry struct {
	html      []byte
	expiresAt time.Time
}

type artifactStore struct {
	mu    sync.Mutex
	items map[string]artifactEntry
}

func newArtifactStore() *artifactStore {
	return &artifactStore{items: make(map[string]artifactEntry)}
}

func newArtifactToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

var validArtifactToken = regexp.MustCompile(`^[0-9a-f]{32}$`)

// put stores html and returns its capability token, sweeping expired entries.
func (a *artifactStore) put(html []byte) (string, error) {
	token, err := newArtifactToken()
	if err != nil {
		return "", err
	}
	now := time.Now()
	a.mu.Lock()
	defer a.mu.Unlock()
	for key, entry := range a.items {
		if !entry.expiresAt.After(now) {
			delete(a.items, key)
		}
	}
	a.items[token] = artifactEntry{html: html, expiresAt: now.Add(artifactTTL)}
	return token, nil
}

func (a *artifactStore) get(token string) ([]byte, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	entry, ok := a.items[token]
	if !ok || !entry.expiresAt.After(time.Now()) {
		delete(a.items, token)
		return nil, false
	}
	return entry.html, true
}

type publishArtifactRequest struct {
	HTML string `json:"html"`
}

func (s *Server) handlePublishArtifact(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxArtifactHTMLBytes+1024)
	var req publishArtifactRequest
	body, err := io.ReadAll(r.Body)
	if err != nil {
		errorResponse(w, "Request body too large.", http.StatusRequestEntityTooLarge)
		return
	}
	if err := json.Unmarshal(body, &req); err != nil {
		errorResponse(w, "Invalid JSON body.", http.StatusBadRequest)
		return
	}
	if len(req.HTML) == 0 || len(req.HTML) > maxArtifactHTMLBytes {
		errorResponse(w, "HTML must be non-empty and under 2 MiB.", http.StatusBadRequest)
		return
	}
	token, err := s.artifacts.put([]byte(req.HTML))
	if err != nil {
		internalError(w, r, "Could not publish artifact.", err)
		return
	}
	jsonResponse(w, map[string]string{"token": token}, http.StatusOK)
}

func (s *Server) handleGetArtifact(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	if !validArtifactToken.MatchString(token) {
		errorResponse(w, "Artifact not found.", http.StatusNotFound)
		return
	}
	html, ok := s.artifacts.get(token)
	if !ok {
		errorResponse(w, "Artifact not found.", http.StatusNotFound)
		return
	}
	// Override the global security headers for this document: it must be
	// frameable same-origin and free to run its own inline scripts. A minimal
	// CSP with only frame-ancestors imposes nothing else.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'self'")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Write(html)
}
