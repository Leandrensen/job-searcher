import { describe, expect, it, vi } from "vitest";
import { createHttpClient, HttpError, USER_AGENT } from "./http";

function res(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

function setup(responses: Array<Response | Error>) {
  const queue = [...responses];
  const fetchFn = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const client = createHttpClient({ fetchFn, sleep });
  return { client, fetchFn, sleep };
}

describe("createHttpClient", () => {
  it("sends the user agent", async () => {
    const { client, fetchFn } = setup([res("{}")]);
    await client.getJson("https://example.com/a");
    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(USER_AGENT);
    expect(headers["Accept"]).toBe("application/json");
  });

  it("returns parsed json", async () => {
    const { client } = setup([res('{"a":1}')]);
    expect(await client.getJson("https://example.com/a")).toEqual({ a: 1 });
  });

  it("returns text", async () => {
    const { client, fetchFn } = setup([res("hello")]);
    expect(await client.getText("https://example.com/a")).toBe("hello");
    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Accept"]).toBeUndefined();
  });

  it("retries on 503 then succeeds", async () => {
    const { client, fetchFn, sleep } = setup([res("", 503), res("", 503), res('{"ok":true}')]);
    expect(await client.getJson("https://example.com/a")).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 2000);
  });

  it("retries on network errors", async () => {
    const { client, fetchFn } = setup([new TypeError("fetch failed"), res("{}")]);
    await client.getJson("https://example.com/a");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 404 and throws HttpError", async () => {
    const { client, fetchFn } = setup([res("", 404)]);
    await expect(client.getJson("https://example.com/a")).rejects.toBeInstanceOf(HttpError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After on 429", async () => {
    const { client, sleep } = setup([res("", 429, { "Retry-After": "5" }), res("{}")]);
    await client.getJson("https://example.com/a");
    expect(sleep).toHaveBeenCalledWith(5000);
  });

  it("caps Retry-After at 30 seconds", async () => {
    const { client, sleep } = setup([res("", 429, { "Retry-After": "600" }), res("{}")]);
    await client.getJson("https://example.com/a");
    expect(sleep).toHaveBeenCalledWith(30000);
  });

  it("gives up after retries", async () => {
    const { client, fetchFn } = setup([res("", 500), res("", 500), res("", 500)]);
    const err = await client.getJson("https://example.com/a").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect((err as HttpError).message).toBe("HTTP 500 for https://example.com/a");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("throws on invalid json without retrying", async () => {
    const { client, fetchFn } = setup([res("<html>")]);
    await expect(client.getJson("https://example.com/a")).rejects.toThrow("Invalid JSON from https://example.com/a");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
  it("passes an AbortSignal on every request", async () => {
    const { client, fetchFn } = setup([res("", 503), res("{}")]);
    await client.getJson("https://example.com/a");
    const signals = fetchFn.mock.calls.map((c) => c[1]?.signal);
    expect(signals).toHaveLength(2);
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
  });

  it("gives up after repeated network errors", async () => {
    const failure = new TypeError("fetch failed");
    const { client, fetchFn, sleep } = setup([failure, failure, failure]);
    await expect(client.getJson("https://example.com/a")).rejects.toBe(failure);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it("throws HttpError 429 when retries run out", async () => {
    const { client, fetchFn } = setup([res("", 429), res("", 429), res("", 429)]);
    const err = await client.getJson("https://example.com/a").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(429);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("getText retries too", async () => {
    const { client, fetchFn } = setup([res("", 503), res("ok")]);
    expect(await client.getText("https://example.com/a")).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it.each(["", "abc", "Wed, 21 Oct 2026 07:28:00 GMT", "-5", "1.5"])(
    "falls back to backoff for a non-numeric Retry-After (%j)",
    async (value) => {
      const { client, sleep } = setup([res("", 429, { "Retry-After": value }), res("{}")]);
      await client.getJson("https://example.com/a");
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(1000);
    },
  );
});

describe("createHttpClient timeouts", () => {
  // A request that never answers and only ends when its abort signal fires.
  function hangingFetch() {
    return vi.fn<typeof fetch>(
      (...args) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = args[1]?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
  }

  it("aborts a hanging request after timeoutMs", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const client = createHttpClient({ fetchFn: hangingFetch(), sleep, timeoutMs: 20, retries: 0 });
    const err = await client.getJson("https://example.com/slow").catch((e) => e);
    expect((err as Error).name).toBe("TimeoutError");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a timed-out request", async () => {
    const fetchFn = hangingFetch();
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
    const client = createHttpClient({ fetchFn, sleep, timeoutMs: 20, retries: 1 });
    const err = await client.getJson("https://example.com/slow").catch((e) => e);
    expect((err as Error).name).toBe("TimeoutError");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
  });
});
