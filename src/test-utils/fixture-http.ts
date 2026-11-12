import type { HttpClient } from "@/core/http";
import { loadFixture, loadFixtureText } from "./fixtures";

export interface FixtureHttp extends HttpClient {
  /** Every URL requested, in order (including unknown ones). */
  calls: string[];
}

/** An HttpClient that serves recorded fixtures. `routes` maps an exact URL to a path under test/fixtures/. */
export function createFixtureHttp(routes: Record<string, string>): FixtureHttp {
  const calls: string[] = [];
  function fixturePath(url: string): string {
    calls.push(url);
    if (!Object.hasOwn(routes, url)) throw new Error(`No fixture for ${url}`);
    return routes[url]!;
  }
  return {
    calls,
    async getJson(url) {
      return loadFixture(fixturePath(url));
    },
    async getText(url) {
      return loadFixtureText(fixturePath(url));
    },
  };
}
