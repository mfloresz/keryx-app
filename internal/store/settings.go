package store

import (
	"encoding/json"

	"keryx-server/internal/ai"
)

// Collection names
const (
	UsersCollection                  = "users"
	ChatsCollection                  = "chats"
	ModelsCollection                 = "models"
	UserModelAccessCollection        = "user_model_access"
	InvitationsCollection            = "invitations"
	AttachmentsCollection            = "attachments"
	ProviderKeysCollection           = "provider_keys"
	TitleGenerationPolicyCollection  = "title_generation_policy"
		ModelPresetsCollection            = "model_presets"
			WebSearchConfigCollection         = "web_search_config"
)

// User roles
const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

// Chat visibility
const (
	VisibilityPublic  = "public"
	VisibilityPrivate = "private"
)

// ---- Types ----

type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name,omitempty"`
	Role      string `json:"role"`
	Avatar    string `json:"avatar,omitempty"`
	AvatarURL string `json:"avatarUrl,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

type AuthResult struct {
	// Token travels only in the HttpOnly session cookie, never in JSON
	// bodies, so page scripts can't read it.
	Token string `json:"-"`
	User  User   `json:"user"`
}

type ChatRecord struct {
	ID         string          `json:"id"`
	OwnerID    string          `json:"ownerId,omitempty"`
	Title      string          `json:"title"`
	Visibility string          `json:"visibility"`
	Messages   json.RawMessage `json:"messages"`
	Votes      json.RawMessage `json:"votes"`
	WebSearch  bool            `json:"webSearch"`
	Branches   json.RawMessage `json:"branches"`
	LastUsage  json.RawMessage `json:"lastUsage,omitempty"`
	CreatedAt  string          `json:"createdAt,omitempty"`
	UpdatedAt  string          `json:"updatedAt,omitempty"`
}

type ChatIndexEntry struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	CreatedAt string `json:"createdAt"`
}

type FavoriteMessageEntry struct {
	ChatID           string `json:"chatId"`
	ChatTitle        string `json:"chatTitle"`
	ChatCreatedAt    string `json:"chatCreatedAt"`
	MessageID        string `json:"messageId"`
	MessagePreview   string `json:"messagePreview"`
	MessageCreatedAt string `json:"messageCreatedAt"`
}

type ModelRecord struct {
	ID             string `json:"id"`
	Provider       string `json:"provider"`
	DisplayName    string `json:"displayName"`
	SupportsImages bool   `json:"supportsImages"`
	SupportsSearch bool   `json:"supportsSearch"`
	Enabled        bool   `json:"enabled"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

type InvitationRecord struct {
	ID                 string   `json:"id"`
	Email              string   `json:"email"`
	TokenHash          string   `json:"tokenHash"`
	Role               string   `json:"role"`
	ExpiresAt          string   `json:"expiresAt"`
	UsedAt             *string  `json:"usedAt"`
	CreatedBy          string   `json:"createdBy"`
	CreatedAt          string   `json:"createdAt"`
	InitialModelAccess []string `json:"initialModelAccess"`
}

// TitleGenerationMode defines how the chat title is generated.
type TitleGenerationMode string

const (
	TitleModeChatModel TitleGenerationMode = "chat_model"
	TitleModeCustom    TitleGenerationMode = "custom"
)

// TitleGenerationPolicy holds the admin-defined title generation policy.
type TitleGenerationPolicy struct {
	Mode      TitleGenerationMode `json:"mode"`
	ModelID   string              `json:"modelId,omitempty"`
}

type AllowedModel struct {
	ID             string `json:"id"`
	Provider       string `json:"provider"`
	DisplayName    string `json:"displayName"`
	SupportsImages bool   `json:"supportsImages"`
	SupportsSearch bool   `json:"supportsSearch"`
}

type AttachmentRecord struct {
	ID        string `json:"id"`
	OwnerID   string `json:"ownerId"`
	ChatID    string `json:"chatId"`
	Filename  string `json:"filename"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
	File      string `json:"file"`
	CreatedAt string `json:"createdAt"`
}

// ModelPreset defines which model is used for a user-facing preset mode (fast, reflect, extended_context).
type ModelPreset struct {
	PresetID string `json:"presetId"`
	ModelID  string `json:"modelId"`
	Label    string `json:"label"`
}

// WebSearchConfig holds the Brave Search API key and enabled flag.
type WebSearchConfig struct {
	APIKey  string `json:"apiKey,omitempty"`
	Enabled bool   `json:"enabled"`
}

// Model catalog definitions
type ModelInfo struct {
	ID             string `json:"id"`
	Provider       string `json:"provider"`
	DisplayName    string `json:"displayName"`
	SupportsImages bool   `json:"supportsImages"`
	SupportsSearch bool   `json:"supportsSearch"`
	MaxContext     int    `json:"maxContextTokens"`
	MaxOutput      int    `json:"maxOutputTokens"`
}

// GetCatalogModels returns the model catalog, derived from the single source
// of truth in the ai package registry (same pattern as Yara's seedProviders).
func GetCatalogModels() []ModelInfo {
	catalog := ai.ModelCatalog()
	out := make([]ModelInfo, 0, len(catalog))
	for _, m := range catalog {
		out = append(out, ModelInfo{
			ID:             m.ID,
			Provider:       m.Provider,
			DisplayName:    m.DisplayName,
			SupportsImages: m.SupportsImages,
			SupportsSearch: m.SupportsSearch,
			MaxContext:     m.MaxContext,
			MaxOutput:      m.MaxOutput,
		})
	}
	return out
}
