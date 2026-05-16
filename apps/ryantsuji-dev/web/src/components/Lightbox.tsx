/**
 * `.post-body img` を click すると native `<dialog>` で拡大表示する client component。
 *
 * 動作:
 * - mount 時に document 全体に click delegation を仕掛け、`.post-body img` を踏むと
 *   その img の src を state に持って dialog を `showModal()` で開く
 * - dialog backdrop (= dialog 自身) を click すると close、ESC でも close (native 挙動)
 *
 * markdown は server で render され `<img src=...>` が単純に DOM に並ぶ。各 img に
 * listener を貼るのは reflow / cost が嵩むので document delegation 1 個で済ます。
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business 投稿本文の画像クリックで拡大表示する lightbox。client component で document delegation を 1 箇所に集約、`<dialog>` native API で focus trap / ESC close を browser に委譲
 * @graph-connects react [provides] global click delegation + <dialog> overlay
 */

"use client";

import { useEffect, useRef, useState } from "react";

/** @graph-connects react [provides] lightbox overlay */
export function Lightbox() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [alt, setAlt] = useState<string>("");

  useEffect(() => {
    function handler(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName !== "IMG") return;
      const img = target as HTMLImageElement;
      if (!img.closest(".post-body")) return;
      // markdown 由来の img のみ対象、それ以外 (logo 等) は素通し
      event.preventDefault();
      setSrc(img.currentSrc || img.src);
      setAlt(img.alt);
      dialogRef.current?.showModal();
    }
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className="lightbox"
      onClick={(e) => {
        // dialog (= backdrop) を直接クリックされた場合のみ close (img の click は無視)
        if (e.target === dialogRef.current) close();
      }}
      onClose={() => setSrc(null)}
    >
      {src ? (
        <button
          type="button"
          className="lightbox__close"
          onClick={close}
          aria-label="close lightbox"
        >
          ×
        </button>
      ) : null}
      {src ? <img className="lightbox__img" src={src} alt={alt} /> : null}
    </dialog>
  );
}
