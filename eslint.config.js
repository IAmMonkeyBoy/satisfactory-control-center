import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Type-aware linting across the workspaces. We point the parser at each package's
// typecheck config (which includes test files) so every linted file is covered by
// a TypeScript program and the type-checked rules can run. Config files and build
// output are not linted.
export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/*.tsbuildinfo", "**/*.config.js", "**/*.config.ts"],
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: [
          "./packages/shared/tsconfig.typecheck.json",
          "./packages/server/tsconfig.typecheck.json",
          "./packages/web/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/server/**/*.ts", "packages/shared/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
