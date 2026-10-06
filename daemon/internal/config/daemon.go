package config

import (
	"os"
	"strconv"
	"time"
)

func LoadDaemon() (Daemon, error) {
	idx, err := loadIndexer()
	if err != nil {
		return Daemon{}, err
	}

	port := os.Getenv(EnvHTTPPort)
	if port == "" {
		port = "8080"
	}

	gitDirs := make([]string, 0, len(idx.Roots))
	if dir := os.Getenv(EnvGitDir); dir != "" {
		gitDirs = append(gitDirs, dir)
	} else {
		for _, r := range idx.Roots {
			gitDirs = append(gitDirs, r.Root)
		}
	}

	var pull time.Duration
	if v := os.Getenv(EnvGitPullSec); v != "" {
		sec, err := strconv.Atoi(v)
		if err != nil || sec < 0 {
			return Daemon{}, invalid(EnvGitPullSec)
		}

		pull = time.Duration(sec) * time.Second
	}
	return Daemon{
		Indexer:  idx,
		HTTPPort: port,
		GitPull:  pull,
		GitDirs:  gitDirs,
	}, nil
}

func loadIndexer() (Indexer, error) {
	roots, defaultKey, err := loadRoots()
	if err != nil {
		return Indexer{}, err
	}

	model := os.Getenv(EnvModel)
	indexPath := os.Getenv(EnvIndexPath)
	indexBackend := os.Getenv(EnvIndexBackend)
	indexQuant := os.Getenv(EnvIndexQuant)
	vectorDBURL := os.Getenv(EnvVectorDBURL)
	vectorDBKey := os.Getenv(EnvVectorDBKey)
	postgresURL := os.Getenv(EnvPostgresURL)
	poll, err := loadPollMS()
	if err != nil {
		return Indexer{}, err
	}

	socket := os.Getenv(EnvSocket)
	if socket == "" {
		socket = "/tmp/codeberg-index.sock"
	}
	return Indexer{
		Root:         roots[0].Root,
		Roots:        roots,
		DefaultKey:   defaultKey,
		Model:        model,
		EmbedBackend: os.Getenv(EnvEmbedBackend),
		EmbedWorker:  os.Getenv(EnvEmbedWorker),
		EmbedPython:  os.Getenv(EnvEmbedPython),
		LlamaServer:  os.Getenv(EnvLlamaServer),
		Index:        indexPath,
		IndexBackend: indexBackend,
		IndexQuant:   indexQuant,
		VectorDBURL:  vectorDBURL,
		VectorDBKey:  vectorDBKey,
		PostgresURL:  postgresURL,
		PollMS:       poll,
		Socket:       socket,
		Bin:          os.Getenv(EnvIndexerBin),
	}, nil
}

func loadPollMS() (int, error) {
	poll := 1000
	if v := os.Getenv(EnvPollMS); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return 0, invalid(EnvPollMS)
		}

		poll = n
	}

	if poll <= 0 {
		poll = 1000
	}

	return poll, nil
}
