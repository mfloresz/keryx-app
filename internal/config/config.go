package config

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Addr      string
	Port      string
	DataDir   string
	StaticDir string
	// AI Gateway API Key for Vercel AI Gateway
	AIGatewayAPIKey string
	// OpenCode API Key
	OpenCodeAPIKey string
	// App base URL (for invitation links)
	AppBaseURL string
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

	cfg.AIGatewayAPIKey = strings.TrimSpace(os.Getenv("AI_GATEWAY_API_KEY"))
	cfg.OpenCodeAPIKey = strings.TrimSpace(os.Getenv("OPENCODE_API_KEY"))
	cfg.AppBaseURL = strings.TrimSpace(os.Getenv("APP_BASE_URL"))

	return cfg, nil
}
