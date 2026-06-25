# HTTP API (`codeberg-d`)

Pure Go daemon. Semantic search is proxied to the C `cberg-index` process over a Unix socket.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Daemon + indexer status (`ready`, `chunks`, `version`) |
| `GET` | `/search?q=…&k=10` | Vector search (requires `CBERG_MODEL` + `CBERG_INDEX_PATH`) |
| `GET` | `/tools` | List registered read-only agent tools |
| `POST` | `/tools/call` | Run a tool: `{"name":"grep","args":{…}}` |

## Tools

All tools are read-only and sandboxed to `CODEBERG_ROOT`:

`grep`, `glob`, `read_file`, `list_dir`, `tree`, `head`, `tail`, `wc`, `sed`, `pipe`, `git_log`, `git_blame`

### `pipe` — read-only pipelines

Runs a chained pipeline over the repo in one call, so the agent can combine search
and filtering without multiple round-trips:

```json
{"name":"pipe","args":{"command":"rg -l 'func main' --glob '*.go' | head -20"}}
```

Returns `{"command", "stdout", "truncated", "exit_codes"}`. **No shell is invoked** —
the command is tokenized (quote-aware), split on `|`, and each stage is exec'd
directly with `Dir = CODEBERG_ROOT`. Therefore:

- **Allowed commands:** `rg`, `grep`, `head`, `tail`, `wc`, `sort`, `uniq`, `cut`,
  `tr`, `nl`, `cat`, `paste`, `sed` (read-only script, as the `sed` tool). `awk` and
  `xargs` are excluded (they can execute arbitrary commands).
- **Rejected (400):** redirection/substitution/sequencing (`>`, `<`, `;`, `&`, `$()`,
  backticks), write/exec flags (`rg --pre`, `sort -o`, `sed -i`), and any command not
  on the allowlist.
- **Rejected (403):** absolute paths or `..` traversal in any argument.
- Output is capped (`truncated` flag); the run has a timeout; a stage exiting nonzero
  (e.g. `rg` finding nothing) is reported in `exit_codes`, not an error.
