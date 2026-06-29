import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_PATH,
  META_PATH,
  createWebServer,
  type ChatResponder,
  type WebServerOptions,
} from "./server.js";

// `agent` is unused when `respond` is injected; cast a stub so the tests can
// drive routing without a live model.
const stubAgent = {} as WebServerOptions["agent"];

let baseUrl = "";
let close: (() => Promise<void>) | undefined;
const tempDirs: string[] = [];

async function start(opts: Partial<WebServerOptions> = {}): Promise<string> {
  const server = createWebServer({ agent: stubAgent, title: "test-title", ...opts });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

function makeStaticRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "codeberg-web-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>spa</title><div id=root></div>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log('hi')");
  return dir;
}

afterEach(async () => {
  await close?.();
  close = undefined;
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("web server", () => {
  it("serves the embedded fallback page (no build) with the title substituted", async () => {
    await start();
    const res = await fetch(baseUrl + "/");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("test-title");
    expect(body).toContain('id="messages"');
    expect(body).not.toContain("{{TITLE}}");
  });

  it("escapes the title to avoid HTML injection in the fallback page", async () => {
    await start({ title: '<script>"x"' });
    const body = await (await fetch(baseUrl + "/")).text();
    expect(body).toContain("&lt;script&gt;&quot;x&quot;");
    expect(body).not.toContain('<script>"x"');
  });

  it("returns model/daemon metadata for the title bar", async () => {
    await start({ title: "codeberg · m · d" });
    const res = await fetch(baseUrl + META_PATH);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ title: "codeberg · m · d" });
  });

  it("404s unknown API routes (any method) but serves the app for other GETs", async () => {
    await start();
    // unknown API path / wrong method -> 404, not the SPA
    expect((await fetch(baseUrl + "/api/nope")).status).toBe(404);
    expect((await fetch(baseUrl + CHAT_PATH)).status).toBe(404); // GET on chat
    // unknown non-API GET -> serves the app (SPA fallback)
    expect((await fetch(baseUrl + "/some/route")).status).toBe(200);
    // unknown non-GET -> 404
    expect((await fetch(baseUrl + "/whatever", { method: "PUT" })).status).toBe(404);
  });

  it("serves the built SPA and hashed assets when a build is present", async () => {
    const staticRoot = makeStaticRoot();
    await start({ staticRoot });

    const index = await fetch(baseUrl + "/");
    expect(await index.text()).toContain("<title>spa</title>");

    const asset = await fetch(baseUrl + "/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await asset.text()).toBe("console.log('hi')");

    // client-side route -> index.html (SPA fallback)
    const spa = await fetch(baseUrl + "/deep/link");
    expect(await spa.text()).toContain("<title>spa</title>");
  });

  it("blocks path traversal out of the static root", async () => {
    const staticRoot = makeStaticRoot();
    await start({ staticRoot });
    // encoded traversal should not escape the root; falls back to index.html
    const res = await fetch(baseUrl + "/..%2f..%2f..%2fetc%2fpasswd");
    const body = await res.text();
    expect(body).not.toContain("root:");
    expect(body).toContain("<title>spa</title>");
  });

  it("routes posted messages to the responder and streams its output", async () => {
    let received: unknown[] | undefined;
    const respond: ChatResponder = async (res: ServerResponse, messages) => {
      received = messages;
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("streamed");
    };
    await start({ respond });

    const messages = [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }];
    const res = await fetch(baseUrl + CHAT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    expect(await res.text()).toBe("streamed");
    expect(received).toEqual(messages);
  });

  it("defaults to an empty message list on a malformed body", async () => {
    let received: unknown[] | undefined;
    const respond: ChatResponder = async (res, messages) => {
      received = messages;
      res.end("ok");
    };
    await start({ respond });

    await fetch(baseUrl + CHAT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(received).toEqual([]);
  });
});
