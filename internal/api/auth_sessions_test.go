package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase"

	"keryx-server/internal/config"
	"keryx-server/internal/secure"
	"keryx-server/internal/store"
)

type apiTestEnv struct {
	handler http.Handler
	store   *store.Store
}

func newAPITestEnv(t *testing.T) *apiTestEnv {
	t.Helper()

	dataDir := t.TempDir()
	app := pocketbase.NewWithConfig(pocketbase.Config{DefaultDataDir: dataDir})
	if err := app.Bootstrap(); err != nil {
		t.Fatalf("bootstrap pocketbase: %v", err)
	}
	// Cleanup runs before t.TempDir removes the data dir, so no background
	// writer races the removal.
	t.Cleanup(func() { app.ResetBootstrapState() })

	encryptor, err := secure.NewEncryptorFromConfig("", filepath.Join(dataDir, "app.key"))
	if err != nil {
		t.Fatalf("create encryptor: %v", err)
	}

	st := store.New(app, encryptor)
	if err := st.EnsureSchema(); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}

	server := New(st, &config.Config{DataDir: dataDir})
	return &apiTestEnv{handler: server.Handler(), store: st}
}

func doJSONRequest(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("expected status %d, got %d: %s", want, rec.Code, rec.Body.String())
	}
}

func testUser(t *testing.T, env *apiTestEnv, email string) *store.AuthResult {
	t.Helper()
	result, err := env.store.CreateUser(email, "secret123", "Test")
	if err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	return result
}

// Logout and password change rotate the auth tokenKey, which must invalidate
// every previously issued session token (JWTs are stateless — tokenKey is the
// only revocation lever).
func TestLogoutRevokesAllSessions(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "logout@example.com")

	second, err := env.store.AuthenticateUser("logout@example.com", "secret123")
	if err != nil {
		t.Fatalf("second session: %v", err)
	}

	for _, tok := range []string{u.Token, second.Token} {
		assertStatus(t, doJSONRequest(t, env.handler, "GET", "/api/auth/me", tok, nil), http.StatusOK)
	}

	assertStatus(t, doJSONRequest(t, env.handler, "POST", "/api/auth/logout", u.Token, nil), http.StatusOK)

	for _, tok := range []string{u.Token, second.Token} {
		assertStatus(t, doJSONRequest(t, env.handler, "GET", "/api/auth/me", tok, nil), http.StatusUnauthorized)
	}
}

func TestPasswordChangeRevokesOtherSessions(t *testing.T) {
	env := newAPITestEnv(t)
	u := testUser(t, env, "passwd@example.com")

	other, err := env.store.AuthenticateUser("passwd@example.com", "secret123")
	if err != nil {
		t.Fatalf("second session: %v", err)
	}

	assertStatus(t, doJSONRequest(t, env.handler, "POST", "/api/auth/password", u.Token, map[string]string{
		"currentPassword": "secret123",
		"newPassword":     "newsecret456",
	}), http.StatusOK)

	// Old tokens (the caller's and the other device's) are dead.
	assertStatus(t, doJSONRequest(t, env.handler, "GET", "/api/auth/me", u.Token, nil), http.StatusUnauthorized)
	assertStatus(t, doJSONRequest(t, env.handler, "GET", "/api/auth/me", other.Token, nil), http.StatusUnauthorized)

	// Re-login works with the new password.
	if _, err := env.store.AuthenticateUser("passwd@example.com", "newsecret456"); err != nil {
		t.Fatalf("login with new password: %v", err)
	}
}

// A regular user must not be able to promote themselves to admin, no matter
// what the request payload says: the role-change route is admin-gated and the
// profile route never touches role fields.
func TestUserCannotSelfPromoteToAdmin(t *testing.T) {
	env := newAPITestEnv(t)

	admin := testUser(t, env, "admin-sp@example.com")
	if err := env.store.UpdateUserRole(admin.User.ID, store.RoleAdmin); err != nil {
		t.Fatalf("promote admin: %v", err)
	}
	user := testUser(t, env, "user-sp@example.com")

	// Direct attempt on the admin role-change route.
	assertStatus(t, doJSONRequest(t, env.handler, "PATCH", "/api/admin/users/"+user.User.ID, user.Token,
		map[string]string{"role": store.RoleAdmin}), http.StatusForbidden)

	// Escalation attempt through the profile route is a no-op for role.
	assertStatus(t, doJSONRequest(t, env.handler, "PATCH", "/api/auth/profile", user.Token,
		map[string]string{"name": "Escalated", "role": store.RoleAdmin}), http.StatusOK)

	fresh, err := env.store.GetUserByID(user.User.ID)
	if err != nil {
		t.Fatalf("get user: %v", err)
	}
	if fresh.Role != store.RoleUser {
		t.Fatalf("expected role to stay %q, got %q", store.RoleUser, fresh.Role)
	}

	// Sanity: an admin CAN change roles.
	assertStatus(t, doJSONRequest(t, env.handler, "PATCH", "/api/admin/users/"+user.User.ID, admin.Token,
		map[string]string{"role": store.RoleAdmin}), http.StatusOK)
}
