import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.config.*",
      "**/*.cjs",
      "**/coverage/**",
      "**/.turbo/**",
      ".claude/**",
      "scripts/**",
      "infra/evidence/.evidence/**",
      "infra/evidence/build/**",
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    // tools/sync-db.ts deliberately sits outside the root tsconfig.json's project
    // references (it's a standalone live-infra script, not part of the turbo build
    // graph — see tools/tsconfig.sync-db.json), so it needs its own type-aware project
    // pointer instead of the shared project service.
    files: ["tools/sync-db.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["tools/tsconfig.sync-db.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // tools/scripts/*.ts are standalone release scripts (not part of the turbo build
    // graph — see tools/tsconfig.scripts.json), so they need their own project pointer.
    files: ["tools/scripts/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["tools/tsconfig.scripts.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
