MCP servers connect the agent to external tools, such as issue trackers or databases. Built-in source tools work without MCP.

## Add a server

1. Open **Settings → MCP servers**.
2. Choose the current project or **All projects**.
3. Enter a unique name and one server configuration object.
4. Choose **Add MCP server**; use it on the next chat turn.

For an HTTP server, replace the endpoint:

```json
{
  "url": "https://your-service.example/mcp",
  "headers": {
    "Authorization": "Bearer ${env:MCP_TOKEN}"
  }
}
```

For a local process, install the executable separately:

```json
{
  "command": "your-mcp-server",
  "args": []
}
```

A saved entry does not confirm the server is reachable. MCP tools may change external data; check capabilities and state the intended actions in your request.

## Configure a file

Global `~/.codeberg/mcp.json` wraps named servers in `mcpServers`:

```json
{
  "mcpServers": {
    "my-service": {
      "command": "your-mcp-server",
      "args": [],
      "env": { "MCP_TOKEN": "${env:MCP_TOKEN}" }
    }
  }
}
```

Discovery order, lowest priority first:

1. Global `mcp.json`.
2. Repository `.cursor/mcp.json`, then `.codeberg/mcp.json`.
3. Extra files in `CODEBERG_MCP_CONFIG`.
4. Selected project's stored configuration.

Later definitions replace matching names. `servers` is also accepted; `mcpServers` wins collisions within a file.

To reuse another file:

```sh
codeberg config set CODEBERG_MCP_CONFIG=~/.cursor/mcp.json
```

| Placeholder | Resolves to |
| --- | --- |
| `${env:NAME}`, `${NAME}` | Process environment value. |
| `${workspaceFolder}` | Selected repository. |
| `${userHome}` | User home directory. |

Export extension secrets before launching; arbitrary secret names in launcher config are not forwarded. Restart after environment changes.

## Tool loading

The agent sees server catalogs and loads relevant tools through `load_mcp_tools`. Names use `mcp_<server>_<tool>` and cannot replace built-ins.

For handshake or credential failures, inspect Settings warnings and project logs. Set `CODEBERG_MCP_USE=false` to disable file-configured servers.

## Database MCP

The built-in server supports MongoDB, PostgreSQL, and Redis. It needs its binary, a connection spec, and `CODEBERG_DBMCP_USE=true`. Source installs can run `make build-dbmcp`.

Create `spec.yml` or `spec.yaml` in the project's config directory shown in Settings. For example:

```yaml
connections:
  - name: app
    type: postgres
    uri: ${POSTGRES_URI}
    access: read_only
```

Export the credential, choose the intended access level, and restart. `CODEBERG_DBMCP_BIN` overrides the executable; legacy workspaces may retain `CODEBERG_DBMCP_SPEC` paths.

Database MCP is independent of `CODEBERG_MCP_USE`. A configured server named `databases` replaces the built-in command.
