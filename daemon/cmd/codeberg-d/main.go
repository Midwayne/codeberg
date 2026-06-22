package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/gitpull"
	"codeberg.org/codeberg/daemon/internal/httpserver"
	"codeberg.org/codeberg/daemon/internal/indexer"
)

func main() {
	cfg, err := config.LoadDaemon()
	if err != nil {
		log.Fatal(err)
	}
	idx, err := indexer.Open(cfg.Indexer)
	if err != nil {
		log.Fatal(err)
	}
	defer idx.Close()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	go gitpull.Run(ctx, cfg.GitDir, cfg.GitPull)

	log.Printf("indexer: root=%s vectors=%v", cfg.Root, cfg.Vectors)
	if err := idx.Bootstrap(ctx); err != nil {
		log.Fatal(err)
	}
	log.Print("bootstrap complete")

	go func() {
		if err := idx.Run(ctx); err != nil && err != context.Canceled {
			log.Printf("indexer: %v", err)
			os.Exit(1)
		}
	}()

	srv := httpserver.New(idx)
	log.Printf("http listening on :%s", cfg.HTTPPort)
	httpSrv := &http.Server{Addr: ":" + cfg.HTTPPort, Handler: srv.Handler()}
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("http: %v", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	_ = httpSrv.Shutdown(context.Background())
}
