import { describe, expect, it } from "vitest";
import { createFixtureHttp } from "./fixture-http";

describe("createFixtureHttp", () => {
  const routes = {
    "https://example.com/a.json": "remoteok/api.json",
    "https://example.com/feed.rss": "weworkremotely/programming.rss",
  };

  it("serves json and text by exact url", async () => {
    const http = createFixtureHttp(routes);
    expect(Array.isArray(await http.getJson("https://example.com/a.json"))).toBe(true);
    expect(await http.getText("https://example.com/feed.rss")).toContain("<rss");
  });

  it("throws for unknown urls", async () => {
    const http = createFixtureHttp(routes);
    await expect(http.getJson("https://example.com/other")).rejects.toThrow("No fixture for https://example.com/other");
    await expect(http.getText("https://example.com/a.json?x=1")).rejects.toThrow("No fixture for");
  });

  it("does not treat object prototype keys as routes", async () => {
    await expect(createFixtureHttp({}).getJson("constructor")).rejects.toThrow("No fixture for constructor");
  });

  it("records calls in order, including unknown urls", async () => {
    const http = createFixtureHttp(routes);
    await http.getJson("https://example.com/a.json");
    await http.getJson("https://example.com/missing").catch(() => {});
    await http.getText("https://example.com/feed.rss");
    expect(http.calls).toEqual([
      "https://example.com/a.json",
      "https://example.com/missing",
      "https://example.com/feed.rss",
    ]);
  });
});
