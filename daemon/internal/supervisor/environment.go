package supervisor

import (
	"fmt"

	"codeberg.org/codeberg/daemon/internal/config"
)

func indexerEnv(cfg config.Indexer) []string {
	env := []string{
		config.EnvRoot + "=" + cfg.Root,
		config.EnvSocket + "=" + cfg.Socket,
		fmt.Sprintf("%s=%d", config.EnvPollMS, cfg.PollMS),
	}

	// Preserve configured keys even for a single root; the engine otherwise
	// derives a basename key that may differ from the daemon's workspace key.
	if len(cfg.Roots) > 0 {
		env = append(env, config.EnvRoots+"="+config.FormatRoots(cfg.Roots))
	}

	env = embeddingEnv(env, cfg)

	if cfg.Index != "" {
		env = append(env, config.EnvIndexPath+"="+cfg.Index)
	}

	if cfg.IndexBackend != "" {
		env = append(env, config.EnvIndexBackend+"="+cfg.IndexBackend)
	}

	if cfg.IndexQuant != "" {
		env = append(env, config.EnvIndexQuant+"="+cfg.IndexQuant)
	}

	if cfg.VectorDBURL != "" {
		env = append(env, config.EnvVectorDBURL+"="+cfg.VectorDBURL)
	}

	if cfg.VectorDBKey != "" {
		env = append(env, config.EnvVectorDBKey+"="+cfg.VectorDBKey)
	}

	if cfg.PostgresURL != "" {
		env = append(env, config.EnvPostgresURL+"="+cfg.PostgresURL)
	}

	return env
}

func embeddingEnv(env []string, cfg config.Indexer) []string {
	if cfg.Model != "" {
		env = append(env, config.EnvModel+"="+cfg.Model)
	}

	for key, value := range map[string]string{
		config.EnvEmbedBackend: cfg.EmbedBackend,
		config.EnvEmbedWorker:  cfg.EmbedWorker,
		config.EnvEmbedPython:  cfg.EmbedPython,
		config.EnvLlamaServer:  cfg.LlamaServer,
	} {
		if value != "" {
			env = append(env, key+"="+value)
		}
	}

	return env
}
