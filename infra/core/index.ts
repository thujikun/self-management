import * as gcp from "@pulumi/gcp";
import * as pulumi from "@pulumi/pulumi";

const gcpConfig = new pulumi.Config("gcp");
const projectId = gcpConfig.require("project");
const location = gcpConfig.get("region") ?? "asia-northeast1";

/**
 * ryan-product-graph 用 BQ dataset。
 * docs/product-graph/README.md と整合。
 */
const ryanDataset = new gcp.bigquery.Dataset("ryan", {
  datasetId: "ryan",
  location,
  description:
    "ryan-product-graph: nodes (persons/contents/release_notes/decisions/topics/domains/events) + edges",
});

/**
 * graph app (apps/graph/product) が BQ に書き込む際に使う service account。
 * ローカル開発時は SA key を `.config/gcp-sa.json` に保存して使う。
 * 将来 Cloud Run 上の MCP server も同じ SA を使う想定。
 */
const graphSa = new gcp.serviceaccount.Account("graph-sa", {
  accountId: "graph-app",
  displayName: "ryan-product-graph build/read",
  description:
    "Used by apps/graph/product and (future) mcp-ryan-product-graph to ingest and query the personal graph",
});

new gcp.bigquery.DatasetIamMember("graph-dataset-editor", {
  datasetId: ryanDataset.datasetId,
  role: "roles/bigquery.dataEditor",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

new gcp.projects.IAMMember("graph-job-user", {
  project: projectId,
  role: "roles/bigquery.jobUser",
  member: pulumi.interpolate`serviceAccount:${graphSa.email}`,
});

/**
 * SA key を Pulumi が生成 → ローカル保存用に出力 (Pulumi state では暗号化保存)。
 * `pulumi stack output --show-secrets graphServiceAccountKey` で取り出して
 * `.config/gcp-sa.json` に保存する想定。
 */
const graphKey = new gcp.serviceaccount.Key("graph-sa-key", {
  serviceAccountId: graphSa.name,
});

export const datasetId = ryanDataset.datasetId;
export const datasetLocation = ryanDataset.location;
export const graphServiceAccountEmail = graphSa.email;
export const graphServiceAccountKey = pulumi.secret(graphKey.privateKey);
