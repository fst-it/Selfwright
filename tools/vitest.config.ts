import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/index.ts",
        "src/inbox.ts",
        // Hook entry-point scripts use top-level await, stdin, and process.exit();
        // they are integration-tested via the git hook mechanism, not via unit tests.
        "src/hooks/session-start.ts",
        "src/hooks/block-generated-files.ts",
        "src/hooks/fast-verify.ts",
        "src/hooks/fast-verify-staged.ts",
        "src/hooks/setup-hooks.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});
