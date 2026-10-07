# Motion demo

From the repository root, run `npm run demo --prefix agent/web-ui`, then open
http://127.0.0.1:5176/demo/.

This uses the real application components with an in-memory API transport.
Requests default to a 1.5-second delay. Choose Instant or 3 seconds in the demo
bar, or use Replay loading to repeat the workspace entrance. Open Models,
Training, or a Settings section to preview their loading states.

The demo does not make model calls or write server data. Its entry and fixtures
are excluded from the production build. Stop it with Ctrl+C in its terminal.
