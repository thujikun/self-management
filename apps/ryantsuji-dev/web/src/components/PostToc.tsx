/**
 * 投稿詳細の目次。Zenn 風の floating UI:
 *
 * - **desktop (≥1280px)**: main の右側に sticky で居続ける aside。最大高さは
 *   `100vh - top - bottom` で内部スクロール
 * - **mobile (<1280px)**: 右下に floating button、押下で native `<dialog>` が
 *   全画面寄りで開き、項目クリックで close + アンカージャンプ
 *
 * heading の active state highlight は次イテレーション (IntersectionObserver) で
 * 入れる予定、現状は静的リンクのみ。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細の目次を Zenn 風 floating UI に。desktop は右 sticky aside、mobile は右下フローティングボタン + `<dialog>` で出し入れ、main 本文に被らずスクロール独立
 * @graph-connects react [provides] desktop sticky aside + mobile dialog
 */

"use client";

import { useRef } from "react";
import type { Heading } from "@self/content";

/** @graph-connects react [provides] floating TOC */
export function PostToc({ headings }: { headings: readonly Heading[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  if (headings.length <= 1) return null;

  const openMobile = () => dialogRef.current?.showModal();
  const closeMobile = () => dialogRef.current?.close();

  return (
    <>
      {/* desktop sticky aside (≥1280px のみ visible、それ未満は display:none で消える) */}
      <aside className="post-toc post-toc--desktop" aria-label="目次">
        <h2 className="post-toc__heading">目次</h2>
        <TocList headings={headings} />
      </aside>

      {/* mobile floating button (右下) — desktop では display:none */}
      <button
        type="button"
        className="post-toc__mobile-trigger"
        onClick={openMobile}
        aria-label="目次を開く"
      >
        <TocIcon />
      </button>

      {/* mobile dialog — desktop / mobile 共通の DOM だが open は mobile button のみ */}
      <dialog
        ref={dialogRef}
        className="post-toc__dialog"
        onClick={(e) => {
          if (e.target === dialogRef.current) closeMobile();
        }}
      >
        <div className="post-toc__dialog-panel">
          <header className="post-toc__dialog-head">
            <h2 className="post-toc__heading">目次</h2>
            <button
              type="button"
              className="post-toc__dialog-close"
              onClick={closeMobile}
              aria-label="閉じる"
            >
              ×
            </button>
          </header>
          <TocList headings={headings} onItemClick={closeMobile} />
        </div>
      </dialog>
    </>
  );
}

/** @graph-connects none */
function TocList({
  headings,
  onItemClick,
}: {
  headings: readonly Heading[];
  onItemClick?: () => void;
}) {
  return (
    <ol className="post-toc__list">
      {headings.map((h) => (
        <li key={h.id} className="post-toc__item" data-level={h.level}>
          <a href={`#${h.id}`} onClick={onItemClick} className="post-toc__link">
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

/** @graph-connects none */
function TocIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="8" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="18" x2="20" y2="18" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  );
}
