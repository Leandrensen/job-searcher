import type { WorkplaceType } from "./job";

export const REGIONS = [
  "argentina",
  "latam",
  "south-america",
  "americas",
  "worldwide",
  "latam-country",
  "north-america",
  "europe",
  "emea",
  "apac",
] as const;
export type Region = (typeof REGIONS)[number];

/** Regions a job may have for it to be doable from Argentina. */
export const ALLOWED_JOB_REGIONS: readonly Region[] = ["argentina", "latam", "south-america", "americas", "worldwide"];

interface CountryEntry {
  code: string;
  region: Region;
  names: string[];
}

const c = (region: Region, code: string, ...names: string[]): CountryEntry => ({ code, region, names });

/** Country names (English first, then Spanish) with the region each one implies. */
export const COUNTRIES: readonly CountryEntry[] = [
  c("argentina", "AR", "Argentina", "Buenos Aires"),
  // Latin American countries other than Argentina
  c("latam-country", "BR", "Brazil", "Brasil"),
  c("latam-country", "MX", "Mexico", "México"),
  c("latam-country", "CO", "Colombia"),
  c("latam-country", "CL", "Chile"),
  c("latam-country", "PE", "Peru", "Perú"),
  c("latam-country", "UY", "Uruguay"),
  c("latam-country", "PY", "Paraguay"),
  c("latam-country", "BO", "Bolivia"),
  c("latam-country", "EC", "Ecuador"),
  c("latam-country", "VE", "Venezuela"),
  c("latam-country", "CR", "Costa Rica"),
  c("latam-country", "PA", "Panama", "Panamá"),
  c("latam-country", "GT", "Guatemala"),
  c("latam-country", "SV", "El Salvador"),
  c("latam-country", "HN", "Honduras"),
  c("latam-country", "NI", "Nicaragua"),
  c("latam-country", "DO", "Dominican Republic", "República Dominicana"),
  c("latam-country", "CU", "Cuba"),
  c("latam-country", "PR", "Puerto Rico"),
  // North America
  c("north-america", "US", "United States", "United States of America", "USA", "US", "U.S.", "U.S.A.", "Estados Unidos", "EEUU"),
  c("north-america", "CA", "Canada", "Canadá"),
  // Europe
  c("europe", "GB", "United Kingdom", "UK", "U.K.", "Great Britain", "England", "Scotland", "Wales", "Reino Unido"),
  c("europe", "IE", "Ireland", "Irlanda"),
  c("europe", "DE", "Germany", "Alemania", "Deutschland"),
  c("europe", "FR", "France", "Francia"),
  c("europe", "ES", "Spain", "España"),
  c("europe", "PT", "Portugal"),
  c("europe", "IT", "Italy", "Italia"),
  c("europe", "NL", "Netherlands", "The Netherlands", "Países Bajos", "Holland"),
  c("europe", "BE", "Belgium", "Bélgica"),
  c("europe", "LU", "Luxembourg"),
  c("europe", "CH", "Switzerland", "Suiza"),
  c("europe", "AT", "Austria"),
  c("europe", "DK", "Denmark", "Dinamarca"),
  c("europe", "SE", "Sweden", "Suecia"),
  c("europe", "NO", "Norway", "Noruega"),
  c("europe", "FI", "Finland", "Finlandia"),
  c("europe", "IS", "Iceland"),
  c("europe", "PL", "Poland", "Polonia"),
  c("europe", "CZ", "Czech Republic", "Czechia"),
  c("europe", "SK", "Slovakia"),
  c("europe", "HU", "Hungary", "Hungría"),
  c("europe", "RO", "Romania", "Rumania"),
  c("europe", "BG", "Bulgaria"),
  c("europe", "GR", "Greece", "Grecia"),
  c("europe", "HR", "Croatia", "Croacia"),
  c("europe", "SI", "Slovenia"),
  c("europe", "RS", "Serbia"),
  c("europe", "EE", "Estonia"),
  c("europe", "LV", "Latvia"),
  c("europe", "LT", "Lithuania"),
  c("europe", "UA", "Ukraine", "Ucrania"),
  c("europe", "CY", "Cyprus"),
  c("europe", "MT", "Malta"),
  // Asia-Pacific
  c("apac", "AU", "Australia"),
  c("apac", "NZ", "New Zealand", "Nueva Zelanda"),
  c("apac", "IN", "India"),
  c("apac", "SG", "Singapore", "Singapur"),
  c("apac", "JP", "Japan", "Japón"),
  c("apac", "CN", "China"),
  c("apac", "HK", "Hong Kong"),
  c("apac", "TW", "Taiwan"),
  c("apac", "KR", "South Korea", "Korea"),
  c("apac", "ID", "Indonesia"),
  c("apac", "PH", "Philippines", "Filipinas"),
  c("apac", "VN", "Vietnam"),
  c("apac", "TH", "Thailand"),
  c("apac", "MY", "Malaysia"),
  c("apac", "PK", "Pakistan"),
  c("apac", "BD", "Bangladesh"),
  c("apac", "LK", "Sri Lanka"),
  // Middle East and Africa
  c("emea", "IL", "Israel"),
  c("emea", "AE", "United Arab Emirates", "UAE", "Dubai"),
  c("emea", "SA", "Saudi Arabia"),
  c("emea", "TR", "Turkey", "Türkiye", "Turquía"),
  c("emea", "EG", "Egypt"),
  c("emea", "NG", "Nigeria"),
  c("emea", "KE", "Kenya"),
  c("emea", "ZA", "South Africa", "Sudáfrica"),
  c("emea", "MA", "Morocco"),
  c("emea", "GH", "Ghana"),
];

const PHRASES: readonly { region: Region; names: string[] }[] = [
  { region: "latam", names: ["LATAM", "Latin America", "Latinoamérica", "Latinoamerica", "América Latina", "America Latina"] },
  { region: "south-america", names: ["South America", "Sudamérica", "Sudamerica", "América del Sur"] },
  { region: "americas", names: ["Americas", "The Americas"] },
  { region: "north-america", names: ["North America", "NAMER"] },
  { region: "europe", names: ["Europe", "EU", "European Union", "Europa"] },
  { region: "emea", names: ["EMEA"] },
  { region: "apac", names: ["APAC", "Asia"] },
  { region: "worldwide", names: ["Anywhere", "Worldwide", "Global"] },
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu");

interface Matcher {
  region: Region;
  re: RegExp;
  length: number;
}

// Longest names first, so "United States of America" is consumed before "United States" and "US".
const byLength = (a: Matcher, b: Matcher) => b.length - a.length;
const PHRASE_MATCHERS: Matcher[] = PHRASES.flatMap((p) =>
  p.names.map((n) => ({ region: p.region, re: wholeWord(n), length: n.length })),
).sort(byLength);
const COUNTRY_MATCHERS: Matcher[] = COUNTRIES.flatMap((e) =>
  e.names.map((n) => ({ region: e.region, re: wholeWord(n), length: n.length })),
).sort(byLength);

function consume(text: string, matchers: Matcher[], found: Set<Region>): string {
  let rest = text;
  for (const m of matchers) {
    rest = rest.replace(m.re, () => {
      found.add(m.region);
      return " ".repeat(m.length);
    });
  }
  return rest;
}

/** Regions implied by location strings (English and Spanish). Unique and sorted alphabetically. */
export function deriveRegions(locationTexts: string[]): Region[] {
  const found = new Set<Region>();
  for (const text of locationTexts) {
    // Phrases first and removed from the text, so "North America" can't also match anything else.
    const afterPhrases = consume(text, PHRASE_MATCHERS, found);
    consume(afterPhrases, COUNTRY_MATCHERS, found);
  }
  return [...found].sort();
}

const CODE_BY_NAME = new Map<string, string>(COUNTRIES.flatMap((e) => e.names.map((n) => [n.toLowerCase(), e.code] as const)));

/** ISO alpha-2 code if `name` exactly equals a known country name (case-insensitive, trimmed). */
export function countryCodeFromName(name: string): string | null {
  return CODE_BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

/** Codes of countries whose region is `europe`. */
export const EUROPEAN_COUNTRY_CODES: readonly string[] = COUNTRIES.filter((e) => e.region === "europe").map((e) => e.code);

const REMOTE_RE = /(?<![\p{L}\p{N}])(remote|anywhere|worldwide|remoto)(?![\p{L}\p{N}])/iu;
const HYBRID_RE = /(?<![\p{L}\p{N}])(hybrid|híbrido|hibrido)(?![\p{L}\p{N}])/iu;
const ONSITE_RE = /(?<![\p{L}\p{N}])(onsite|on-site|on site|in office|in-office|presencial)(?![\p{L}\p{N}])/iu;

/** Workplace type from the ATS when it gives one, otherwise read from the location text. */
export function deriveWorkplaceType(structured: WorkplaceType | null, locationTexts: string[]): WorkplaceType | null {
  if (structured !== null) return structured;
  const joined = locationTexts.join(" | ");
  if (REMOTE_RE.test(joined)) return "remote";
  if (HYBRID_RE.test(joined)) return "hybrid";
  if (ONSITE_RE.test(joined)) return "onsite";
  const nonEmpty = locationTexts.filter((t) => t.trim() !== "");
  if (nonEmpty.length === 0) return null;
  // A location made only of region names ("LATAM", "Americas, EMEA", "Global") names no office, so it is unknown
  // and the region rule decides. A city or country with no remote word is an office.
  const regionOnly = (t: string) => !/[\p{L}\p{N}]/u.test(consume(t, PHRASE_MATCHERS, new Set()));
  return nonEmpty.every(regionOnly) ? null : "onsite";
}
