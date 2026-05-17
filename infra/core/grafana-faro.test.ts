/**
 * `infra/core/grafana-faro.ts` (Pulumi Faro provisioning pipeline) の dedicated test。
 *
 * `pulumi.runtime.setMocks` で resource provider を mock 化して `provisionGrafanaFaro`
 * を直接呼び、(a) Stack Admin SA + Token + 2nd Provider + Faro App + Secret +
 * IAM + Version の 7 resource が作られる、(b) Faro App の `allowedOrigins` が custom
 * domain + workers.dev preview を網羅する、(c) output 2 つ (`collectorUrlSecretId` /
 * `collectorEndpoint`) が `pulumi.Output` として返る、を契約として固定する。
 *
 * negative case (`stackUrl` に `Output<string | undefined>` の undefined を渡しても
 * construction が落ちない) は `grafana-faro.edge.test.ts` に分離。理由:
 * `provisionGrafanaFaro` は resource 名を hardcode するため、同一 Pulumi runtime 内で
 * 2 回呼ぶと URN 衝突リスクがある。test file ごとに vitest が isolate (= 各 file =
 * 別 worker / Pulumi runtime state) するので、negative case は別 file に置いて normal
 * case と切り離す。
 *
 * barrel snapshot (`index.test.ts`) と同型の「silent rename / 削除を機械検知する」
 * 安全網を `grafana-faro.ts` 側にも張る目的。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business grafana-faro.ts の Pulumi pipeline (Stack SA + Faro App + SecretVersion) を mock-runtime で smoke test。allowedOrigins 配列 / resource 構成を inline snapshot で固定し、silent な変更 (Stack SA name 変更 / workers.dev preview origin 削除 等) を機械検知する
 * @graph-connects none
 */

import * as gcp from "@pulumi/gcp";
import * as grafana from "@pulumiverse/grafana";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

import { provisionGrafanaFaro, type ProvisionFaroOutput } from "./grafana-faro.js";

/**
 * Pulumi mock が capture する resource 1 件分の最小 shape。
 *
 * @graph-connects none
 */
interface CapturedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

/**
 * Pulumi Output<T> を Promise<T> に。`.apply` で 1 回限り resolve。
 *
 * @graph-connects none
 */
function promiseOf<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((resolve) => o.apply((v) => resolve(v)));
}

const captured: CapturedResource[] = [];
let output: ProvisionFaroOutput;

beforeAll(async () => {
  pulumi.runtime.setAllConfig({
    "gcp:project": "test-project",
    "grafana:stackSlug": "test-stack",
  });
  pulumi.runtime.setMocks({
    newResource(args: pulumi.runtime.MockResourceArgs): {
      id: string;
      state: Record<string, unknown>;
    } {
      captured.push({ type: args.type, name: args.name, inputs: { ...args.inputs } });
      return { id: `${args.name}_id`, state: { ...args.inputs, id: `${args.name}_id` } };
    },
    call(args: pulumi.runtime.MockCallArgs): Record<string, unknown> {
      return args.inputs;
    },
  });

  // 上流で建てる Cloud-level provider と secretmanager API enabler。
  // provisionGrafanaFaro の args として渡すため、本 file の側で minimal に build する。
  // どちらも captured に入るが、後段の assertion では name で除外する。
  const cloudProvider = new grafana.Provider("grafana-cloud", {
    cloudAccessPolicyToken: "test-access-policy-token",
  });
  const secretmanagerApi = new gcp.projects.Service("secretmanager-api", {
    service: "secretmanager.googleapis.com",
  });

  output = provisionGrafanaFaro({
    cloudProvider,
    cloudAccessPolicyToken: pulumi.output("test-cap-token"),
    stackSlug: "test-stack",
    stackUrl: pulumi.output("https://test-stack.grafana.net"),
    stackId: pulumi.output("12345"),
    graphSaEmail: pulumi.output("graph-app@test-project.iam.gserviceaccount.com"),
    secretmanagerApi,
  });

  // Pulumi resource registration は async (newResource は registerResource の
  // microtask 経由で呼ばれる)。output Output を resolve して dependency 連鎖で
  // 全 resource の登録を flush する。IAM / SecretVersion は output に露出しない
  // side-effect resource なので、追加で macrotask を回して登録キューを drain する。
  await Promise.all([promiseOf(output.collectorEndpoint), promiseOf(output.collectorUrlSecretId)]);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
});

/**
 * Cloud-level provider と secretmanager API enabler を除外し、`provisionGrafanaFaro`
 * が直接発行した resource のみを (type, name) で並べ替えて返す。順序は async 登録
 * 順に依存するので、(type, name) lex sort で正規化する。
 *
 * @graph-connects none
 */
function provisionedResources(): Array<{ type: string; name: string }> {
  return captured
    .filter((r) => r.name !== "grafana-cloud" && r.name !== "secretmanager-api")
    .map((r) => ({ type: r.type, name: r.name }))
    .sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type),
    );
}

describe("provisionGrafanaFaro", () => {
  it("Stack Admin SA / Token / 2nd Provider / Faro App / Secret / IAM / Version の 7 resource を発行する", () => {
    expect(provisionedResources()).toStrictEqual([
      { type: "gcp:secretmanager/secret:Secret", name: "grafana-faro-collector-url" },
      {
        type: "gcp:secretmanager/secretIamMember:SecretIamMember",
        name: "graph-faro-collector-url-accessor",
      },
      {
        type: "gcp:secretmanager/secretVersion:SecretVersion",
        name: "grafana-faro-collector-url-v1",
      },
      {
        type: "grafana:cloud/stackServiceAccount:StackServiceAccount",
        name: "pulumi-stack-admin",
      },
      {
        type: "grafana:cloud/stackServiceAccountToken:StackServiceAccountToken",
        name: "pulumi-stack-admin-token",
      },
      { type: "grafana:frontendObservability/app:App", name: "ryantsuji-dev-web" },
      { type: "pulumi:providers:grafana", name: "grafana-stack" },
    ]);
  });

  it("Faro App は ryantsuji-dev-web として custom domain + workers.dev preview の 3 origin を許可する", () => {
    const faroApp = captured.find(
      (r) => r.type === "grafana:frontendObservability/app:App" && r.name === "ryantsuji-dev-web",
    );
    expect(faroApp?.inputs["name"]).toStrictEqual("ryantsuji-dev-web");
    expect(faroApp?.inputs["allowedOrigins"]).toStrictEqual([
      "https://ryantsuji.dev",
      "https://www.ryantsuji.dev",
      "https://ryantsuji-dev-web.workers.dev",
    ]);
    // stackId は `args.stackId.apply(Number)` で数値変換されて渡る (Faro App の
    // schema が int を要求するため)。
    expect(faroApp?.inputs["stackId"]).toStrictEqual(12345);
  });

  it("Stack Admin SA は Admin role + isDisabled=false + name=pulumi-stack-admin で発行される", () => {
    const sa = captured.find(
      (r) =>
        r.type === "grafana:cloud/stackServiceAccount:StackServiceAccount" &&
        r.name === "pulumi-stack-admin",
    );
    expect(sa?.inputs["role"]).toStrictEqual("Admin");
    expect(sa?.inputs["isDisabled"]).toStrictEqual(false);
    expect(sa?.inputs["stackSlug"]).toStrictEqual("test-stack");
    expect(sa?.inputs["name"]).toStrictEqual("pulumi-stack-admin");
  });

  it("Stack SA Token は SA を referencing + stackSlug=test-stack で発行される", () => {
    const token = captured.find(
      (r) =>
        r.type === "grafana:cloud/stackServiceAccountToken:StackServiceAccountToken" &&
        r.name === "pulumi-stack-admin-token",
    );
    expect(token?.inputs["stackSlug"]).toStrictEqual("test-stack");
    expect(token?.inputs["name"]).toStrictEqual("pulumi-stack-admin");
    // mock の SA は `${name}_id` を id として返すので、SA を参照していることを契約化。
    expect(token?.inputs["serviceAccountId"]).toStrictEqual("pulumi-stack-admin_id");
  });

  it("2nd grafana.Provider は url + auth + cloudAccessPolicyToken + frontendO11yApiAccessToken の 4 field を詰めて発行される", () => {
    // Faro App は 3 経路 (Stack instance API / Frontend Observability management API /
    // Cloud Portal lookup) を踏むため、`auth` (Stack SA token) と `cloudAccessPolicyToken`
    // / `frontendO11yApiAccessToken` (Cloud-level admin CAP token) の 4 field 全てが
    // 必要。`grafana-faro.ts:113-114` の 2 行が silent に消えても regression を拾える
    // ように、各 field を toStrictEqual で個別に固定する。
    //
    // `cloudAccessPolicyToken` / `frontendO11yApiAccessToken` / `auth` は provider schema
    // 上 secret 扱いのため、Pulumi mock は値を secret sentinel
    // (`4dabf18193072939515e22adb298388d` 0xc26d0f04 magic) で wrap して serialize する。
    // `auth` の値は mock 側で synthesize されない (`stackPulumiToken.key` は state に
    // 載らない) ため `value: null` になり、CAP 系 2 field は test fixture の入力値
    // `"test-cap-token"` がそのまま wrap される。
    const SECRET_SENTINEL = "4dabf18193072939515e22adb298388d";
    const SECRET_MAGIC = "1b47061264138c4ac30d75fd1eb44270";
    const provider = captured.find(
      (r) => r.type === "pulumi:providers:grafana" && r.name === "grafana-stack",
    );
    expect(provider?.inputs["url"]).toStrictEqual("https://test-stack.grafana.net");
    expect(provider?.inputs["cloudAccessPolicyToken"]).toStrictEqual({
      [SECRET_SENTINEL]: SECRET_MAGIC,
      value: "test-cap-token",
    });
    expect(provider?.inputs["frontendO11yApiAccessToken"]).toStrictEqual({
      [SECRET_SENTINEL]: SECRET_MAGIC,
      value: "test-cap-token",
    });
    expect(provider?.inputs["auth"]).toStrictEqual({
      [SECRET_SENTINEL]: SECRET_MAGIC,
      value: null,
    });
  });

  it("Secret container は replication.auto + secretId=grafana-faro-collector-url で発行される", () => {
    const secret = captured.find(
      (r) =>
        r.type === "gcp:secretmanager/secret:Secret" && r.name === "grafana-faro-collector-url",
    );
    expect(secret?.inputs["secretId"]).toStrictEqual("grafana-faro-collector-url");
    expect(secret?.inputs["replication"]).toStrictEqual({ auto: {} });
  });

  it("graph-faro-collector-url-accessor IAM は graph-app SA への secretAccessor bind", () => {
    const iam = captured.find(
      (r) =>
        r.type === "gcp:secretmanager/secretIamMember:SecretIamMember" &&
        r.name === "graph-faro-collector-url-accessor",
    );
    expect(iam?.inputs["role"]).toStrictEqual("roles/secretmanager.secretAccessor");
    // mock 内で pulumi.interpolate は文字列展開されて inputs に乗る。
    expect(iam?.inputs["member"]).toStrictEqual(
      "serviceAccount:graph-app@test-project.iam.gserviceaccount.com",
    );
    // mock の Secret は `${name}_id` を id として返すので、Secret container を referencing。
    expect(iam?.inputs["secretId"]).toStrictEqual("grafana-faro-collector-url_id");
  });

  it("SecretVersion は Secret container と Faro App.collectorEndpoint を referencing する", () => {
    const version = captured.find(
      (r) =>
        r.type === "gcp:secretmanager/secretVersion:SecretVersion" &&
        r.name === "grafana-faro-collector-url-v1",
    );
    expect(version?.inputs["secret"]).toStrictEqual("grafana-faro-collector-url_id");
    // `faroApp.collectorEndpoint` は mock で synthesize されないので、Pulumi は
    // secret-wrapped null として serialize する。Output の依存が確かに張られていること
    // (= Faro App の output が SecretVersion の input に流れる) を sentinel 形で固定。
    expect(version?.inputs["secretData"]).toStrictEqual({
      "4dabf18193072939515e22adb298388d": "1b47061264138c4ac30d75fd1eb44270",
      value: null,
    });
  });

  it("output は collectorUrlSecretId / collectorEndpoint の 2 つを返す", () => {
    expect(Object.keys(output).sort()).toStrictEqual(["collectorEndpoint", "collectorUrlSecretId"]);
  });

  it("output.collectorUrlSecretId は Secret container の id を返す Output", async () => {
    const id = await promiseOf(output.collectorUrlSecretId);
    expect(id).toStrictEqual("grafana-faro-collector-url_id");
  });
});
