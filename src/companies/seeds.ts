import { z } from "zod";
import { isAllowedHomeCountry } from "@/core/location-filter";
import { countryCodeFromName } from "@/core/locations";
import type { HttpClient } from "@/core/http";
import type { CandidateInput } from "@/db/companies";

export const REMOTEINTECH_TREE_URL = "https://api.github.com/repos/remoteintech/remote-jobs/git/trees/main?recursive=1";
export const REMOTEINTECH_RAW_BASE = "https://raw.githubusercontent.com/remoteintech/remote-jobs/main/";
export const YC_ALL_URL = "https://yc-oss.github.io/api/companies/all.json";

/** Top-level `key: value` lines of a markdown file's front matter. Lists and nested values are ignored. */
export function parseFrontMatter(markdown: string): Record<string, string> {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") return {};
  const out: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    if (line === "---") break;
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]!] = m[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

const TreeSchema = z.looseObject({
  truncated: z.boolean().default(false),
  tree: z.array(z.looseObject({ path: z.string(), type: z.string() })),
});

const COMPANY_FILE = /^src\/companies\/[^/]+\.md$/;

export async function fetchRemoteintechCandidates(http: HttpClient, log: (msg: string) => void = () => {}): Promise<CandidateInput[]> {
  const { tree, truncated } = TreeSchema.parse(await http.getJson(REMOTEINTECH_TREE_URL));
  if (truncated) log("seed: remoteintech file tree was truncated by GitHub; some companies may be missing");
  const paths = tree.filter((t) => t.type === "blob" && COMPANY_FILE.test(t.path)).map((t) => t.path);

  // The paced client limits the request rate.
  const results = await Promise.all(
    paths.map(async (path) => {
      try {
        return parseFrontMatter(await http.getText(REMOTEINTECH_RAW_BASE + path));
      } catch (err) {
        log(`seed: skipping ${path}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }),
  );

  const candidates: CandidateInput[] = [];
  for (const fm of results) {
    if (!fm?.title) continue;
    candidates.push({
      name: fm.title,
      website: fm.website || null,
      careersUrl: fm.careers_url || null,
      homeCountry: null,
      origin: "seed:remoteintech",
    });
  }
  return candidates;
}

const YcSchema = z.array(
  z.looseObject({
    name: z.string(),
    website: z.string().nullish(),
    status: z.string().nullish(),
    isHiring: z.boolean().nullish(),
    all_locations: z.string().nullish(),
  }),
);

/** The country at the end of a company's first location, e.g. "San Francisco, CA, USA" gives "US". */
function homeCountryOf(allLocations: string | null | undefined): string | null {
  const first = allLocations?.split(";")[0]?.trim();
  if (!first) return null;
  const lastToken = first.split(",").at(-1)?.trim() ?? "";
  return countryCodeFromName(lastToken);
}

/** Active, hiring companies whose home country is allowed or unknown. No industry filter. */
export function ycCandidatesFrom(json: unknown): {
  kept: CandidateInput[];
  skipped: { notActive: number; notHiring: number; homeCountry: number };
} {
  const kept: CandidateInput[] = [];
  const skipped = { notActive: 0, notHiring: 0, homeCountry: 0 };
  for (const c of YcSchema.parse(json)) {
    if (c.status !== "Active") {
      skipped.notActive++;
      continue;
    }
    if (c.isHiring !== true) {
      skipped.notHiring++;
      continue;
    }
    const homeCountry = homeCountryOf(c.all_locations);
    if (homeCountry !== null && !isAllowedHomeCountry(homeCountry)) {
      skipped.homeCountry++;
      continue;
    }
    kept.push({ name: c.name, website: c.website ?? null, careersUrl: null, homeCountry, origin: "seed:yc" });
  }
  return { kept, skipped };
}

export async function fetchYcCandidates(http: HttpClient): Promise<ReturnType<typeof ycCandidatesFrom>> {
  return ycCandidatesFrom(await http.getJson(YC_ALL_URL));
}
