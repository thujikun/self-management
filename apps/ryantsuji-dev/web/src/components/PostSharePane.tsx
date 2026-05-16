/**
 * 投稿詳細の左 sticky pane。like + RSS / X share / Facebook share を集約。
 *
 * 役割: post detail page の左側に float させ、scroll 中も常に share / like の
 * 動線を near hand に置く。Medium / Zenn 同型 pattern。
 *
 * - **like**: 認証 user のみ press 可。未認証時は sign-in CTA に変える。
 * - **RSS**: 当該 lang の atom feed link (`/rss/<lang>.xml`)。
 * - **X share**: `https://x.com/intent/post?...` で window を開く (新 tab)。
 * - **Facebook share**: `https://www.facebook.com/sharer/sharer.php?u=...` で
 *   share dialog。
 *
 * mobile (<1024px) では sticky pane を出さず、bottom toolbar 風に full-width で
 * 出す ── CSS 側の `.post-share-pane` media query で切替。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細の share / like pane。左 sticky で常時表示、X / Facebook intent URL + RSS / like を集約。mobile では bottom 固定に。like は server fn 経由で auth-gate
 * @graph-connects react [provides] sticky share + like pane
 */

import type { Lang } from "../server/i18n.js";

/** @graph-connects none */
export interface SharePaneInput {
  slug: string;
  title: string;
  lang: Lang;
  /** post の絶対 URL (intent URL に乗せるための事前計算済 string)。 */
  postUrl: string;
  /** like button の現在 state。`null` = 認証無し時 (button 自体出さない)。 */
  likes: { count: number; liked: boolean } | null;
  /** click handler。like は親が server fn を回す。 */
  onLike?: () => void;
  /** like in-flight 中かどうか (disabled 表示用)。 */
  likeSubmitting?: boolean;
  /** 未認証時は sign-in URL に飛ばすため redirect target を一緒に渡す。 */
  signInHref?: string;
}

/**
 * X (twitter) の web intent URL を組む。`text` は post title、`url` は post URL、
 * `via` は handle (公式 EN / JP で切替)。
 *
 * @graph-connects none
 */
export function buildXShareUrl(title: string, postUrl: string, lang: Lang): string {
  const via = lang === "ja" ? "RyanAircloset" : "ryantsuji";
  const params = new URLSearchParams({
    text: title,
    url: postUrl,
    via,
  });
  return `https://x.com/intent/post?${params.toString()}`;
}

/**
 * Facebook の sharer URL を組む。`u` に share 対象 URL を入れるだけ。title は
 * scrape 側 (og:title) から拾われるので渡さない。
 *
 * @graph-connects none
 */
export function buildFacebookShareUrl(postUrl: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`;
}

/** @graph-connects react [provides] sticky share + like pane */
export function PostSharePane({
  slug,
  title,
  lang,
  postUrl,
  likes,
  onLike,
  likeSubmitting,
  signInHref,
}: SharePaneInput) {
  const xUrl = buildXShareUrl(title, postUrl, lang);
  const fbUrl = buildFacebookShareUrl(postUrl);
  const rssUrl = `/rss/${lang}.xml`;

  return (
    <aside className="post-share-pane" aria-label="share / like">
      {likes ? (
        <button
          type="button"
          className="post-share-pane__btn post-share-pane__btn--like"
          onClick={onLike}
          disabled={likeSubmitting}
          aria-pressed={likes.liked}
          aria-label={likes.liked ? "unlike" : "like"}
          title={likes.liked ? "unlike" : "like"}
        >
          <span className="post-share-pane__icon" aria-hidden="true">
            {likes.liked ? "♥" : "♡"}
          </span>
          <span className="post-share-pane__count">{likes.count}</span>
        </button>
      ) : signInHref ? (
        // Link 不使用 (router context 無しの SSR test でも render したいため plain <a>)
        // tanstack-router の SPA navigation は client 側で hydrate されると自動で interception
        // される (data-link 属性なし通常 anchor は full reload になるが、sign-in 経由は
        // どのみち server-rendered なので問題なし)
        <a
          href={`/sign-in?redirect=${encodeURIComponent(signInHref)}`}
          className="post-share-pane__btn post-share-pane__btn--signin"
          aria-label="sign in to like"
          title="sign in to like"
        >
          <span className="post-share-pane__icon" aria-hidden="true">
            ♡
          </span>
        </a>
      ) : null}

      <a
        href={xUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="post-share-pane__btn post-share-pane__btn--x"
        aria-label="share on X"
        title="share on X"
      >
        <span className="post-share-pane__icon" aria-hidden="true">
          𝕏
        </span>
      </a>

      <a
        href={fbUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="post-share-pane__btn post-share-pane__btn--facebook"
        aria-label="share on Facebook"
        title="share on Facebook"
      >
        <span className="post-share-pane__icon" aria-hidden="true">
          f
        </span>
      </a>

      <a
        href={rssUrl}
        className="post-share-pane__btn post-share-pane__btn--rss"
        aria-label={`RSS feed (${lang.toUpperCase()})`}
        title={`RSS feed (${lang.toUpperCase()})`}
        data-slug={slug}
      >
        <span className="post-share-pane__icon" aria-hidden="true">
          ⌁
        </span>
      </a>
    </aside>
  );
}
