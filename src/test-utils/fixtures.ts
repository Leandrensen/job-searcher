import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../test/fixtures");

export function loadFixtureText(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

export function loadFixture(file: string): unknown {
  return JSON.parse(loadFixtureText(file));
}
