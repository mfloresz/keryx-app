package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func publishArtifact(t *testing.T, env *apiTestEnv, token, html string) string {
	t.Helper()
	rec := doJSONRequest(t, env.handler, "POST", "/api/artifacts", token, map[string]string{"html": html})
	assertStatus(t, rec, http.StatusOK)
	var out map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode publish response: %v", err)
	}
	if out["token"] == "" {
		t.Fatalf("empty artifact token in %v", out)
	}
	return out["token"]
}

func TestPublishArtifactRequiresAuth(t *testing.T) {
	env := newAPITestEnv(t)
	rec := doJSONRequest(t, env.handler, "POST", "/api/artifacts", "", map[string]string{"html": "<p>x</p>"})
	if rec.Code == http.StatusOK {
		t.Fatalf("expected non-OK without auth, got %d", rec.Code)
	}
}

func TestArtifactPreviewRoundTrip(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "artifact@example.com")

	html := `<button onclick="document.body.dataset.x='1'">x</button><script>window.__ran = true</script>`
	previewToken := publishArtifact(t, env, u.Token, html)

	req := httptest.NewRequest("GET", "/api/artifacts/"+previewToken, nil)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)
	assertStatus(t, rec, http.StatusOK)

	body, _ := io.ReadAll(rec.Result().Body)
	if string(body) != html {
		t.Fatalf("preview body mismatch: %q", body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
		t.Fatalf("unexpected content type %q", ct)
	}
	// The preview document must be frameable and free of the app's strict
	// CSP (otherwise its inline scripts stay blocked).
	if got := rec.Header().Get("X-Frame-Options"); got == "DENY" {
		t.Fatalf("preview must not send X-Frame-Options DENY, got %q", got)
	}
	if csp := rec.Header().Get("Content-Security-Policy"); strings.Contains(csp, "script-src") {
		t.Fatalf("preview must not inherit script-src restrictions, got %q", csp)
	}
}

func TestArtifactPreviewNotFound(t *testing.T) {
	env := newAPITestEnv(t)
	for _, path := range []string{
		"/api/artifacts/not-a-token",
		"/api/artifacts/0123456789abcdef0123456789abcdef", // well-formed, unknown
	} {
		req := httptest.NewRequest("GET", path, nil)
		rec := httptest.NewRecorder()
		env.handler.ServeHTTP(rec, req)
		assertStatus(t, rec, http.StatusNotFound)
	}
}

func TestPublishArtifactRejectsOversize(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "artifact-big@example.com")
	rec := doJSONRequest(t, env.handler, "POST", "/api/artifacts", u.Token,
		map[string]string{"html": strings.Repeat("x", maxArtifactHTMLBytes+1)})
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 400/413 for oversize artifact, got %d", rec.Code)
	}
}
