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

import { PostToc, TOC_OBSERVER_ROOT_MARGIN, tocLabels } from "./PostToc.js";

const SAMPLE_HEADINGS = [
  { id: "intro", text: "Intro", level: 2 },
  { id: "section-a", text: "Section A", level: 2 },
  { id: "section-a-1", text: "Section A.1", level: 3 },
] as const;

describe("PostToc", () => {
  it("headings 0 件なら null (DOM 出さない)", () => {
    const html = renderToString(<PostToc headings={[]} lang="en" />);
    expect(html).toBe("");
  });

  it("headings 1 件なら null (TOC を出すには 2 件以上必要)", () => {
    const html = renderToString(<PostToc headings={[SAMPLE_HEADINGS[0]]} lang="en" />);
    expect(html).toBe("");
  });

  it("headings 2+ 件で desktop aside + mobile trigger + dialog を全て render", () => {
    const html = renderToString(<PostToc headings={SAMPLE_HEADINGS} lang="en" />);
    expect(html).toMatch(/<aside class="post-toc post-toc--desktop"/);
    expect(html).toMatch(/<button[^>]*class="post-toc__mobile-trigger"/);
    expect(html).toMatch(/<dialog class="post-toc__dialog"/);
    // heading list は同じ内容を desktop / dialog 両方に出す
    expect(html).toMatch(/<a href="#intro"[^>]*>Intro<\/a>/);
    expect(html).toMatch(/<a href="#section-a-1"[^>]*>Section A\.1<\/a>/);
    expect(html).toMatch(/data-level="3"/);
  });

  it("lang=ja: TOC heading / mobile trigger aria / close aria に ja 文言が出る", () => {
    const html = renderToString(<PostToc headings={SAMPLE_HEADINGS} lang="ja" />);
    // desktop aside + dialog の両方に `<h2>目次</h2>` が出る (= 2 箇所)
    expect(html.match(/<h2 class="post-toc__heading">目次<\/h2>/g)?.length).toBe(2);
    // mobile trigger の aria-label
    expect(html).toMatch(
      /<button[^>]*class="post-toc__mobile-trigger"[^>]*aria-label="目次を開く"/,
    );
    // dialog close の aria-label
    expect(html).toMatch(/<button[^>]*class="post-toc__dialog-close"[^>]*aria-label="閉じる"/);
    // desktop aside の aria-label も ja
    expect(html).toMatch(/<aside class="post-toc post-toc--desktop"[^>]*aria-label="目次"/);
    // en 文言は出ない (= clean 切替が成立、ja 経路に en 文言が混ざってない)
    expect(html).not.toMatch(/Contents/);
    expect(html).not.toMatch(/Open contents/);
  });

  it("lang=en: TOC heading / aria に en 文言が出る (旧 ja 固定だった bug の回帰防止)", () => {
    const html = renderToString(<PostToc headings={SAMPLE_HEADINGS} lang="en" />);
    expect(html.match(/<h2 class="post-toc__heading">Contents<\/h2>/g)?.length).toBe(2);
    expect(html).toMatch(
      /<button[^>]*class="post-toc__mobile-trigger"[^>]*aria-label="Open contents"/,
    );
    expect(html).toMatch(/<button[^>]*class="post-toc__dialog-close"[^>]*aria-label="Close"/);
    expect(html).toMatch(/<aside class="post-toc post-toc--desktop"[^>]*aria-label="Contents"/);
    // ja 文言が混ざらない
    expect(html).not.toMatch(/目次/);
    expect(html).not.toMatch(/閉じる/);
  });

  describe("tocLabels (pure)", () => {
    it("ja は 目次 / 目次を開く / 閉じる", () => {
      expect(tocLabels("ja")).toStrictEqual({
        heading: "目次",
        openTrigger: "目次を開く",
        closeDialog: "閉じる",
      });
    });
    it("en は Contents / Open contents / Close", () => {
      expect(tocLabels("en")).toStrictEqual({
        heading: "Contents",
        openTrigger: "Open contents",
        closeDialog: "Close",
      });
    });
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
      const ssr = renderToString(<PostToc headings={SAMPLE_HEADINGS} lang="en" />);
      container.innerHTML = ssr;
      act(() => {
        root = hydrateRoot(container, <PostToc headings={SAMPLE_HEADINGS} lang="en" />);
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

  describe("active heading highlight (IntersectionObserver)", () => {
    type ObserverArgs = {
      callback: IntersectionObserverCallback;
      options: IntersectionObserverInit | undefined;
    };
    let lastObserver: ObserverArgs | null = null;
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      lastObserver = null;
      const originalIO = globalThis.IntersectionObserver;
      class FakeIO {
        callback: IntersectionObserverCallback;
        observed: Element[] = [];
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.callback = callback;
          lastObserver = { callback, options };
        }
        observe(el: Element) {
          this.observed.push(el);
        }
        unobserve() {}
        disconnect() {}
        takeRecords(): IntersectionObserverEntry[] {
          return [];
        }
        root: Element | Document | null = null;
        rootMargin = "";
        thresholds: ReadonlyArray<number> = [];
      }
      globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;
      // テスト終了時に restore
      return () => {
        globalThis.IntersectionObserver = originalIO;
      };
    });

    afterEach(() => {
      act(() => root?.unmount());
      container?.remove();
    });

    function mountWithHeadings(): void {
      // heading anchor を本文に置いて document.getElementById が hit する状態にする
      for (const h of SAMPLE_HEADINGS) {
        const el = document.createElement(`h${h.level}`);
        el.id = h.id;
        el.textContent = h.text;
        document.body.appendChild(el);
      }
      container = document.createElement("div");
      document.body.appendChild(container);
      const ssr = renderToString(<PostToc headings={SAMPLE_HEADINGS} lang="en" />);
      container.innerHTML = ssr;
      act(() => {
        root = hydrateRoot(container, <PostToc headings={SAMPLE_HEADINGS} lang="en" />);
      });
    }

    function buildEntry(id: string, isIntersecting: boolean): IntersectionObserverEntry {
      const target = document.getElementById(id);
      if (!target) throw new Error(`no target: ${id}`);
      return {
        isIntersecting,
        target,
        intersectionRatio: isIntersecting ? 1 : 0,
        time: 0,
        rootBounds: null,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: target.getBoundingClientRect(),
      } as IntersectionObserverEntry;
    }

    function fireIntersect(id: string, isIntersecting: boolean): void {
      if (!lastObserver) throw new Error("no observer");
      act(() => {
        lastObserver!.callback([buildEntry(id, isIntersecting)], {} as IntersectionObserver);
      });
    }

    function fireIntersectBatch(items: ReadonlyArray<[string, boolean]>): void {
      if (!lastObserver) throw new Error("no observer");
      const entries = items.map(([id, hit]) => buildEntry(id, hit));
      act(() => {
        lastObserver!.callback(entries, {} as IntersectionObserver);
      });
    }

    it("IntersectionObserver は viewport 上部 trigger band で初期化される (TOC_OBSERVER_ROOT_MARGIN)", () => {
      mountWithHeadings();
      expect(lastObserver?.options?.rootMargin).toBe(TOC_OBSERVER_ROOT_MARGIN);
      expect(TOC_OBSERVER_ROOT_MARGIN).toBe("-25% 0px -65% 0px");
    });

    function activeHrefs(): string[] {
      return Array.from(
        container.querySelectorAll<HTMLAnchorElement>('a.post-toc__link[aria-current="true"]'),
      ).map((a) => a.getAttribute("href") ?? "");
    }

    it("intersecting heading に対応する <li> に post-toc__item--active が付き、<a> に aria-current=true", () => {
      mountWithHeadings();
      fireIntersect("section-a", true);
      // desktop aside と dialog の両方の list で同じ id の <li> が active になる
      const activeItems = container.querySelectorAll(".post-toc__item--active[data-level='2']");
      expect(activeItems).toHaveLength(2);
      // 全 active link が #section-a を指している (desktop + dialog の 2 件、決定的)
      expect(activeHrefs()).toStrictEqual(["#section-a", "#section-a"]);
    });

    it("別の heading が intersect すると active が切替わる (scroll down 追従)", () => {
      mountWithHeadings();
      fireIntersect("section-a", true);
      fireIntersect("section-a-1", true);
      expect(activeHrefs()).toStrictEqual(["#section-a-1", "#section-a-1"]);
    });

    it("同一 callback で複数 heading が同時 intersect しても DOM 順で最後の id が active になる", () => {
      mountWithHeadings();
      // entries は仕様上 DOM 順を保証しない。逆順 (section-a-1 → intro) で渡しても、
      // SAMPLE_HEADINGS 内のインデックスで最後 (= section-a-1) が active になる。
      fireIntersectBatch([
        ["section-a-1", true],
        ["intro", true],
        ["section-a", true],
      ]);
      expect(activeHrefs()).toStrictEqual(["#section-a-1", "#section-a-1"]);
    });

    it("初期 render (intersect 未発火) では aria-current=true な link は無い", () => {
      mountWithHeadings();
      expect(activeHrefs()).toStrictEqual([]);
    });

    it("isIntersecting=false の entry では active を更新しない (scroll で band を出ても直前の active を保持)", () => {
      mountWithHeadings();
      fireIntersect("section-a", true);
      // scroll で band を抜けた場合、entry は isIntersecting=false で再 fire される。
      // この path で activeId が null に倒れない (= 直前の id を保持) ことを固定する。
      fireIntersect("section-a", false);
      expect(activeHrefs()).toStrictEqual(["#section-a", "#section-a"]);
    });

    it("DOM 上に heading 要素が無い場合は observer を組まない (early return)", () => {
      // headings は frontmatter から渡ってるが、本文 DOM に id が無いケース
      // (テスト fixture / SSR で headings parse のみ完了 / 本文 hydration 前等)
      container = document.createElement("div");
      document.body.appendChild(container);
      const ssr = renderToString(<PostToc headings={SAMPLE_HEADINGS} lang="en" />);
      container.innerHTML = ssr;
      act(() => {
        root = hydrateRoot(container, <PostToc headings={SAMPLE_HEADINGS} lang="en" />);
      });
      // observe される要素が無いので、active が決まらず aria-current も付かない
      expect(activeHrefs()).toStrictEqual([]);
    });
  });

  describe("active heading highlight (SSR / IntersectionObserver 未対応環境)", () => {
    it("IntersectionObserver が undefined の環境では effect 内で early return (例外を出さない)", () => {
      const originalIO = globalThis.IntersectionObserver;
      // happy-dom に IO はあるが、global を一時的に剥がして early-return path を踏む。
      // typeof check が "undefined" になる経路。delete operator は global で型に
      // 渋るので `Reflect.deleteProperty` 経由で取り外し、finally で復元する。
      Reflect.deleteProperty(
        globalThis as unknown as Record<string, unknown>,
        "IntersectionObserver",
      );
      try {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const ssr = renderToString(<PostToc headings={SAMPLE_HEADINGS} lang="en" />);
        container.innerHTML = ssr;
        const fakeRoot = hydrateRoot(container, <PostToc headings={SAMPLE_HEADINGS} lang="en" />);
        // hydrate が落ちなければ OK (early return 経路)
        act(() => fakeRoot.unmount());
        container.remove();
      } finally {
        globalThis.IntersectionObserver = originalIO;
      }
    });
  });
});
