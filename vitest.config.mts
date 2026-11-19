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
        "src/scripts/seed.ts", // process wiring only; the logic lives in seed-cli.ts
        "src/scripts/company.ts", // process wiring only; the logic lives in company-cli.ts
        "src/scripts/rank.ts", // process wiring only; the logic lives in rank-cli.ts
        "src/sources/types.ts", // types and one identity helper
        "src/ranking/transformers-embedder.ts", // loads the real model; covered by the live check
      ],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      // Measured 2026-11-12: lines 98.7, branches 89.07, functions 91.13, statements 96.79 (rounded down to 5).
      thresholds: { lines: 95, branches: 85, functions: 90, statements: 95 },
    },
  },
});
