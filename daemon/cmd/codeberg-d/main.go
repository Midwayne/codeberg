package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/gitpull"
	"codeberg.org/codeberg/daemon/internal/httpserver"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/supervisor"
	"codeberg.org/codeberg/daemon/internal/tools"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

const startupTimeoutPerRepo = 5 * time.Minute

// startupTimeout scales with repo count — a first `--all` run may cold-index
// several repos back to back through one embedder — but stays bounded.
func startupTimeout(repos int) time.Duration {
	if repos < 1 {
		repos = 1
	}
	d := time.Duration(repos) * startupTimeoutPerRepo
	if max := 60 * time.Minute; d > max {
		return max
	}
	return d
}

func main() {
	cfg, err := config.LoadDaemon()
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	sup, err := supervisor.Start(ctx, cfg.Indexer)
	if err != nil {
		log.Fatal(err)
	}
	defer sup.Stop()

	idx := indexctl.NewClient(cfg.Socket)

	readyCtx, readyCancel := context.WithTimeout(ctx, startupTimeout(len(cfg.Roots)))
	st, err := indexctl.WaitReady(readyCtx, idx)
	readyCancel()
	if err != nil {
		log.Fatalf("indexer not ready: %v", err)
	}
	log.Printf("indexer ready: %d chunks, version %s", st.Chunks, st.Version)

	go gitpull.Run(ctx, cfg.GitDirs, cfg.GitPull)

	repos := make([]workspace.RepoInfo, 0, len(cfg.Roots))
	roots := make([]string, 0, len(cfg.Roots))
	for _, r := range cfg.Roots {
		repos = append(repos, workspace.RepoInfo{Key: r.Key, Root: r.Path})
		roots = append(roots, r.Key+"="+r.Path)
	}

	ws := workspace.New(repos, cfg.DefaultKey)
	srv := httpserver.New(idx, tools.Default(ws, idx))

	log.Printf("codeberg-d: roots=[%s] http=:%s socket=%s", strings.Join(roots, " "), cfg.HTTPPort, cfg.Socket)

	httpSrv := &http.Server{Addr: ":" + cfg.HTTPPort, Handler: srv.Handler()}
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
