import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, normalizeTags } from "./text";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos;&nbsp;g")).toBe(
      "a & b <c> \"d\" 'e' 'f' g",
    );
    expect(decodeEntities("&#123;x&#125; &#x2F; &#x41;")).toBe("{x} / A");
  });

  it("decodes only one level", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves unknown entities alone", () => {
    expect(decodeEntities("&foo; bar")).toBe("&foo; bar");
  });
});

describe("htmlToText", () => {
  it("converts lists and paragraphs to lines", () => {
    expect(htmlToText("<p>a</p><ul><li>b</li></ul>")).toBe("a\n- b");
  });

  it("handles double-encoded html", () => {
    expect(htmlToText("&lt;p&gt;hi&lt;/p&gt;")).toBe("hi");
  });

  it("collapses whitespace and blank lines", () => {
    expect(htmlToText("<p>a   b</p><br><br><br><p>  c </p>")).toBe("a b\n\nc");
  });
});

describe("normalizeTags", () => {
  it("dedupes and lowercases", () => {
    expect(normalizeTags(["React", "react ", " Node-JS", null, ""])).toEqual(["react", "node js"]);
  });
});
