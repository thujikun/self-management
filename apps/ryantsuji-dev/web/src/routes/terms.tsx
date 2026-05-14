/**
 * `/terms` — terms of service page。
 *
 * OAuth provider (GitHub / X) の app dashboard で **Terms of Service URL** として
 * 登録する公開 URL。X の "Request email from users" 機能の前提条件として必須。
 *
 * 内容: 個人サイトの最低限の利用規約 (acceptable use, no warranty, governing law,
 * 連絡先)。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business OAuth provider が要求する Terms of Service URL の実体。個人サイトでの comments/likes 投稿に関する acceptable use と免責、運営者の任意の suspension 権限、governing law (Japan) を明示する最小限の規約
 * @graph-connects tanstack-router [provides] /terms route
 */

import { Link, createFileRoute } from "@tanstack/react-router";

/** @graph-connects tanstack-router [provides] /terms route */
export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — ryantsuji.dev" },
      { name: "description", content: "Terms of service for ryantsuji.dev personal blog." },
    ],
  }),
  component: TermsPage,
});

/** @graph-connects none */
function TermsPage() {
  return (
    <main className="legal">
      <header className="legal__header">
        <h1>Terms of Service</h1>
        <p className="meta">Last updated: 2026-05-14</p>
      </header>

      <section>
        <h2>Acceptance</h2>
        <p>
          By accessing ryantsuji.dev or signing in to post comments / likes, you agree to these
          terms. If you do not agree, please do not use the site.
        </p>
      </section>

      <section>
        <h2>Account &amp; authentication</h2>
        <p>
          Sign-in is via GitHub or X (Twitter) OAuth. You are responsible for keeping your
          third-party account secure. The site operator reserves the right to limit account creation
          to specific email addresses.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>post spam, promotional content, or off-topic material;</li>
          <li>post abusive, harassing, hateful, or illegal content;</li>
          <li>impersonate any other person;</li>
          <li>attempt to disrupt or compromise the service.</li>
        </ul>
      </section>

      <section>
        <h2>Content you post</h2>
        <p>
          You retain rights to content you submit (comments). By posting, you grant ryantsuji.dev a
          non-exclusive, royalty-free license to display, store, and reasonably moderate your
          content for the operation of the site.
        </p>
      </section>

      <section>
        <h2>Termination &amp; moderation</h2>
        <p>
          The site operator may, at sole discretion, remove content or suspend accounts that violate
          these terms or are otherwise inappropriate. No notice is required.
        </p>
      </section>

      <section>
        <h2>No warranty</h2>
        <p>
          The site is provided &quot;as is&quot; without warranty of any kind. Availability,
          accuracy, and security are best-effort. Use at your own risk.
        </p>
      </section>

      <section>
        <h2>Limitation of liability</h2>
        <p>
          To the extent permitted by applicable law, the operator is not liable for any indirect,
          incidental, consequential, or special damages arising from your use of the site.
        </p>
      </section>

      <section>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of Japan. Any dispute will be subject to the
          exclusive jurisdiction of courts located in Tokyo.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          These terms may be updated as the site evolves. Continued use after a change constitutes
          acceptance of the updated terms.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          For questions about these terms:{" "}
          <a href="mailto:tsuji.0107@gmail.com">tsuji.0107@gmail.com</a>.
        </p>
      </section>

      <p className="legal__nav">
        <Link to="/">← back to home</Link>
      </p>
    </main>
  );
}
