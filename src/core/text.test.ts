import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, normalizeTags } from "./text";

describe("decodeEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos;&nbsp;g")).toBe(
      "a & b <c> \"d\" 'e' 'f' g",
    );
    expect(decodeEntities("&#123;x&#125; &#x2F; &#x41;")).toBe("{x} / A");
  });

  it("decodes the real-world mdash case", () => {
    expect(decodeEntities("£73,000&mdash;£95,000")).toBe("£73,000—£95,000");
  });

  it.each([
    ["mdash", "—"],
    ["ndash", "–"],
    ["hellip", "…"],
    ["rsquo", "’"],
    ["ldquo", "“"],
    ["euro", "€"],
    ["eacute", "é"],
    ["Ntilde", "Ñ"],
    ["shy", ""],
    ["copy", "©"],
    ["trade", "™"],
    ["pound", "£"],
  ])("decodes &%s;", (name, expected) => {
    expect(decodeEntities(`&${name};`)).toBe(expected);
  });

  it("named entities are case-sensitive", () => {
    expect(decodeEntities("&Eacute;&eacute;")).toBe("Éé");
  });

  it("decodes uppercase basic aliases", () => {
    expect(decodeEntities("&AMP;&LT;&GT;&QUOT;")).toBe('&<>"');
  });

  it("does not treat object prototype keys as entities", () => {
    expect(decodeEntities("&constructor; &toString; &valueOf; &hasOwnProperty;")).toBe(
      "&constructor; &toString; &valueOf; &hasOwnProperty;",
    );
  });

  it("does not decode odd casing of other names", () => {
    expect(decodeEntities("&Mdash;")).toBe("&Mdash;");
  });

  it("decodes only one level", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });

  it("leaves unknown entities alone", () => {
    expect(decodeEntities("&foo; bar")).toBe("&foo; bar");
  });

  it.each(["&#99999999;", "&#xFFFFFF;", "&#xD800;", "&#0;"])("leaves out-of-range numeric entity %s unchanged", (entity) => {
    expect(decodeEntities(entity)).toBe(entity);
  });

  it("decodes astral code points", () => {
    expect(decodeEntities("&#128512;")).toBe("😀");
    expect(decodeEntities("&#x1F600;")).toBe("😀");
  });
});

describe("htmlToText", () => {
  it("converts lists and paragraphs to lines", () => {
    expect(htmlToText("<p>a</p><ul><li>b</li></ul>")).toBe("a\n- b");
  });

  it("keeps comparison operators that are not tags", () => {
    expect(htmlToText("<p>5 years &lt; experience &lt; 10 and salary &gt; 50k</p>")).toBe(
      "5 years < experience < 10 and salary > 50k",
    );
  });

  it("handles double-encoded html", () => {
    expect(htmlToText("&lt;p&gt;hi&lt;/p&gt;")).toBe("hi");
  });

  it("drops style blocks", () => {
    expect(htmlToText("<style>.a{color:red}</style><p>Hi</p>")).toBe("Hi");
  });

  it("drops script blocks with attributes and uppercase tags", () => {
    expect(htmlToText('<SCRIPT type="text/javascript">\nvar x = 1;\n</SCRIPT><p>Hello</p>')).toBe("Hello");
  });

  it("drops html comments", () => {
    expect(htmlToText("<p>A</p><!-- hidden\nnote --><p>B</p>")).toBe("A\nB");
  });

  it("drops double-encoded style blocks", () => {
    expect(htmlToText("&lt;style&gt;p{}&lt;/style&gt;&lt;p&gt;Hi&lt;/p&gt;")).toBe("Hi");
  });

  it("does not throw on invalid entities", () => {
    expect(htmlToText("<p>a &#99999999; b</p>")).toBe("a &#99999999; b");
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
