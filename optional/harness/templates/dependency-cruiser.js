/**
 * Structural sensor — dependency-cruiser.
 *
 * Answers the question no test and no type checker asks: "is the shape of the
 * import graph still the shape we said it was?" Three rules, all of them things
 * `AGENTS.md` already states in prose and nothing previously enforced:
 *
 *   no-circular   STRUCT-1 — a cycle means neither file is understandable
 *                 without the other, which is the opposite of cohesion.
 *   no-orphans    QUAL-3 — a module nothing imports is dead code that still
 *                 type-checks, so `tsc` will never mention it.
 *   lib-is-a-leaf STRUCT-6 — the seam only holds if it points one way. Pure
 *                 logic must not reach back up into the UI that calls it.
 *
 * `severity` is `error` for all three: these are structural invariants, not
 * style preferences, and the pre-push hook fails on them. Complexity is the
 * sensor that stays at `warn` — see `eslint.harness.js`.
 *
 * ADAPT THE PATHS. `src/lib`, `src/components`, `src/pages` are the defaults
 * for a TypeScript web app. If this project's pure logic lives in `app/core/`
 * and its UI in `app/ui/`, change the regexes below — a rule whose `from`
 * matches nothing passes silently and is worse than no rule at all. After
 * editing, confirm the rule still fires:
 *
 *   npx depcruise src --config .dependency-cruiser.js
 *
 * Docs: https://github.com/sverweij/dependency-cruiser
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "This dependency is part of a cycle. Break it by moving the shared piece " +
        "into a third module that both sides import.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "error",
      comment:
        "This module is not imported by anything and imports nothing. Either it is " +
        "dead code (delete it — QUAL-3) or it is a new entry point that belongs in " +
        "the allow-list below.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$", // dotfiles: configs, not modules
          "\\.d\\.ts$", // ambient types are imported implicitly
          "(^|/)tsconfig\\.json$",
          "(^|/)(babel|webpack|vite|vitest|astro|next|rollup)\\.config\\.[^/]+$",
        ],
      },
      to: {},
    },
    {
      name: "lib-is-a-leaf",
      severity: "error",
      comment:
        "Pure logic in src/lib/ must not import UI. The dependency points one way: " +
        "components and pages import lib, never the reverse (STRUCT-6).",
      from: { path: "^src/lib/" },
      to: { path: "^src/(components|pages)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      // Tests legitimately import across every layer and are allowed to be
      // orphans — nothing imports a spec file.
      path: "\\.(test|spec)\\.[jt]sx?$|(^|/)(__tests__|test|tests)/",
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".d.ts"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
