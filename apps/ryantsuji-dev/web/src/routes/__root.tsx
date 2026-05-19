/**
 * Root route — 全 page 共通の HTML shell + provider 配置。
 *
 * `Outlet` 配下に各 page route が render される。`HeadContent` / `Scripts` は
 * TanStack Start の SSR で <head> / <script> を hoist するために必須。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 全ページ共通の HTML shell。<html> / <head> / <body> を 1 箇所で持ち、後続 route は Outlet 配下に流し込む。design-tokens (将来) と Query devtools をここで mount する
 * @graph-connects tanstack-router [provides] Root Route を export してファイルベースルーティングの起点になる
 */

import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";

import { Lightbox } from "../components/Lightbox.js";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, SUPPORTED_LANGS, type Lang } from "../server/i18n.js";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type Theme } from "../server/theme.js";

import { runResolveLang } from "./__root.server.js";

// `?url` で Vite に CSS asset として import させ、hashed pathname を取得する。
// 直書きの `/styles.css` だと Vite が emit せず 404 する (src/styles.css は
// public/ に置いてないため static serve されない) ので、必ず import 経由で
// build pipeline に乗せる。
import appCss from "../styles.css?url";

/**
 * root loader 用 server function。current lang を全 page で共通解決し、SiteHeader の
 * LangSwitcher active state に流す。
 *
 * @graph-connects content [calls] runResolveLang
 */
const resolveLangServer = createServerFn().handler(() => runResolveLang());

export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * 本番公開 URL。Facebook Sharing Debugger / Twitter Card Validator / Slack 等の
 * external crawler は HTML の og:image / twitter:image / og:url を raw 文字列として
 * 読むため、相対 path だと resolve に失敗する。OGP 仕様 (ogp.me) も og:image は
 * 絶対 URL を要求する。wrangler.jsonc の custom_domain routes と一致させる。
 *
 * @graph-connects none
 */
const SITE_URL = "https://ryantsuji.dev";

/** @graph-connects tanstack-router [provides] root route definition */
export const Route = createRootRouteWithContext<RouterContext>()({
  loader: async () => resolveLangServer(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ryantsuji.dev" },
      {
        name: "description",
        content: "Ryan Tsuji's personal blog — engineering, design, product.",
      },
      { name: "theme-color", content: "#0abab5" },
      // OG / Twitter Card (sub-label 付き logo を社外 share の preview に)
      // crawler が解決できるよう絶対 URL で送出する
      { property: "og:title", content: "ryantsuji.dev" },
      {
        property: "og:description",
        content: "Ryan Tsuji's personal blog — engineering, design, product.",
      },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: `${SITE_URL}/og-image.png` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: `${SITE_URL}/og-image.png` },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // favicon: SVG (modern browsers) + ICO fallback + 各 raster size
      // Mochiy Pop One letterforms を path 化した self-contained SVG (font 依存無し)
      { rel: "icon", type: "image/svg+xml", href: "/logo-mark.svg" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      // RSS feed (Atom 1.0、EN / JP 分離)。reader の自動検出はこの <link
      // rel="alternate"> を見るので、両 lang を declare する。title は reader UI
      // にそのまま並ぶので lang label を明示
      {
        rel: "alternate",
        type: "application/atom+xml",
        href: "/rss/en.xml",
        title: "ryantsuji.dev (EN)",
      },
      {
        rel: "alternate",
        type: "application/atom+xml",
        href: "/rss/ja.xml",
        title: "ryantsuji.dev (JP)",
      },
    ],
  }),
  component: RootComponent,
});

/**
 * `import.meta.env` の `VITE_FARO_COLLECTOR_URL` を string | undefined で取り出す薄い
 * helper。env object を引数で受け取る形にし、default は `import.meta.env` を読む。
 * test 側は env を直接渡すことで未投入 / 値あり / object 不在の各 branch を踏める
 * (vitest 上では `import.meta.env` の property 上書きが Proxy で反映されないため、
 * env 引数化が唯一安定して branch を assert できる構造)。
 *
 * @graph-connects none
 */
export function readFaroCollectorUrl(
  env: Record<string, string | undefined> | undefined = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env,
): string | undefined {
  return env?.VITE_FARO_COLLECTOR_URL;
}

/**
 * Faro client init の wiring を pure に切り出し。`docAvailable` (=window 存在判定) /
 * URL 読み出し / faro-client module の dynamic import / init 呼び出しの 3 分岐を
 * test 側で確定的に踏めるよう、副作用を全て引数経由 (`readUrl` / `importFaro`) で
 * inject する。`useEffect` 側はこの関数を 1 回呼ぶだけ。
 *
 * 戻り値は test 用に「init 経路に入ったかどうか」を返す Promise (URL 空 / SSR 時は
 * 即座に resolve(false))。`useEffect` の void cast でも safety は崩れない。
 *
 * @graph-connects none
 */
export async function performInitFaroClient(args: {
  docAvailable: boolean;
  readUrl: () => string | undefined;
  importFaro: () => Promise<{ initFaro: (url: string) => boolean }>;
}): Promise<boolean> {
  if (!args.docAvailable) return false;
  const url = args.readUrl();
  if (!url) return false;
  const mod = await args.importFaro();
  mod.initFaro(url);
  return true;
}

/** @graph-connects none */
function RootComponent() {
  const { theme, lang } = Route.useLoaderData();
  const location = useLocation();
  // Grafana Faro は client でしか動かない (window / document を eager 参照する) ので、
  // SDK 自体を lazy import + useEffect 内で初期化する。collector URL が未投入なら
  // dynamic import 自体を skip して bundle 解析対象から外す。
  useEffect(() => {
    void performInitFaroClient({
      docAvailable: typeof window !== "undefined",
      readUrl: readFaroCollectorUrl,
      importFaro: () => import("../lib/faro-client.js"),
    });
  }, []);
  // 自前 analytics: 各 route change で page_view を 1 件送る。effect の発火条件は
  // **URL 変化のみ** (= deps は location.pathname だけ)。lang は payload には載せたい
  // が、LangSwitcher 押下時の `router.invalidate()` で同 path に対して再 fire させ
  // たくない (DAU / per-path pv が膨らんで集計が壊れる) ため、ref 経由で「最新値を
  // 読むだけ」にして deps から外す。
  const langRef = useRef(lang);
  langRef.current = lang;
  useEffect(() => {
    if (typeof window === "undefined") return;
    void import("../lib/track-client.js").then(({ trackPageView }) =>
      trackPageView({ path: location.pathname, lang: langRef.current }),
    );
  }, [location.pathname]);
  return (
    <RootDocument theme={theme} lang={lang}>
      <Outlet />
    </RootDocument>
  );
}

/** @graph-connects none */
function RootDocument({
  children,
  theme,
  lang,
}: {
  children: ReactNode;
  theme: Theme | null;
  lang: Lang;
}) {
  // `data-theme` は明示選択 (cookie) 時のみ付ける。null の時は CSS の
  // `@media (prefers-color-scheme)` に判定を委ねる。
  const htmlProps = theme ? { "data-theme": theme } : {};
  // `<html lang>` は SEO / a11y 両面で per-request に正しい lang を返す方が良い
  // (Accept-Language / cookie / ?lang= で確定した値をそのまま流す)。
  return (
    <html lang={lang} {...htmlProps}>
      <head>
        <HeadContent />
      </head>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Lightbox />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * 全 page 共通 header。左に rt logo (home link 兼用)、中央に primary nav、
 * 右上に LangSwitcher + ThemeSwitcher。glass morphism で sticky pill。
 *
 * @graph-connects tanstack-router [calls] Link で / と /posts に飛ばす
 */
function SiteHeader() {
  const { lang, theme } = Route.useLoaderData();
  return (
    <header className="site-header">
      <Link to="/" className="site-header__brand" aria-label="ryantsuji.dev home">
        <img src="/logo-mark.svg" alt="" width={28} height={28} className="site-header__logo" />
        <span className="site-header__brand-text">ryantsuji.dev</span>
      </Link>
      <nav className="site-header__nav" aria-label="primary">
        <Link
          to="/posts"
          activeProps={{ className: "site-header__link site-header__link--active" }}
        >
          <span className="site-header__link">posts</span>
        </Link>
        <Link
          to="/about"
          activeProps={{ className: "site-header__link site-header__link--active" }}
        >
          <span className="site-header__link">about</span>
        </Link>
      </nav>
      <div className="site-header__prefs">
        <LangSwitcher current={lang} />
        <ThemeSwitcher current={theme} />
      </div>
    </header>
  );
}

/**
 * SiteHeader 右上の言語切替。`SUPPORTED_LANGS` を map で iterate するので、対応
 * 言語を増やしたら自動で UI も拡張される。
 *
 * 動作: 押下時に `document.cookie` を直接書いて、`router.invalidate()` で current
 * route の loader 群を再実行 → 全 loader が新 cookie を読んで新 lang で render する。
 * URL に `?lang=` を付ける per-link 伝播は廃止 (cookie で persistent に。 ?lang= は
 * 外部からの override 用に server 側で引き続き受理する)。
 *
 * @graph-connects tanstack-router [calls] router.invalidate で loader を再実行
 */
/**
 * LangSwitcher / ThemeSwitcher の click handler から呼ぶ pure 関数。
 * `document.cookie` の書き込みは副作用だが、引数で `doc` を受けることで test 時に
 * fake document を渡せる構造にする。`router.invalidate` は別途呼ぶ。
 *
 * @graph-connects none
 */
export function writeLangCookieDom(doc: { cookie: string }, lang: Lang): void {
  doc.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * 現在の theme (data-theme 属性 + prefers-color-scheme) から「逆側」の theme を返す。
 * テスト用に explicit theme と prefersDark を引数で受ける形に分離。
 *
 * @graph-connects none
 */
export function computeNextTheme(explicit: Theme | null, prefersDark: boolean): Theme {
  const isDark = explicit === "dark" || (explicit === null && prefersDark);
  return isDark ? "light" : "dark";
}

/**
 * ThemeSwitcher click 時の cookie 書き込み (pure)。
 *
 * @graph-connects none
 */
export function writeThemeCookieDom(doc: { cookie: string }, theme: Theme): void {
  doc.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * LangSwitcher 内 setLang の本体を pure に切り出し。引数で document / invalidate /
 * 環境判定を inject し、test では fake document + spy invalidate を渡す。実装側は
 * `typeof document === "undefined"` の early-return path を持つので、`docAvailable` を
 * 引数化することで両 path を test できる。
 *
 * @graph-connects none
 */
export function performSetLang(
  args: {
    docAvailable: boolean;
    doc: { cookie: string };
    invalidate: () => void;
    /**
     * URL の `?lang=` query を取り除く副作用。`pickLang` の優先順は
     * `?lang= > cookie > Accept-Language > en` なので、cookie 更新だけでは
     * URL に query が残った状態で言語切替が画面に反映されない (cookie が
     * loser になる)。test では fake spy を渡して呼ばれたかだけ確認する。
     */
    stripLangQuery: () => void;
  },
  lang: Lang,
): void {
  if (!args.docAvailable) return;
  writeLangCookieDom(args.doc, lang);
  args.stripLangQuery();
  args.invalidate();
}

/**
 * `window.location.search` から `lang` key を取り除いて history を replaceState する
 * 既定実装。callers (LangSwitcher) で `performSetLang` の `stripLangQuery` arg に渡す。
 * LangSwitcher.setLang が `typeof document === "undefined"` で SSR を弾いた後にしか
 * 呼ばれないので、本関数は browser globals (`window`) の存在を前提にする。
 *
 * @graph-connects none
 */
export function stripLangQueryFromWindow(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("lang")) return;
  url.searchParams.delete("lang");
  window.history.replaceState(null, "", url.toString());
}

/**
 * ThemeSwitcher 内 toggle の本体を pure に切り出し。document / matchMedia / invalidate
 * を inject し、test で各 path を踏める。`docAvailable=false` の SSR early-return も
 * 確認可能に。
 *
 * @graph-connects none
 */
export function performToggleTheme(args: {
  docAvailable: boolean;
  htmlEl: { getAttribute: (name: string) => string | null };
  doc: { cookie: string };
  prefersDark: boolean;
  invalidate: () => void;
}): void {
  if (!args.docAvailable) return;
  const explicit = args.htmlEl.getAttribute("data-theme") as Theme | null;
  const next = computeNextTheme(explicit, args.prefersDark);
  writeThemeCookieDom(args.doc, next);
  args.invalidate();
}

/** @graph-connects tanstack-router [calls] router.invalidate */
function LangSwitcher({ current }: { current: Lang }) {
  const router = useRouter();
  const setLang = (lang: Lang) => {
    if (typeof document === "undefined") return;
    performSetLang(
      {
        docAvailable: true,
        doc: document,
        invalidate: () => void router.invalidate(),
        stripLangQuery: stripLangQueryFromWindow,
      },
      lang,
    );
  };
  return (
    <nav className="lang-switcher" aria-label="language">
      {SUPPORTED_LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={
            l === current ? "lang-switcher__btn lang-switcher__btn--active" : "lang-switcher__btn"
          }
          aria-pressed={l === current}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </nav>
  );
}

/**
 * sun ↔ moon 切替ボタン。cookie 未設定 (= system 任せ) の時はどっちのアイコンを
 * 出すべきか server 側では分からないので、CSS で `[data-theme]` / `prefers-color-scheme`
 * に応じて 2 つの SVG を出し分ける (両方常時 DOM にあり、片方だけ visible)。
 *
 * 押下時に cookie を書いて `router.invalidate()` で全 loader 再実行 → `<html>` の
 * `data-theme` 属性が再 render され、CSS variables が新 theme に切り替わる。
 *
 * @graph-connects tanstack-router [calls] router.invalidate で loader を再実行
 */
function ThemeSwitcher({ current }: { current: Theme | null }) {
  const router = useRouter();
  const toggle = () => {
    // SSR では document が存在しない。click は client でしか発火しないので実害は
    // ないが、defensive に early return して performToggleTheme には常に確定値だけ渡す。
    if (typeof document === "undefined") return;
    performToggleTheme({
      docAvailable: true,
      htmlEl: document.documentElement,
      doc: document,
      prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
      invalidate: () => void router.invalidate(),
    });
  };
  // SSR では explicit が null の時に「いまどっちか」を出力できないので、両方 render
  // して CSS で出し分ける (hydration mismatch 回避)。
  return (
    <button
      type="button"
      onClick={toggle}
      className="theme-switcher"
      aria-label={
        current === "dark"
          ? "switch to light theme"
          : current === "light"
            ? "switch to dark theme"
            : "toggle theme"
      }
      data-current={current ?? "auto"}
    >
      <SunIcon className="theme-switcher__icon theme-switcher__icon--sun" />
      <MoonIcon className="theme-switcher__icon theme-switcher__icon--moon" />
    </button>
  );
}

/** @graph-connects none */
function SunIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** @graph-connects none */
function MoonIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/**
 * 全 page 共通の footer。/privacy と /terms へのリンクが OAuth provider 要件
 * (X "Request email from users" などで公開 URL の登録を要求される) を満たす入口。
 *
 * @graph-connects tanstack-router [calls] Link で /privacy / /terms に飛ばす
 */
function SiteFooter() {
  const { lang } = Route.useLoaderData();
  // X handle は lang で切替: ja → @RyanAircloset (JP 公式), en → @ryantsuji (EN 集約)
  const xHref = lang === "ja" ? "https://x.com/RyanAircloset" : "https://x.com/ryantsuji";
  // RSS link は当該 lang feed を指す (header の <link rel="alternate"> 側で en/jp
  // 両方 expose しているので、UI 表示は user の見ている lang に集中させる)
  const rssHref = `/rss/${lang}.xml`;
  return (
    <footer className="site-footer">
      <nav className="site-footer__links" aria-label="footer">
        <Link to="/about">about</Link>
        <span aria-hidden="true">·</span>
        <a href={rssHref}>RSS</a>
        <span aria-hidden="true">·</span>
        <a href={xHref}>X</a>
        <span aria-hidden="true">·</span>
        <a href="https://github.com/thujikun">GitHub</a>
        <span aria-hidden="true">·</span>
        <Link to="/privacy">privacy</Link>
        <span aria-hidden="true">·</span>
        <Link to="/terms">terms</Link>
      </nav>
      <small className="site-footer__copyright">© ryantsuji.dev</small>
    </footer>
  );
}
