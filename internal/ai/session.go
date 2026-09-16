package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const keryxUserAgent = "keryx"

const opencodeSessionHeader = "X-Opencode-Session"

const opencodeSessionLength = 8

// SessionForChat derives a stable, opaque session ID from a chat ID so
// OpenCode can group a conversation's requests (including retries, which reuse
// the same chat) for prompt-cache optimization. The hash keeps internal IDs
// out of the header.
//
// A new chat (including forks, which get a fresh PocketBase ID) maps to a new
// session. Restarts must create a new chat rather than emptying the messages
// of an existing one, otherwise the reused session would group unrelated
// histories and pollute the cache.
func SessionForChat(chatID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(chatID)))
	return hex.EncodeToString(sum[:])[:opencodeSessionLength]
}

// IsOpencodeProvider reports whether a provider consumes the OpenCode session
// header for cache grouping. Only opencode-go/opencode-zen consume it.
func IsOpencodeProvider(providerID string) bool {
	id := strings.TrimSpace(providerID)
	return id == "opencode-go" || id == "opencode-zen"
}
