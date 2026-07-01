// Prisma 7 config — connection URL lives here, not in schema.prisma.
// `env()` from prisma/config throws if DATABASE_URL is missing.
// `dotenv/config` is imported explicitly so .env files are loaded.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});