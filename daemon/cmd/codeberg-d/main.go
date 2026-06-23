package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
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

const startupTimeout = 5 * time.Minute

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
	readyCtx, readyCancel := context.WithTimeout(ctx, startupTimeout)
	st, err := indexctl.WaitReady(readyCtx, idx)
	readyCancel()
	if err != nil {
		log.Fatalf("indexer not ready: %v", err)
	}
	log.Printf("indexer ready: %d chunks, version %s", st.Chunks, st.Version)

	go gitpull.Run(ctx, cfg.GitDir, cfg.GitPull)

	ws := workspace.New(cfg.Root)
	srv := httpserver.New(idx, tools.Default(ws))

	log.Printf("codeberg-d: root=%s http=:%s socket=%s", cfg.Root, cfg.HTTPPort, cfg.Socket)
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
