/**
 * ci-fix prompt builder の test。snapshot で全文 drift を検知。
 */

import { describe, expect, it } from "vitest";

import { buildCiFixPrompt } from "./prompt-ci-fix.js";

describe("buildCiFixPrompt", () => {
  it("生成 prompt の全文 (snapshot) — failing checks が箇条書きで展開される", () => {
    const out = buildCiFixPrompt({
      prNumber: 28,
      repo: "thujikun/self-management",
      branch: "feat/github-actions-pulumi-wif",
      failingChecks: [
        {
          name: "Pulumi core (preview on PR / up on main)",
          runId: "25871546001",
          jobUrl:
            "https://github.com/thujikun/self-management/actions/runs/25871546001/job/76027820487",
        },
        {
          name: "test",
          runId: "25871546000",
          jobUrl:
            "https://github.com/thujikun/self-management/actions/runs/25871546000/job/76027960575",
        },
      ],
    });
    expect(out).toMatchSnapshot();
  });

  it("failing checks が 1 件のみのケース (Pulumi だけ落ちる pattern)", () => {
    const out = buildCiFixPrompt({
      prNumber: 28,
      repo: "thujikun/self-management",
      branch: "feat/github-actions-pulumi-wif",
      failingChecks: [
        {
          name: "Pulumi core (preview on PR / up on main)",
          runId: "25871546001",
          jobUrl:
            "https://github.com/thujikun/self-management/actions/runs/25871546001/job/76027820487",
        },
      ],
    });
    expect(out).toMatchSnapshot();
  });
});
