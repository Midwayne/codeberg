package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/httpserver"
	"codeberg.org/codeberg/daemon/internal/projects"
	"codeberg.org/codeberg/daemon/internal/resources"
)

func main() {
	cfg, err := config.LoadDaemon()
	if err != nil {
		log.Fatal(err)
	}

	if len(os.Args) > 1 {
		runCommand(cfg, os.Args[1:])
		return
	}

	if err := run(cfg); err != nil {
		log.Fatal(err)
	}
}

// run returns instead of exiting so deferred cleanup (stopping indexers,
// removing a --no-index session) always happens.
func run(cfg config.Daemon) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	dataHome, cleanup, err := projectHome(cfg)
	if err != nil {
		return err
	}

	defer cleanup()

	// Include indexing/bootstrap in history rather than starting only once ready.
	metrics := resources.New(resources.Options{Home: cfg.Home, ModelPath: cfg.Model, IndexPath: cfg.Index,
		LogDir: cfg.LogDir, RootPID: cfg.RootPID, EmbeddingBackend: cfg.EmbedBackend, EmbedPython: cfg.EmbedPython})
	metrics.Start(ctx)

	manager, err := projects.New(ctx, dataHome, cfg.Indexer)
	if err != nil {
		return err
	}

	defer manager.Close()
	manager.WithRuntime(projects.Runtime{GitPull: cfg.GitPull, HealthTimeout: cfg.HealthTimeout, OnIndexReady: metrics.InvalidateDisk})
	if err := manager.StartDefault(); err != nil {
		return err
	}

	return serve(ctx, cfg, manager, metrics)
}

// projectHome keeps a --no-index session's catalog and indexes in a temporary
// directory removed at exit, so nothing is registered or written under Home.
func projectHome(cfg config.Daemon) (string, func(), error) {
	if !cfg.NoIndex {
		return cfg.Home, func() {}, nil
	}

	dir, err := os.MkdirTemp("", "codeberg-session-")
	if err != nil {
		return "", nil, err
	}

	return dir, func() { _ = os.RemoveAll(dir) }, nil
}

// serve answers until ctx ends or the listener fails.
func serve(ctx context.Context, cfg config.Daemon, manager *projects.Manager, metrics *resources.Collector) error {
	mux := http.NewServeMux()
	resourceRoutes := httpserver.Resources(metrics)
	mux.Handle("/resources", resourceRoutes)
	mux.Handle("/resources/", resourceRoutes)
	mux.Handle("/", manager.Handler())

	// Repository APIs are local-only. Never expose unauthenticated tools on a
	// wildcard interface; remote access must go through an authenticated proxy.
	address := net.JoinHostPort("127.0.0.1", cfg.HTTPPort)
	log.Printf("codeberg-d: roots=[%s] http=%s home=%s", formatRoots(cfg), address, cfg.Home)

	httpSrv := &http.Server{Addr: address, Handler: mux}
	failed := make(chan error, 1)
	go func() { failed <- httpSrv.ListenAndServe() }()

	select {
	case err := <-failed:
		return fmt.Errorf("http: %w", err)
	case <-ctx.Done():
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	return httpSrv.Shutdown(shutdownCtx)
}

func formatRoots(cfg config.Daemon) string {
	roots := make([]string, 0, len(cfg.Roots))

	for _, r := range cfg.Roots {
		roots = append(roots, r.Key+"="+r.Root)
	}

	return strings.Join(roots, " ")
}

// runCommand handles the one-shot subcommands other components use to read
// daemon-owned state without starting a server.
func runCommand(cfg config.Daemon, args []string) {
	switch args[0] {
	case "storage":
		report, err := projects.StorageReport(cfg.Home)
		if err != nil {
			log.Fatal(err)
		}

		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(report); err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatalf("unknown command %q (available: storage)", args[0])
	}
}
