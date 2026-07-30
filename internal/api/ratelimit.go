package api

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// bucket is a simple token-bucket rate limiter state for a single key.
type bucket struct {
	tokens    float64
	last      time.Time
	seenLast  time.Time
}

// rateLimiter implements a per-key token bucket. It has no external
// dependencies so the binary keeps building offline.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	max     float64 // bucket capacity (burst)
}

func newRateLimiter(perMinute float64) *rateLimiter {
	return &rateLimiter{
		buckets: make(map[string]*bucket),
		rate:    perMinute / 60.0,
		max:     perMinute,
	}
}

// allow reports whether one request is permitted for the given key.
func (rl *rateLimiter) allow(key string) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: rl.max}
		rl.buckets[key] = b
	}

	elapsed := now.Sub(b.last).Seconds()
	b.tokens += elapsed * rl.rate
	if b.tokens > rl.max {
		b.tokens = rl.max
	}
	b.last = now
	b.seenLast = now

	// Lazy cleanup: occasionally drop keys idle for >10 minutes so the map
	// cannot grow unbounded on a public endpoint.
	if len(rl.buckets) > 10000 {
		for k, v := range rl.buckets {
			if now.Sub(v.seenLast) > 10*time.Minute {
				delete(rl.buckets, k)
			}
		}
	}

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// clientIP extracts the best-available client IP. When the app runs behind a
// tunnel (cloudflared, zrok), RemoteAddr is 127.0.0.1, so prefer the proxy
// headers. Only trust these headers if you control the exposure path.
func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return ip
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		if first := strings.TrimSpace(strings.Split(fwd, ",")[0]); first != "" {
			return first
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// withRateLimit rejects requests over the limit with 429. keyFn produces the
// limiting key (IP, user ID, etc.).
func (s *Server) withRateLimit(rl *rateLimiter, keyFn func(*http.Request) string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(keyFn(r)) {
			w.Header().Set("Retry-After", "60")
			errorResponse(w, "Too many requests", http.StatusTooManyRequests)
			return
		}
		next(w, r)
	}
}
