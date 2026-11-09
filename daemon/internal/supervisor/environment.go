package supervisor

import (
	"strconv"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/procenv"
)

// indexerEnv lists every setting the indexer reads. Empty values are removed
// from the inherited environment, so a project indexer never picks up another
// project's roots or an embedding setting the config turned off.
func indexerEnv(cfg config.Indexer) map[string]string {
	return map[string]string{
		config.EnvSocket:       cfg.Socket,
		config.EnvPollMS:       strconv.Itoa(cfg.PollMS),
		config.EnvRoots:        config.FormatRoots(cfg.Roots),
		config.EnvModel:        cfg.Model,
		config.EnvEmbedBackend: cfg.EmbedBackend,
		config.EnvEmbedWorker:  cfg.EmbedWorker,
		config.EnvEmbedPython:  cfg.EmbedPython,
		config.EnvLlamaServer:  cfg.LlamaServer,
		config.EnvIndexPath:    cfg.Index,
		config.EnvIndexBackend: cfg.IndexBackend,
		config.EnvIndexQuant:   cfg.IndexQuant,
		config.EnvVectorDBURL:  cfg.VectorDBURL,
		config.EnvVectorDBKey:  cfg.VectorDBKey,
		config.EnvPostgresURL:  cfg.PostgresURL,
	}
}

// Preserve loader/certificate settings while replacing every indexer setting.
func processEnv(cfg config.Indexer) []string {
	return procenv.Overlay(indexerEnv(cfg))
}
