/**
 * Lightbox の DOM 経路 test (happy-dom)。
 *
 * - 初期 SSR は dialog 要素のみ render し、img / close button は不在
 * - mount 後に `.post-body img` を click すると src/alt が state に入り showModal が呼ばれる
 * - `.post-body` 外の img click は無視
 * - dialog backdrop click で close、close button click でも close
 * - dialog onClose で src state がリセットされる
 *
 * @graph-stack ryantsuji-dev
 * @graph-domain publishing
 * @graph-business Lightbox component の delegation / open / close / cleanup を網羅。dialog showModal() / close() は happy-dom で関数を mock し、呼び出し回数で確認
 * @graph-connects none
 */

import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

import { Lightbox } from "./Lightbox.js";

describe("Lightbox", () => {
  it("SSR で dialog のみ render される (src 未設定なので img / close button は不在)", () => {
    const html = renderToString(<Lightbox />);
    expect(html).toMatch(/<dialog class="lightbox"/);
    expect(html).not.toMatch(/<img class="lightbox__img"/);
    expect(html).not.toMatch(/lightbox__close/);
  });

  describe("DOM interaction (happy-dom)", () => {
    let container: HTMLDivElement;
    let root: Root;
    let showModal: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      showModal = vi.fn();
      close = vi.fn();
      // happy-dom の HTMLDialogElement は showModal / close を持っているが、
      // 実装で stub 化して呼び出し回数を測る。
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
      // hydration mismatch を避けるため client-only render (createRoot) を使う。
      // SSR と client の出力差 (例: showModal mock の有無) を hydrate で検出する
      // 必要がない unit test なので fresh mount で十分。
      act(() => {
        root = createRoot(container);
        root.render(<Lightbox />);
      });
    }

    it("`.post-body img` の click で showModal が呼ばれる", () => {
      mount();
      // post-body 配下の img を用意
      const postBody = document.createElement("div");
      postBody.className = "post-body";
      const img = document.createElement("img");
      img.src = "https://example.com/foo.png";
      img.alt = "foo";
      postBody.appendChild(img);
      document.body.appendChild(postBody);

      act(() => {
        img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      expect(showModal).toHaveBeenCalled();

      postBody.remove();
    });

    it("`.post-body` の外にある img の click は無視 (showModal 呼ばれない)", () => {
      mount();
      const img = document.createElement("img");
      img.src = "https://example.com/logo.png";
      document.body.appendChild(img);

      act(() => {
        img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(showModal).not.toHaveBeenCalled();

      img.remove();
    });

    it("img 以外の click は無視 (showModal 呼ばれない)", () => {
      mount();
      const div = document.createElement("div");
      document.body.appendChild(div);

      act(() => {
        div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(showModal).not.toHaveBeenCalled();

      div.remove();
    });

    it("event.target が null の場合は何もしない (defensive)", () => {
      mount();
      // EventTarget なしの click は throw しない (handler の early return path)
      const evt = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(evt, "target", { value: null });
      act(() => {
        document.dispatchEvent(evt);
      });
      expect(showModal).not.toHaveBeenCalled();
    });

    it("img click 後に close button を render し、その click で close される", () => {
      mount();
      // post-body 配下の img を click して dialog を open
      const postBody = document.createElement("div");
      postBody.className = "post-body";
      const img = document.createElement("img");
      img.src = "https://example.com/x.png";
      img.alt = "x";
      postBody.appendChild(img);
      document.body.appendChild(postBody);
      act(() => {
        img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      // open 後に container 内の lightbox 内に close button が render される
      const closeBtn = container.querySelector(
        "button.lightbox__close",
      ) as HTMLButtonElement | null;
      expect(closeBtn).toBeTruthy();
      act(() => {
        closeBtn!.click();
      });
      expect(close).toHaveBeenCalled();
      postBody.remove();
    });

    it("dialog backdrop click (= dialog 自体への click) で close が呼ばれる", () => {
      mount();
      const dialog = container.querySelector("dialog.lightbox") as HTMLDialogElement;
      // target === dialog のとき close される
      act(() => {
        const evt = new MouseEvent("click", { bubbles: true });
        Object.defineProperty(evt, "target", { value: dialog });
        dialog.dispatchEvent(evt);
      });
      expect(close).toHaveBeenCalled();
    });

    it("dialog の close event 発火で src state がリセットされる (onClose handler)", () => {
      mount();
      const postBody = document.createElement("div");
      postBody.className = "post-body";
      const img = document.createElement("img");
      img.src = "https://example.com/z.png";
      postBody.appendChild(img);
      document.body.appendChild(postBody);
      act(() => {
        img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      // src が入ったので lightbox img が DOM にある
      expect(container.querySelector("img.lightbox__img")).toBeTruthy();
      const dialog = container.querySelector("dialog.lightbox") as HTMLDialogElement;
      // close event を dispatch して onClose handler を踏む
      act(() => {
        dialog.dispatchEvent(new Event("close", { bubbles: false }));
      });
      // src が null に戻り img が消える
      expect(container.querySelector("img.lightbox__img")).toBeFalsy();
      postBody.remove();
    });

    it("dialog 内 img click (target が dialog 自身ではない) では close されない", () => {
      mount();
      // src を入れて img を render させる
      const postBody = document.createElement("div");
      postBody.className = "post-body";
      const trigger = document.createElement("img");
      trigger.src = "https://example.com/y.png";
      postBody.appendChild(trigger);
      document.body.appendChild(postBody);
      act(() => {
        trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      const lightboxImg = container.querySelector("img.lightbox__img") as HTMLImageElement | null;
      expect(lightboxImg).toBeTruthy();
      close.mockClear();
      const dialog = container.querySelector("dialog.lightbox") as HTMLDialogElement;
      act(() => {
        const evt = new MouseEvent("click", { bubbles: true });
        Object.defineProperty(evt, "target", { value: lightboxImg });
        dialog.dispatchEvent(evt);
      });
      // target が dialog 自身ではないため close は呼ばれない
      expect(close).not.toHaveBeenCalled();
      postBody.remove();
    });
  });
});
