/**
 * ryantsuji.dev personal blog infrastructure (Pulumi stack: `ryantsuji-dev`)。
 *
 * 提供するもの (現状):
 * - Cloudflare zone のルックアップ (CF Registrar で取得済 zone を import 参照)
 * - zone ID export (後段スタックや wrangler が参照)
 *
 * 後で追加する予定:
 * - apex / www DNS records (Workers custom domain binding 経由なので record 直書きはしない想定)
 * - `cloudflare.WorkerCustomDomain` で `ryantsuji.dev` と Worker `ryantsuji-dev-web` を紐付け
 *   → `apps/ryantsuji-dev/web` を 1 度 wrangler deploy した後に追加
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain infra
 * @graph-business 個人ブログ ryantsuji.dev の Cloudflare 基盤を Pulumi で集約管理する。CF Registrar で取得済の zone を起点に、DNS と Workers custom domain を declarative にコード化し、ryan-product-graph と同じ Pulumi-only 運用に乗せる
 * @graph-connects cloudflare-zone [reads_from] CF Registrar 経由で取得済の `ryantsuji.dev` zone を lookup して zone ID を後段に渡す
 */

import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/** @graph-connects none */
const config = new pulumi.Config("ryantsuji-dev");
/** @graph-connects none */
const zoneName = config.require("zoneName");

/**
 * CF Registrar 経由で取得済の zone を lookup する。
 *
 * 取得自体は dashboard 操作 (Pulumi の cloudflare provider に register endpoint がない) で
 * 行うため、ここでは既存 zone を参照するのみ。
 *
 * @graph-connects cloudflare [reads_from] zone name から zone ID を解決
 */
const zone = cloudflare.getZoneOutput({ filter: { name: zoneName } });

/** @graph-connects none */
export const zoneId = zone.zoneId;
/** @graph-connects none */
export const zoneNameOut = zone.name;

/**
 * Google Search Console domain verification の TXT record。
 *
 * Google OAuth consent screen で「ブランディングの確認」を pass するために必要。
 * `https://ryantsuji.dev` をホームページとして登録すると Search Console 経由で
 * 所有権確認が要求され、それの方法として TXT record (`google-site-verification=<token>`)
 * を apex に置く形を採用。
 *
 * record 自体は Ryan が dashboard で手動追加済 (Search Console 確認を画面から完了)
 * → state drift しないよう `pulumi import` で取り込み、本ファイルで declarative
 * 管理に統合。token 値は public な検証用 nonce で secret ではない (Google が
 * dashboard を見れば誰でも取れる)。
 *
 * @graph-connects cloudflare [writes_to] apex TXT で Google Search Console verification
 */
const googleSiteVerification = new cloudflare.DnsRecord("google-site-verification", {
  zoneId: zone.zoneId,
  name: zoneName,
  type: "TXT",
  content: config.require("googleSiteVerification"),
  // Search Console 確認時に dashboard 側で default の 3600s で作成済 → drift 回避のため明示
  ttl: 3600,
  // 注: `comment` は Cloudflare API の DNS:Edit 権限がないと書き換えできない。
  // 現状の pulumi 用 CF token は Zone:Read + DNS:Read のみで Edit を含めていない
  // (運用上 DNS は dashboard で確認 + Pulumi import で取り込む方針) ため、
  // 装飾扱いの comment は declaration 側で持たず JSDoc に集約する。
});

/** @graph-connects none */
export const googleSiteVerificationRecordId = googleSiteVerification.id;
