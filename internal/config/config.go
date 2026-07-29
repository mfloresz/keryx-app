package config

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"keryx-server/internal/secure"
)

type Config struct {
	Addr      string
	Port      string
	DataDir   string
	StaticDir string

	// Venice API Key (env fallback)
	VeniceAPIKey string
	// OpenCode Go API Key (env fallback)
	OpenCodeGoAPIKey string
	// Google API Key (env fallback)
	GoogleAPIKey string
	// Chutes API Key (env fallback)
	ChutesAPIKey string
	// App base URL (for invitation links)
	AppBaseURL string

	// Encryption key for storing provider API keys in the DB.
	// If empty, an auto-generated key is persisted at AppEncryptionPath.
	AppEncryptionKey  string
	AppEncryptionPath string

	// Encryptor is initialised after Load() by InitEncryptor.
	Encryptor *secure.Encryptor

	// BaseSystemPrompt is the system prompt used for chat conversations.
	// Defaults to the prompt from prompts.ts.
	// Override via BASE_SYSTEM_PROMPT env var or BASE_SYSTEM_PROMPT_PATH file.
	BaseSystemPrompt string

	// TitleGenerationSystemPrompt is the system prompt used for generating
	// chat titles. Defaults to the prompt from prompts.ts.
	// Override via TITLE_GENERATION_SYSTEM_PROMPT env var
	// or TITLE_GENERATION_SYSTEM_PROMPT_PATH file.
	TitleGenerationSystemPrompt string
}

func Load() (*Config, error) {
	cfg := &Config{}
	flag.StringVar(&cfg.Addr, "addr", "", "listen address")
	flag.StringVar(&cfg.Port, "port", "", "listen port")
	flag.StringVar(&cfg.DataDir, "data-dir", "", "data directory")
	flag.StringVar(&cfg.StaticDir, "static-dir", "", "dev static dir")
	flag.Parse()

	if cfg.Addr == "" {
		cfg.Addr = strings.TrimSpace(os.Getenv("ADDR"))
	}
	if cfg.Port == "" {
		cfg.Port = strings.TrimSpace(os.Getenv("PORT"))
	}
	if cfg.Addr == "" {
		port := strings.TrimSpace(cfg.Port)
		if port == "" {
			port = ":5176"
		} else if strings.HasPrefix(port, ":") {
			// port already has a leading colon
		} else {
			port = ":" + port
		}
		cfg.Addr = port
	}

	if cfg.DataDir == "" {
		cfg.DataDir = strings.TrimSpace(os.Getenv("DATA_DIR"))
	}
	if cfg.DataDir == "" {
		execPath, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("resolve executable path: %w", err)
		}
		cfg.DataDir = filepath.Join(filepath.Dir(execPath), "data")
	}
	absDataDir, err := filepath.Abs(cfg.DataDir)
	if err != nil {
		return nil, fmt.Errorf("resolve data dir: %w", err)
	}
	cfg.DataDir = absDataDir

	if cfg.StaticDir == "" {
		cfg.StaticDir = strings.TrimSpace(os.Getenv("STATIC_DIR"))
	}
	if cfg.StaticDir != "" {
		absStaticDir, err := filepath.Abs(cfg.StaticDir)
		if err != nil {
			return nil, fmt.Errorf("resolve static dir: %w", err)
		}
		cfg.StaticDir = absStaticDir
	}

	cfg.AppEncryptionPath = filepath.Join(cfg.DataDir, "app.key")
	cfg.AppEncryptionKey = strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY"))
	cfg.AppEncryptionKey = strings.TrimSpace(os.Getenv("APP_ENCRYPTION_KEY"))

	cfg.VeniceAPIKey = strings.TrimSpace(os.Getenv("VENICE_API_KEY"))
	cfg.OpenCodeGoAPIKey = strings.TrimSpace(os.Getenv("OPENCODEGO_API_KEY"))
	cfg.GoogleAPIKey = strings.TrimSpace(os.Getenv("GOOGLE_API_KEY"))
	cfg.ChutesAPIKey = strings.TrimSpace(os.Getenv("CHUTES_API_KEY"))
	cfg.AppBaseURL = strings.TrimSpace(os.Getenv("APP_BASE_URL"))

	// System prompts — env var > file path > default
	cfg.BaseSystemPrompt = loadPrompt("BASE_SYSTEM_PROMPT", defaultBaseSystemPrompt)
	cfg.TitleGenerationSystemPrompt = loadPrompt("TITLE_GENERATION_SYSTEM_PROMPT", defaultTitleGenerationSystemPrompt)

	return cfg, nil
}

// loadPrompt loads a prompt from an environment variable or file.
// Priority: env var > file path env var > default.
func loadPrompt(envName, defaultPrompt string) string {
	if v := strings.TrimSpace(os.Getenv(envName)); v != "" {
		return v
	}
	if path := strings.TrimSpace(os.Getenv(envName + "_PATH")); path != "" {
		data, err := os.ReadFile(path)
		if err == nil && len(data) > 0 {
			return string(data)
		}
	}
	return defaultPrompt
}

// InitEncryptor creates the Encryptor from the configured env key or app.key file.
func (cfg *Config) InitEncryptor() error {
	enc, err := secure.NewEncryptorFromConfig(cfg.AppEncryptionKey, cfg.AppEncryptionPath)
	if err != nil {
		return fmt.Errorf("init encryptor: %w", err)
	}
	cfg.Encryptor = enc
	return nil
}
