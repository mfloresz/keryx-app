package api

import (
	"net/http"
	"time"
)

// authCookieName holds the session token. HttpOnly so JS can't read it,
// SameSite=Strict so the cookie is never sent cross-site (CSRF protection).
// The Bearer Authorization header remains supported as a fallback for
// non-browser clients.
const authCookieName = "keryx_session"

// authCookieMaxAge mirrors PocketBase's default auth token lifetime (~7 days).
const authCookieMaxAge = int((7 * 24 * time.Hour) / time.Second)

// setAuthCookie writes the session cookie. Secure is only set when the
// request arrives over HTTPS (direct TLS or via an HTTPS tunnel) so plain
// HTTP usage on localhost/LAN keeps working.
func setAuthCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   authCookieMaxAge,
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteStrictMode,
	})
}

// clearAuthCookie expires the session cookie.
func clearAuthCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecureRequest(r),
		SameSite: http.SameSiteStrictMode,
	})
}

// isSecureRequest reports whether the request arrived over HTTPS, either
// directly or behind a tunnel/proxy that terminated TLS (cloudflared, zrok).
func isSecureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return r.Header.Get("X-Forwarded-Proto") == "https"
}
