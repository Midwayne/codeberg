package config

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"codeberg.org/codeberg/launcher/internal/embedding"
)

// DaemonEnv builds the environment overlay for codeberg-d. The daemon forwards
// CODEBERG_ROOTS/CBERG_* to the C cberg-index when it spawns it.
func (c *Config) DaemonEnv() map[string]string {
	e := map[string]string{
		KeyHome:     c.Home,
		KeyHTTPPort: c.HTTPPort,
		KeySocket:   c.Socket,
		KeyLogDir:   filepath.Join(c.Home, "logs"),
	}

	putIf(e, KeyRoots, c.rootRecords())
	if c.Vector {
		c.addEmbedding(e)
	}

	putIf(e, KeyPollMS, c.PollMS)
	putIf(e, KeyIndexBin, c.IndexBin)
	putIf(e, KeyGitPullSec, c.GitPullSec)
	putIf(e, KeyGitDir, c.GitDir)

	c.addVectorMode(e)
	c.addRuntimePath(e)
	return e
}

// addEmbedding tells the indexer which model to embed with and, for models
// that do not run on ONNX, which worker process to start.
func (c *Config) addEmbedding(e map[string]string) {
	// Python-backed models are a directory of weights, not a single file.
	embedModel := c.EmbedModel
	if c.usesPythonWorker() {
		embedModel = filepath.Dir(embedModel)
	}

	e[KeyEmbedModel] = embedModel
	e[KeyIndexPath] = c.IndexPath
	e[KeyEmbedBackend] = c.EmbedBackend

	if c.EmbedBackend == "onnx" {
		return
	}

	root, _ := c.ResolveRoot()
	e["CBERG_EMBED_WORKER"] = filepath.Join(root, "scripts", "embedding_worker.py")

	if c.usesPythonWorker() {
		model, _ := embedding.Lookup(c.Embedding)
		e["CBERG_EMBED_PYTHON"] = filepath.Join(model.VenvPath(c.Home), "bin", "python")
	}

	putIf(e, "CBERG_LLAMA_SERVER", os.Getenv("CBERG_LLAMA_SERVER"))
}

func (c *Config) usesPythonWorker() bool {
	switch c.EmbedBackend {
	case "mlx", "gemma-mlx", "sentence-transformers":
		return true
	}

	return false
}

// AgentEnv builds the environment overlay for the Node agent.
func (c *Config) AgentEnv() map[string]string {
	e := map[string]string{
		KeyModel:     c.Model,
		KeyDaemonURL: c.DaemonURL,
		KeyLogDir:    filepath.Join(c.Home, "logs"),
	}

	putIf(e, KeyReasoning, c.Reasoning)
	putIf(e, KeySubagentModel, c.SubagentModel)

	// Include configured storage outside CODEBERG_HOME in resource accounting.
	if c.Vector {
		putIf(e, KeyEmbedModel, c.EmbedModel)
		putIf(e, KeyIndexPath, c.IndexPath)
	}

	// codeberg-web reads this for its local HTTP listener.
	putIf(e, KeyWebPort, c.WebPort)

	// Pass the master switch, initial search preference, and optional external
	// endpoint. The browser server obtains managed endpoints via private control.
	e[KeyWebUse] = strconv.FormatBool(c.WebUse)
	e[KeyWebSearchUse] = strconv.FormatBool(c.WebSearchUse)
	e[KeyLearningUse] = strconv.FormatBool(c.LearningUse)
	putIf(e, KeySearxngURL, c.SearxngURL)

	// MCP: the agent discovers mcp.json itself; we pass home + indexed roots so
	// it finds ~/.codeberg/mcp.json and per-repo configs even though the child
	// cwd is the codeberg checkout/dist, not the indexed tree.
	e[KeyHome] = c.Home
	e[KeyMcpUse] = strconv.FormatBool(c.McpUse)
	putIf(e, KeyMcpConfig, c.McpConfig)
	putIf(e, KeyRoots, c.rootRecords())

	e[KeyDbmcpUse] = strconv.FormatBool(c.DbmcpUse)
	putIf(e, KeyDbmcpSpec, c.DbmcpSpec)
	if c.DbmcpUse {
		putIf(e, KeyDbmcpBin, c.DbmcpBinary())
	}

	for k, v := range c.Passthrough {
		e[k] = v
	}

	c.addVectorMode(e)
	c.addRuntimePath(e)
	return e
}

// rootRecords encodes the served repos as newline-separated "key\tpath"
// records, the CODEBERG_ROOTS wire format. Empty when no roots are set.
func (c *Config) rootRecords() string {
	records := make([]string, 0, len(c.Roots))
	for _, r := range c.Roots {
		records = append(records, r.Key+"\t"+r.Root)
	}

	return strings.Join(records, "\n")
}

func putIf(m map[string]string, k, v string) {
	if v != "" {
		m[k] = v
	}
}
