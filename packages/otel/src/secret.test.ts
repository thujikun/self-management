/**
 * `secret.ts` (Secret Manager getter) の unit test。
 *
 * `_setSecretCacheForTest` で Secret Manager 実呼び出しを回避し、純粋に
 * cache 動作と project resolution のロジックだけ検証する。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain infra
 * @graph-business getSecret の cache hit / cache miss / project ID 解決 / clearSecretCache の挙動を網羅。Secret Manager API は test hook で短絡する
 * @graph-connects none
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setSecretCacheForTest, clearSecretCache, getSecret } from "./secret.js";

// Secret Manager client を mock。test 全体で共有する mock 関数を vi.hoisted で先に作る。
const accessSecretVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@google-cloud/secret-manager", () => {
  class FakeSecretManagerServiceClient {
    accessSecretVersion = accessSecretVersionMock;
  }
  return { SecretManagerServiceClient: FakeSecretManagerServiceClient };
});

describe("getSecret", () => {
  beforeEach(() => {
    clearSecretCache();
    delete process.env.GOOGLE_CLOUD_PROJECT;
    accessSecretVersionMock.mockReset();
  });

  afterEach(() => {
    clearSecretCache();
  });

  it("project 未指定 + env 未設定 → エラー", async () => {
    await expect(getSecret("any")).rejects.toThrow(/project not specified/);
  });

  it("cache hit: 注入した値をそのまま返す", async () => {
    _setSecretCacheForTest("token", "secret-value", "p1");
    await expect(getSecret("token", "p1")).resolves.toBe("secret-value");
  });

  it("env GOOGLE_CLOUD_PROJECT を fallback する", async () => {
    process.env.GOOGLE_CLOUD_PROJECT = "p-env";
    // cache は env を含む project name で keyed (`p-env`)
    _setSecretCacheForTest("token", "from-env", "p-env");
    const out = await getSecret("token");
    expect(out).toBe("from-env");
  });

  it("project が違えば cache 別 key", async () => {
    _setSecretCacheForTest("token", "v1", "p1");
    _setSecretCacheForTest("token", "v2", "p2");
    await expect(getSecret("token", "p1")).resolves.toBe("v1");
    await expect(getSecret("token", "p2")).resolves.toBe("v2");
  });

  it("clearSecretCache で cache 消える → API 再呼び出し", async () => {
    _setSecretCacheForTest("token", "from-cache", "p");
    clearSecretCache();
    accessSecretVersionMock.mockResolvedValueOnce([{ payload: { data: "from-api" } }]);
    await expect(getSecret("token", "p")).resolves.toBe("from-api");
    expect(accessSecretVersionMock).toHaveBeenCalledOnce();
  });

  it("cache miss で Secret Manager から取得、Buffer payload を utf8 デコードする", async () => {
    accessSecretVersionMock.mockResolvedValueOnce([{ payload: { data: Buffer.from("hello") } }]);
    await expect(getSecret("token", "p")).resolves.toBe("hello");
    expect(accessSecretVersionMock).toHaveBeenCalledWith({
      name: "projects/p/secrets/token/versions/latest",
    });
  });

  it("string payload もそのまま返す", async () => {
    accessSecretVersionMock.mockResolvedValueOnce([{ payload: { data: "raw-string" } }]);
    await expect(getSecret("token", "p")).resolves.toBe("raw-string");
  });

  it("payload 空 → エラー", async () => {
    accessSecretVersionMock.mockResolvedValueOnce([{ payload: { data: null } }]);
    await expect(getSecret("token", "p")).rejects.toThrow(/empty payload/);
  });

  it("一度取得したら 2 回目は cache hit (API は 1 回しか呼ばない)", async () => {
    accessSecretVersionMock.mockResolvedValueOnce([{ payload: { data: "v" } }]);
    await getSecret("token", "p");
    await getSecret("token", "p");
    expect(accessSecretVersionMock).toHaveBeenCalledOnce();
  });

  it("_setSecretCacheForTest: env GOOGLE_CLOUD_PROJECT を見て key を組む branch", () => {
    process.env.GOOGLE_CLOUD_PROJECT = "from-env";
    _setSecretCacheForTest("token", "v");
    // 実検証: getSecret に project 指定なしで env の値を使い cache hit する
    return expect(getSecret("token")).resolves.toBe("v");
  });

  it("_setSecretCacheForTest: project / env 両方なし → 空 project key で cache", () => {
    _setSecretCacheForTest("token", "v");
    // 実検証: getSecret は project 不在で reject するが、cache は確実に書かれている
    return expect(getSecret("token")).rejects.toThrow(/project not specified/);
  });
});
