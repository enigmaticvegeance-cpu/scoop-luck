/**
 * Vitest config — pure-unit tests for the parts of Scoop Luck that
 * don't require a database or HTTP. We deliberately do NOT mock the
 * full payment flow here — that lives in `tests/e2e/` and uses
 * Playwright (see package.json).
 *
 * Tests under `tests/unit/` exercise:
 *   - tier.ts (assignment + USD->INR conversion)
 *   - razorpay HMAC verification
 *
 * Both modules have no I/O and are security-sensitive.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` is a real package that throws when imported from
      // a non-Next.js context. For unit tests, alias it to an empty
      // module so the imports become no-ops.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});