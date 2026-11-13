import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.live.test.ts", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.live.test.ts",
        "src/test-utils/**",
        "src/app/**",
        "src/scripts/fetch.ts", // process wiring only; the logic lives in fetch-cli.ts
        "src/sources/types.ts", // types and one identity helper
      ],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
