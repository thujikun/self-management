/**
 * GitHub Actions OIDC → GCP impersonation (Workload Identity Federation) の Pulumi 配線。
 *
 * `index.ts` から分離した理由は単に 500 行 cap を維持するため。本 module は
 * 「WIF pool / provider → CI 用 SA 群 (pulumi-ci / devto-import) → IAM bindings」
 * という GitHub Actions 認証経路全体を 1 ファイルに閉じる。
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
 * - pulumi-ci SA の権限は graph-app と同 admin role (CI で Pulumi up を回すために必要)
 * - schedule 系 job (dev.to import 等) は admin SA を使い回さず、必要 secret のみ
 *   read できる最小権限 SA を分離する (devto-import)
 * - secret 値 (CF token / DB URL 等) は SA 経由 secretAccessor で動的取得 (workflow yaml に直書きしない)
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business GitHub Actions から GCP を叩くための WIF 構成。OIDC で SA impersonation
 *   して JSON key を持たずに済ませる pattern。pool / provider / SA / IAM bindings を declarative 管理
 * @graph-connects iam [writes_to] WIF pool + provider + pulumi-ci / devto-import SA + IAM bindings
 * @graph-connects github-actions [delegates_to] OIDC token を SA に変換する経路
 */

import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";

/**
 * Pulumi 用 args。`index.ts` で先に作成済の API enabler と secret ID を渡すことで、
 * 本 module は依存リソースの作成順を気にしなくて良くなる (grafana-faro と同 pattern)。
 *
 * @graph-connects none
 */
export interface ProvisionGithubWifArgs {
  projectId: string;
  /** WIF pool の dependsOn に渡す iam API enabler (`apiServices["iam"]`)。 */
  iamApi: gcp.projects.Service;
  /** devto-import SA に read 権限を bind する `neon-database-url` secret container の ID。 */
  neonDatabaseUrlSecretId: pulumi.Output<string>;
}

/**
 * WIF pipeline の output。`index.ts` から stack output として re-export され、
 * GitHub Actions の vars (PULUMI_CI_SA_EMAIL / DEVTO_IMPORT_SA_EMAIL) の参照元になる。
 *
 * @graph-connects none
 */
export interface ProvisionGithubWifOutput {
  pulumiCiSaEmail: pulumi.Output<string>;
  devtoImportSaEmail: pulumi.Output<string>;
  githubWifProviderName: pulumi.Output<string>;
}

/**
 * GitHub Actions WIF provisioning の全体 pipeline。1 度だけ呼ばれる前提。
 *
 * @graph-connects iam [writes_to] WIF pool + provider + pulumi-ci / devto-import SA + IAM bindings
 * @graph-connects github-actions [delegates_to] OIDC token を SA に変換する経路
 */
export function provisionGithubWif(args: ProvisionGithubWifArgs): ProvisionGithubWifOutput {
  const pulumiCiSa = new gcp.serviceaccount.Account("pulumi-ci-sa", {
    accountId: "pulumi-ci",
    displayName: "GitHub Actions Pulumi runner (WIF, no key)",
    description: "Impersonated via WIF from GitHub Actions to run pulumi preview / up.",
  });

  // WIF pool (GitHub OIDC trust の入口)
  const githubWifPool = new gcp.iam.WorkloadIdentityPool(
    "github-actions-pool",
    {
      workloadIdentityPoolId: "github-actions",
      displayName: "GitHub Actions",
      description: "OIDC trust for GitHub Actions in thujikun/self-management.",
    },
    { dependsOn: [args.iamApi] },
  );

  // GitHub OIDC issuer (`token.actions.githubusercontent.com`) を pool に bind。
  // `attribute_condition` で本 repository からの token のみ許可。fork や別 org からの
  // 流入をブロックする (Google 公式推奨 pattern)。
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

  // 本 repository の GitHub OIDC token 経由の subject 群のみ impersonation を許可する
  // principalSet。pulumi-ci / devto-import の両 SA で同一の trust 境界を共有する。
  const githubPrincipalSet = pulumi.interpolate`principalSet://iam.googleapis.com/${githubWifPool.name}/attribute.repository/thujikun/self-management`;

  new gcp.serviceaccount.IAMMember("pulumi-ci-wif-binding", {
    serviceAccountId: pulumiCiSa.name,
    role: "roles/iam.workloadIdentityUser",
    member: githubPrincipalSet,
  });

  // pulumi-ci SA に Pulumi up に必要な admin role 群を bind (graph-app と同セット)。
  // stack を実 apply するため admin 権限が要る。`dependsOn` は不要 (SA 作成順は宣言順)。
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
      project: args.projectId,
      role,
      member: pulumi.interpolate`serviceAccount:${pulumiCiSa.email}`,
    });
  }

  // dev.to コメント取り込み (import-devto-comments.yml) 専用 SA。
  //
  // この job が必要とする GCP 権限は `neon-database-url` secret の read 1 件だけなので、
  // project admin 級の pulumi-ci SA を使い回さず最小権限の SA に分離する
  // (docs/guidelines/security.md: Secret を読む SA は必要な secret のみに
  // `roles/secretmanager.secretAccessor` を付与)。schedule で無人実行される job のため、
  // 依存パッケージの supply-chain 侵害時でも到達できる権限をこの 1 secret に限定する。
  const devtoImportSa = new gcp.serviceaccount.Account("devto-import-sa", {
    accountId: "devto-import",
    displayName: "dev.to comments import (GitHub Actions schedule)",
    description:
      "Impersonated via WIF from import-devto-comments.yml. Reads neon-database-url secret only.",
  });

  new gcp.secretmanager.SecretIamMember("devto-import-neon-database-url-accessor", {
    secretId: args.neonDatabaseUrlSecretId,
    role: "roles/secretmanager.secretAccessor",
    member: pulumi.interpolate`serviceAccount:${devtoImportSa.email}`,
  });

  new gcp.serviceaccount.IAMMember("devto-import-wif-binding", {
    serviceAccountId: devtoImportSa.name,
    role: "roles/iam.workloadIdentityUser",
    member: githubPrincipalSet,
  });

  return {
    pulumiCiSaEmail: pulumiCiSa.email,
    devtoImportSaEmail: devtoImportSa.email,
    githubWifProviderName: githubWifProvider.name,
  };
}
