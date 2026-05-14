/**
 * `/privacy` — privacy policy page。
 *
 * OAuth provider (GitHub / X) の app dashboard で **Privacy Policy URL** として
 * 登録する公開 URL。X の "Request email from users" 機能の前提条件として必須。
 *
 * 内容: 個人サイトの最低限の disclosure (誰が運用してて、何のデータを取って、
 * どこに置いて、いつ消すか、連絡先)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business OAuth provider が要求する Privacy Policy URL の実体。何の data を集めて (auth user info, comments/likes, view counter)、どの third-party (Cloudflare, Neon, GitHub, X) に流れているか、保管期間と削除手順を明示する個人サイト用の最小開示
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
        <p className="meta">Last updated: 2026-05-14</p>
      </header>

      <section>
        <h2>Who runs this site</h2>
        <p>
          ryantsuji.dev is a personal blog operated by Ryan Tsuji (個人サイト). Contact:{" "}
          <a href="mailto:tsuji.0107@gmail.com">tsuji.0107@gmail.com</a>.
        </p>
      </section>

      <section>
        <h2>What data is collected</h2>
        <ul>
          <li>
            <strong>Authentication info</strong> from your OAuth provider (GitHub or X): user ID,
            display name, primary email, avatar URL. Stored when you sign in.
          </li>
          <li>
            <strong>Engagement actions</strong> you take: comments you post (text + your name) and
            likes. Stored under your authenticated account.
          </li>
          <li>
            <strong>Page view counts</strong> (per post, aggregate, anonymous). No per-visitor
            tracking.
          </li>
          <li>
            <strong>Network metadata</strong> (IP, user agent) is processed transiently by
            Cloudflare for routing and DDoS protection, and is not persisted to our database.
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
            <strong>Cloudflare Workers</strong> — request handling and edge cache. No persistent
            user data stored here.
          </li>
          <li>
            <strong>GitHub OAuth</strong> / <strong>X OAuth 2.0</strong> — handle initial sign-in
            handshake. Their respective privacy policies apply on those services.
          </li>
        </ul>
      </section>

      <section>
        <h2>Sharing</h2>
        <p>
          No data is shared with marketing, advertising, or analytics third parties. There is no
          tracking script on this site beyond the OAuth callback flow.
        </p>
      </section>

      <section>
        <h2>Retention &amp; deletion</h2>
        <p>
          Data is retained while your account exists. Email{" "}
          <a href="mailto:tsuji.0107@gmail.com">tsuji.0107@gmail.com</a> to request account and data
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
