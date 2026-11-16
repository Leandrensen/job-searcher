import { HttpError, type HttpClient } from "@/core/http";
import { loadFixture, loadFixtureText } from "./fixtures";

export interface FixtureHttp extends HttpClient {
  /** Every URL requested, in order (including unknown ones). */
  calls: string[];
}

/** A route is a fixture path under test/fixtures/, or `{ status }` to make the request fail with that HTTP status. */
export type FixtureRoute = string | { status: number };

/**
 * An HttpClient that serves recorded fixtures. `routes` maps an exact URL to a route.
 * Unknown URLs throw `No fixture for <url>`, or an HttpError with `fallbackStatus` when it is set.
 */
export function createFixtureHttp(
  routes: Record<string, FixtureRoute>,
  opts: { fallbackStatus?: number } = {},
): FixtureHttp {
  const calls: string[] = [];
  const httpError = (status: number, url: string) => new HttpError(status, url, `HTTP ${status} for ${url}`);
  function fixturePath(url: string): string {
    calls.push(url);
    if (!Object.hasOwn(routes, url)) {
      if (opts.fallbackStatus !== undefined) throw httpError(opts.fallbackStatus, url);
      throw new Error(`No fixture for ${url}`);
    }
    const route = routes[url]!;
    if (typeof route !== "string") throw httpError(route.status, url);
    return route;
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
