/**
 * `infra/ryantsuji-dev/index.ts` (Pulumi stack `ryantsuji-dev`) の smoke test。
 *
 * Pulumi の `runtime.setMocks` で resource provider と function call を mock 化し、
 * 実 Cloudflare API を叩かずに module を import → `getZoneOutput` が解決される過程と
 * 各 export、および以下の resource declaration の構造的属性を検証する:
 * - `cloudflare.DnsRecord` (Google Search Console verification + Workspace MX × 5
 *   + SPF + DKIM + Workspace verification の計 9 本): type / name / content /
 *   ttl / priority / zoneId
 * - `cloudflare.WorkersCustomDomain` (apex + www × 1 ずつ): accountId / hostname /
 *   service / zoneId
 *
 * 同一プロジェクトの `infra/core/index.test.ts` と同じ Pulumi mock pattern を踏襲しつつ、
 * `newResource` mock で `args.inputs` を resource name 別に capture し、declaration の
 * typo (例: `type: "TXT"` を `type: "A"`、`hostname` を別 zone に向ける等) を test で検出できる。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain infra
 * @graph-business ryantsuji-dev stack の Pulumi 構築コードを mock-runtime で smoke test。実 CF API なしで「getZone が解決される」「期待 export が出る」「DNS record / Workers binding の構造属性が宣言どおり」を保証し、preview 前の早期 fail を取る
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
 * `newResource` mock が捕捉した args を resource name 別に貯める buffer。
 * 同一 stack 内に複数の `cloudflare:index/dnsRecord:DnsRecord` がある (Search Console
 * verification + Workspace MX × 5 + SPF + DKIM + Workspace verification の計 9 本)
 * ため、type ではなく name を key に取る。
 *
 * @graph-connects none
 */
const captured: Record<string, pulumi.runtime.MockResourceArgs> = {};

/**
 * test 用 DKIM 公開鍵 (multi-string 形式の dummy)。本番値は public key とはいえ
 * test snapshot に焼くと sources of truth が分散するので test 専用 dummy を使う。
 *
 * @graph-connects none
 */
const TEST_DKIM = '"v=DKIM1;k=rsa;p=AAAA" "BBBB"';

/**
 * test 用 Workspace domain verification token (任意の dummy)。
 *
 * @graph-connects none
 */
const TEST_WORKSPACE_VERIFICATION = '"google-site-verification=workspace-test-token"';

/**
 * test 用 Cloudflare account ID (dummy)。
 *
 * @graph-connects none
 */
const TEST_ACCOUNT_ID = "test-account-id-deadbeef";

beforeAll(() => {
  pulumi.runtime.setAllConfig({
    "ryantsuji-dev:zoneName": "ryantsuji.dev",
    "ryantsuji-dev:cloudflareAccountId": TEST_ACCOUNT_ID,
    "ryantsuji-dev:googleSiteVerification": '"google-site-verification=test-token"',
    "ryantsuji-dev:googleWorkspaceVerification": TEST_WORKSPACE_VERIFICATION,
    "ryantsuji-dev:googleDkim": TEST_DKIM,
  });
  pulumi.runtime.setMocks({
    newResource(args: pulumi.runtime.MockResourceArgs): {
      id: string;
      state: Record<string, unknown>;
    } {
      captured[args.name] = args;
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

/**
 * `captured[name]` の inputs を Pulumi Output 解決済みの plain object に正規化する
 * 複数 record の structural assertion を簡潔に書くための helper。
 *
 * @graph-connects none
 */
async function inputsOf(name: string): Promise<{
  zoneId: string;
  name: unknown;
  type: unknown;
  content: unknown;
  ttl: unknown;
  priority: unknown;
}> {
  const r = captured[name];
  expect(r, `resource ${name} not captured`).toBeDefined();
  expect(r.type).toBe("cloudflare:index/dnsRecord:DnsRecord");
  const zoneIdInput = await promiseOf(pulumi.output(r.inputs.zoneId));
  return {
    zoneId: zoneIdInput,
    name: r.inputs.name,
    type: r.inputs.type,
    content: r.inputs.content,
    ttl: r.inputs.ttl,
    priority: r.inputs.priority,
  };
}

describe("infra/ryantsuji-dev stack", () => {
  it("module import に成功し、zoneId / zoneNameOut / 各 resource id を返す", async () => {
    const m = await import("./index.js");
    const id = await promiseOf(m.zoneId);
    const name = await promiseOf(m.zoneNameOut);
    const verifyId = await promiseOf(m.googleSiteVerificationRecordId);
    const spfId = await promiseOf(m.googleSpfRecordId);
    const dkimId = await promiseOf(m.googleDkimRecordId);
    const workspaceVerifyId = await promiseOf(m.googleWorkspaceVerificationRecordId);
    const mxIds = await Promise.all(m.googleWorkspaceMxRecordIds.map((o) => promiseOf(o)));
    const wcdIds = await Promise.all(m.workerCustomDomainIds.map((o) => promiseOf(o)));
    expect({ id, name, verifyId, spfId, dkimId, workspaceVerifyId, mxIds, wcdIds }).toStrictEqual({
      id: "test-zone-id-1234567890",
      name: "ryantsuji.dev",
      // mock newResource は `${args.name}_id` を返すため、resource name 由来で決まる
      verifyId: "google-site-verification_id",
      spfId: "google-spf_id",
      dkimId: "google-dkim_id",
      workspaceVerifyId: "google-workspace-verification_id",
      mxIds: [
        "google-mx-aspmx_id",
        "google-mx-alt1_id",
        "google-mx-alt2_id",
        "google-mx-alt3_id",
        "google-mx-alt4_id",
      ],
      wcdIds: ["worker-cd-apex_id", "worker-cd-www_id"],
    });
  });

  it("google-site-verification TXT record を期待どおりに宣言する", async () => {
    await import("./index.js");
    expect(await inputsOf("google-site-verification")).toStrictEqual({
      zoneId: "test-zone-id-1234567890",
      name: "ryantsuji.dev",
      type: "TXT",
      content: '"google-site-verification=test-token"',
      ttl: 3600,
      priority: undefined,
    });
  });

  it("google-spf TXT record を期待どおりに宣言する", async () => {
    await import("./index.js");
    expect(await inputsOf("google-spf")).toStrictEqual({
      zoneId: "test-zone-id-1234567890",
      name: "ryantsuji.dev",
      type: "TXT",
      content: '"v=spf1 include:_spf.google.com ~all"',
      ttl: 3600,
      priority: undefined,
    });
  });

  it("google-dkim TXT record を期待どおりに宣言する (sub-name + 自動 TTL)", async () => {
    await import("./index.js");
    expect(await inputsOf("google-dkim")).toStrictEqual({
      zoneId: "test-zone-id-1234567890",
      name: "google._domainkey.ryantsuji.dev",
      type: "TXT",
      content: TEST_DKIM,
      ttl: 1,
      priority: undefined,
    });
  });

  it("google-workspace-verification TXT record を期待どおりに宣言する", async () => {
    await import("./index.js");
    expect(await inputsOf("google-workspace-verification")).toStrictEqual({
      zoneId: "test-zone-id-1234567890",
      name: "ryantsuji.dev",
      type: "TXT",
      content: TEST_WORKSPACE_VERIFICATION,
      ttl: 3600,
      priority: undefined,
    });
  });

  it.each([
    { name: "google-mx-aspmx", content: "aspmx.l.google.com", priority: 1 },
    { name: "google-mx-alt1", content: "alt1.aspmx.l.google.com", priority: 5 },
    { name: "google-mx-alt2", content: "alt2.aspmx.l.google.com", priority: 5 },
    { name: "google-mx-alt3", content: "alt3.aspmx.l.google.com", priority: 10 },
    { name: "google-mx-alt4", content: "alt4.aspmx.l.google.com", priority: 10 },
  ])("$name MX record を期待どおりに宣言する (priority=$priority)", async (mx) => {
    await import("./index.js");
    expect(await inputsOf(mx.name)).toStrictEqual({
      zoneId: "test-zone-id-1234567890",
      name: "ryantsuji.dev",
      type: "MX",
      content: mx.content,
      ttl: 3600,
      priority: mx.priority,
    });
  });

  it.each([
    { name: "worker-cd-apex", hostname: "ryantsuji.dev" },
    { name: "worker-cd-www", hostname: "www.ryantsuji.dev" },
  ])("$name WorkersCustomDomain を期待どおりに宣言する (hostname=$hostname)", async (cd) => {
    await import("./index.js");
    const r = captured[cd.name];
    expect(r, `resource ${cd.name} not captured`).toBeDefined();
    expect(r.type).toBe("cloudflare:index/workersCustomDomain:WorkersCustomDomain");
    const zoneIdInput = await promiseOf(pulumi.output(r.inputs.zoneId));
    expect({
      accountId: r.inputs.accountId,
      hostname: r.inputs.hostname,
      service: r.inputs.service,
      zoneId: zoneIdInput,
      // deprecated `environment` を declaration に含めると preview で warning が出るため
      // 省く方針。test 側で `undefined` を assert することで誤って戻すことを防ぐ。
      environment: r.inputs.environment,
    }).toStrictEqual({
      accountId: TEST_ACCOUNT_ID,
      hostname: cd.hostname,
      service: "ryantsuji-dev-web",
      zoneId: "test-zone-id-1234567890",
      environment: undefined,
    });
  });

  it("ryantsuji-dev-images R2 bucket を期待どおりに宣言する", async () => {
    await import("./index.js");
    const r = captured["ryantsuji-dev-images"];
    expect(r, "ryantsuji-dev-images bucket not captured").toBeDefined();
    expect(r.type).toBe("cloudflare:index/r2Bucket:R2Bucket");
    expect({
      accountId: r.inputs.accountId,
      name: r.inputs.name,
      location: r.inputs.location,
      storageClass: r.inputs.storageClass,
    }).toStrictEqual({
      accountId: TEST_ACCOUNT_ID,
      name: "ryantsuji-dev-images",
      location: "apac",
      storageClass: "Standard",
    });
  });

  it("imagesBucketName export を返す", async () => {
    const m = await import("./index.js");
    const name = await promiseOf(m.imagesBucketName);
    expect(name).toBe("ryantsuji-dev-images");
  });
});
