import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Generated output — coverage/ and the Playwright report dirs are build
  // artifacts, not source, and were being linted because they are tracked.
  { ignores: ["dist", "coverage", "playwright-report", "test-results"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Disabled deliberately, not out of laziness. tsconfig.app.json sets
      // `strict: false` and `noImplicitAny: false`, so the compiler already
      // accepts untyped code everywhere. Against that, this rule only flags the
      // HONEST annotation `(row: any)` and says nothing about `(row)`, which is
      // identically unsafe — 5,817 hits across 773 files, none of them actionable.
      //
      // To get real type safety, do it in this order:
      //   1. tsconfig.app.json: noImplicitAny -> true, fix the fallout
      //   2. then re-enable this rule
      // Turning it on first just produces noise.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Supabase edge functions are Deno modules with URL imports; tsconfig.json
    // excludes them from the TS project, so their `@ts-nocheck` headers are
    // deliberate rather than debt.
    files: ["supabase/functions/**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/ban-ts-comment": "off" },
  },
  {
    // The e2e/ Playwright suite was removed 2026-09-05 ("restarting testing from a clean
    // slate") — this block currently matches nothing and is a no-op. Left in place rather
    // than deleted: if the suite returns, its fixture API takes a callback named `use`,
    // which react-hooks/rules-of-hooks mistakes for React's use() hook and reports as an
    // error. Rediscovering that is more expensive than carrying an inert glob.
    files: ["e2e/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.node },
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // react-refresh/only-export-components guards *Vite's* React Fast Refresh.
    // Neither target below qualifies, so the rule measures nothing there:
    //  - components/ui/** are vendored shadcn primitives, each pairing a
    //    component with its `cva` variants object (buttonVariants, badgeVariants,
    //    …). That pairing is upstream shadcn's own shape — splitting it would
    //    turn every future shadcn update into a manual merge. (allowConstantExport
    //    does not cover it: a cva() result is not a literal constant.)
    //  - mobile/** is React Native/Expo, which ships its own Fast Refresh and is
    //    never built by Vite.
    files: ["src/components/ui/**/*.tsx", "mobile/**/*.{ts,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
