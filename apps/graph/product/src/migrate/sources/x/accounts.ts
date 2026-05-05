/**
 * X account 静的 config。
 *
 * `handle` と `userId` (X の numeric user_id) は安定なので、毎回 `/2/users/me` を叩く代わりに
 * ここに固定する。新規アカウント追加時はここに足す + Pulumi `XMCP_ACCOUNTS` も同期更新。
 *
 * `personHandle` は person_id 生成 (`deterministicId("person", handle)`) に使う key で、
 * 大小区別を回避するため小文字に正規化したものを使う。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business X 両アカウントの static metadata (handle / display name / userId / person seed)。posts / mentions / liked 等の parser 全てが起点として参照
 * @graph-connects none
 */

import { deterministicId } from "../../common/id.js";

/** @graph-connects none */
export const PERSON_SOURCE = "person";

export interface XAccountConfig {
  /** Pulumi の `XMCP_ACCOUNTS` 値、Secret Manager の `xmcp-user-{account}` 接尾辞 */
  account: "ryantsuji" | "ryanaircloset";
  /** 表示用の handle (大小区別あり、URL 構築 + UI に使う) */
  handle: string;
  /** person_id 生成用 key (小文字正規化) */
  personHandle: string;
  /** X の numeric user_id (`/2/users/{userId}/...` で使う) */
  userId: string;
  displayName: string;
  bio: string;
  language: "en" | "ja" | "ja+en";
}

/** @graph-connects none */
export const X_ACCOUNTS: XAccountConfig[] = [
  {
    account: "ryantsuji",
    handle: "ryantsuji",
    personHandle: "ryantsuji",
    userId: "183196464",
    displayName: "Ryan Tsuji",
    bio: "CTO @airCloset (1.4M users). Built an Agentic Graph RAG over our codebase + DBs. Writing about AI infra that actually works in production. Tokyo 🇯🇵",
    language: "en",
  },
  {
    account: "ryanaircloset",
    handle: "RyanAircloset",
    personHandle: "ryanaircloset",
    userId: "1311525688411713537",
    displayName: "辻亮佑",
    bio: "airCloset 公式 (代表 辻 亮佑) — 1.4M ユーザー基盤のファッションレンタル。",
    language: "ja",
  },
];

/**
 * account から person_id を導出。`PERSON_SOURCE = "person"` を namespace にして
 * threads.ts の `RYAN_PERSON_ID = deterministicId("person", "ryantsuji")` と整合する。
 *
 * @graph-connects none
 */
export function personIdFor(account: XAccountConfig): string {
  return deterministicId(PERSON_SOURCE, account.personHandle);
}
