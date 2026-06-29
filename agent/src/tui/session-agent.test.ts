import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelMessage, ToolLoopAgent } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionStore } from "./session-store.js";
import { wrapSessionAgent } from "./session-agent.js";

/** A stand-in `ToolLoopAgent` that records the prompt it was asked to run. */
function fakeAgent(answer = "model answer") {
  const calls: ModelMessage[][] = [];
  const agent = {
    tools: {},
    stream: async (params: { prompt: ModelMessage[] }) => {
      calls.push(params.prompt);
      return { fullStream: textStream(answer) };
    },
  } as unknown as ToolLoopAgent;
  return { agent, calls };
}

async function* textStream(text: string): AsyncGenerator<unknown> {
  yield { type: "text-start", id: "x" };
  yield { type: "text-delta", id: "x", text };
  yield { type: "text-end", id: "x" };
  yield { type: "finish", finishReason: "stop" };
}

async function collect(result: { fullStream: AsyncIterable<unknown> }): Promise<string> {
  let out = "";
  for await (const part of result.fullStream as AsyncIterable<{
    type?: string;
    text?: string;
  }>) {
    if (part.type === "text-delta") {
      out += part.text ?? "";
    }
  }
  return out;
}

/** Drives the wrapped agent the way the sealed runner does: push user, stream, push assistant. */
function makeDriver(wrapped: ToolLoopAgent) {
  const transcript: ModelMessage[] = [];
  return {
    transcript,
    async send(text: string): Promise<string> {
      transcript.push({ role: "user", content: text });
      const result = (await wrapped.stream({
        prompt: [...transcript],
      } as never)) as unknown as { fullStream: AsyncIterable<unknown> };
      const reply = await collect(result);
      transcript.push({ role: "assistant", content: reply });
      return reply;
    },
  };
}

describe("wrapSessionAgent", () => {
  let dir: string;
  let store: SessionStore;
  let ids: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "codeberg-session-agent-"));
    store = new SessionStore(dir);
    ids = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function wrap(answer?: string) {
    const { agent, calls } = fakeAgent(answer);
    const wrapped = wrapSessionAgent(agent, {
      store,
      modelSpec: "test:model",
      now: () => 1000,
      newId: () => `s${ids++}`,
    });
    return { wrapped, calls };
  }

  it("answers /help locally without calling the model", async () => {
    const { wrapped, calls } = wrap();
    const reply = await makeDriver(wrapped).send("/help");
    expect(reply).toContain("Commands:");
    expect(reply).toContain("/sessions");
    expect(calls).toHaveLength(0);
  });

  it("persists real turns and lists them via /sessions", async () => {
    const { wrapped, calls } = wrap("the token expires");
    const driver = makeDriver(wrapped);

    expect(await driver.send("why does login fail?")).toBe("the token expires");
    expect(calls).toHaveLength(1);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "why does login fail?", turns: 1 });

    const reply = await driver.send("/sessions");
    expect(reply).toContain(list[0]!.id);
    expect(reply).toContain("why does login fail?");
  });

  it("keeps command exchanges out of the model's context", async () => {
    const { wrapped, calls } = wrap();
    const driver = makeDriver(wrapped);

    await driver.send("/sessions");
    await driver.send("real question");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([{ role: "user", content: "real question" }]);
  });

  it("prepends a resumed session's history to later turns", async () => {
    await store.save({
      id: "a3f2",
      title: "old chat",
      modelSpec: "test:model",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { role: "user", content: "old q" },
        { role: "assistant", content: "old a" },
      ],
    });

    const { wrapped, calls } = wrap();
    const driver = makeDriver(wrapped);

    const resumed = await driver.send("/resume a3f2");
    expect(resumed).toContain('Resumed "old chat"');
    expect(calls).toHaveLength(0);

    await driver.send("now what?");
    expect(calls[0]).toEqual([
      { role: "user", content: "old q" },
      { role: "assistant", content: "old a" },
      { role: "user", content: "now what?" },
    ]);
  });

  it("reports an unknown session id", async () => {
    const { wrapped } = wrap();
    const reply = await makeDriver(wrapped).send("/resume nope");
    expect(reply).toContain("No session matches");
  });

  it("/new drops earlier turns from context", async () => {
    const { wrapped, calls } = wrap();
    const driver = makeDriver(wrapped);

    await driver.send("first");
    await driver.send("/new");
    await driver.send("second");

    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual([{ role: "user", content: "second" }]);
  });
});
