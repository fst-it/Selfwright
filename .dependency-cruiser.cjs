/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "FF-PORT-1-core-no-adapter-imports",
      comment:
        "packages/core must never import from adapter packages (hexagonal boundary)",
      severity: "error",
      from: { path: "^packages/core/src/" },
      to: { path: "^packages/adapters/" },
    },
    {
      name: "FF-PORT-1-core-no-framework-npm",
      comment:
        "packages/core must not import framework, provider SDK, or storage driver npm packages — only zod",
      severity: "error",
      from: { path: "^packages/core/src/" },
      to: {
        dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer"],
        pathNot: [
          "^node_modules/zod",
          "^zod",
        ],
      },
    },
    {
      name: "FF-PORT-1-core-no-apps",
      comment: "packages/core must never import from app packages (hexagonal boundary)",
      severity: "error",
      from: { path: "^packages/core/src/" },
      to: { path: "^apps/" },
    },
    {
      name: "FF-PORT-1-core-no-tools",
      comment: "packages/core must never import from the tools package (hexagonal boundary)",
      severity: "error",
      from: { path: "^packages/core/src/" },
      to: { path: "^tools/" },
    },
    {
      name: "FF-PORT-1-no-circular",
      comment: "No circular dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "FF-WEB-UI-1-no-core-adapter-imports",
      comment:
        "apps/web-ui/src must never import packages/core or packages/adapters — the cockpit consumes ONLY /api/*; belt-and-braces transitive graph check complementing FF-WEB-1 clause (j) regex check",
      severity: "error",
      from: { path: "^apps/web-ui/src/" },
      to: { path: "^packages/(core|adapters)/" },
    },
    {
      name: "FF-CONTEXT-1-index-only-cross-context",
      comment:
        "Bounded contexts inside packages/core/src may import a sibling context only through that context's index.ts. Exceptions: shared/ (shared kernel) and ports/ (hexagonal contracts — one file per port; ports may reference domain types directly, which also avoids the scan-provider↔scanning index cycle).",
      severity: "error",
      from: { path: "^packages/core/src/([^/]+)/", pathNot: ["^packages/core/src/ports/"] },
      to: {
        path: "^packages/core/src/[^/]+/",
        pathNot: [
          "^packages/core/src/$1/",
          "^packages/core/src/[^/]+/index\\.ts$",
          "^packages/core/src/ports/[^/]+\\.ts$",
          "^packages/core/src/shared/",
        ],
      },
    },
  ],

  options: {
    moduleSystems: ["es6"],
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    exclude: {
      path: [
        "node_modules",
        "\\.d\\.ts$",
        "dist/",
        "\\.test\\.ts$",
      ],
    },
  },
};
