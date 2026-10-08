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
	home := codebergHome()

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

	stop := startInitialProject(ctx, cfg, metrics)
	defer stop()
	idx := indexctl.NewClient(cfg.Socket)
	httpSrv := serveProjects(cfg, idx, metrics, projectManager, stop)

	<-ctx.Done()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	_ = httpSrv.Shutdown(shutdownCtx)
}

func codebergHome() string {
	home := os.Getenv("CODEBERG_HOME")
	if home == "" {
		userHome, _ := os.UserHomeDir()
		home = filepath.Join(userHome, ".codeberg")
	}

	return home
}

func waitForInitialIndex(ctx context.Context, cfg config.Daemon, idx *indexctl.Client, metrics *resources.Collector) {
	readyCtx, readyCancel := context.WithTimeout(ctx, bootstrap.StartupTimeout(len(cfg.Roots)))
	defer readyCancel()
	st, err := bootstrap.WaitIndexer(readyCtx, idx)
	if err != nil {
		log.Printf("initial project indexing: %v", err)
		return
	}

	log.Printf("indexer ready: %d chunks, version %s", st.Chunks, st.Version)
	metrics.InvalidateDisk()
}

func serveProjects(cfg config.Daemon, idx *indexctl.Client, metrics *resources.Collector, projectManager *projects.Manager, stop func()) *http.Server {
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

	projectManager.WithGitPull(cfg.GitPull)
	if len(cfg.Roots) > 0 {
		projectManager.BindDefault(srv.Handler(), stop)
	}
	httpSrv := &http.Server{Addr: address, Handler: projectManager.Handler(srv.Handler())}
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http: %v", err)
			os.Exit(1)
		}
	}()

	return httpSrv
}

func startInitialProject(ctx context.Context, cfg config.Daemon, metrics *resources.Collector) func() {
	if len(cfg.Roots) == 0 {
		return func() {}
	}

	ctx, cancel := context.WithCancel(ctx)
	sup, err := supervisor.Start(ctx, cfg.Indexer)
	if err != nil {
		log.Fatal(err)
	}

	go waitForInitialIndex(ctx, cfg, indexctl.NewClient(cfg.Socket), metrics)
	dirs := make([]string, 0, len(cfg.Roots))
	for _, root := range cfg.Roots {
		dirs = append(dirs, root.Root)
	}

	go gitpull.Run(ctx, dirs, cfg.GitPull)
	return func() {
		sup.Stop()
		cancel()
	}
}
