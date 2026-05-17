/**
 * ryantsuji.dev personal blog infrastructure (Pulumi stack: `ryantsuji-dev`)。
 *
 * 提供するもの (現状):
 * - Cloudflare zone のルックアップ (CF Registrar で取得済 zone を import 参照)
 * - zone ID export (後段スタックや wrangler が参照)
 * - Google Search Console domain verification 用 apex TXT record
 *   (`google-site-verification=<token>` を `pulumi import` で取り込み declarative 管理)
 * - Google Workspace 受信メール一式の DNS record (MX × 5 + SPF + DKIM + workspace
 *   domain verification TXT)。Workspace Admin Console の案内に従い dashboard で追加した
 *   record を `pulumi import` で取り込み declarative 管理に統合
 * - Cloudflare Workers custom domain binding × 2 (`ryantsuji.dev` apex + `www`
 *   subdomain → Worker `ryantsuji-dev-web`)。`apps/ryantsuji-dev/web/wrangler.jsonc`
 *   の `routes[].custom_domain: true` で wrangler が作成した binding を `pulumi import`
 *   で declarative 管理に取り込み
 *
 * 後で追加する予定:
 * - DMARC TXT (`_dmarc` に `p=none` で監視開始 → 後で `p=quarantine` 昇格)
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain infra
 * @graph-business 個人ブログ ryantsuji.dev の Cloudflare 基盤を Pulumi で集約管理する。CF Registrar で取得済の zone を起点に、DNS と Workers custom domain を declarative にコード化し、ryan-product-graph と同じ Pulumi-only 運用に乗せる
 * @graph-connects cloudflare-zone [reads_from] CF Registrar 経由で取得済の `ryantsuji.dev` zone を lookup して zone ID を後段に渡す
 * @graph-connects google-workspace [reads_from] Workspace Admin Console で発行した DKIM 公開鍵 / domain verification token / SPF include / MX target を DNS record として apex に publish し、Workspace の受信メール経路と送信認証 (SPF/DKIM) を成立させる
 * @graph-connects ryantsuji-dev-web [routes_to] Workers custom domain binding 経由で `ryantsuji.dev` / `www.ryantsuji.dev` への request を `ryantsuji-dev-web` Worker に routing する
 */

import * as cloudflare from "@pulumi/cloudflare";
import * as pulumi from "@pulumi/pulumi";

/** @graph-connects none */
const config = new pulumi.Config("ryantsuji-dev");
/** @graph-connects none */
const zoneName = config.require("zoneName");
/** @graph-connects none */
const cloudflareAccountId = config.require("cloudflareAccountId");

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

/**
 * Google Workspace 受信メール用 MX record 一式 (apex `ryantsuji.dev`)。
 *
 * Workspace の旧来案内 (priority 1 + 5 × 2 + 10 × 2 の 5 本構成) で dashboard に
 * 追加済。新形式 (`smtp.google.com` 1 本) に switch する選択肢もあるが、現状動いており
 * 並行運用するメリットも薄いため当面 5 本構成のまま維持。
 *
 * `pulumi import` で state に取り込み declarative 管理に統合。CF token は DNS:Read
 * のみで Edit 不要 (record 自体は dashboard で書き、Pulumi は state 反映のみ)。
 *
 * @graph-connects cloudflare [writes_to] apex MX 5 本で Google Workspace の受信メールを `ryantsuji.dev` 宛で受け取る
 */
const GOOGLE_WORKSPACE_MX = [
  { name: "google-mx-aspmx", priority: 1, content: "aspmx.l.google.com" },
  { name: "google-mx-alt1", priority: 5, content: "alt1.aspmx.l.google.com" },
  { name: "google-mx-alt2", priority: 5, content: "alt2.aspmx.l.google.com" },
  { name: "google-mx-alt3", priority: 10, content: "alt3.aspmx.l.google.com" },
  { name: "google-mx-alt4", priority: 10, content: "alt4.aspmx.l.google.com" },
] as const;

/** @graph-connects none */
const googleWorkspaceMxRecords = GOOGLE_WORKSPACE_MX.map(
  (mx) =>
    new cloudflare.DnsRecord(mx.name, {
      zoneId: zone.zoneId,
      name: zoneName,
      type: "MX",
      content: mx.content,
      priority: mx.priority,
      ttl: 3600,
    }),
);

/** @graph-connects none */
export const googleWorkspaceMxRecordIds = googleWorkspaceMxRecords.map((r) => r.id);

/**
 * SPF TXT record (apex)。Google Workspace の SMTP host を sender として許容する。
 *
 * `~all` (soft-fail) は Workspace の標準推奨。`-all` (hard-fail) に上げるのは
 * Workspace 以外から `@ryantsuji.dev` で送る経路がないことを確認してからの方が安全。
 *
 * @graph-connects cloudflare [writes_to] apex TXT で SPF authorization を publish し Workspace 送信メールを受信側に SPF pass させる
 */
const googleSpf = new cloudflare.DnsRecord("google-spf", {
  zoneId: zone.zoneId,
  name: zoneName,
  type: "TXT",
  content: '"v=spf1 include:_spf.google.com ~all"',
  ttl: 3600,
});

/** @graph-connects none */
export const googleSpfRecordId = googleSpf.id;

/**
 * DKIM 公開鍵 TXT record (`google._domainkey.ryantsuji.dev`)。
 *
 * Workspace Admin Console > Apps > Gmail > Authenticate email で 2048bit RSA 鍵を
 * 生成し、表示された TXT 値をそのまま dashboard 登録 → ここに `pulumi import` で取り込む。
 * Cloudflare API は長い TXT を RFC 1035 multi-string (`"chunk1" "chunk2"`) で保持する
 * ため、config 値も literal の quote-space-quote をそのまま保持している。
 *
 * 鍵をローテートする運用に乗せる場合は Workspace 側で再生成 → dashboard 更新 →
 * config 値書き換え + `pulumi import` の流れで drift をゼロに戻す。
 *
 * @graph-connects cloudflare [writes_to] google._domainkey TXT で DKIM 公開鍵を publish し受信側で DKIM 署名検証可能にする
 */
const googleDkim = new cloudflare.DnsRecord("google-dkim", {
  zoneId: zone.zoneId,
  name: `google._domainkey.${zoneName}`,
  type: "TXT",
  content: config.require("googleDkim"),
  // dashboard 既定値 "Auto" のまま (= 1)。drift 回避のため明示。
  ttl: 1,
});

/** @graph-connects none */
export const googleDkimRecordId = googleDkim.id;

/**
 * Google Workspace の domain ownership 確認用 TXT (apex)。
 *
 * Workspace Admin Console の初期 setup で「ドメイン所有権の確認」手順として apex に
 * 追加した token。Search Console の verification token とは別物 (Workspace と Search
 * Console は別 product として token を発行する)。
 *
 * Workspace の verify 完了後は理論上は削除可能だが、削除すると以降の再 verify が
 * 必要になるため恒久 record として残しておくのが標準運用。
 *
 * @graph-connects cloudflare [writes_to] apex TXT で Google Workspace の domain ownership を継続証明
 */
const googleWorkspaceVerification = new cloudflare.DnsRecord("google-workspace-verification", {
  zoneId: zone.zoneId,
  name: zoneName,
  type: "TXT",
  content: config.require("googleWorkspaceVerification"),
  ttl: 3600,
});

/** @graph-connects none */
export const googleWorkspaceVerificationRecordId = googleWorkspaceVerification.id;

/**
 * Cloudflare Workers custom domain binding 一式 (apex + www → `ryantsuji-dev-web`)。
 *
 * `apps/ryantsuji-dev/web/wrangler.jsonc` の `routes[].custom_domain: true` で
 * wrangler が deploy 時に作成した binding を `pulumi import` で取り込む。
 *
 * **AAAA `100::` record について**: binding を作成すると CF backend が apex / www
 * 双方に AAAA `100::` placeholder record を自動付随させる (`100::` は CF edge が
 * intercept して Worker に routing する sentinel IPv6)。これは binding の lifecycle
 * に従属するため `cloudflare.DnsRecord` で別管理せず、binding 削除時に CF が自動で
 * 削除するに任せる (二重管理すると destroy race condition のリスク)。
 *
 * binding 自体の lifecycle は wrangler deploy 起点 (= app 側の deploy が真実) で、
 * Pulumi は state 反映のみを担当する。今後 hostname を増減する場合は wrangler.jsonc
 * を更新 → `wrangler deploy` → このファイルに resource 追記 → `pulumi import` の流れ。
 *
 * @graph-connects ryantsuji-dev-web [routes_to] apex / www custom domain binding で外部 request を Worker に routing
 */
const WORKER_CUSTOM_DOMAINS = [
  { name: "worker-cd-apex", hostname: zoneName },
  { name: "worker-cd-www", hostname: `www.${zoneName}` },
] as const;

/** @graph-connects none */
const workerCustomDomains = WORKER_CUSTOM_DOMAINS.map(
  (cd) =>
    new cloudflare.WorkersCustomDomain(cd.name, {
      accountId: cloudflareAccountId,
      hostname: cd.hostname,
      service: "ryantsuji-dev-web",
      zoneId: zone.zoneId,
      // `environment` は provider 6.x 系で deprecated。CF API は `production` 固定で
      // 返してくるが、宣言側で `environment` を渡すと `WARNING property "environment"
      // is deprecated` が毎 preview 出るため、declaration からは省く。
      // 省いても import 後 state には `production` が残るが drift 検出されない
      // (provider が deprecated 扱いで diff 比較から除外している)。
    }),
);

/** @graph-connects none */
export const workerCustomDomainIds = workerCustomDomains.map((d) => d.id);

/**
 * R2 bucket: `ryantsuji-dev-images`。post 添付画像 (markdown 内 `![](/images/...)`) の
 * 配信元。同 worker からの binding (`IMAGES`) 経由で fetch されるため、外部からの
 * 直接 R2 アクセス (`*.r2.dev` / custom domain) は無効化したまま運用する。
 *
 * **location**: `apac` (Asia Pacific) を選択。Ryan が JP 在住・Cloud Flare の edge は
 * どの location でも世界中から fetch できるが、bucket の primary region を読み手に
 * 近い region に置くことで cold-cache miss 時の latency を最小化する。
 *
 * **storageClass**: `Standard` (default)。画像は post 公開時に upload され、即時参照
 * 想定なので IA (InfrequentAccess) の取り出し latency が立ち上がりに刺さるのは避ける。
 *
 * **API token に必要な scope**: `Workers R2 Storage Write` (現状の pulumi 用 CF token
 * に未付与なら、新規 token 発行 or 既存 token に scope 追加が必要。bucket 操作後の
 * sync は GitHub Actions の `cloudflare-api-token` 経由で REST API を叩く)。
 *
 * @graph-connects cloudflare [provides] R2 bucket で post 添付画像を保管し、ryantsuji-dev-web Worker の `IMAGES` binding 経由で配信
 */
const imagesBucket = new cloudflare.R2Bucket("ryantsuji-dev-images", {
  accountId: cloudflareAccountId,
  name: "ryantsuji-dev-images",
  location: "apac",
  storageClass: "Standard",
});

/** @graph-connects none */
export const imagesBucketName = imagesBucket.name;
