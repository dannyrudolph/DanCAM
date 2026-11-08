/**
 * Complexity sensor — ESLint flat config fragment.
 *
 * DELIBERATELY `warn`, NOT `error`. Agent-written code measures significantly
 * worse than human code on cyclomatic and cognitive complexity, so complexity
 * is a useful *drift signal* on a codebase an AI is helping write. It is a poor
 * *gate*: the same reasoning COV-2 gives for coverage applies here — a hard
 * threshold gets satisfied by splitting one honest 13-branch function into
 * three dishonest ones, which is worse code that scores better.
 *
 * So: it never fails a push or a build. `/jgl-check` surfaces the count, and a
 * count that climbs across a few sessions is the thing worth acting on — not
 * any single warning.
 *
 * The numbers are below ESLint's defaults (complexity 20) on purpose: a
 * threshold that only fires on genuinely unmaintainable code never fires at
 * all, and a sensor that never fires tells you nothing. Raise them if this
 * project's honest baseline is higher; do not raise them to silence a warning.
 *
 * USAGE — spread into the project's `eslint.config.js`:
 *
 *   import harness from "./eslint.harness.js";
 *   export default [
 *     ...harness,
 *     // the project's own rules
 *   ];
 *
 * If this project has no `eslint.config.js`, this file works as one on its own:
 *   npx eslint src --config eslint.harness.js
 */
export default [
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"],
    ignores: ["**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}"],
    rules: {
      // Cyclomatic complexity: independent paths through one function.
      complexity: ["warn", 12],
      // Nesting depth: the shape that makes a function hard to hold in
      // your head even when its branch count is modest.
      "max-depth": ["warn", 4],
    },
  },
];
