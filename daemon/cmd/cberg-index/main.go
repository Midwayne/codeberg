package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/indexer"
)

func main() {
	cfg, err := config.LoadIndexer()
	if err != nil {
		log.Fatal(err)
	}
	idx, err := indexer.Open(cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer idx.Close()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	log.Printf("cberg-index: root=%s vectors=%v", cfg.Root, cfg.Vectors)
	if err := idx.Bootstrap(ctx); err != nil {
		log.Fatal(err)
	}
	log.Print("bootstrap complete")
	if err := idx.Run(ctx); err != nil && err != context.Canceled {
		log.Fatal(err)
	}
}
