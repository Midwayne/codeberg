package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func LoadDaemon() (Daemon, error) {
	idx, err := loadIndexer()
	if err != nil {
		return Daemon{}, err
	}

	pull, err := loadSeconds(EnvGitPullSec)
	if err != nil {
		return Daemon{}, err
	}

	health, err := loadDuration(EnvHealthTimeout)
	if err != nil {
		return Daemon{}, err
	}

	rootPID, err := loadInt(EnvRootPID, 0)
	if err != nil {
		return Daemon{}, err
	}

	return Daemon{
		Indexer:       idx,
		Home:          loadHome(),
		LogDir:        os.Getenv(EnvLogDir),
		HTTPPort:      orDefault(os.Getenv(EnvHTTPPort), DefaultHTTPPort),
		GitPull:       pull,
		HealthTimeout: health,
		NoIndex:       isTrue(os.Getenv(EnvNoIndex)),
		RootPID:       rootPID,
	}, nil
}

func loadHome() string {
	if home := os.Getenv(EnvHome); home != "" {
		return home
	}

	userHome, _ := os.UserHomeDir()
	return filepath.Join(userHome, ".codeberg")
}

func loadIndexer() (Indexer, error) {
	roots, defaultKey, err := loadRoots()
	if err != nil {
		return Indexer{}, err
	}

	poll, err := loadInt(EnvPollMS, 1000)
	if err != nil {
		return Indexer{}, err
	}

	namespace := os.Getenv(EnvIndexNamespace)
	if namespace != "" && (namespace != filepath.Base(namespace) || strings.HasPrefix(namespace, ".")) {
		return Indexer{}, invalid(EnvIndexNamespace)
	}

	idx := Indexer{
		Roots:          roots,
		DefaultKey:     defaultKey,
		Index:          os.Getenv(EnvIndexPath),
		IndexNamespace: namespace,
		IndexBackend:   os.Getenv(EnvIndexBackend),
		IndexQuant:     os.Getenv(EnvIndexQuant),
		VectorDBURL:    os.Getenv(EnvVectorDBURL),
		VectorDBKey:    os.Getenv(EnvVectorDBKey),
		PostgresURL:    os.Getenv(EnvPostgresURL),
		PollMS:         orPositive(poll, 1000),
		Bin:            os.Getenv(EnvIndexerBin),
	}

	loadEmbedding(&idx)
	return idx, nil
}

func loadInt(name string, fallback int) (int, error) {
	v := os.Getenv(name)
	if v == "" {
		return fallback, nil
	}

	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return 0, invalid(name)
	}

	return n, nil
}

func loadSeconds(name string) (time.Duration, error) {
	sec, err := loadInt(name, 0)
	return time.Duration(sec) * time.Second, err
}

func loadDuration(name string) (time.Duration, error) {
	v := os.Getenv(name)
	if v == "" {
		return 0, nil
	}

	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		return 0, invalid(name)
	}

	return d, nil
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}

	return v
}

func orPositive(n, fallback int) int {
	if n <= 0 {
		return fallback
	}

	return n
}
