/**
 * `/privacy` — privacy policy page。
 *
 * OAuth provider (GitHub / X / Google) の app dashboard で **Privacy Policy URL**
 * として登録する公開 URL。X の "Request email from users" 機能の前提条件として必須。
 *
 * 内容: 個人サイトの最低限の disclosure (誰が運用してて、何のデータを取って、
 * どこに置いて、いつ消すか、連絡先)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business OAuth provider が要求する Privacy Policy URL の実体。何の data を集めて (auth user info, comments/likes, view counter)、どの third-party (Cloudflare, Neon, GitHub, X, Google) に流れているか、保管期間と削除手順を明示する個人サイト用の最小開示
 * @graph-connects tanstack-router [provides] /privacy route
 */

import { Link, createFileRoute } from "@tanstack/react-router";

/** @graph-connects tanstack-router [provides] /privacy route */
export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — ryantsuji.dev" },
      { name: "description", content: "Privacy policy for ryantsuji.dev personal blog." },
    ],
  }),
  component: PrivacyPage,
});

/** @graph-connects none */
function PrivacyPage() {
  return (
    <main className="legal">
      <header className="legal__header">
        <h1>Privacy Policy</h1>
        <p className="meta">Last updated: 2026-05-17</p>
      </header>

      <section>
        <h2>Who runs this site</h2>
        <p>
          ryantsuji.dev is a personal blog operated by Ryan Tsuji (個人サイト). Contact:{" "}
          <a href="mailto:hello@ryantsuji.dev">hello@ryantsuji.dev</a>.
        </p>
      </section>

      <section>
        <h2>What data is collected</h2>
        <ul>
          <li>
            <strong>Authentication info</strong> from your OAuth provider (GitHub, X, or Google):
            user ID, display name, primary email, avatar URL. Stored when you sign in.
          </li>
          <li>
            <strong>Engagement actions</strong> you take: comments you post (text + your name) and
            likes. Stored under your authenticated account.
          </li>
          <li>
            <strong>Page view counts</strong> (per post, aggregate). Stored in our database to
            display engagement totals.
          </li>
          <li>
            <strong>Per-page view metadata</strong>: path, referrer, <code>utm_*</code> query
            parameters, viewport size (width/height), browser locale, and a user-agent string
            truncated to 256 characters. Sent on every page navigation to our own analytics endpoint
            (<code>/api/track</code>) and stored in our BigQuery dataset.
          </li>
          <li>
            <strong>Anonymous session identifier</strong>: a random UUID generated in your browser
            and kept only in <code>sessionStorage</code>. It is discarded when you close the browser
            tab. No cookies are set for tracking, and the UUID is not linked to your authenticated
            account or to your IP address.
          </li>
          <li>
            <strong>Network metadata</strong> (IP, raw user agent) is processed transiently by
            Cloudflare for routing and DDoS protection. The IP is not persisted to our database; the
            user agent is captured server-side from the request header and stored truncated (≤ 256
            chars) alongside the page view metadata above.
          </li>
        </ul>
      </section>

      <section>
        <h2>Why it&apos;s collected</h2>
        <p>To identify commenters, attribute likes, and show aggregate view counts on posts.</p>
      </section>

      <section>
        <h2>Where data lives</h2>
        <ul>
          <li>
            <strong>Neon Postgres</strong> (US region) — user accounts, comments, likes, view
            counts.
          </li>
          <li>
            <strong>Google BigQuery</strong> (asia-northeast1 region, our own project) — page view
            metadata described above (table <code>ryan.web_events</code>). Used only by us for
            first-party analytics on the blog; not exposed to or shared with any external tooling.
          </li>
          <li>
            <strong>Cloudflare Workers</strong> — request handling and edge cache. No persistent
            user data stored here.
          </li>
          <li>
            <strong>GitHub OAuth</strong> / <strong>X OAuth 2.0</strong> /{" "}
            <strong>Google OAuth 2.0</strong> — handle initial sign-in handshake. Their respective
            privacy policies apply on those services.
          </li>
        </ul>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          No data is shared with marketing, advertising, or third-party analytics SaaS. Analytics is
          self-hosted on our own BigQuery dataset, not sent to Google Analytics, Plausible, Fathom,
          or any equivalent external service. The only third parties involved in this site are the
          infrastructure providers listed under &quot;Where data lives&quot; above.
        </p>
      </section>

      <section>
        <h2>Retention &amp; deletion</h2>
        <p>
          Data is retained while your account exists. Email{" "}
          <a href="mailto:hello@ryantsuji.dev">hello@ryantsuji.dev</a> to request account and data
          deletion; all rows tied to your user ID will be removed within a reasonable window.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          You may request access, correction, or deletion of any personal data we hold about you,
          consistent with GDPR / APPI / CCPA principles. Use the contact above.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          This page may be updated as the site&apos;s features change. The &quot;Last updated&quot;
          date above will reflect any change.
        </p>
      </section>

      <p className="legal__nav">
        <Link to="/">← back to home</Link>
      </p>
    </main>
  );
}
