import { describe, expect, it, vi } from "vitest";
import { adapters } from "@/sources/registry";
import { CliUsageError, parseFetchArgs, runCli, type SummaryRow } from "./fetch-cli";

describe("parseFetchArgs", () => {
  it("returns defaults for no arguments", () => {
    expect(parseFetchArgs([])).toEqual({ sources: [], force: false });
  });

  it("parses --force", () => {
    expect(parseFetchArgs(["--force"])).toEqual({ sources: [], force: true });
  });

  it("parses a single --source", () => {
    expect(parseFetchArgs(["--source", "remoteok"])).toEqual({ sources: ["remoteok"], force: false });
  });

  it("splits a comma separated --source", () => {
    expect(parseFetchArgs(["--source", "remoteok,jobicy"]).sources).toEqual(["remoteok", "jobicy"]);
  });

  it("accumulates a repeated --source", () => {
    expect(parseFetchArgs(["--source", "remoteok", "--source", "jobicy"]).sources).toEqual(["remoteok", "jobicy"]);
  });

  it("drops empty parts and duplicates, keeping first-seen order", () => {
    expect(parseFetchArgs(["--source", "jobicy,,remoteok", "--source", "jobicy"]).sources).toEqual(["jobicy", "remoteok"]);
  });

  it("accepts flags in any order", () => {
    expect(parseFetchArgs(["--force", "--source", "jobicy"])).toEqual({ sources: ["jobicy"], force: true });
    expect(parseFetchArgs(["--source", "jobicy", "--force"])).toEqual({ sources: ["jobicy"], force: true });
  });

  it.each([
    ["--source as the last argument", ["--source"]],
    ["--source followed by another flag", ["--source", "--force"]],
    ["--source with only separators", ["--source", ","]],
  ])("rejects %s", (_label, argv) => {
    expect(() => parseFetchArgs(argv)).toThrow(CliUsageError);
    expect(() => parseFetchArgs(argv)).toThrow("Missing value for --source");
  });

  it.each([
    ["an unknown flag", ["--bogus"], "--bogus"],
    ["a positional value", ["remoteok"], "remoteok"],
    ["a flag after valid ones", ["--force", "-x"], "-x"],
  ])("rejects %s", (_label, argv, offender) => {
    expect(() => parseFetchArgs(argv)).toThrow(`Unknown option: ${offender}`);
  });

  it("throws errors named CliUsageError", () => {
    try {
      parseFetchArgs(["--bogus"]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      expect((err as Error).name).toBe("CliUsageError");
    }
  });
});

function deps() {
  return {
    openDb: vi.fn(),
    http: { getJson: vi.fn(), getText: vi.fn() },
    adapters,
    out: {
      log: vi.fn<(msg: string) => void>(),
      error: vi.fn<(msg: string) => void>(),
      table: vi.fn<(rows: SummaryRow[]) => void>(),
    },
  };
}

describe("runCli argument validation", () => {
  it("returns 1 and does not open the DB for an unknown source", async () => {
    const d = deps();
    expect(await runCli(["--source", "nope"], d)).toBe(1);
    expect(d.openDb).not.toHaveBeenCalled();
    expect(d.http.getJson).not.toHaveBeenCalled();
    expect(d.out.table).not.toHaveBeenCalled();
  });

  it("lists the valid ids in the unknown-source message", async () => {
    const d = deps();
    await runCli(["--source", "nope"], d);
    expect(d.out.error).toHaveBeenCalledTimes(1);
    expect(d.out.error).toHaveBeenCalledWith(
      "Unknown source: nope. Valid: remoteok, weworkremotely, getonboard, remotive, himalayas, jobicy, workingnomads, arbeitnow, hn-hiring",
    );
  });

  it("reports the first unknown id when several are given", async () => {
    const d = deps();
    await runCli(["--source", "remoteok,nope,other"], d);
    expect(d.out.error).toHaveBeenCalledWith(expect.stringMatching(/^Unknown source: nope\./));
  });

  it("returns 1 and does not open the DB for a usage error", async () => {
    const d = deps();
    expect(await runCli(["--bogus"], d)).toBe(1);
    expect(d.openDb).not.toHaveBeenCalled();
    expect(d.out.error).toHaveBeenCalledWith("Unknown option: --bogus");
  });

  it("returns 1 for a missing --source value", async () => {
    const d = deps();
    expect(await runCli(["--source"], d)).toBe(1);
    expect(d.out.error).toHaveBeenCalledWith("Missing value for --source");
    expect(d.openDb).not.toHaveBeenCalled();
  });
});
