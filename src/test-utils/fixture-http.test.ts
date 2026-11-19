import { describe, expect, it } from "vitest";
import { HttpError } from "@/core/http";
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

  it("a status route throws an HttpError", async () => {
    const http = createFixtureHttp({ "https://a.com/gone": { status: 404 } });
    const err = await http.getJson("https://a.com/gone").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 404, url: "https://a.com/gone", message: "HTTP 404 for https://a.com/gone" });
    await expect(http.getText("https://a.com/gone")).rejects.toBeInstanceOf(HttpError);
    expect(http.calls).toEqual(["https://a.com/gone", "https://a.com/gone"]);
  });

  it("fallbackStatus makes unknown urls HttpErrors instead of 'No fixture'", async () => {
    const http = createFixtureHttp(routes, { fallbackStatus: 404 });
    const err = await http.getJson("https://example.com/other").catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(404);
    expect(Array.isArray(await http.getJson("https://example.com/a.json"))).toBe(true);
  });
});
