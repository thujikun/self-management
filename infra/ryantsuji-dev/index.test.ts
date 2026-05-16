/**
 * `infra/ryantsuji-dev/index.ts` (Pulumi stack `ryantsuji-dev`) の smoke test。
 *
 * Pulumi の `runtime.setMocks` で resource provider と function call を mock 化し、
 * 実 Cloudflare API を叩かずに module を import → `getZoneOutput` が解決される過程と
 * 各 export、および `cloudflare.DnsRecord` (= Google Search Console verification TXT) の
 * 構造的属性 (type / name / content / ttl / zoneId) を検証する。
 *
 * 同一プロジェクトの `infra/core/index.test.ts` と同じ Pulumi mock pattern を踏襲しつつ、
 * `newResource` mock で `args.inputs` を closure に capture し、resource declaration の
 * typo (例: `type: "TXT"` を `type: "A"` に書き換え) を test で検出できるようにしている。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain infra
 * @graph-business ryantsuji-dev stack の Pulumi 構築コードを mock-runtime で smoke test。実 CF API なしで「getZone が解決される」「期待 export が出る」「TXT record の構造属性が宣言どおり」を保証し、preview 前の早期 fail を取る
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

/**
 * `newResource` mock が捕捉した args を resource type 別に貯める buffer。
 * Pulumi の resource type token (例: `cloudflare:index/dnsRecord:DnsRecord`) を key に
 * 最後に作成された resource args を保持する。複数同型 resource を作る test では拡張する。
 *
 * @graph-connects none
 */
const captured: Record<string, pulumi.runtime.MockResourceArgs> = {};

beforeAll(() => {
  pulumi.runtime.setAllConfig({
    "ryantsuji-dev:zoneName": "ryantsuji.dev",
    "ryantsuji-dev:googleSiteVerification": '"google-site-verification=test-token"',
  });
  pulumi.runtime.setMocks({
    newResource(args: pulumi.runtime.MockResourceArgs): {
      id: string;
      state: Record<string, unknown>;
    } {
      captured[args.type] = args;
      return { id: `${args.name}_id`, state: { ...args.inputs, id: `${args.name}_id` } };
    },
    call(args: pulumi.runtime.MockCallArgs): Record<string, unknown> {
      // cloudflare:index/getZone:getZone (= getZoneOutput) のモック。
      // 実際の zone ID は dashboard 取得後に決まるため、test では決定論的な値を返す。
      if (args.token.endsWith("/getZone:getZone")) {
        return {
          zoneId: "test-zone-id-1234567890",
          name: (args.inputs as { filter?: { name?: string } }).filter?.name ?? "ryantsuji.dev",
        };
      }
      return args.inputs;
    },
  });
});

describe("infra/ryantsuji-dev stack", () => {
  it("module import に成功し、zoneId / zoneNameOut / TXT record id を返す", async () => {
    const m = await import("./index.js");
    const id = await promiseOf(m.zoneId);
    const name = await promiseOf(m.zoneNameOut);
    const verifyId = await promiseOf(m.googleSiteVerificationRecordId);
    expect({ id, name, verifyId }).toStrictEqual({
      id: "test-zone-id-1234567890",
      name: "ryantsuji.dev",
      // mock newResource は `${args.name}_id` を返すため、resource name 由来で決まる
      verifyId: "google-site-verification_id",
    });
  });

  it("google-site-verification TXT record を期待どおりに宣言する", async () => {
    await import("./index.js");
    const txt = captured["cloudflare:index/dnsRecord:DnsRecord"];
    // captured[...] が undefined なら resource type 自体が誤っている (typo / 別 type に差替え)
    // 早期に気付けるよう先に明示 assertion を入れる。
    expect(txt.type).toBe("cloudflare:index/dnsRecord:DnsRecord");

    // Output<string> な zoneId は mock 解決後 plain string で inputs に乗る。
    const zoneIdInput = await promiseOf(pulumi.output(txt.inputs.zoneId));
    expect({
      zoneId: zoneIdInput,
      name: txt.inputs.name,
      type: txt.inputs.type,
      content: txt.inputs.content,
      ttl: txt.inputs.ttl,
    }).toStrictEqual({
      zoneId: "test-zone-id-1234567890",
      name: "ryantsuji.dev",
      type: "TXT",
      content: '"google-site-verification=test-token"',
      ttl: 3600,
    });
  });
});
