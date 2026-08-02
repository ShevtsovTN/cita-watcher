// @ts-check
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**"],
    },
    ...tseslint.configs.strictTypeChecked,
    {
        languageOptions: {
            globals: globals.node,
            parserOptions: {
                // tsconfig.json excludes **/*.test.ts from the build project (see its own
                // comment) — allowDefaultProject lets those files still get linted (with a
                // lightweight single-file program) instead of erroring as "not found".
                projectService: {
                    allowDefaultProject: ["src/*.test.ts"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
);
