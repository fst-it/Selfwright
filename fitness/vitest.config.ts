import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      // Scoped to files that actually have unit tests today (egress-guard.ts, added for
      // ADR 0017 GAP-2). The rest of fitness/src/checks is exercised only via `pnpm
      // fitness` against real repo state, not via Vitest — including them here would fail
      // the threshold on untested pre-existing code, which is out of scope for this change.
      include: ["src/checks/egress-guard.ts"],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});
