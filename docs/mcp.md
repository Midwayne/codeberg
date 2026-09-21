# MCP configuration

The Codeberg agent can load [Model Context Protocol](https://modelcontextprotocol.io)
servers from JSON files, using the same `mcpServers` shape as
[Cursor](https://docs.cursor.com/context/model-context-protocol).

Tools from those servers are registered last (so they cannot shadow
`search_code` or other built-ins) and named `mcp_<server>_<tool>`.

## Files

Later files override the same server name.

| File | When |
|------|------|
| `~/.codeberg/mcp.json` (or `$CODEBERG_HOME/mcp.json`) | Always, if present |
| `<indexed-root>/.cursor/mcp.json` | Each repo this session indexes |
| `<indexed-root>/.codeberg/mcp.json` | Same, and wins over `.cursor/mcp.json` in that root |
| `$CODEBERG_MCP_CONFIG` | Extra path(s), comma-separated |

`codeberg config init` writes an empty `~/.codeberg/mcp.json`. Project files are
optional — drop a `.cursor/mcp.json` in a repo you already use with Cursor and
Codeberg will pick it up when that repo is indexed.

When no `CODEBERG_ROOT` / `CODEBERG_ROOTS` is set (standalone `codeberg-tui`
inside a project), the agent uses the git root of the current directory.

The launcher always sets `CODEBERG_HOME` and `CODEBERG_ROOTS` on the agent
process so discovery follows the indexed repos, not the launcher's working
directory (the codeberg checkout).

Disable everything with `CODEBERG_MCP_USE=false`.

To reuse Cursor's **global** file without copying it:

```sh
codeberg config set CODEBERG_MCP_CONFIG=~/.cursor/mcp.json
```

## Format

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${env:GITHUB_PERSONAL_ACCESS_TOKEN}"
      }
    },
    "docs": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${env:MCP_TOKEN}"
      }
    }
  }
}
```

| Field | Transport | Notes |
|-------|-----------|--------|
| `command` + `args` | stdio | Local process. Optional `cwd`, `env`, `envFile`. |
| `url` | http or sse | Remote. Optional `headers`. `type` defaults to `http`, or `sse` when the path is `/sse`. |
| `type` | either | `stdio`, `http` / `streamable-http`, `sse`. |
| `disabled` / `enabled` | either | `disabled: true` or `enabled: false` skips the server. |

The VS Code key `"servers"` is accepted as an alias for `"mcpServers"`. If both
are present, `mcpServers` wins on a name collision.

A fuller example lives at
[`launcher/internal/config/mcp.json.example`](../launcher/internal/config/mcp.json.example).

## Interpolation

String fields (`command`, `args`, `url`, `headers`, `env`, `cwd`, `envFile`)
expand:

| Token | Value |
|-------|--------|
| `${env:NAME}` / `${NAME}` | process environment |
| `${workspaceFolder}` / `${workspaceRoot}` | project directory that owns the file (or the first indexed root for the global file) |
| `${userHome}` | home directory |
| `${input:…}` | empty (Codeberg has no interactive MCP prompts) |

Keep secrets in the environment (or an `envFile`); do not commit tokens in
`mcp.json`.

## Failures

A server that fails to spawn or handshake is skipped. The rest of the agent —
code search, web tools, other MCP servers — keeps running. Look for
`› MCP:` lines on stderr.

## Built-in database server

[multi-db-mcp-server](https://github.com/Midwayne/multi-db-mcp-server) is a
built-in stdio MCP server for MongoDB, PostgreSQL, and Redis. The source is
the git submodule `third_party/multi-db-mcp-server` (branch `main`), so tool
changes upstream are pulled in rather than copied into this tree:

```sh
make update-dbmcp   # git submodule update --remote, then rebuild build/dbmcp
```

It is off until you opt in.

1. Build the binary (the `codeberg` launcher does this when the flag is on):

   ```sh
   make build-dbmcp
   ```

2. Add a spec in the codeberg config directory. `spec.yml` is preferred;
   `spec.yaml` is accepted. Recipes and the field reference live in the
   submodule (`README.md`, `spec.example.yaml`) — do not commit passwords.
   `${ENV_VAR}` in the spec expands from the agent process environment.

   ```yaml
   connections:
     - name: app
       type: postgres
       uri: ${POSTGRES_URI}
       access: read_only
   ```

3. Turn it on:

   ```sh
   CODEBERG_DBMCP_USE=true
   ```

   `0` / `false` / `off` / `no` (or leaving it unset) keeps it disabled.
   `CODEBERG_MCP_USE=false` disables `mcp.json` servers only; this flag is
   independent.

Optional overrides: `CODEBERG_DBMCP_SPEC` (spec path) and `CODEBERG_DBMCP_BIN`
(binary path). An `mcp.json` server named `databases` replaces the built-in
command.

When the flag is on, the spec is readable, and the process completes the MCP
handshake, the agent registers that server's tools as `mcp_databases_<tool>`
and lists them in the system prompt. The prompt tells the agent to list the
databases on each connection — including their schemas, collections, and
tables — and to map those names onto the code it searches. A missing spec, a missing binary, or a
server that exits (for example a database down while `fail_on_connect_error`
is true) is skipped. Code search and other MCP servers keep running.

## Related

- Agent environment variables: [agent/README.md](../agent/README.md)
- Launcher config reference: [launcher/internal/config/config.example](../launcher/internal/config/config.example)
