import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: ["src/**/*.test.ts", "src/server.ts", "src/hash-password.ts"],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 98,
        lines: 90,
      },
    },
  },
});
