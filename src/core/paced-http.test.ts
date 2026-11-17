import { describe, expect, it } from "vitest";
import type { HttpClient } from "./http";
import { createPacedHttpClient, DEFAULT_PACING } from "./paced-http";

/** A fake clock: `sleep(ms)` advances `now()`. */
function setup(opts: { fail?: (url: string) => boolean; perHost?: Record<string, number> } = {}) {
  let t = 0;
  const starts: Array<{ url: string; at: number }> = [];
  const inner: HttpClient = {
    async getJson(url) {
      starts.push({ url, at: t });
      if (opts.fail?.(url)) throw new Error(`boom ${url}`);
      return { url };
    },
    async getText(url) {
      starts.push({ url, at: t });
      return url;
    },
  };
  const client = createPacedHttpClient(inner, {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    perHostMinIntervalMs: opts.perHost,
  });
  return { client, starts };
}

describe("createPacedHttpClient", () => {
  it("serializes requests to one host", async () => {
    const { client, starts } = setup();
    await Promise.all([client.getJson("https://a.com/1"), client.getJson("https://a.com/2"), client.getText("https://a.com/3")]);
    expect(starts.map((s) => s.at)).toEqual([0, 500, 1000]);
  });

  it("different hosts run in parallel", async () => {
    const { client, starts } = setup();
    await Promise.all([client.getJson("https://a.com/1"), client.getJson("https://b.com/1")]);
    expect(starts.map((s) => s.at)).toEqual([0, 0]);
  });

  it("supports a per-host interval override", async () => {
    const { client, starts } = setup({ perHost: { "raw.githubusercontent.com": 100 } });
    await Promise.all([
      client.getText("https://raw.githubusercontent.com/x/1"),
      client.getText("https://raw.githubusercontent.com/x/2"),
    ]);
    expect(starts.map((s) => s.at)).toEqual([0, 100]);
  });

  it("errors propagate and still pace", async () => {
    const { client, starts } = setup({ fail: (u) => u.endsWith("/1") });
    const first = client.getJson("https://a.com/1");
    const second = client.getJson("https://a.com/2");
    await expect(first).rejects.toThrow("boom https://a.com/1");
    await expect(second).resolves.toEqual({ url: "https://a.com/2" });
    expect(starts.map((s) => s.at)).toEqual([0, 500]);
  });

  it("preserves call order per host", async () => {
    const { client, starts } = setup();
    await Promise.all(["1", "2", "3", "4"].map((n) => client.getJson(`https://a.com/${n}`)));
    expect(starts.map((s) => s.url)).toEqual(["https://a.com/1", "https://a.com/2", "https://a.com/3", "https://a.com/4"]);
  });

  it("does not wait when enough time has already passed", async () => {
    let t = 0;
    const starts: number[] = [];
    const inner: HttpClient = {
      async getJson() {
        starts.push(t);
        return {};
      },
      async getText() {
        return "";
      },
    };
    const sleeps: number[] = [];
    const client = createPacedHttpClient(inner, { now: () => t, sleep: async (ms) => void sleeps.push(ms) });
    await client.getJson("https://a.com/1");
    t = 5000;
    await client.getJson("https://a.com/2");
    expect(starts).toEqual([0, 5000]);
    expect(sleeps).toEqual([]);
  });
});

describe("DEFAULT_PACING", () => {
  it("spaces GitHub raw requests 100 ms apart and everything else 500 ms", async () => {
    let t = 0;
    const starts: Array<{ host: string; at: number }> = [];
    const inner: HttpClient = {
      async getJson(url) {
        starts.push({ host: new URL(url).host, at: t });
        return {};
      },
      async getText() {
        return "";
      },
    };
    const client = createPacedHttpClient(inner, {
      ...DEFAULT_PACING,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    for (const host of ["raw.githubusercontent.com", "api.lever.co"]) {
      await client.getJson(`https://${host}/a`);
      await client.getJson(`https://${host}/b`);
    }
    const gap = (host: string) => {
      const [a, b] = starts.filter((s) => s.host === host);
      return b!.at - a!.at;
    };
    expect([gap("raw.githubusercontent.com"), gap("api.lever.co")]).toEqual([100, 500]);
  });
});
