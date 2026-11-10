import { defineConfig } from "drizzle-kit";

const url = (process.env.DATABASE_URL ?? "./data/jobs.db").replace(/^file:/, "");

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
