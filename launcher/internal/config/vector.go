package config

import "strconv"

// Explicitly override inherited settings when embeddings are off, including
// when bootstrap falls back after a model setup failure.
func (c *Config) addVectorMode(env map[string]string) {
	env[KeyVector] = strconv.FormatBool(c.Vector)
	if c.Vector {
		return
	}

	for _, key := range []string{
		KeyEmbedModel, KeyIndexPath, KeyEmbedBackend,
		"CBERG_EMBED_WORKER", "CBERG_EMBED_PYTHON", "CBERG_LLAMA_SERVER",
	} {
		env[key] = ""
	}
}
