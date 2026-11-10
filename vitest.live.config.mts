import { defineConfig } from "vitest/config";


export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    testTimeout: 60000,
  },
});
