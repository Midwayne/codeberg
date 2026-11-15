package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"codeberg.org/codeberg/launcher/internal/bootstrap"
	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/embedding"
)

func cmdBuild(args []string) error {
	o, err := parseShared("build", args)
	if err != nil {
		return err
	}

	c, err := config.Load(*o)
	if err != nil {
		return err
	}

	if err := selectEmbedding(c, o); err != nil {
		return err
	}

	if _, prebuilt := c.ResolveRoot(); prebuilt {
		fmt.Fprintln(os.Stderr, "running from a prebuilt install — nothing to build; checking the model only")
	} else if c.Repo == "" {
		return fmt.Errorf("no source checkout found; run inside it or pass --repo")
	}

	// An explicit build always reports every component it checked.
	c.Verbose = true

	return bootstrap.Ensure(c, true)
}

// selectEmbedding picks the embedding model before a first download and
// records the choice for subsequent runs. A fresh interactive install offers
// one keystroke to choose; otherwise the platform default is used.
func selectEmbedding(c *config.Config, o *config.Overrides) error {
	if embeddingSettled(c, o) {
		return nil
	}

	choice := embedding.Default()
	if stdinIsTerminal() {
		picked, err := promptEmbedding(choice)
		if err != nil {
			return err
		}
		choice = picked
	}

	model, _ := embedding.Lookup(choice)
	if err := model.ValidatePlatform(); err != nil {
		return err
	}

	o.Embedding = choice
	resolved, err := config.Load(*o)
	if err != nil {
		return err
	}
	*c = *resolved

	return config.SetValues(c.ConfigPath, map[string]string{config.KeyEmbedding: choice})
}

// embeddingSettled reports whether there is nothing to choose: vectors are
// off, a model was named explicitly, or an existing installation (model file
// or index on disk) must keep the model it was built with.
func embeddingSettled(c *config.Config, o *config.Overrides) bool {
	if !c.Vector || c.Embedding != "" || o.EmbedModel != "" || os.Getenv(config.KeyEmbedModel) != "" {
		return true
	}

	if _, err := os.Stat(c.EmbedModel); err == nil {
		return true
	}

	if matches, _ := filepath.Glob(c.IndexPath + ".*"); len(matches) > 0 {
		return true
	}

	value, ok := c.Get(config.KeyEmbedding)
	return ok && value != ""
}

func stdinIsTerminal() bool {
	info, err := os.Stdin.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// promptEmbedding lists the models this platform supports and reads a
// numbered choice. An empty answer keeps fallback.
func promptEmbedding(fallback string) (string, error) {
	models := embedding.List()

	fmt.Fprintln(os.Stderr, "Choose an embedding model (before download):")
	for i, model := range models {
		if model.ValidatePlatform() == nil {
			fmt.Fprintf(os.Stderr, "  %d. %s\n", i+1, model.Label)
		}
	}
	fmt.Fprintf(os.Stderr, "Selection [%s]: ", fallback)

	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	answer := strings.TrimSpace(line)
	if err != nil || answer == "" {
		return fallback, nil
	}

	n, err := strconv.Atoi(answer)
	if err != nil || n < 1 || n > len(models) {
		return "", fmt.Errorf("invalid embedding choice %q", answer)
	}

	return models[n-1].ID, nil
}
