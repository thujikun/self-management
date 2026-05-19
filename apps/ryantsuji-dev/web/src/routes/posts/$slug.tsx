/**
 * `/posts/$slug` — 投稿詳細 page。markdown render + engagement (views / likes / comments)。
 *
 * loader は **renderPost → loadEngagement の serial 化**で動く:
 * (frontmatter が engagement の post upsert に必要なため Promise.all 不可)
 * - `renderPostServer` — slug → `virtual:rendered-posts` から build 時 pre-render 済の HTML / frontmatter / headings / readingTime を lookup (runtime に shiki / unified は持ち込まない)
 * - `loadEngagementServer` — view count を +1 + likes summary + comments list を 1 まとめ取得
 *
 * client の mutation (like toggle / comment 投稿) は `toggleLikeServer` / `addCommentServer`
 * を `useServerFn` で叩く。auth gate は server 側 (`getSessionFromHeaders`) で実行され、
 * 未認証は明示的に reject (UI はその前に sign-in CTA を出す)。
 *
 * 404 (slug 不在 or draft) は `notFound()` で boundary に倒す。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細 route。markdown render + engagement (views/likes/comments) を 1 SSR loader で並列取得し、client の mutation (like toggle / comment 投稿) を server fn 経由で実行する。auth gate は server 側で行い、未認証経路は sign-in CTA を表示
 * @graph-connects tanstack-router [provides] /posts/$slug route
 * @graph-connects tanstack-start [provides] createServerFn で pre-rendered HTML lookup / engagement DB ops を server に閉じ込める
 * @graph-connects content [calls] @self/content の RenderedDoc 型 (markdown render 本体は build 時 vite plugin で完了済)
 * @graph-connects content [embeds] engagement.ts 経由で posts/likes/comments/view_counts を Drizzle 経由で読み書き
 * @graph-connects better-auth [calls] getSessionFromHeaders で current user を解決して like/comment を gate
 */

import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";

import { useSession } from "../../lib/auth-client.js";
import { displayTags } from "../../lib/tags.js";
import { CommentList } from "../../components/CommentList.js";
import { PostSharePane } from "../../components/PostSharePane.js";
import { PostToc } from "../../components/PostToc.js";
import { PostBody } from "../../server-components/PostBody.js";
import { type CommentView } from "../../server/engagement.js";
import type { Lang } from "../../server/i18n.js";
import { isAdminFromCurrentRequest } from "../../server/request.server.js";

import {
  runAddComment,
  runDeleteComment,
  runLoadEngagement,
  runRenderPost,
  runToggleLike,
} from "./$slug.server.js";
import {
  dispatchCommentSubmit,
  dispatchLikeClick,
  executeAddCommentAction,
  executeLikeAction,
  type AddCommentFn,
  type ToggleLikeFn,
} from "./$slug.actions.js";

/** @graph-connects none */
const SlugSchema = z.string().min(1);

/**
 * `?lang=en|ja` で override (一覧側と同じ仕様)。invalid 値は捨てて
 * Accept-Language fallback に任せる。
 *
 * @graph-connects none
 */
const SearchSchema = z.object({
  lang: z.enum(["en", "ja"]).optional(),
});

/**
 * renderPost server fn の input schema。slug + override lang。lang は
 * server 側で `Accept-Language` と組合せて `pickLang` で確定する。
 *
 * @graph-connects none
 */
const RenderInputSchema = z.object({
  slug: z.string().min(1),
  override: z.enum(["en", "ja"]).optional(),
});

/**
 * comment 投稿 input。slug + body を受け、body は server 側でも `validateCommentBody` で
 * trim / 上限 check が走る (client 側でも同等の check を出す UX)。
 *
 * @graph-connects none
 */
const CommentInputSchema = z.object({
  slug: z.string().min(1),
  body: z.string().min(1).max(4000),
  // UUID format は DB FK check で担保するので、ここでは string presence のみ。
  // Zod v4 の `.uuid()` regex が test fixture (固定 UUID 文字列) を rejection するため。
  parentCommentId: z.string().min(1).nullable().optional(),
});

/**
 * comment 削除 input。soft delete を server 側で `deletedAt = now()` する。
 *
 * @graph-connects none
 */
const DeleteCommentInputSchema = z.string().min(1);

/**
 * loadEngagement 用の input schema。slug + post meta (title / publishedAt) を受ける。
 * post meta は `posts` 行の upsert に使う (FK target 確保)。
 *
 * @graph-connects none
 */
const EngagementInputSchema = z.object({
  slug: z.string().min(1),
  post: z.object({
    title: z.string().min(1),
    publishedAt: z.string().min(1),
  }),
});

/**
 * server function: slug + override lang → `virtual:rendered-posts` の pre-rendered
 * map から該当 (slug, lang) を lookup。lang は server で Accept-Language と組合せて
 * 確定する。markdown render (shiki / unified / remark-*) は vite plugin が build 時に
 * Node 上で完走済で、runtime bundle (rsc / ssr / client / worker) には一切入らない。
 *
 * @graph-connects content [calls] runRenderPost → getRenderedPost (pre-rendered HTML lookup)
 */
const renderPostServer = createServerFn()
  .inputValidator((data: unknown) => RenderInputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const includeDrafts = await isAdminFromCurrentRequest(context.env);
    return runRenderPost(data.slug, data.override as Lang | undefined, { includeDrafts });
  });

/**
 * server function: slug → view +1 + like summary + comments list。
 * SSR loader で 1 回だけ呼ばれる (= 1 view = 1 increment)。client navigate でも呼ばれるため
 * 明示的に SSR 限定にしたい場合は別経路を考える (今回は spam リスク無視で全 view 加算)。
 *
 * @graph-connects content [calls] runLoadEngagement へ委譲
 */
const loadEngagementServer = createServerFn()
  .inputValidator((data: unknown) => EngagementInputSchema.parse(data))
  .handler(async ({ data, context }) => runLoadEngagement(context.env, data));

/**
 * server function: like を toggle。auth 必須。未認証で呼ばれたら UNAUTHENTICATED を throw。
 *
 * @graph-connects content [calls] runToggleLike へ委譲
 */
const toggleLikeServer = createServerFn()
  .inputValidator((data: unknown) => SlugSchema.parse(data))
  .handler(async ({ data: slug, context }) => runToggleLike(context.env, slug));

/**
 * server function: comment 投稿。auth 必須。空 body / 上限超は server 側でも reject。
 *
 * @graph-connects content [calls] runAddComment へ委譲
 */
const addCommentServer = createServerFn()
  .inputValidator((data: unknown) => CommentInputSchema.parse(data))
  .handler(async ({ data, context }) => runAddComment(context.env, data));

/**
 * server function: comment 削除 (soft delete)。auth 必須、自分の comment のみ。
 *
 * @graph-connects content [calls] runDeleteComment へ委譲
 */
const deleteCommentServer = createServerFn()
  .inputValidator((data: unknown) => DeleteCommentInputSchema.parse(data))
  .handler(async ({ data: commentId, context }) => runDeleteComment(context.env, commentId));

/**
 * 本番公開 URL。外部 crawler は og:image / twitter:image / og:url を **絶対 URL** で
 * 要求する (`__root.tsx` の SITE_URL と同値)。1 箇所にしか出てこないので二重定義の
 * cost より変更点を 1 ファイルに閉じる方を取った (= ここで再定義)。
 *
 * @graph-connects none
 */
const SITE_URL = "https://ryantsuji.dev";

type HeadMeta = { title: string } | { name?: string; property?: string; content: string };

/**
 * post slug の en/ja URL を組む helper。`?lang=ja` は ja variant にのみ付き、en は
 * 無印 (default lang)。canonical / hreflang / og:url 全部で同じ URL 規約に揃える
 * ため pure 関数に切り出す。
 *
 * @graph-connects none
 */
export function postUrlFor(slug: string, lang: Lang): string {
  return `${SITE_URL}/posts/${slug}${lang === "ja" ? "?lang=ja" : ""}`;
}

/**
 * post 詳細 page の `<link rel="canonical">` + `<link rel="alternate" hreflang>`
 * 列を組む pure 関数。Route.head() から呼ばれる。
 *
 * - canonical: 現在 serve している variant の URL (en は無印、ja は `?lang=ja`)
 * - alternate hreflang: `availableLangs` に含まれる lang のみ emit
 * - x-default: en があれば en URL に倒し、無ければ「使える唯一の lang」の URL に
 *   倒す (= sitemap 側 `server/sitemap.ts:buildPostUrlEntry` と同 logic)。head と
 *   sitemap の hreflang 集合を Google が cross-check するため、ja-only 等の片言
 *   case でも両者で x-default 有無を揃える
 *
 * GSC の「重複しています。ユーザーにより、正規ページとして選択されていません」
 * 警告は、ja と en の canonical が path 同一 + query 違いで、Google から見て
 * 「同じ page の query 差分」に見えていたのが原因。reciprocal な hreflang
 * alternate で「これは互いに翻訳関係にある別 page」と明示する。
 *
 * @graph-connects none
 */
export function buildPostLinks(input: {
  slug: string;
  servedLang: Lang;
  availableLangs: ReadonlyArray<Lang>;
}): Array<{ rel: string; href: string; hrefLang?: string }> {
  // React JSX の `<link>` props は camelCase の `hrefLang` を要求するため key 名は
  // `hrefLang` で持つ (HTML 出力は React が自動で小文字 `hreflang` に直す)。
  const links: Array<{ rel: string; href: string; hrefLang?: string }> = [
    { rel: "canonical", href: postUrlFor(input.slug, input.servedLang) },
  ];
  if (input.availableLangs.includes("en")) {
    links.push({ rel: "alternate", hrefLang: "en", href: postUrlFor(input.slug, "en") });
    links.push({ rel: "alternate", hrefLang: "x-default", href: postUrlFor(input.slug, "en") });
  }
  if (input.availableLangs.includes("ja")) {
    links.push({ rel: "alternate", hrefLang: "ja", href: postUrlFor(input.slug, "ja") });
    if (!input.availableLangs.includes("en")) {
      links.push({ rel: "alternate", hrefLang: "x-default", href: postUrlFor(input.slug, "ja") });
    }
  }
  return links;
}

/**
 * 1 post 分の HTML <head> meta tag 列を組む。Route.head() から呼ばれ、og:title /
 * og:description / og:image / twitter:* を per-post に上書きする (root の default は
 * blog 全体向け meta なので、詳細 page は自前 meta で塗り直す)。
 *
 * `cover` 未指定時は `/posts/<slug>.<lang>.cover.png` の convention path を採用する。
 * `generate-covers` script が同 path に PNG を吐く前提で、frontmatter に `cover:` を
 * 書き忘れても自動で per-post cover が og:image / twitter:image に乗る。
 *
 * @graph-connects none
 */
export function buildPostMeta(input: {
  slug: string;
  title: string;
  summary?: string;
  cover?: string;
  lang: Lang;
}): HeadMeta[] {
  const url = `${SITE_URL}/posts/${input.slug}${input.lang === "ja" ? "?lang=ja" : ""}`;
  const description = input.summary ?? `${input.title} — ryantsuji.dev`;
  const coverPath = input.cover ?? `/posts/${input.slug}.${input.lang}.cover.png`;
  const image = `${SITE_URL}${coverPath}`;

  return [
    { title: `${input.title} — ryantsuji.dev` },
    { name: "description", content: description },
    { property: "og:title", content: input.title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:type", content: "article" },
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:image", content: image },
  ];
}

/**
 * post 1 件分の `Article` JSON-LD structured data。Google の rich result / X /
 * Discord 等が ingest して article 表示を強化する。`author` / `mainEntityOfPage` /
 * `datePublished` / `dateModified` を埋める。Zenn / dev.to に syndicate されている
 * post も canonical (= ryantsuji.dev) を mainEntityOfPage に置くことで「正典は本サイト」
 * と検索エンジンに明示する。
 *
 * @graph-connects none
 */
export function buildPostJsonLd(input: {
  slug: string;
  title: string;
  summary?: string;
  cover?: string;
  publishedAt: string;
  updatedAt?: string;
  lang: Lang;
}): string {
  const url = `${SITE_URL}/posts/${input.slug}${input.lang === "ja" ? "?lang=ja" : ""}`;
  const description = input.summary ?? `${input.title} — ryantsuji.dev`;
  const coverPath = input.cover ?? `/posts/${input.slug}.${input.lang}.cover.png`;
  const image = `${SITE_URL}${coverPath}`;
  const author = {
    "@type": "Person",
    name: "Ryan Tsuji",
    url: `${SITE_URL}/about`,
    sameAs: [
      "https://x.com/ryantsuji",
      "https://github.com/thujikun",
      "https://dev.to/ryantsuji",
      "https://zenn.dev/aircloset",
    ],
  };
  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description,
    inLanguage: input.lang === "ja" ? "ja-JP" : "en-US",
    datePublished: input.publishedAt,
    dateModified: input.updatedAt ?? input.publishedAt,
    author,
    publisher: author,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: [image],
  };
  // `<script type="application/ld+json">` の中身は HTML parser に対しては raw text。
  // 値に `</script>` が混じった瞬間に script tag が早期終了し以降が HTML として
  // render されるため、output 側で `</` だけエスケープして安全にする。
  return JSON.stringify(doc).replace(/<\/(script)/gi, "<\\/$1");
}

/** @graph-connects tanstack-router [provides] /posts/$slug route */
export const Route = createFileRoute("/posts/$slug")({
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ override: search.lang }),
  loader: async ({ params, deps }) => {
    // renderPost を先に解決して frontmatter (title / publishedAt) を取り出し、
    // posts 行の upsert に使う。Promise.all で並列化できない (engagement が
    // frontmatter に依存) ので serial。lang は server 側で確定。
    const doc = await renderPostServer({ data: { slug: params.slug, override: deps.override } });
    const engagement = await loadEngagementServer({
      data: {
        slug: params.slug,
        post: { title: doc.frontmatter.title, publishedAt: doc.frontmatter.publishedAt },
      },
    });
    return { ...doc, engagement };
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) return {};
    return {
      meta: buildPostMeta({
        slug: params.slug,
        title: loaderData.frontmatter.title,
        summary: loaderData.frontmatter.summary,
        cover: loaderData.frontmatter.cover,
        lang: loaderData.servedLang,
      }),
      links: buildPostLinks({
        slug: params.slug,
        servedLang: loaderData.servedLang,
        availableLangs: loaderData.availableLangs,
      }),
      scripts: [
        {
          type: "application/ld+json",
          children: buildPostJsonLd({
            slug: params.slug,
            title: loaderData.frontmatter.title,
            summary: loaderData.frontmatter.summary,
            cover: loaderData.frontmatter.cover,
            publishedAt: loaderData.frontmatter.publishedAt,
            updatedAt: loaderData.frontmatter.updatedAt,
            lang: loaderData.servedLang,
          }),
        },
      ],
    };
  },
  component: PostDetail,
});

/** @graph-connects none */
function PostDetail() {
  const { html, frontmatter, headings, readingTimeMinutes, engagement, servedLang, seriesNav } =
    Route.useLoaderData();
  const { slug } = Route.useParams();
  return (
    <main className="post-detail" lang={servedLang}>
      <nav className="post-detail__crumbs">
        <Link to="/posts">← all posts</Link>
      </nav>
      <header className="post-detail__header">
        <h1>{frontmatter.title}</h1>
        <div className="post-detail__meta">
          <time dateTime={frontmatter.publishedAt}>{frontmatter.publishedAt.slice(0, 10)}</time>
          <span className="post-detail__divider" aria-hidden="true">
            ·
          </span>
          <span>{readingTimeMinutes} min read</span>
          {displayTags(frontmatter.tags).length > 0 ? (
            <>
              <span className="post-detail__divider" aria-hidden="true">
                ·
              </span>
              <ul className="post-detail__tags">
                {displayTags(frontmatter.tags).map((tag) => (
                  <li key={tag}>
                    <Link to="/posts" search={{ tag }}>
                      #{tag}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </header>
      {seriesNav ? <PostSeriesBox nav={seriesNav} lang={servedLang} /> : null}
      <PostToc headings={headings} />
      <PostBody html={html} />
      <PostShareRail
        slug={slug}
        title={frontmatter.title}
        lang={servedLang}
        initialLikes={engagement.likes}
      />
      <EngagementSection slug={slug} lang={servedLang} initialComments={engagement.comments} />
    </main>
  );
}

/**
 * 連載 (series) に属する post の冒頭に出す navigation box。シリーズタイトル + 現在
 * Part 番号 + prev / next + シリーズ hub へのリンク。HN / X から個別 Part を踏んだ
 * 読者が「Part 1 から読み直したい」を最短で叶える。
 *
 * @graph-connects tanstack-router [calls] /series/$slug + /posts/$slug に Link
 */
function PostSeriesBox({
  nav,
  lang,
}: {
  nav: NonNullable<Awaited<ReturnType<typeof runRenderPost>>["seriesNav"]>;
  lang: Lang;
}) {
  const labelSeries = lang === "ja" ? "連載" : "Series";
  const labelPart = lang === "ja" ? "第" : "Part";
  const labelPartUnit = lang === "ja" ? "回" : "";
  const labelHub = lang === "ja" ? "目次" : "all parts";
  const labelPrev = lang === "ja" ? "← 前の Part" : "← previous";
  const labelNext = lang === "ja" ? "次の Part →" : "next →";
  return (
    <aside className="post-series-box" aria-label={labelSeries}>
      <span className="post-series-box__label">{labelSeries}</span>
      <p className="post-series-box__title">
        <Link to="/series/$slug" params={{ slug: nav.meta.slug }}>
          {nav.meta.title}
        </Link>{" "}
        — {labelPart} {nav.currentOrder}
        {labelPartUnit} / {nav.total}
      </p>
      <p className="post-series-box__nav">
        {nav.prev ? (
          <Link to="/posts/$slug" params={{ slug: nav.prev.slug }}>
            {labelPrev}: {nav.prev.title}
          </Link>
        ) : null}
        {nav.next ? (
          <Link to="/posts/$slug" params={{ slug: nav.next.slug }}>
            {labelNext}: {nav.next.title}
          </Link>
        ) : null}
        <Link to="/series/$slug" params={{ slug: nav.meta.slug }}>
          {labelHub}
        </Link>
      </p>
    </aside>
  );
}

/**
 * 左 sticky の share / like rail。`.post-detail` 直下に置くことで desktop grid
 * (column 1) に乗せ、article の左横で sticky になる。
 *
 * 元々は `EngagementSection` 内 (comment セクションと同居) に置いていたが、その
 * 場合 `.post-detail` の grid item にならず desktop でも記事の下に縦並びで出てしまう
 * 不具合があった。like 系の state は本 component が単独で持ち、comments と独立した
 * 状態管理にして責務を分離する (`submitting` flag も like / comment で別)。
 *
 * @graph-connects better-auth [calls] useSession で auth state を取得
 * @graph-connects content [calls] toggleLikeServer (server fn 経由)
 */
export function PostShareRail({
  slug,
  title,
  lang,
  initialLikes,
}: {
  slug: string;
  title: string;
  lang: Lang;
  initialLikes: { count: number; liked: boolean };
}) {
  const { data: session } = useSession();
  const toggleLikeFn = useServerFn(toggleLikeServer);
  const [likes, setLikes] = useState(initialLikes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuthenticated = !!session?.user;

  const onLike = () =>
    dispatchLikeClick({
      isAuthenticated,
      submitting,
      toggleLikeFn,
      slug,
      setSubmitting,
      setError,
      setLikes,
    });

  const postUrl = `${SHARE_SITE_URL}/posts/${slug}${lang === "ja" ? "?lang=ja" : ""}`;
  const signInHref = `/posts/${slug}`;

  return (
    <div className="post-share-rail">
      <PostSharePane
        title={title}
        lang={lang}
        postUrl={postUrl}
        likes={isAuthenticated ? likes : null}
        onLike={onLike}
        likeSubmitting={submitting}
        signInHref={isAuthenticated ? undefined : signInHref}
      />
      {error ? (
        <p className="comments__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 本サイトの公開 URL。share intent URL に絶対 URL を埋めるための local 定数。
 * `__root.tsx` / 上部の SITE_URL と同値だが、share pane は client-only でも組み立て
 * られるよう、ここで再定義する (=同 file の方が変更点が閉じる)。
 *
 * @graph-connects none
 */
const SHARE_SITE_URL = SITE_URL;

/**
 * like / comment の client logic は `$slug.actions.ts` に分離 (本 file の行数 cap
 * 回避と test 容易性確保のため)。React component から `dispatchLikeClick` /
 * `dispatchCommentSubmit` を呼ぶ。下の再 export は test で本 file の export を
 * 期待している経路への互換性維持 (`$slug.test.tsx` が `from "./$slug.js"` で参照)。
 */
export {
  executeLikeAction,
  executeAddCommentAction,
  dispatchLikeClick,
  dispatchCommentSubmit,
  type AddCommentFn,
  type ToggleLikeFn,
};

/**
 * post 末尾の engagement 領域。like 押下 + comment 投稿の client 側 UI を持つ。
 * 未認証時は sign-in CTA を出すだけで mutation は飛ばさない。
 *
 * @graph-connects better-auth [calls] useSession で auth state を取得
 */
export function EngagementSection({
  slug,
  lang,
  initialComments,
}: {
  slug: string;
  lang: Lang;
  initialComments: CommentView[];
}) {
  const { data: session } = useSession();
  const router = useRouter();
  const addCommentFn = useServerFn(addCommentServer);
  const deleteCommentFn = useServerFn(deleteCommentServer);

  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = !!session?.user;
  const currentUserId = session?.user.id ?? null;

  const onSubmitComment = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return dispatchCommentSubmit({
      isAuthenticated,
      submitting,
      draft,
      addCommentFn,
      slug,
      comments,
      setSubmitting,
      setError,
      setComments,
      setDraft,
      invalidate: () => router.invalidate(),
    });
  };

  const onReply = async ({ parentId, body }: { parentId: string; body: string }) => {
    const r = await executeAddCommentAction(addCommentFn, {
      slug,
      body,
      parentCommentId: parentId,
    });
    if (r.ok) {
      setComments((prev) => [r.comment, ...prev]);
      return { ok: true };
    }
    return { ok: false, error: r.error };
  };

  const onDeleteComment = async (commentId: string): Promise<void> => {
    try {
      const r = await deleteCommentFn({ data: commentId });
      if (r.deletedId) {
        setComments((prev) => prev.filter((c) => c.id !== r.deletedId));
        // view count + 親 soft-delete に伴う orphan-promotion を最新化するため
        // route loader を再走させる (post 経路の invalidate と同経路)。
        router.invalidate();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete failed");
    }
  };

  const signInHref = `/posts/${slug}`;
  // 未認証 user にも textarea を出して、submit 時に sign-in 画面へ誘導する。
  // 「書こうとしたら login を要求」のオンボーディング動線が、書く前に sign-in
  // バナーを見せるより自然 (Medium / Zenn 同 pattern)。
  const submitLabel = isAuthenticated
    ? submitting
      ? "posting..."
      : "post"
    : lang === "ja"
      ? "ログインして投稿"
      : "sign in to post";

  return (
    <section id="comments" className="engagement" aria-label="engagement">
      <h2 className="comments__heading">comments ({comments.length})</h2>
      <form className="comments__form" onSubmit={onSubmitComment}>
        <label htmlFor="comment-body" className="visually-hidden">
          comment
        </label>
        <textarea
          id="comment-body"
          className="comments__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={lang === "ja" ? "思ったことを書いてください" : "share your thoughts"}
          rows={3}
          maxLength={4000}
          disabled={submitting}
        />
        {isAuthenticated ? (
          <button
            type="submit"
            className="comments__submit"
            disabled={submitting || draft.trim().length === 0}
          >
            {submitLabel}
          </button>
        ) : (
          <Link
            to="/sign-in"
            search={{ redirect: signInHref }}
            className="comments__submit comments__submit--signin"
          >
            {submitLabel}
          </Link>
        )}
      </form>
      {error ? (
        <p className="comments__error" role="alert">
          {error}
        </p>
      ) : null}

      <CommentList
        comments={comments}
        currentUserId={currentUserId}
        lang={lang}
        onReply={onReply}
        onDelete={onDeleteComment}
      />
    </section>
  );
}
