/**
 * PostToc の SSR + DOM 経路 test。
 *
 * - headings 0/1 件は null を返す (TOC を出さない null branch)
 * - 2 件以上で desktop aside + mobile trigger + dialog を full render
 * - mobile trigger click で dialog.showModal が呼ばれる
 * - dialog 内項目 click で dialog が close される
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business PostToc の null branch / SSR markup / DOM 経路 (showModal/close/backdrop click/item click) を網羅
 * @graph-connects none
 */

import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateRoot, type Root } from "react-dom/client";
import { act } from "react";

import { PostToc } from "./PostToc.js";

const SAMPLE_HEADINGS = [
  { id: "intro", text: "Intro", level: 2 },
  { id: "section-a", text: "Section A", level: 2 },
  { id: "section-a-1", text: "Section A.1", level: 3 },
] as const;

describe("PostToc", () => {
  it("headings 0 件なら null (DOM 出さない)", () => {
    const html = renderToString(<PostToc headings={[]} />);
    expect(html).toBe("");
  });

  it("headings 1 件なら null (TOC を出すには 2 件以上必要)", () => {
    const html = renderToString(<PostToc headings={[SAMPLE_HEADINGS[0]]} />);
    expect(html).toBe("");
  });

  it("headings 2+ 件で desktop aside + mobile trigger + dialog を全て render", () => {
    const html = renderToString(<PostToc headings={SAMPLE_HEADINGS} />);
    expect(html).toMatch(/<aside class="post-toc post-toc--desktop"/);
    expect(html).toMatch(/<button[^>]*class="post-toc__mobile-trigger"/);
    expect(html).toMatch(/<dialog class="post-toc__dialog"/);
    // heading list は同じ内容を desktop / dialog 両方に出す
    expect(html).toMatch(/<a href="#intro"[^>]*>Intro<\/a>/);
    expect(html).toMatch(/<a href="#section-a-1"[^>]*>Section A\.1<\/a>/);
    expect(html).toMatch(/data-level="3"/);
  });

  describe("DOM interaction (happy-dom)", () => {
    let container: HTMLDivElement;
    let root: Root;
    let showModal: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      showModal = vi.fn();
      close = vi.fn();
      HTMLDialogElement.prototype.showModal =
        showModal as unknown as typeof HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.close =
        close as unknown as typeof HTMLDialogElement.prototype.close;
      container = document.createElement("div");
      document.body.appendChild(container);
    });

    afterEach(() => {
      act(() => root?.unmount());
      container.remove();
    });

    function mount() {
      const ssr = renderToString(<PostToc headings={SAMPLE_HEADINGS} />);
      container.innerHTML = ssr;
      act(() => {
        root = hydrateRoot(container, <PostToc headings={SAMPLE_HEADINGS} />);
      });
    }

    it("mobile trigger button の click で showModal が呼ばれる", () => {
      mount();
      const trigger = container.querySelector(
        "button.post-toc__mobile-trigger",
      ) as HTMLButtonElement;
      act(() => {
        trigger.click();
      });
      expect(showModal).toHaveBeenCalled();
    });

    it("dialog 内 close button の click で close が呼ばれる", () => {
      mount();
      const closeBtn = container.querySelector(
        "button.post-toc__dialog-close",
      ) as HTMLButtonElement;
      act(() => {
        closeBtn.click();
      });
      expect(close).toHaveBeenCalled();
    });

    it("dialog 内 heading link の click でも close が呼ばれる (mobile 用 dialog 内のみ)", () => {
      mount();
      // dialog 内の (= dialog__panel 配下の) heading link を取る
      const dialogLink = container.querySelector(
        ".post-toc__dialog .post-toc__link",
      ) as HTMLAnchorElement;
      act(() => {
        dialogLink.click();
      });
      expect(close).toHaveBeenCalled();
    });

    it("dialog の backdrop click (= dialog 自体への click) で close が呼ばれる", () => {
      mount();
      const dialog = container.querySelector("dialog.post-toc__dialog") as HTMLDialogElement;
      // backdrop click は dialog 自身が target になる
      act(() => {
        dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(close).toHaveBeenCalled();
    });
  });
});
