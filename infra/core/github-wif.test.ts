/**
 * `infra/core/github-wif.ts` (GitHub Actions WIF provisioning pipeline) の dedicated test。
 *
 * `pulumi.runtime.setMocks` で resource provider を mock 化して `provisionGithubWif`
 * を直接呼び、(a) pool / provider / SA 群 / IAM bindings の resource 構成、
 * (b) attribute condition が本 repository のみ許可する、(c) devto-import SA が
 * **project-level role を 1 つも持たず** `neon-database-url` secret の secretAccessor
 * のみ bind される (最小権限契約)、を固定する。
 *
 * mock は SA の email / pool・provider の name を GCP 実 API と同型で synthesize し、
 * principalSet / member の interpolate 結果を文字列レベルで assert できるようにする。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business github-wif.ts の WIF pipeline (pool + provider + pulumi-ci / devto-import SA + IAM bindings) を mock-runtime で smoke test。devto-import SA の最小権限 (neon-database-url read のみ / project role なし) を契約として機械検知する
 * @graph-connects none
 */

import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

import { provisionGithubWif, type ProvisionGithubWifOutput } from "./github-wif.js";

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
let output: ProvisionGithubWifOutput;

beforeAll(async () => {
  pulumi.runtime.setAllConfig({
    "gcp:project": "test-project",
  });
  pulumi.runtime.setMocks({
    newResource(args: pulumi.runtime.MockResourceArgs): {
      id: string;
      state: Record<string, unknown>;
    } {
      captured.push({ type: args.type, name: args.name, inputs: { ...args.inputs } });
      const state: Record<string, unknown> = { ...args.inputs, id: `${args.name}_id` };
      // SA email / pool・provider name は実 API 側で計算される output なので、
      // interpolate 結果 (member / principalSet) を assert できるよう GCP 実 API と
      // 同型で synthesize する。
      if (typeof args.inputs["accountId"] === "string") {
        state["email"] = `${args.inputs["accountId"]}@test-project.iam.gserviceaccount.com`;
      }
      if (typeof args.inputs["workloadIdentityPoolId"] === "string") {
        const poolPath = `projects/test-project/locations/global/workloadIdentityPools/${args.inputs["workloadIdentityPoolId"]}`;
        state["name"] =
          typeof args.inputs["workloadIdentityPoolProviderId"] === "string"
            ? `${poolPath}/providers/${args.inputs["workloadIdentityPoolProviderId"]}`
            : poolPath;
      }
      return { id: `${args.name}_id`, state };
    },
    call(args: pulumi.runtime.MockCallArgs): Record<string, unknown> {
      return args.inputs;
    },
  });

  // 上流 (`index.ts`) で建てる iam API enabler。args として渡すため本 file 側で
  // minimal に build する。captured に入るが、後段の assertion では name で除外する。
  const iamApi = new gcp.projects.Service("iam-api", {
    service: "iam.googleapis.com",
  });

  output = provisionGithubWif({
    projectId: "test-project",
    iamApi,
    neonDatabaseUrlSecretId: pulumi.output("neon-database-url_id"),
  });

  // Pulumi resource registration は async。output を resolve して dependency 連鎖で
  // 登録を flush し、output に露出しない IAM binding 群は追加の macrotask で drain する。
  await Promise.all([
    promiseOf(output.pulumiCiSaEmail),
    promiseOf(output.devtoImportSaEmail),
    promiseOf(output.githubWifProviderName),
  ]);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
});

/**
 * iam API enabler を除外し、`provisionGithubWif` が直接発行した resource のみを
 * (type, name) で並べ替えて返す。順序は async 登録順に依存するので lex sort で正規化。
 *
 * @graph-connects none
 */
function provisionedResources(): Array<{ type: string; name: string }> {
  return captured
    .filter((r) => r.name !== "iam-api")
    .map((r) => ({ type: r.type, name: r.name }))
    .sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type),
    );
}

describe("provisionGithubWif", () => {
  it("pool / provider / SA 2 つ / WIF binding 2 つ / admin role 12 / secret accessor 1 の 19 resource を発行する", () => {
    expect(provisionedResources()).toMatchInlineSnapshot(`
      [
        {
          "name": "github-actions-pool",
          "type": "gcp:iam/workloadIdentityPool:WorkloadIdentityPool",
        },
        {
          "name": "github-actions-provider",
          "type": "gcp:iam/workloadIdentityPoolProvider:WorkloadIdentityPoolProvider",
        },
        {
          "name": "pulumi-ci-aiplatform-admin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-artifactregistry-admin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-bigquery-admin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-cloudscheduler-admin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-compute-networkViewer",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-iam-serviceAccountAdmin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-iam-serviceAccountKeyAdmin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-iam-workloadIdentityPoolAdmin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-resourcemanager-projectIamAdmin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-run-admin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-secretmanager-admin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-serviceusage-serviceUsageAdmin",
          "type": "gcp:projects/iAMMember:IAMMember",
        },
        {
          "name": "devto-import-neon-database-url-accessor",
          "type": "gcp:secretmanager/secretIamMember:SecretIamMember",
        },
        {
          "name": "devto-import-sa",
          "type": "gcp:serviceaccount/account:Account",
        },
        {
          "name": "pulumi-ci-sa",
          "type": "gcp:serviceaccount/account:Account",
        },
        {
          "name": "devto-import-wif-binding",
          "type": "gcp:serviceaccount/iAMMember:IAMMember",
        },
        {
          "name": "pulumi-ci-wif-binding",
          "type": "gcp:serviceaccount/iAMMember:IAMMember",
        },
      ]
    `);
  });

  it("OIDC provider は attribute condition で thujikun/self-management のみ許可する", () => {
    const provider = captured.find((r) => r.name === "github-actions-provider");
    expect(provider?.inputs["attributeCondition"]).toStrictEqual(
      'assertion.repository == "thujikun/self-management"',
    );
    expect(provider?.inputs["oidc"]).toStrictEqual({
      issuerUri: "https://token.actions.githubusercontent.com",
    });
  });

  it("pulumi-ci / devto-import の WIF binding は同一 principalSet (本 repo のみ) を共有する", () => {
    const expectedPrincipalSet =
      "principalSet://iam.googleapis.com/projects/test-project/locations/global/workloadIdentityPools/github-actions/attribute.repository/thujikun/self-management";
    const pulumiCiBinding = captured.find((r) => r.name === "pulumi-ci-wif-binding");
    const devtoBinding = captured.find((r) => r.name === "devto-import-wif-binding");
    expect(pulumiCiBinding?.inputs["role"]).toStrictEqual("roles/iam.workloadIdentityUser");
    expect(pulumiCiBinding?.inputs["member"]).toStrictEqual(expectedPrincipalSet);
    expect(devtoBinding?.inputs["role"]).toStrictEqual("roles/iam.workloadIdentityUser");
    expect(devtoBinding?.inputs["member"]).toStrictEqual(expectedPrincipalSet);
  });

  it("project-level role bind は pulumi-ci SA のみ (devto-import は project role を 1 つも持たない)", () => {
    const projectMembers = captured
      .filter((r) => r.type === "gcp:projects/iAMMember:IAMMember")
      .map((r) => ({ name: r.name, role: r.inputs["role"], member: r.inputs["member"] }));
    // 12 role すべてが pulumi-ci-* 名で pulumi-ci@ SA に bind される = devto-import へ
    // project-level 権限が silent に増えたら本 assertion が落ちる。
    expect(projectMembers.map((m) => m.member)).toStrictEqual(
      Array.from(
        { length: 12 },
        () => "serviceAccount:pulumi-ci@test-project.iam.gserviceaccount.com",
      ),
    );
    expect(projectMembers.map((m) => m.role).sort()).toStrictEqual([
      "roles/aiplatform.admin",
      "roles/artifactregistry.admin",
      "roles/bigquery.admin",
      "roles/cloudscheduler.admin",
      "roles/compute.networkViewer",
      "roles/iam.serviceAccountAdmin",
      "roles/iam.serviceAccountKeyAdmin",
      "roles/iam.workloadIdentityPoolAdmin",
      "roles/resourcemanager.projectIamAdmin",
      "roles/run.admin",
      "roles/secretmanager.admin",
      "roles/serviceusage.serviceUsageAdmin",
    ]);
  });

  it("devto-import SA は neon-database-url secret の secretAccessor のみ bind される", () => {
    const accessor = captured.find((r) => r.name === "devto-import-neon-database-url-accessor");
    expect(accessor?.inputs["role"]).toStrictEqual("roles/secretmanager.secretAccessor");
    expect(accessor?.inputs["secretId"]).toStrictEqual("neon-database-url_id");
    expect(accessor?.inputs["member"]).toStrictEqual(
      "serviceAccount:devto-import@test-project.iam.gserviceaccount.com",
    );
    // devto-import SA を member に持つ IAM 系 resource は accessor の 1 件だけ
    // (WIF binding の member は principalSet) = secret read 以外の権限が増えたら落ちる。
    const devtoMemberResources = captured
      .filter(
        (r) =>
          r.inputs["member"] === "serviceAccount:devto-import@test-project.iam.gserviceaccount.com",
      )
      .map((r) => r.name)
      .sort();
    expect(devtoMemberResources).toStrictEqual(["devto-import-neon-database-url-accessor"]);
  });

  it("output は 2 SA の email と provider name を返す", async () => {
    expect(Object.keys(output).sort()).toStrictEqual([
      "devtoImportSaEmail",
      "githubWifProviderName",
      "pulumiCiSaEmail",
    ]);
    expect(await promiseOf(output.pulumiCiSaEmail)).toStrictEqual(
      "pulumi-ci@test-project.iam.gserviceaccount.com",
    );
    expect(await promiseOf(output.devtoImportSaEmail)).toStrictEqual(
      "devto-import@test-project.iam.gserviceaccount.com",
    );
    expect(await promiseOf(output.githubWifProviderName)).toStrictEqual(
      "projects/test-project/locations/global/workloadIdentityPools/github-actions/providers/github-actions",
    );
  });
});
