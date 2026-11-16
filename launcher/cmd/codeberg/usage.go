package main

import (
	"fmt"
	"os"
)

// usageText is the top-level help printed by `codeberg help` and on bad usage.
const usageText = `codeberg — launch the code-search stack (core + daemon + browser agent)

One command builds anything missing, starts the daemon (which brings up the C
indexer), waits for it to be healthy, and opens the agent chat — like claude.

USAGE
  codeberg [flags]               boot everything and open the browser chat
  codeberg run [flags]           explicit form of the default command
  codeberg <dir>                 index/search that directory (same as --root <dir>)
  codeberg --all [flags]         search every previously indexed repo combined
  codeberg --repos a,b [flags]   serve a chosen set of dirs and/or repo keys
  codeberg --no-index [flags]    one-off run: register nothing, build no index
  codeberg --no-vector [flags]   skip embedding setup and semantic tools
  codeberg --verbose [flags]     show component checks and daemon/indexer logs
  codeberg build [flags]         (re)build/download components and the model
  codeberg doctor                check toolchains, binaries, and resolved config
  codeberg config [sub]          view/change configuration (see below)
  codeberg repos                 list registered repos (what --all will search)
  codeberg learning <command>    search learning/knowledge or export datasets
  codeberg clean-index [--dry-run]  prune cached per-directory vector indexes
  codeberg uninstall             remove the command; ask before deleting data
  codeberg version
  codeberg help                  show this help

FLAG REFERENCE
  codeberg run --help            startup flags (also codeberg --help)
  codeberg build --help          build flags
  Launcher flag help currently prints usage and exits with status 1.

CONFIGURE (changeable any time after install)
  codeberg config                print the resolved config (secrets masked)
  codeberg config path           print the config file path
  codeberg config get KEY        print one resolved value
  codeberg config set KEY=VALUE  set one or more values (KEY=VALUE ...)
  codeberg config unset KEY      remove a value
  codeberg config edit           open the config file in $EDITOR
  codeberg config init           write a starter config file and mcp.json

  Config is read fresh on every run from four layers, highest precedence first:
    1. CLI flags        e.g. codeberg --root ~/proj --model openai:gpt-4o
    2. environment      e.g. CODEBERG_MODEL=… ANTHROPIC_API_KEY=…
    3. ~/.codeberg/config   (KEY=VALUE; written by config set / edit / init)
    4. built-in defaults
  Changes take effect the next time you run codeberg (it restarts the daemon
  each session, so a new root or model is picked up automatically).

COMMON TASKS
  First run:        codeberg config set CODEBERG_MODEL=anthropic:claude-haiku-4-5 \
                      ANTHROPIC_API_KEY=sk-ant-… ; codeberg
                      (choose Add project in the browser)
  Switch model:     codeberg config set CODEBERG_MODEL=openai:gpt-4o ; codeberg
  Index another repo: codeberg ~/other                   (registers it; overrides --root)
  Search all repos: codeberg --all
                      (everything ever indexed; see: codeberg repos)
  Pin several repos: codeberg --root ~/a,~/b
  A chosen subset:  codeberg --repos ~/proj-a,api        (dirs and/or repo keys)
  Leave no trace:   codeberg ~/scratch --no-index        (not registered, no index)
  No embeddings:    codeberg --no-vector                 (skip model and semantic tools)
  Save that mode:   codeberg config set CODEBERG_VECTOR=false
  What's installed: codeberg doctor

KEY SETTINGS
  CODEBERG_ALL      true = search all registered repos (--all)
  CODEBERG_REPOS    comma-separated dirs/keys to serve (--repos)
  CODEBERG_NO_INDEX true = register nothing, no index  (--no-index)
  CODEBERG_VERBOSE  true = detailed startup output     (--verbose)
  CODEBERG_MODEL    LLM as provider:model          (--model)
                     optional when $CODEBERG_HOME/models.yml exists
  CODEBERG_SUBAGENT_MODEL  background knowledge model; defaults to CODEBERG_MODEL
  CODEBERG_LEARNING_USE   false = disable learning and feedback (default true)
  CODEBERG_VECTOR   false = skip model and semantic tools (--no-vector)
  CODEBERG_HTTP_PORT  daemon port (default 48080)  (--port)
  CODEBERG_WEB_PORT   browser UI port (default 48088)  (--web-port)
  CODEBERG_REASONING  reasoning effort             (--reasoning)
  CODEBERG_MCP_USE    false = disable MCP servers from mcp.json
  CODEBERG_DBMCP_USE  true = built-in database MCP (needs ~/.codeberg/spec.yml)
  ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY

Note: there is no in-chat /config. Configure from this CLI (above) instead.
`

func usage(w *os.File) {
	fmt.Fprint(w, usageText)
}
