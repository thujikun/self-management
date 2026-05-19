// @ts-check

import noSkipCi from "./scripts/hooks/commitlint-no-skip-ci.js";

/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [noSkipCi],
  rules: {
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
    "no-skip-ci-magic": [2, "always"],
  },
};
