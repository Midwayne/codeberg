package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"codeberg.org/codeberg/daemon/internal/bootstrap"
	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/gitpull"
	"codeberg.org/codeberg/daemon/internal/httpserver"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/projects"
	"codeberg.org/codeberg/daemon/internal/resources"
	"codeberg.org/codeberg/daemon/internal/supervisor"
	"codeberg.org/codeberg/daemon/internal/tools"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func main() {
	cfg, err := config.LoadDaemon()
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	home := os.Getenv("CODEBERG_HOME")
	if home == "" {
		userHome, _ := os.UserHomeDir()
		home = filepath.Join(userHome, ".codeberg")
	}
	projectManager, err := projects.New(ctx, home, cfg.Indexer)
	if err != nil {
		log.Fatal(err)
	}
	defer projectManager.Close()
	cfg.Indexer, err = projectManager.InitialConfig()
	if err != nil {
		log.Fatal(err)
	}
	rootPID, _ := strconv.Atoi(os.Getenv("CODEBERG_RESOURCE_ROOT_PID"))
	metrics := resources.New(resources.Options{Home: home, ModelPath: cfg.Model, IndexPath: cfg.Index,
		LogDir: os.Getenv("CODEBERG_LOG_DIR"), RootPID: rootPID, EmbeddingBackend: cfg.EmbedBackend})
	// Include indexing/bootstrap in history rather than starting only once ready.
	metrics.Start(ctx)

	sup, err := supervisor.Start(ctx, cfg.Indexer)
	if err != nil {
		log.Fatal(err)
	}
	defer sup.Stop()

	idx := indexctl.NewClient(cfg.Socket)

	// Serve the project UI while the initial index is still being built.
	go func() {
		readyCtx, readyCancel := context.WithTimeout(ctx, bootstrap.StartupTimeout(len(cfg.Roots)))
		defer readyCancel()
		st, err := bootstrap.WaitIndexer(readyCtx, idx)
		if err != nil {
			log.Printf("initial project indexing: %v", err)
			return
		}
		log.Printf("indexer ready: %d chunks, version %s", st.Chunks, st.Version)
		metrics.InvalidateDisk()
	}()

	go gitpull.Run(ctx, cfg.GitDirs, cfg.GitPull)

	repos := make([]workspace.RepoInfo, 0, len(cfg.Roots))
	roots := make([]string, 0, len(cfg.Roots))
	for _, r := range cfg.Roots {
		repos = append(repos, workspace.RepoInfo{Key: r.Key, Root: r.Root})
		roots = append(roots, r.Key+"="+r.Root)
	}

	ws := workspace.New(repos, cfg.DefaultKey)
	srv := httpserver.New(idx, tools.Default(ws, idx)).WithResources(metrics)

	// Repository APIs are local-only. Never expose unauthenticated tools on a
	// wildcard interface; remote access must go through an authenticated proxy.
	address := net.JoinHostPort("127.0.0.1", cfg.HTTPPort)
	log.Printf("codeberg-d: roots=[%s] http=%s socket=%s", strings.Join(roots, " "), address, cfg.Socket)

	projectManager.WithGitPull(cfg.GitPull).BindDefault(srv.Handler())
	httpSrv := &http.Server{Addr: address, Handler: projectManager.Handler(srv.Handler())}
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http: %v", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}
