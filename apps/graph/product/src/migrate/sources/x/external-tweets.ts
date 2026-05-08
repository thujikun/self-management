/**
 * 外部ユーザーが投稿した tweet (mentions / liked / bookmarks / reposts 等で取れる)
 * を contents node + author 用 persons node に変換する共通 helper。
 *
 * own posts (`posts.ts`) は author_person_id が固定 (Ryan / RyanAircloset) だったが、
 * 外部 tweet は author が動的なので `expansions=author_id` で取った includes.users を使って
 * 都度 person を seed する必要がある。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business 外部ユーザー tweet を contents + 著者 persons node に展開する共通 helper。mentions / liked / bookmarks / reposts の 4 parser から共有される。author seed は username を deterministicId の key にして idempotent
 * @graph-connects none
 */

import { deterministicId } from "../../common/id.js";
import type { NodeInput } from "../../common/types.js";
import { PERSON_SOURCE } from "./accounts.js";
import { tweetSubtype, type XTweetRaw } from "./posts.js";

/** X v2 user object の subset (parser が読む field のみ)。 */
export interface XUserRaw {
  id: string;
  username: string;
  name?: string;
  description?: string;
}

/** `expansions=author_id` 付き response の data 要素。 */
export interface XTweetWithAuthor extends XTweetRaw {
  author_id?: string;
}

/** `externalTweetsToNodes` の戻り値。 */
export interface ExternalNodesResult {
  contentNodes: NodeInput[];
  personNodes: NodeInput[];
  /** content_id → author の person_id (edge 生成側で使う) */
  contentToAuthor: Map<string, string>;
}

/**
 * 1 ユーザーから 1 person NodeInput を作る。`username` を lowercase 化して
 * `deterministicId("person", lowercase)` を id にする (own posts 側と整合)。
 *
 * @graph-connects none
 */
export function userToPersonNode(user: XUserRaw): NodeInput {
  const handle = user.username.toLowerCase();
  const id = deterministicId(PERSON_SOURCE, handle);
  return {
    kind: "persons",
    id,
    fields: {
      person_id: id,
      primary_handle: user.username,
      identifiers: [
        { platform: "x", value: user.username },
        { platform: "x_id", value: user.id },
      ],
      display_name: user.name ?? user.username,
      bio: user.description ?? null,
    },
    body_summary: user.description ?? user.name ?? user.username,
    metadata: { role: "external" },
  };
}

/**
 * 外部 tweet を contents node に変換する。`author_id` が `authorsById` に存在しない場合は
 * unknown 扱いで author_person_id を null にする (外部 user の取得失敗で全体を落とさない)。
 *
 * @graph-connects none
 */
export function externalTweetToContentNode(
  tweet: XTweetWithAuthor,
  authorsById: Map<string, XUserRaw>,
  metadataExtra: Record<string, unknown> = {},
): { content: NodeInput; authorPersonId: string | null } {
  const id = deterministicId("x", tweet.id);
  const author = tweet.author_id ? authorsById.get(tweet.author_id) : undefined;
  const authorPersonId = author
    ? deterministicId(PERSON_SOURCE, author.username.toLowerCase())
    : null;
  const handle = author?.username ?? "unknown";
  const titleRaw = tweet.text.replace(/\s+/g, " ").trim();
  return {
    content: {
      kind: "contents",
      id,
      fields: {
        content_id: id,
        source: "x",
        external_id: tweet.id,
        url: `https://x.com/${handle}/status/${tweet.id}`,
        title: titleRaw.slice(0, 80),
        body_md: tweet.text,
        published_at: tweet.created_at ?? null,
        author_person_id: authorPersonId,
      },
      body_summary: tweet.text,
      metadata: {
        source: "x_external",
        author_handle: author?.username ?? null,
        author_id: tweet.author_id ?? null,
        subtype: tweetSubtype(tweet),
        conversation_id: tweet.conversation_id ?? null,
        referenced_tweets: tweet.referenced_tweets ?? [],
        in_reply_to_user_id: tweet.in_reply_to_user_id ?? null,
        language: tweet.lang ?? null,
        ...metadataExtra,
      },
      first_seen_at: tweet.created_at,
    },
    authorPersonId,
  };
}

/**
 * 外部 tweet 配列 + 著者一覧から content + person node 群を一気に展開。
 *
 * @graph-connects none
 */
export function externalTweetsToNodes(
  tweets: XTweetWithAuthor[],
  authors: XUserRaw[] = [],
  metadataExtra: Record<string, unknown> = {},
): ExternalNodesResult {
  const authorsById = new Map(authors.map((u) => [u.id, u]));
  const personNodes: NodeInput[] = authors.map(userToPersonNode);
  const contentNodes: NodeInput[] = [];
  const contentToAuthor = new Map<string, string>();
  for (const t of tweets) {
    const { content, authorPersonId } = externalTweetToContentNode(
      t,
      authorsById,
      metadataExtra,
    );
    contentNodes.push(content);
    if (authorPersonId) contentToAuthor.set(content.id, authorPersonId);
  }
  return { contentNodes, personNodes, contentToAuthor };
}
