import { describe, expect, it } from "vitest";

import { assertFetchableUrl, isPrivateHost } from "./ssrf.js";

describe("isPrivateHost", () => {
  it("flags loopback and private hosts", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "printer.local",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it("allows public hosts and IPs", () => {
    for (const host of ["example.com", "docs.rs", "8.8.8.8", "172.32.0.1", "1.1.1.1"]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });
});

describe("assertFetchableUrl", () => {
  const pub = { allowPrivate: false };

  it("accepts http(s) public URLs and returns a URL", () => {
    expect(assertFetchableUrl("https://example.com/a", pub).hostname).toBe(
      "example.com",
    );
    expect(assertFetchableUrl("http://example.com", pub).protocol).toBe("http:");
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => assertFetchableUrl("file:///etc/passwd", pub)).toThrow(/scheme/);
    expect(() => assertFetchableUrl("ftp://example.com", pub)).toThrow(/scheme/);
    expect(() => assertFetchableUrl("not a url", pub)).toThrow(/invalid URL/);
  });

  it("rejects private/loopback hosts unless allowed", () => {
    expect(() => assertFetchableUrl("http://localhost:8080", pub)).toThrow(/private/);
    expect(() => assertFetchableUrl("http://169.254.169.254/latest", pub)).toThrow(
      /private/,
    );
    expect(
      assertFetchableUrl("http://localhost:8080", { allowPrivate: true }).hostname,
    ).toBe("localhost");
  });

  it("always blocks cloud metadata hostnames", () => {
    expect(() =>
      assertFetchableUrl("http://metadata.google.internal/x", { allowPrivate: true }),
    ).toThrow(/blocked host/);
  });
});
