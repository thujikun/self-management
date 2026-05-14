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
  "artifactregistry.googleapis.com",
  "run.googleapis.com",
  "cloudscheduler.googleapis.com",
  "cloudbuild.googleapis.com",
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
  "roles/iam.workloadIdentityPoolAdmin",
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
    scopes: ["metrics:write", "logs:write", "traces:write", "profiles:write"],
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
 * Grafana 公式 mcp-grafana binary 用の token を保管する Secret container。
 *
 * mcp-grafana は **Stack instance の API** (`https://<stack>.grafana.net/api/...`)
 * を呼ぶため、Cloud-level の Access Policy Token (`glc_`) ではなく Stack-scoped
 * Service Account Token (`sat_xxx` 形式) が必要。Stack 内 SA 作成 API は Cloud
 * admin token の scope 外なので、ここでは Pulumi は **secret container と IAM のみ
 * 管理** し、SA + token 自体は Ryan が Grafana UI で 1 回作って `gcloud secrets
 * versions add grafana-mcp-token --data-file=-` で投入する運用にする (xmcp 系と
 * 同じパターン)。
 *
 * `.envrc` から `gcloud secrets versions access` で取り出して `GRAFANA_API_KEY`
 * env var にして mcp-grafana binary を起動する (`.mcp.json` の grafana-personal)。
 *
 * @graph-connects secret-manager [writes_to] grafana-mcp-token secret container
 */
const mcpTokenSecret = new gcp.secretmanager.Secret(
  "grafana-mcp-token",
  {
    secretId: "grafana-mcp-token",
    replication: { auto: {} },
  },
  { dependsOn: [apiServices["secretmanager"]] },
);

/** @graph-connects iam [writes_to] graph-app SA に MCP token secret の read 権限を付与 */
new gcp.secretmanager.SecretIamMember("graph-mcp-token-accessor", {
  secretId: mcpTokenSecret.id,
  role: "roles/secretmanager.secretAccessor",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/** @graph-connects none */
export const grafanaMcpTokenSecretId = mcpTokenSecret.id;
/** @graph-connects none */
export const grafanaStackUrl = grafanaStack.url;

/**
 * Neon Postgres (ryantsuji.dev) の DATABASE_URL を保管する Secret container。
 *
 * Neon は console / API でしか project / branch を作れない (Pulumi neon provider
 * の成熟度待ち) ので、connection string 自体は Ryan が console で取得 → `gcloud
 * secrets versions add neon-database-url --data-file=-` で投入する運用にする
 * (grafana-mcp-token と同パターン)。Pulumi は **container と IAM のみ管理**。
 *
 * 消費経路:
 * - dev (.envrc): `gcloud secrets versions access` で `DATABASE_URL` env に展開
 * - production CF Workers: `wrangler secret put DATABASE_URL` で binding に投入
 *   (deploy 直前に GCP から手で読んで wrangler に流す。長期的には infra/ryantsuji-dev/
 *   側で `cloudflare.WorkerSecret` を declarative に bind する形にする)
 *
 * @graph-connects secret-manager [writes_to] neon-database-url secret container
 */
const neonDatabaseUrlSecret = new gcp.secretmanager.Secret(
  "neon-database-url",
  {
    secretId: "neon-database-url",
    replication: { auto: {} },
  },
  { dependsOn: [apiServices["secretmanager"]] },
);

/** @graph-connects iam [writes_to] graph-app SA に neon DB URL secret の read 権限 */
new gcp.secretmanager.SecretIamMember("graph-neon-database-url-accessor", {
  secretId: neonDatabaseUrlSecret.id,
  role: "roles/secretmanager.secretAccessor",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/** @graph-connects none */
export const neonDatabaseUrlSecretId = neonDatabaseUrlSecret.id;

/**
 * Better Auth 系 5 secret container。
 *
 * Better Auth runtime が要求する secret 群を GCP Secret Manager に集約する
 * (Grafana / Neon と同パターン)。Pulumi は **container と IAM のみ管理**、値は
 * Ryan が dev portal で OAuth app 作成 → `gcloud secrets versions add` で投入する運用。
 *
 * - `better-auth-secret`: 32+ char の暗号化 / 署名鍵 (`openssl rand -base64 32` で生成)
 * - `github-oauth-client-id` / `github-oauth-client-secret`: GitHub OAuth App
 *   (https://github.com/settings/developers で作成、callback URL は
 *   `https://ryantsuji.dev/api/auth/callback/github` + dev は `http://localhost:3000/api/auth/callback/github`)
 * - `x-oauth2-client-id` / `x-oauth2-client-secret`: X (Twitter) OAuth 2.0 client
 *   (https://developer.x.com の App settings で OAuth 2.0 を有効化、xmcp が使う
 *   OAuth1 とは独立。callback URL は `/api/auth/callback/twitter`)
 *
 * 消費経路:
 * - dev (.envrc): `gcloud secrets versions access` で 5 つの env var に展開
 * - production CF Workers: `wrangler secret put <NAME>` で binding に投入
 *
 * @graph-connects secret-manager [writes_to] Better Auth 5 secret container
 */
const authSecretIds = [
  "better-auth-secret",
  "github-oauth-client-id",
  "github-oauth-client-secret",
  "x-oauth2-client-id",
  "x-oauth2-client-secret",
] as const;
/** @graph-connects none */
const authSecrets: Record<string, gcp.secretmanager.Secret> = {};
for (const id of authSecretIds) {
  const secret = new gcp.secretmanager.Secret(
    id,
    {
      secretId: id,
      replication: { auto: {} },
    },
    { dependsOn: [apiServices["secretmanager"]] },
  );
  authSecrets[id] = secret;
  new gcp.secretmanager.SecretIamMember(`graph-${id}-accessor`, {
    secretId: secret.id,
    role: "roles/secretmanager.secretAccessor",
    member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
  });
}

/** @graph-connects none */
export const betterAuthSecretId = authSecrets["better-auth-secret"].id;
/** @graph-connects none */
export const githubOauthClientIdSecretId = authSecrets["github-oauth-client-id"].id;
/** @graph-connects none */
export const githubOauthClientSecretSecretId = authSecrets["github-oauth-client-secret"].id;
/** @graph-connects none */
export const xOauth2ClientIdSecretId = authSecrets["x-oauth2-client-id"].id;
/** @graph-connects none */
export const xOauth2ClientSecretSecretId = authSecrets["x-oauth2-client-secret"].id;

/**
 * Cloudflare API token (Workers deploy 用)。
 *
 * 用途: `wrangler deploy` / `wrangler secret put` を non-interactive (Bash tool /
 * CI) から叩く時に `CLOUDFLARE_API_TOKEN` env として必要。Ryan が CF Dashboard
 * (https://dash.cloudflare.com/profile/api-tokens) で **minimal scope** の
 * custom token を発行して `gcloud secrets versions add cloudflare-api-token` で
 * 投入する運用。Pulumi は container と IAM のみ管理。
 *
 * scope (Create Custom Token で必要なだけ):
 * - Account permission: `Workers Scripts: Edit`
 * - Zone permission: `Workers Routes: Edit` on `ryantsuji.dev`
 *
 * (Account Settings: Read は `wrangler whoami` で必要、deploy だけなら不要)
 *
 * 消費経路:
 * - dev (.envrc): `gcloud secrets versions access` で `CLOUDFLARE_API_TOKEN` を export
 * - CI / Bash tool: 同 env 経由で wrangler が non-interactive deploy 可能に
 *
 * @graph-connects secret-manager [writes_to] cloudflare-api-token secret container
 */
const cloudflareApiTokenSecret = new gcp.secretmanager.Secret(
  "cloudflare-api-token",
  {
    secretId: "cloudflare-api-token",
    replication: { auto: {} },
  },
  { dependsOn: [apiServices["secretmanager"]] },
);

/** @graph-connects iam [writes_to] graph-app SA に cloudflare-api-token secret の read 権限 */
new gcp.secretmanager.SecretIamMember("graph-cloudflare-api-token-accessor", {
  secretId: cloudflareApiTokenSecret.id,
  role: "roles/secretmanager.secretAccessor",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/** @graph-connects none */
export const cloudflareApiTokenSecretId = cloudflareApiTokenSecret.id;

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
  // OAuth 2.0 user-context (bookmark / repost-of-me 等で必須、OAuth1 では 403 になる endpoint 用)
  const userOauth2Secret = new gcp.secretmanager.Secret(
    `xmcp-user-${account}-oauth2`,
    {
      secretId: `xmcp-user-${account}-oauth2`,
      replication: { auto: {} },
    },
    { dependsOn: [apiServices["secretmanager"]] },
  );
  new gcp.secretmanager.SecretIamMember(`graph-xmcp-user-${account}-oauth2-accessor`, {
    secretId: userOauth2Secret.id,
    role: "roles/secretmanager.secretAccessor",
    member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
  });
  // graph-app SA は version 追加権限も必要 (TS 側で refresh 後に書き戻すため)
  new gcp.secretmanager.SecretIamMember(`graph-xmcp-user-${account}-oauth2-version-adder`, {
    secretId: userOauth2Secret.id,
    role: "roles/secretmanager.secretVersionAdder",
    member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
  });
}

/** @graph-connects none */
export const xmcpAppSecretId = xmcpAppSecret.id;

/**
 * graph-product (X ingest) を Cloud Run Job として日次実行するための infra。
 *
 * 構成:
 * - Artifact Registry repo `self-mgmt` (Docker image 配置先)
 * - Cloud Run Job `graph-migrate` (graph-app SA で実行、tsx で migrate.ts を起動)
 * - Cloud Scheduler `graph-migrate-daily` (00:00 UTC = 09:00 JST、graph-app SA で OIDC auth)
 *
 * image の build/push は別オペ:
 *   gcloud builds submit --region=asia-northeast1 \
 *     --tag asia-northeast1-docker.pkg.dev/${PROJECT}/self-mgmt/graph-product:latest \
 *     -f apps/graph/product/Dockerfile .
 *
 * @graph-connects artifact-registry [writes_to] Docker repo を作成
 */
const arRepo = new gcp.artifactregistry.Repository(
  "self-mgmt",
  {
    repositoryId: "self-mgmt",
    format: "DOCKER",
    location,
    description: "self-management container images (graph-product / future workers)",
  },
  { dependsOn: [apiServices["artifactregistry"]] },
);

/** @graph-connects iam [writes_to] graph-app SA に AR repo の reader 権限 (Cloud Run pull 用) */
new gcp.artifactregistry.RepositoryIamMember("graph-ar-reader", {
  repository: arRepo.name,
  location: arRepo.location,
  role: "roles/artifactregistry.reader",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/**
 * Cloud Run Job: 日次の X ingest を含む migrate。
 *
 * env:
 * - GOOGLE_CLOUD_PROJECT / OTEL_* は graph-app SA 配下で direnv-equivalent な値を直書き
 *
 * 初回 pulumi up 時点では image が存在しない → image push 後に再 pulumi up で job spec
 * が確定する想定。Cloud Run Job 自体は image 不在でも spec 登録は通る。
 *
 * @graph-connects cloud-run [writes_to] graph-migrate Job (X ingest を週次/日次で実行)
 */
const graphMigrateJob = new gcp.cloudrunv2.Job(
  "graph-migrate",
  {
    name: "graph-migrate",
    location,
    template: {
      template: {
        serviceAccount: graphSa.email,
        timeout: "1800s",
        maxRetries: 1,
        containers: [
          {
            image: pulumi.interpolate`${location}-docker.pkg.dev/${projectId}/${arRepo.repositoryId}/graph-product:latest`,
            resources: { limits: { cpu: "1", memory: "1Gi" } },
            envs: [
              { name: "GOOGLE_CLOUD_PROJECT", value: projectId },
              {
                name: "OTEL_EXPORTER_OTLP_ENDPOINT",
                value: "https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp",
              },
              { name: "GRAFANA_OTLP_INSTANCE_ID", value: "1623802" },
            ],
          },
        ],
      },
    },
  },
  { dependsOn: [apiServices["run"], graphSa, arRepo] },
);

/** @graph-connects iam [writes_to] graph-app SA に Job 起動権限 (Scheduler が graph-app の OIDC で叩くため) */
new gcp.cloudrunv2.JobIamMember("graph-job-invoker", {
  name: graphMigrateJob.name,
  location: graphMigrateJob.location,
  role: "roles/run.invoker",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/**
 * Cloud Scheduler: 日次 00:00 UTC (09:00 JST) で graph-migrate Job をキック。
 * Cloud Run v2 Job の run endpoint を OAuth2 で POST する。
 *
 * @graph-connects cloud-scheduler [writes_to] daily cron
 * @graph-connects cloud-run [calls] graph-migrate Job の run endpoint を OAuth で呼び出し
 */
new gcp.cloudscheduler.Job(
  "graph-migrate-daily",
  {
    name: "graph-migrate-daily",
    region: location,
    schedule: "0 0 * * *",
    timeZone: "Etc/UTC",
    // since_id-based incremental + pay-as-you-go credits 投入済 (Phase 4g)。
    // 日次 00:00 UTC で graph-migrate Job を実行 → 新規 tweet + URL refs +
    // same_entity edge を BQ に反映する
    paused: false,
    httpTarget: {
      httpMethod: "POST",
      uri: pulumi.interpolate`https://run.googleapis.com/v2/projects/${projectId}/locations/${location}/jobs/${graphMigrateJob.name}:run`,
      oauthToken: {
        serviceAccountEmail: graphSa.email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
      },
    },
  },
  { dependsOn: [apiServices["cloudscheduler"], graphMigrateJob] },
);

/** @graph-connects none */
export const artifactRegistryRepoId = arRepo.repositoryId;
/** @graph-connects none */
export const graphMigrateJobName = graphMigrateJob.name;

/**
 * GitHub Actions OIDC → GCP impersonation (Workload Identity Federation)。
 *
 * GitHub Actions の OIDC token を直接 GCP service account に変換 (long-lived JSON key
 * 不使用)。`pulumi-ci` SA に CI 実行に必要な admin role を集約し、本 repository から
 * 起動された workflow のみがその SA を借りられるよう attribute condition で絞り込む。
 *
 * pool / provider / SA / IAM bindings は本 stack で一括 declarative 管理。初回 `pulumi up`
 * で pool 作成 → provider URI と SA email が outputs に出る → GitHub Actions workflow が
 * その値を参照して `google-github-actions/auth@v2` で impersonate する流れ。
 *
 * security 設計:
 * - attribute condition で `repository == thujikun/self-management` のみ許可
 *   (他 repo / fork からの impersonation を防ぐ)
 * - SA の権限は graph-app と同 admin role (CI で Pulumi up を回すために必要)
 * - secret 値 (CF token / DB URL 等) は SA 経由 secretAccessor で動的取得 (workflow yaml に直書きしない)
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business GitHub Actions から Pulumi up を回すための WIF 構成。OIDC で SA impersonation
 *   して JSON key を持たずに済ませる pattern。pool / provider / SA / IAM bindings を declarative 管理
 * @graph-connects iam [writes_to] WIF pool + provider + pulumi-ci SA + admin IAM bindings
 * @graph-connects github-actions [delegates_to] OIDC token を pulumi-ci SA に変換する経路
 */
/** @graph-connects iam [writes_to] CI 専用 SA (Pulumi up 用) */
const pulumiCiSa = new gcp.serviceaccount.Account("pulumi-ci-sa", {
  accountId: "pulumi-ci",
  displayName: "GitHub Actions Pulumi runner (WIF, no key)",
  description: "Impersonated via WIF from GitHub Actions to run pulumi preview / up.",
});

/** @graph-connects iam [writes_to] WIF pool (GitHub OIDC trust の入口) */
const githubWifPool = new gcp.iam.WorkloadIdentityPool(
  "github-actions-pool",
  {
    workloadIdentityPoolId: "github-actions",
    displayName: "GitHub Actions",
    description: "OIDC trust for GitHub Actions in thujikun/self-management.",
  },
  { dependsOn: [apiServices["iam"]] },
);

/**
 * GitHub OIDC issuer (`token.actions.githubusercontent.com`) を pool に bind。
 *
 * `attribute_condition` で本 repository からの token のみ許可。fork や別 org からの
 * 流入をブロックする (Google 公式推奨 pattern)。
 *
 * @graph-connects iam [writes_to] OIDC provider with attribute condition
 */
const githubWifProvider = new gcp.iam.WorkloadIdentityPoolProvider("github-actions-provider", {
  workloadIdentityPoolId: githubWifPool.workloadIdentityPoolId,
  workloadIdentityPoolProviderId: "github-actions",
  displayName: "GitHub Actions",
  description: "GitHub OIDC provider (thujikun/self-management only).",
  attributeMapping: {
    "google.subject": "assertion.sub",
    "attribute.repository": "assertion.repository",
    "attribute.ref": "assertion.ref",
    "attribute.actor": "assertion.actor",
  },
  attributeCondition: 'assertion.repository == "thujikun/self-management"',
  oidc: {
    issuerUri: "https://token.actions.githubusercontent.com",
  },
});

/**
 * pulumi-ci SA に WIF からの impersonation を許可。`principalSet://...` で
 * pool 配下の特定 attribute (repository) 経由の subject 群を許可する。
 *
 * @graph-connects iam [writes_to] pulumi-ci SA に workloadIdentityUser を bind
 */
new gcp.serviceaccount.IAMMember("pulumi-ci-wif-binding", {
  serviceAccountId: pulumiCiSa.name,
  role: "roles/iam.workloadIdentityUser",
  member: pulumi.interpolate`principalSet://iam.googleapis.com/${githubWifPool.name}/attribute.repository/thujikun/self-management`,
});

/**
 * pulumi-ci SA に Pulumi up に必要な admin role 群を bind (graph-app と同セット)。
 * stack を実 apply するため admin 権限が要る。`dependsOn` は不要 (SA 作成順は宣言順)。
 *
 * @graph-connects iam [writes_to] pulumi-ci SA に Pulumi 実行 admin role bind
 */
const pulumiCiAdminRoles = [
  "roles/serviceusage.serviceUsageAdmin",
  "roles/resourcemanager.projectIamAdmin",
  "roles/iam.serviceAccountAdmin",
  "roles/iam.serviceAccountKeyAdmin",
  "roles/iam.workloadIdentityPoolAdmin",
  "roles/compute.networkViewer",
  "roles/secretmanager.admin",
  "roles/bigquery.admin",
  "roles/aiplatform.admin",
  "roles/run.admin",
  "roles/artifactregistry.admin",
  "roles/cloudscheduler.admin",
];
for (const role of pulumiCiAdminRoles) {
  const slug = role.replace(/^roles\//, "").replace(/\./g, "-");
  new gcp.projects.IAMMember(`pulumi-ci-${slug}`, {
    project: projectId,
    role,
    member: pulumi.interpolate`serviceAccount:${pulumiCiSa.email}`,
  });
}

/** @graph-connects none */
export const pulumiCiServiceAccountEmail = pulumiCiSa.email;
/** @graph-connects none */
export const githubWifProviderResource = githubWifProvider.name;

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
