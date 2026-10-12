An MCP server connects the agent to tools provided by another process or service. Examples include documentation lookup, issue trackers, and database queries. MCP is optional; Codeberg's built-in source tools work without it.

## Add a server in Settings

1. Select a project, then open **Settings → MCP servers**.
2. Choose the current project's name or **All projects** as the scope.
3. Enter a unique server name and its server configuration JSON.
4. Choose **Add MCP server**. It becomes available on the next chat turn.

The form accepts a single server object, not the entire `mcpServers` file. For an HTTP server, use its actual endpoint:

```json
{
  "url": "https://your-service.example/mcp",
  "headers": {
    "Authorization": "Bearer ${env:MCP_TOKEN}"
  }
}
```

For a local server, provide `command` and `args`, for example `{"command":"your-mcp-server","args":[]}`. Install the executable separately and ensure it is available to Codeberg. A saved entry is configuration, not proof that the server is running or reachable.

MCP servers can expose actions that change external data. Review the server's capabilities and credentials before connecting it, and state your intent clearly when asking the agent to perform an action.

## Use an existing configuration file

The global `mcp.json` uses this structure:

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

Codeberg discovers global `mcp.json`, repository `.cursor/mcp.json` and `.codeberg/mcp.json`, optional extra files from `CODEBERG_MCP_CONFIG`, and the selected project's stored configuration. Later definitions override the same name; project storage takes precedence. The `servers` key is also accepted; `mcpServers` wins on collisions within a file.

To reuse another global file:

```sh
codeberg config set CODEBERG_MCP_CONFIG=~/.cursor/mcp.json
```

String fields support `${env:NAME}` or `${NAME}` for environment values, `${workspaceFolder}` for the selected repository, and `${userHome}` for your home directory. Export extension credentials in the environment used to launch Codeberg; arbitrary MCP secrets are not automatically forwarded from the launcher's config file. Restart when changing process environment values.

## Understand tool loading

The agent first sees the server's tool catalog, then loads the tools relevant to your request with `load_mcp_tools`. MCP tools are named `mcp_<server>_<tool>` and cannot replace built-in source tools. This keeps large catalogs out of every model request.

If a server is missing, fails its handshake, or lacks credentials, inspect warnings in Settings and the project logs. Other tools can remain available. Set `CODEBERG_MCP_USE=false` to disable file-configured servers.

## Optional database MCP

The built-in database server supports MongoDB, PostgreSQL, and Redis. It needs its binary, a connection spec, and `CODEBERG_DBMCP_USE=true`. A source install can build it with `make build-dbmcp`. A new project's default spec lives in its config directory as `spec.yml` or `spec.yaml`.

An illustrative connection spec is:

```yaml
connections:
  - name: app
    type: postgres
    uri: ${POSTGRES_URI}
    access: read_only
```

Export the connection credential, use the access level you intend, then restart. `CODEBERG_DBMCP_BIN` can point at an existing executable. Use the config directory shown in Settings for a new project's spec; an upgraded legacy workspace can retain its explicit `CODEBERG_DBMCP_SPEC` path. The database switch is independent of `CODEBERG_MCP_USE`; a configured server named `databases` replaces the built-in command.
