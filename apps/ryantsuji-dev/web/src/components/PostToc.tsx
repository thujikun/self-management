/**
 * 投稿詳細の目次。Zenn 風の floating UI:
 *
 * - **desktop (≥1280px)**: main の右側に sticky で居続ける aside。最大高さは
 *   `100vh - top - bottom` で内部スクロール
 * - **mobile (<1280px)**: 右下に floating button、押下で native `<dialog>` が
 *   全画面寄りで開き、項目クリックで close + アンカージャンプ
 *
 * active heading highlight は `useActiveHeading` フックで IntersectionObserver
 * を回し、viewport 上部 25-35% の trigger band に入っている heading id を返す。
 * scroll up / down 双方向で band 内のものが切替わるため、戻り方向の追従もそのまま
 * 効く。SSR では heading 不確定なので null で render し、hydration 後に observer
 * が初期 active を確定する。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿詳細の目次を Zenn 風 floating UI に。desktop は右 sticky aside、mobile は右下フローティングボタン + `<dialog>` で出し入れ、main 本文に被らずスクロール独立。active heading を IntersectionObserver でハイライトして 23 分級の長文記事でも現在地が分かる
 * @graph-connects react [provides] desktop sticky aside + mobile dialog + active heading observer
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { Heading } from "@self/content";

/** @graph-connects none */
export const TOC_OBSERVER_ROOT_MARGIN = "-25% 0px -65% 0px";

/**
 * 表示中の見出しを返すフック。`headings` に渡された id 群を IntersectionObserver
 * で観測し、viewport 上部の trigger band (25%-35% 帯) に入っている最後の heading id
 * を active として返す。`headings` 配列が変わると observer を再構築する。
 *
 * @graph-connects react [calls] IntersectionObserver で本文 heading の交差を観測
 */
export function useActiveHeading(headings: readonly Heading[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const elements: HTMLElement[] = [];
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (el instanceof HTMLElement) elements.push(el);
    }
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: TOC_OBSERVER_ROOT_MARGIN, threshold: 0 },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [headings]);
  return activeId;
}

/** @graph-connects react [provides] floating TOC */
export function PostToc({ headings }: { headings: readonly Heading[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeId = useActiveHeading(headings);
  if (headings.length <= 1) return null;

  const openMobile = () => dialogRef.current?.showModal();
  const closeMobile = () => dialogRef.current?.close();

  return (
    <>
      {/* desktop sticky aside (≥1280px のみ visible、それ未満は display:none で消える) */}
      <aside className="post-toc post-toc--desktop" aria-label="目次">
        <h2 className="post-toc__heading">目次</h2>
        <TocList headings={headings} activeId={activeId} />
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
          <TocList headings={headings} activeId={activeId} onItemClick={closeMobile} />
        </div>
      </dialog>
    </>
  );
}

/** @graph-connects none */
function TocList({
  headings,
  activeId,
  onItemClick,
}: {
  headings: readonly Heading[];
  activeId: string | null;
  onItemClick?: () => void;
}) {
  return (
    <ol className="post-toc__list">
      {headings.map((h) => {
        const isActive = h.id === activeId;
        const itemClass = isActive ? "post-toc__item post-toc__item--active" : "post-toc__item";
        return (
          <li key={h.id} className={itemClass} data-level={h.level}>
            <a
              href={`#${h.id}`}
              onClick={onItemClick}
              className="post-toc__link"
              aria-current={isActive ? "true" : undefined}
            >
              {h.text}
            </a>
          </li>
        );
      })}
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
