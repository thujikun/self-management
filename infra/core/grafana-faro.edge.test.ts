/**
 * `infra/core/grafana-faro.ts` の edge / negative case 専用 test。
 *
 * 本 file を `grafana-faro.test.ts` から分離する理由: `provisionGrafanaFaro` は内部で
 * resource 名を hardcode するため、同一 Pulumi runtime 内で 2 回呼ぶと URN 衝突
 * リスクがある。test file ごとに vitest が isolate (= 各 file = 別 worker / Pulumi
 * runtime state) するので、negative case は別 file に置いて normal case と切り離す。
 *
 * 検証する契約: `stackUrl` に `pulumi.Output<string | undefined>` の undefined を
 * 渡しても construction が throw せず、`provisionGrafanaFaro` は通常通り output
 * 2 つ (collectorUrlSecretId / collectorEndpoint) を返す。Pulumi の Output 上の
 * undefined は resource args layer まで透過する設計を契約として固定する。
 *
 * @graph-stack core
 * @graph-domain infra
 * @graph-business grafana-faro.ts の Pulumi pipeline に対する negative case (Output<undefined> の透過) を smoke test。Stack instance URL が未解決でも construction が落ちない契約を機械検知に乗せる
 * @graph-connects none
 */

import * as gcp from "@pulumi/gcp";
import * as grafana from "@pulumiverse/grafana";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, it } from "vitest";

import { provisionGrafanaFaro, type ProvisionFaroOutput } from "./grafana-faro.js";

let output: ProvisionFaroOutput;

beforeAll(() => {
  pulumi.runtime.setAllConfig({
    "gcp:project": "test-project",
    "grafana:stackSlug": "test-stack",
  });
  pulumi.runtime.setMocks({
    newResource(args: pulumi.runtime.MockResourceArgs): {
      id: string;
      state: Record<string, unknown>;
    } {
      return { id: `${args.name}_id`, state: { ...args.inputs, id: `${args.name}_id` } };
    },
    call(args: pulumi.runtime.MockCallArgs): Record<string, unknown> {
      return args.inputs;
    },
  });

  const cloudProvider = new grafana.Provider("grafana-cloud", {
    cloudAccessPolicyToken: "test-access-policy-token",
  });
  const secretmanagerApi = new gcp.projects.Service("secretmanager-api", {
    service: "secretmanager.googleapis.com",
  });

  // Output<string | undefined> の undefined を意図的に渡す。実環境では grafanaStack.url
  // が unresolved な間 (preview 直後など) に同じ状態になりうる経路の契約化。
  output = provisionGrafanaFaro({
    cloudProvider,
    stackSlug: "test-stack",
    stackUrl: pulumi.output(undefined as unknown as string),
    stackId: pulumi.output("12345"),
    graphSaEmail: pulumi.output("graph-app@test-project.iam.gserviceaccount.com"),
    secretmanagerApi,
  });
});

describe("provisionGrafanaFaro / stackUrl=undefined の negative case", () => {
  it("Output<string | undefined> の undefined を渡しても construction が throw せず output 2 つを返す", () => {
    expect(Object.keys(output).sort()).toStrictEqual(["collectorEndpoint", "collectorUrlSecretId"]);
  });
});
