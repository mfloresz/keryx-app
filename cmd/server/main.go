package main

import (
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"

	"github.com/pocketbase/pocketbase"
	"keryx-server/internal/api"
	"keryx-server/internal/config"
	"keryx-server/internal/store"
)

var Version = "0.1.1"

func main() {
	showVersion := flag.Bool("version", false, "print version and exit")
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}
	if *showVersion {
		fmt.Println(Version)
		os.Exit(0)
	}

	if err := cfg.InitEncryptor(); err != nil {
		slog.Error("failed to init encryptor", "error", err)
		os.Exit(1)
	}

	app := pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir: cfg.DataDir,
		DefaultDev:     cfg.StaticDir != "",
	})
	if err := app.Bootstrap(); err != nil {
		slog.Error("failed to bootstrap pocketbase", "error", err)
		os.Exit(1)
	}

	st := store.New(app, cfg.Encryptor)
	if err := st.EnsureSchema(); err != nil {
		slog.Error("failed to ensure schema", "error", err)
		os.Exit(1)
	}

	server := api.New(st, cfg)
	handler := server.Handler()

	slog.Info("keryx-server listening", "addr", cfg.Addr, "dataDir", cfg.DataDir)
	if err := http.ListenAndServe(cfg.Addr, handler); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}
