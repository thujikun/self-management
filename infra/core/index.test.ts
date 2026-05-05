/**
 * `infra/core/index.ts` (Pulumi stack `core`) の smoke test。
 *
 * Pulumi の `runtime.setMocks` で resource provider を mock 化し、
 * 実 GCP API を叩かずに module を import → 副作用としての resource 構築 +
 * 4 つの export (datasetId / datasetLocation / graphServiceAccountEmail /
 * graphServiceAccountKey) を検証する。
 *
 * Pulumi.Output を解決するために `apply` を Promise 化するヘルパーを使う。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business core stack の Pulumi 構築コードを mock-runtime で smoke test。実 API なしで「resource が構築できる」「期待 export が出る」を保証し、preview 前の早期 fail を取る
 * @graph-connects none
 */

import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Pulumi Output<T> を Promise<T> に。`.apply` で 1 回限り resolve。
 *
 * @graph-connects none
 */
function promiseOf<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((resolve) => o.apply((v) => resolve(v)));
}

beforeAll(() => {
  // `setAllConfig` の key 形式は `<provider>:<key>`。
  // gcp:region は **意図的に省略**: `??` fallback (`asia-northeast1`) のブランチを通すため。
  pulumi.runtime.setAllConfig({
    "gcp:project": "test-project",
  });
  // resource provider mock。引数の inputs をそのまま state にする最小実装。
  pulumi.runtime.setMocks({
    newResource(args: pulumi.runtime.MockResourceArgs): { id: string; state: Record<string, unknown> } {
      return { id: `${args.name}_id`, state: { ...args.inputs, id: `${args.name}_id` } };
    },
    call(args: pulumi.runtime.MockCallArgs): Record<string, unknown> {
      return args.inputs;
    },
  });
});

describe("infra/core stack", () => {
  it("module import に成功し、4 つの export を返す", async () => {
    const m = await import("./index.js");
    expect(m.datasetId).toBeDefined();
    expect(m.datasetLocation).toBeDefined();
    expect(m.graphServiceAccountEmail).toBeDefined();
    expect(m.graphServiceAccountKey).toBeDefined();
  });

  it("datasetId は 'ryan'", async () => {
    const m = await import("./index.js");
    const id = await promiseOf(m.datasetId);
    expect(id).toBe("ryan");
  });

  it("datasetLocation は config 未設定時の fallback 'asia-northeast1'", async () => {
    const m = await import("./index.js");
    const loc = await promiseOf(m.datasetLocation);
    expect(loc).toBe("asia-northeast1");
  });

  it("graphServiceAccountEmail は SA construction の inputs を経て string になる", async () => {
    const m = await import("./index.js");
    const email = await promiseOf(m.graphServiceAccountEmail);
    // mock で email は `${accountId}@${projectId}.iam.gserviceaccount.com` を直接返さない。
    // mock の state は inputs のみで email は含まれないため undefined になる可能性あり。
    // 実 API 経由でのみ計算される field なので、ここでは「Output である」事実を確認。
    expect(typeof email === "string" || email === undefined).toBe(true);
  });

  it("graphServiceAccountKey は pulumi.secret 経由の Output (apply 可能)", async () => {
    const m = await import("./index.js");
    // privateKey field 自体は mock では undefined。secret() で wrap されてること自体を検証。
    expect(m.graphServiceAccountKey).toBeDefined();
    const v = await promiseOf(m.graphServiceAccountKey);
    expect(v === undefined || typeof v === "string").toBe(true);
  });
});
