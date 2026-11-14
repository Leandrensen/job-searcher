const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes HTML entities in a single pass (`&amp;lt;` becomes `&lt;`). Unknown entities stay as they are. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) {
      return String.fromCodePoint(parseInt(body.slice(1), 10));
    }
    return NAMED[body.toLowerCase()] ?? match;
  });
}

export function htmlToText(html: string): string {
  const text = decodeEntities(html)
    .replace(/<br\s*\/?>|<\/(?:p|li|div|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTags(tags: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!tag) continue;
    const t = tag.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
    if (t) seen.add(t);
  }
  return [...seen];
}
