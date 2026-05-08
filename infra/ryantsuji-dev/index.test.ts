/**
 * `infra/ryantsuji-dev/index.ts` (Pulumi stack `ryantsuji-dev`) の smoke test。
 *
 * Pulumi の `runtime.setMocks` で resource provider と function call を mock 化し、
 * 実 Cloudflare API を叩かずに module を import → `getZoneOutput` が解決される過程と
 * 2 つの export (zoneId / zoneNameOut) を検証する。
 *
 * 同一プロジェクトの `infra/core/index.test.ts` と同じ Pulumi mock pattern。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain infra
 * @graph-business ryantsuji-dev stack の Pulumi 構築コードを mock-runtime で smoke test。実 CF API なしで「getZone が解決される」「期待 export が出る」を保証し、preview 前の早期 fail を取る
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

beforeAll(() => {
  pulumi.runtime.setAllConfig({
    "ryantsuji-dev:zoneName": "ryantsuji.dev",
  });
  pulumi.runtime.setMocks({
    newResource(args: pulumi.runtime.MockResourceArgs): {
      id: string;
      state: Record<string, unknown>;
    } {
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

describe("infra/ryantsuji-dev stack", () => {
  it("module import に成功し、必須 export を全部返す", async () => {
    const m = await import("./index.js");
    expect(m.zoneId).toBeDefined();
    expect(m.zoneNameOut).toBeDefined();

    const id = await promiseOf(m.zoneId);
    const name = await promiseOf(m.zoneNameOut);
    expect(id).toBe("test-zone-id-1234567890");
    expect(name).toBe("ryantsuji.dev");
  });
});
