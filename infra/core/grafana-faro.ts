/**
 * Grafana Cloud Frontend Observability (Faro) の Pulumi 配線。
 *
 * `index.ts` から分離した理由は単に 500 行 cap を維持するため。本 module は
 * 「Stack 内 Admin SA + Token を Cloud-level provider で発行 → その token を
 * `auth` に詰めた 2 つ目の `grafana.Provider` を建てる → Stack instance API 経由で
 * Faro App を declarative 作成 → collector URL を Secret Manager に書く」
 * という pipeline 全体を 1 ファイルに閉じる。
 *
 * 呼び出し側 (`index.ts`) は `provisionGrafanaFaro({ ... })` を呼んで output だけ受け取る。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business Grafana Cloud Frontend Observability (Faro) を end-to-end Pulumi で provision。Stack SA + 2nd provider + Faro App + SecretVersion を 1 セットでセットアップし、手動 UI 操作 / `gcloud secrets versions add` を完全除去
 * @graph-connects grafana-cloud [writes_to] Stack SA + Faro App を declarative に作成
 * @graph-connects secret-manager [writes_to] Faro collector URL を SecretVersion として保管
 */

import * as gcp from "@pulumi/gcp";
import * as grafana from "@pulumiverse/grafana";
import * as pulumi from "@pulumi/pulumi";

/**
 * Pulumi 用 args。`index.ts` で先に作成済の Cloud provider と Stack info を渡す
 * ことで、本 module は依存リソースの作成順を気にしなくて良くなる。
 *
 * @graph-connects none
 */
export interface ProvisionFaroArgs {
  cloudProvider: grafana.Provider;
  stackSlug: string;
  stackUrl: pulumi.Output<string>;
  stackId: pulumi.Output<string>;
  graphSaEmail: pulumi.Output<string>;
  secretmanagerApi: gcp.projects.Service;
}

/**
 * Faro Pulumi pipeline の output。`index.ts` から re-export して outside から見える
 * ようにする (secret container ID は debug / 検索用)。
 *
 * @graph-connects none
 */
export interface ProvisionFaroOutput {
  collectorUrlSecretId: pulumi.Output<string>;
  collectorEndpoint: pulumi.Output<string>;
}

/**
 * Faro app provisioning の全体 pipeline。1 度だけ呼ばれる前提 (multi-stack 化したい
 * 時は呼び出し側で `name` prefix を変える)。
 *
 * @graph-connects grafana-cloud [writes_to] Stack SA + Token + Faro App
 * @graph-connects secret-manager [writes_to] grafana-faro-collector-url container + version + IAM
 */
export function provisionGrafanaFaro(args: ProvisionFaroArgs): ProvisionFaroOutput {
  // Frontend Observability App を作成するには **Stack instance の API**
  // (`https://<stack>.grafana.net/api/...`) を叩く必要があり、Cloud-level
  // Access Policy Token では権限が足りない。Stack 内 Admin SA + Token を発行し、
  // その token を `auth` に詰めた 2 つ目の Provider を建てて Faro App 専用に使う。
  const stackPulumiSa = new grafana.cloud.StackServiceAccount(
    "pulumi-stack-admin",
    {
      stackSlug: args.stackSlug,
      name: "pulumi-stack-admin",
      role: "Admin",
      isDisabled: false,
    },
    { provider: args.cloudProvider },
  );

  const stackPulumiToken = new grafana.cloud.StackServiceAccountToken(
    "pulumi-stack-admin-token",
    {
      stackSlug: args.stackSlug,
      serviceAccountId: stackPulumiSa.id,
      name: "pulumi-stack-admin",
    },
    { provider: args.cloudProvider },
  );

  // Stack instance API 用 2nd provider。`url` は stack base URL、`auth` は SA token。
  const stackProvider = new grafana.Provider("grafana-stack", {
    url: args.stackUrl,
    auth: stackPulumiToken.key,
  });

  // Faro App を declarative に作成。`allowedOrigins` で CORS fence (custom domain +
  // workers.dev preview の両方を許可)。
  const faroApp = new grafana.frontendobservability.App(
    "ryantsuji-dev-web",
    {
      stackId: args.stackId.apply(Number),
      name: "ryantsuji-dev-web",
      allowedOrigins: [
        "https://ryantsuji.dev",
        "https://www.ryantsuji.dev",
        "https://ryantsuji-dev-web.workers.dev",
      ],
      extraLogAttributes: {},
      settings: {},
    },
    { provider: stackProvider },
  );

  // collector URL を保管する Secret container。値は本 pipeline 内の SecretVersion で
  // Faro App output から直接書き込まれるため、UI 操作 / 手動 `gcloud secrets
  // versions add` は完全に不要。
  const collectorUrlSecret = new gcp.secretmanager.Secret(
    "grafana-faro-collector-url",
    {
      secretId: "grafana-faro-collector-url",
      replication: { auto: {} },
    },
    { dependsOn: [args.secretmanagerApi] },
  );

  // graph-app SA に collector URL secret の read 権限。Worker deploy workflow は
  // `pulumi-ci@` SA で動くが、graph-app へも bind しておくことで CLI / 本番外
  // からの読み出し経路も同じ pattern で揃える。
  new gcp.secretmanager.SecretIamMember("graph-faro-collector-url-accessor", {
    secretId: collectorUrlSecret.id,
    role: "roles/secretmanager.secretAccessor",
    member: pulumi.interpolate`serviceAccount:${args.graphSaEmail}`,
  });

  // Faro App の collector URL output を SecretVersion として書き込み (= end-to-end
  // 自動化の最後のピース)。
  new gcp.secretmanager.SecretVersion("grafana-faro-collector-url-v1", {
    secret: collectorUrlSecret.id,
    secretData: faroApp.collectorEndpoint,
  });

  return {
    collectorUrlSecretId: collectorUrlSecret.id,
    collectorEndpoint: faroApp.collectorEndpoint,
  };
}
