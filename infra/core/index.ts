/**
 * self-management 個人プロジェクトの core infra (Pulumi stack: `core`)。
 *
 * 提供するもの: 必須 GCP API の有効化、graph-app SA + IAM 群、
 * ryan-product-graph 用 BQ dataset、SA key (ローカル ADC 用)。
 *
 * 「SA = infra owner」運用のため、admin role を SA に集約することで ADC (user) に
 * 依存せず direnv の `GOOGLE_APPLICATION_CREDENTIALS` 切替だけで Pulumi up が動く。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business 個人プロジェクト ryan-self-management の基盤 infra。API 有効化・SA・dataset・IAM を Pulumi で集約管理し、ADC ではなく SA で完結する運用を成立させる
 * @graph-connects ryan-product-graph [writes_to] BQ dataset `ryan` を provision (graph build/migrate の書き込み先)
 */

import * as gcp from "@pulumi/gcp";
import * as grafana from "@pulumiverse/grafana";
import * as pulumi from "@pulumi/pulumi";

/** @graph-connects none */
const gcpConfig = new pulumi.Config("gcp");
/** @graph-connects none */
const projectId = gcpConfig.require("project");
/** @graph-connects none */
const location = gcpConfig.get("region") ?? "asia-northeast1";

/**
 * Grafana Cloud `getStack` の `otlpUrl` を OTLP base URL (`/otlp` suffix 付き) に正規化する。
 * Stack API は `/otlp` 含まないものと含むものの両方を返しうるので両ケース対応。
 *
 * @graph-connects none
 */
export function normalizeOtlpUrl(raw: string | undefined | null): string {
  if (!raw) return "";
  if (raw.endsWith("/otlp")) return raw;
  return `${raw.replace(/\/$/, "")}/otlp`;
}

/**
 * 必要な Google API の有効化。Pulumi 適用時に自動 enable (既に有効なら no-op)。
 *
 * - serviceusage / cloudresourcemanager / compute / iam: Pulumi GCP provider 自身が
 *   region listing や IAM 操作のために要求する基盤 API
 * - bigquery / aiplatform: graph-app SA が呼ぶ業務 API
 *
 * @graph-connects gcp-services [writes_to] 6 つの GCP API を enable して Pulumi 操作と業務処理を成立させる
 */
const apiServices: Record<string, gcp.projects.Service> = {};
for (const service of [
  "serviceusage.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "compute.googleapis.com",
  "iam.googleapis.com",
  "bigquery.googleapis.com",
  "aiplatform.googleapis.com",
  "secretmanager.googleapis.com",
]) {
  const slug = service.replace(/\.googleapis\.com$/, "").replace(/\./g, "-");
  apiServices[slug] = new gcp.projects.Service(`${slug}-api`, {
    service,
    disableOnDestroy: false,
  });
}
/** @graph-connects none */
const bigqueryApi = apiServices.bigquery;
/** @graph-connects none */
const aiplatformApi = apiServices.aiplatform;

/**
 * ryan-product-graph 用 BQ dataset。docs/product-graph/README.md と整合。
 *
 * @graph-connects bigquery [writes_to] 個人グラフ全 10 テーブルが格納される dataset を作成
 */
const ryanDataset = new gcp.bigquery.Dataset(
  "ryan",
  {
    datasetId: "ryan",
    location,
    description:
      "ryan-product-graph: nodes (persons/contents/release_notes/decisions/topics/events/product_graph_nodes) + edges",
  },
  { dependsOn: [bigqueryApi] },
);

/**
 * graph app (apps/graph/product) が BQ に書き込む際に使う service account。
 * ローカル開発時は SA key を `.config/gcp-sa.json` に保存して使う。
 * 将来 Cloud Run 上の MCP server も同じ SA を使う想定。
 *
 * @graph-connects iam [writes_to] graph-app SA を作成 (graph 系処理の認証主体)
 */
const graphSa = new gcp.serviceaccount.Account("graph-sa", {
  accountId: "graph-app",
  displayName: "ryan-product-graph build/read",
  description:
    "Used by apps/graph/product and (future) mcp-ryan-product-graph to ingest and query the personal graph",
});

/**
 * graph-app SA に dataset `ryan` への書き込み権限を付与。
 *
 * @graph-connects iam [writes_to] dataset レベルの bigquery.dataEditor を SA に bind
 */
new gcp.bigquery.DatasetIamMember("graph-dataset-editor", {
  datasetId: ryanDataset.datasetId,
  role: "roles/bigquery.dataEditor",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/**
 * graph-app SA に project レベルの BQ job 実行権限を付与。
 * MERGE/SELECT 等のジョブ作成に必須。
 *
 * @graph-connects iam [writes_to] bigquery.jobUser を SA に bind
 */
new gcp.projects.IAMMember("graph-job-user", {
  project: projectId,
  role: "roles/bigquery.jobUser",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/**
 * Vertex AI (Gemini embedding 等) 利用権限。`gemini-embedding-2` を呼ぶために必要。
 *
 * @graph-connects iam [writes_to] aiplatform.user を SA に bind (gemini-embedding-2 呼び出し許可)
 */
new gcp.projects.IAMMember(
  "graph-aiplatform-user",
  {
    project: projectId,
    role: "roles/aiplatform.user",
    member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
  },
  { dependsOn: [aiplatformApi] },
);

/**
 * Pulumi が自身を SA で適用できるようにするための admin role 群。
 *
 * 個人スコープなので "SA = infra owner" にして、ADC (user account) に依存しない運用にする。
 * これにより direnv で `GOOGLE_APPLICATION_CREDENTIALS` だけ切替えれば
 * gcloud のログイン状態と無関係に Pulumi up が動く。
 *
 * - serviceusage.serviceUsageAdmin: API enable/disable
 * - resourcemanager.projectIamAdmin: IAM 管理
 * - iam.serviceAccountAdmin: SA 管理 (新規 SA 作成や key rotation 含む)
 * - iam.serviceAccountKeyAdmin: SA key 管理
 * - compute.networkViewer: Pulumi GCP provider が `compute.regions.list` を叩いて
 *   region 検証する際の権限不足 warning を解消
 * - secretmanager.admin: Pulumi が secret / version / IAM を管理
 *
 * @graph-connects iam [writes_to] Pulumi 自身が SA で動くための admin 権限を bind
 */
const adminRoles = [
  "roles/serviceusage.serviceUsageAdmin",
  "roles/resourcemanager.projectIamAdmin",
  "roles/iam.serviceAccountAdmin",
  "roles/iam.serviceAccountKeyAdmin",
  "roles/compute.networkViewer",
  "roles/secretmanager.admin",
];
for (const role of adminRoles) {
  const slug = role.replace(/^roles\//, "").replace(/\./g, "-");
  new gcp.projects.IAMMember(`graph-${slug}`, {
    project: projectId,
    role,
    member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
  });
}

/**
 * SA key を Pulumi が生成 → ローカル保存用に出力 (Pulumi state では暗号化保存)。
 * `pulumi stack output --show-secrets graphServiceAccountKey` で取り出して
 * `.config/gcp-sa.json` に保存する想定。
 *
 * @graph-connects iam [writes_to] graph-app SA の private key (ローカル ADC 用)
 */
const graphKey = new gcp.serviceaccount.Key("graph-sa-key", {
  serviceAccountId: graphSa.name,
});

/**
 * Grafana Cloud 連携。
 *
 * 前提: Ryan が手で Grafana Cloud Access Policy (admin scope) を発行し、
 * Secret Manager `grafana-cloud-admin-token` に格納済み。
 *
 * Pulumi はこの secret を読み出し、grafana provider を介して:
 * - Stack の OTLP endpoint URL を Cloud API から取得
 * - OTLP write 専用の Access Policy + Token を declarative に作成
 * - 発行された token を別の Secret (`grafana-otlp-write-token`) として保存
 * - graph-app SA に上記 secret の secretAccessor 権限を付与
 *
 * これにより、アプリ側 SA は OTLP write token のみアクセスでき、
 * admin token には触れられない (least privilege)。
 *
 * @graph-connects grafana-cloud [writes_to] OTLP write 用 access policy + token を作成
 * @graph-connects secret-manager [writes_to] OTLP write token を Secret Manager に保管
 */
/** @graph-connects none */
const grafanaConfig = new pulumi.Config("grafana");
/** @graph-connects none */
const grafanaStackSlug = grafanaConfig.require("stackSlug");

/** @graph-connects secret-manager [reads_from] admin token をロード */
const grafanaAdminTokenSecret = gcp.secretmanager.getSecretVersionOutput({
  secret: "grafana-cloud-admin-token",
  project: projectId,
});

/** @graph-connects grafana-cloud [calls] Grafana Cloud API への Pulumi provider */
const grafanaProvider = new grafana.Provider("grafana-cloud", {
  cloudAccessPolicyToken: grafanaAdminTokenSecret.secretData,
});

/** @graph-connects grafana-cloud [reads_from] stack の OTLP endpoint / region 等を取得 */
const grafanaStack = grafana.cloud.getStackOutput(
  { slug: grafanaStackSlug },
  { provider: grafanaProvider },
);

/**
 * OTLP write 用 access policy。
 * scopes は metrics / logs / traces / profiles の write のみ (least privilege)。
 *
 * @graph-connects grafana-cloud [writes_to] access policy resource
 */
const otlpAccessPolicy = new grafana.cloud.AccessPolicy(
  "otlp-write",
  {
    region: grafanaStack.regionSlug,
    name: "self-management-otlp-write",
    displayName: "self-management OTLP write",
    scopes: [
      "metrics:write",
      "logs:write",
      "traces:write",
      "profiles:write",
    ],
    realms: [
      {
        type: "stack",
        identifier: grafanaStack.id,
      },
    ],
  },
  { provider: grafanaProvider },
);

/** @graph-connects grafana-cloud [writes_to] access policy token (OTLP write) */
const otlpAccessPolicyToken = new grafana.cloud.AccessPolicyToken(
  "otlp-write-token",
  {
    region: grafanaStack.regionSlug,
    accessPolicyId: otlpAccessPolicy.policyId,
    name: "self-management-otlp-write",
    displayName: "self-management OTLP write",
  },
  { provider: grafanaProvider },
);

/**
 * Grafana Cloud OTLP write token を Secret Manager に保管。
 * graph-app SA は secretAccessor で読み出して OTLP リクエストの Authorization header に使う。
 *
 * @graph-connects secret-manager [writes_to] OTLP write token secret
 */
const otlpTokenSecret = new gcp.secretmanager.Secret(
  "grafana-otlp-write-token",
  {
    secretId: "grafana-otlp-write-token",
    replication: { auto: {} },
  },
  { dependsOn: [apiServices["secretmanager"]] },
);

/** @graph-connects secret-manager [writes_to] token の値を version として書き込む */
new gcp.secretmanager.SecretVersion("grafana-otlp-write-token-v1", {
  secret: otlpTokenSecret.id,
  secretData: otlpAccessPolicyToken.token,
});

/** @graph-connects iam [writes_to] graph-app SA に OTLP token secret の read 権限を付与 */
new gcp.secretmanager.SecretIamMember("graph-otlp-token-accessor", {
  secretId: otlpTokenSecret.id,
  role: "roles/secretmanager.secretAccessor",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/**
 * xmcp (X API MCP server) の OAuth credentials。
 *
 * 構成:
 * - `xmcp-app-credentials`: X dev app の consumer key/secret + bearer token (両アカウント共通)
 * - `xmcp-user-{account}`: 各 X user account の OAuth1 access_token + access_token_secret
 *
 * Secret 値は OAuth1 flow (browser interactive) で取得した値を Ryan が手動で
 * `gcloud secrets versions add` で投入する。Pulumi は container と IAM (graph-app SA に
 * secretAccessor) のみ管理 (token は infra ではなく user credential なので state に乗せない)。
 *
 * @graph-connects secret-manager [writes_to] xmcp app credentials secret container
 */
const xmcpAppSecret = new gcp.secretmanager.Secret(
  "xmcp-app-credentials",
  {
    secretId: "xmcp-app-credentials",
    replication: { auto: {} },
  },
  { dependsOn: [apiServices["secretmanager"]] },
);

/** @graph-connects iam [writes_to] graph-app SA に xmcp app secret の read 権限 */
new gcp.secretmanager.SecretIamMember("graph-xmcp-app-accessor", {
  secretId: xmcpAppSecret.id,
  role: "roles/secretmanager.secretAccessor",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/**
 * xmcp の対象 X account 一覧。新規追加時はここに足す + Pulumi up で secret container 作成。
 *
 * @graph-connects none
 */
export const XMCP_ACCOUNTS = ["ryantsuji", "ryanaircloset"] as const;

for (const account of XMCP_ACCOUNTS) {
  const userSecret = new gcp.secretmanager.Secret(
    `xmcp-user-${account}`,
    {
      secretId: `xmcp-user-${account}`,
      replication: { auto: {} },
    },
    { dependsOn: [apiServices["secretmanager"]] },
  );
  new gcp.secretmanager.SecretIamMember(`graph-xmcp-user-${account}-accessor`, {
    secretId: userSecret.id,
    role: "roles/secretmanager.secretAccessor",
    member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
  });
}

/** @graph-connects none */
export const xmcpAppSecretId = xmcpAppSecret.id;

/** @graph-connects none */
export const datasetId = ryanDataset.datasetId;
/** @graph-connects none */
export const datasetLocation = ryanDataset.location;
/** @graph-connects none */
export const graphServiceAccountEmail = graphSa.email;
/** @graph-connects none */
export const graphServiceAccountKey = pulumi.secret(graphKey.privateKey);

/**
 * Grafana Cloud OTLP gateway endpoint。
 * `getStack` は base URL のみ返すため、`/otlp` suffix を付けて完全な OTLP base にする。
 * `@self/otel` の OTel SDK 設定に流し込む。
 *
 * @graph-connects none
 */
export const grafanaOtlpEndpoint = grafanaStack.otlpUrl.apply(normalizeOtlpUrl);

/** @graph-connects none */
export const grafanaStackId = grafanaStack.id;

/** @graph-connects none */
export const grafanaOtlpTokenSecretId = otlpTokenSecret.id;
