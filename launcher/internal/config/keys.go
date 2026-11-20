package config

import (
	"sort"
	"strconv"
	"strings"
)

// settings maps every canonical key to its resolved value (after all layers).
// It is the single list of keys the launcher reads besides passthroughKeys.
func (c *Config) settings() map[string]string {
	return map[string]string{
		KeyModel:         c.Model,
		KeySubagentModel: c.SubagentModel,
		KeyDaemonURL:     c.DaemonURL,
		KeyHTTPPort:      c.HTTPPort,
		KeyEmbedModel:    c.EmbedModel,
		KeyEmbedding:     c.Embedding,
		KeyIndexPath:     c.IndexPath,
		KeySocket:        c.Socket,
		KeyPollMS:        c.PollMS,
		KeyIndexBin:      c.IndexBin,
		KeyGitPullSec:    c.GitPullSec,
		KeyGitDir:        c.GitDir,
		KeyReasoning:     c.Reasoning,
		KeyVector:        strconv.FormatBool(c.Vector),
		KeyAll:           strconv.FormatBool(c.All),
		KeyReposSel:      strings.Join(c.Repos, ","),
		KeyNoIndex:       strconv.FormatBool(c.NoIndex),
		KeyVerbose:       strconv.FormatBool(c.Verbose),
		KeyWebPort:       c.WebPort,
		KeyWebUse:        strconv.FormatBool(c.WebUse),
		KeyWebSearchUse:  strconv.FormatBool(c.WebSearchUse),
		KeyLearningUse:   strconv.FormatBool(c.LearningUse),
		KeySearxngURL:    c.SearxngURL,
		KeySearxngPort:   c.SearxngPort,
		KeyHome:          c.Home,
		KeyRepo:          c.Repo,
		KeyDist:          c.Dist,
		KeyMcpUse:        strconv.FormatBool(c.McpUse),
		KeyMcpConfig:     c.McpConfig,
		KeyDbmcpUse:      strconv.FormatBool(c.DbmcpUse),
		KeyDbmcpSpec:     c.DbmcpSpec,
		KeyDbmcpBin:      c.DbmcpBin,
		KeyScriptUse:     strconv.FormatBool(c.ScriptUse),
		KeyScriptPython:  c.ScriptPython,
		KeyScriptMcp:     c.ScriptMcp,
	}
}

// KnownKeys are the keys the launcher understands (canonical config + provider
// pass-through). Used to warn on probable typos in `config set`.
func KnownKeys() []string {
	keys := append([]string{}, passthroughKeys...)
	for key := range (&Config{}).settings() {
		keys = append(keys, key)
	}

	sort.Strings(keys)
	return keys
}

// IsKnownKey reports whether key is one the launcher reads.
func IsKnownKey(key string) bool {
	for _, k := range KnownKeys() {
		if k == key {
			return true
		}
	}

	return false
}

// Get returns the resolved value for a recognized key (after all layers), and
// whether the key is recognized. Useful for `config get`.
func (c *Config) Get(key string) (string, bool) {
	if v, ok := c.settings()[key]; ok {
		return v, true
	}

	if v, ok := c.Passthrough[key]; ok {
		return v, true
	}

	// A recognized pass-through key that is unset.
	return "", IsKnownKey(key)
}
