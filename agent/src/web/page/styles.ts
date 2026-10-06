export const PAGE_STYLES = `<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: #0d1117; color: #e6edf3;
  }
  header {
    padding: 10px 16px; border-bottom: 1px solid #30363d;
    font-size: 12px; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .msg { max-width: 760px; width: 100%; align-self: center; }
  .role { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #8b949e; margin-bottom: 4px; }
  .msg-user .text { background: #1f6feb22; border: 1px solid #1f6feb55; }
  .text { white-space: pre-wrap; word-wrap: break-word; padding: 10px 12px; border-radius: 8px; background: #161b22; border: 1px solid #30363d; }
  .reasoning { white-space: pre-wrap; color: #8b949e; font-style: italic; padding: 6px 12px; border-left: 2px solid #30363d; margin: 4px 0; }
  .tool { margin: 6px 0; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 6px 10px; }
  .tool summary { cursor: pointer; color: #d29922; font-family: ui-monospace, monospace; font-size: 13px; }
  .tool pre { margin: 8px 0 4px; padding: 8px; background: #0d1117; border-radius: 6px; overflow-x: auto; font-size: 12px; color: #adbac7; }
  .tool pre:empty { display: none; }
  .activity-group { margin: 6px 0; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 6px 10px; }
  .activity-group > summary { cursor: pointer; color: #8b949e; font-size: 13px; }
  .activity-group-body { padding: 2px 0; }
  .hit { margin: 6px 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #161b22; }
  .hit-hd { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #30363d; font-family: ui-monospace, monospace; font-size: 12px; }
  .hit-repo { color: #8b949e; background: #21262d; padding: 1px 6px; border-radius: 4px; }
  .hit-path { color: #e6edf3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hit-lines { color: #8b949e; }
  .hit-snippet { margin: 0; padding: 8px 10px; font-size: 12px; white-space: pre-wrap; color: #adbac7; }
  .grep-line { padding: 4px 10px; font-family: ui-monospace, monospace; font-size: 12px; border-top: 1px solid #21262d; color: #adbac7; }
  .error { color: #f85149; padding: 8px 12px; border: 1px solid #f8514955; border-radius: 8px; }
  form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #30363d; position: relative; }
  #prompt { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; font: inherit; }
  #prompt:focus { outline: none; border-color: #1f6feb; }
  #attachments { padding: 4px 16px; color: #8b949e; font-size: 12px; }
  button { padding: 0 18px; border-radius: 8px; border: 1px solid #238636; background: #238636; color: white; font: inherit; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  .cmdmenu { position: absolute; left: 16px; right: 16px; bottom: calc(100% + 6px); background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(0,0,0,.45); }
  .cmdrow { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; }
  .cmdrow.active { background: #1f6feb22; }
  .cmdtrigger { font-family: ui-monospace, monospace; color: #79c0ff; }
  .cmdarg { font-family: ui-monospace, monospace; font-size: 12px; color: #8b949e; }
  .cmdsummary { margin-left: auto; padding-left: 12px; font-size: 12px; color: #8b949e; }
  .cmddesc { padding: 8px 10px; border-top: 1px solid #30363d; font-size: 12px; color: #adbac7; }
</style>
</head>
`;
