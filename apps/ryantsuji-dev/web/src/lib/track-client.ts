/**
 * `/api/track` に payload を送る client wrapper。
 *
 * - `navigator.sendBeacon` 優先 (= page unload 中でも届く、CPU 上限を踏まない)
 * - sendBeacon が無い / false を返した場合は fetch keepalive にフォールバック
 * - SSR (window undef) は no-op
 *
 * 副作用は完全 fire-and-forget。失敗は console に出さず silent に潰す (analytics の
 * 失敗が user 体験に伝播しない fail-open 設計、server side と同じ思想)。
 *
 * session_id は sessionStorage に UUID で持つ (tab close で揮発 → cross-session
 * tracking 不可)。cookie 一切使わない方針。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 自前 RUM の client beacon。navigator.sendBeacon で `/api/track` に POST。sendBeacon 不在環境は fetch keepalive に fallback。session_id は sessionStorage の UUID (cookie 不使用) で privacy 配慮、tab close で揮発
 * @graph-connects ryantsuji-dev [calls] POST /api/track (Hono → BQ insertAll)
 */

/**
 * sendBeacon / fetch に渡す JSON shape。BQ row schema と client send 内容の差分は:
 * - `ts` / `user_agent` は server 側で付与 (時刻は request 到達時、UA は header から)
 *
 * @graph-connects none
 */
export interface ClientTrackPayload {
  event_type: "page_view" | "engagement" | "share";
  path?: string;
  slug?: string;
  lang?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  viewport_w?: number;
  viewport_h?: number;
  locale?: string;
  session_id?: string;
}

/** @graph-connects none */
const SESSION_KEY = "rt:session_id";

/**
 * sessionStorage から既存 session_id を取り出すか、無ければ生成して保存する。
 *
 * test では sessionStorage を spy / window-less 環境では undefined を返す。
 *
 * @graph-connects none
 */
export function getOrCreateSessionId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}

/**
 * URL search params から utm_* を取り出す。先頭 `?` 省略可。test では `URL` constructor
 * を経由しないので、`new URLSearchParams(query)` を直接使う。
 *
 * @graph-connects none
 */
export function extractUtm(query: string): {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
} {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const out: { utm_source?: string; utm_medium?: string; utm_campaign?: string } = {};
  const src = params.get("utm_source");
  const med = params.get("utm_medium");
  const camp = params.get("utm_campaign");
  if (src) out.utm_source = src;
  if (med) out.utm_medium = med;
  if (camp) out.utm_campaign = camp;
  return out;
}

/**
 * 現在の page で page_view event を 1 件送る。`__root.tsx` の useEffect から呼ばれる
 * 想定で、location.pathname を path、document.referrer を referrer に詰める。
 *
 * @graph-connects ryantsuji-dev [calls] sendTrackBeacon (POST /api/track)
 */
export function trackPageView(args: { path: string; slug?: string; lang?: string }): void {
  if (typeof window === "undefined") return;
  const payload: ClientTrackPayload = {
    event_type: "page_view",
    path: args.path,
    slug: args.slug,
    lang: args.lang,
    referrer: document.referrer || undefined,
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    locale: navigator.language,
    session_id: getOrCreateSessionId(),
    ...extractUtm(window.location.search),
  };
  sendTrackBeacon(payload);
}

/**
 * payload を `/api/track` に POST する。sendBeacon → fetch keepalive の順で試して、
 * どちらも失敗したら silent に捨てる。
 *
 * test 用に `endpoint` を引数で受け取れる形にして、fixture URL に差し替え可能にする。
 *
 * @graph-connects ryantsuji-dev [calls] POST /api/track
 */
export function sendTrackBeacon(payload: ClientTrackPayload, endpoint = "/api/track"): boolean {
  if (typeof navigator === "undefined") return false;
  const body = JSON.stringify(payload);
  if (typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(endpoint, blob);
      if (ok) return true;
    } catch {
      /* fall through to fetch */
    }
  }
  if (typeof fetch === "function") {
    try {
      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
