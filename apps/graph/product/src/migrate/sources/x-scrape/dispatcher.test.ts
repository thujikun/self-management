/**
 * `dispatcher.ts` の unit test (scaffolding 期の挙動検証)。
 *
 * @graph-stack ryan-product-graph
 * @graph-domain graph
 * @graph-business notImplementedAdapter / dispatchScrape / registerScrapeAdapter
 * の動作と、後続 Phase 5b 以降で adapter 差し替えが動作することの保証
 * @graph-connects none
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  SCRAPE_ADAPTERS,
  dispatchScrape,
  notImplementedAdapter,
  registerScrapeAdapter,
} from "./dispatcher.js";
import type { ScrapeAdapter } from "./types.js";

const RESET: Record<string, ScrapeAdapter> = {
  search: SCRAPE_ADAPTERS.search,
  retweets: SCRAPE_ADAPTERS.retweets,
  quotes: SCRAPE_ADAPTERS.quotes,
};

afterEach(() => {
  // test で差し替えた adapter を default に戻す
  SCRAPE_ADAPTERS.search = RESET.search;
  SCRAPE_ADAPTERS.retweets = RESET.retweets;
  SCRAPE_ADAPTERS.quotes = RESET.quotes;
});

describe("notImplementedAdapter", () => {
  it("throws explicit 'not implemented' error", () => {
    expect(() => notImplementedAdapter({ graphqlJson: {} })).toThrow(/not implemented/);
  });
});

describe("SCRAPE_ADAPTERS table", () => {
  it("has entries for all current ScrapeKind values", () => {
    expect(Object.keys(SCRAPE_ADAPTERS).sort()).toEqual(["quotes", "retweets", "search"]);
  });

  it("retweets / quotes are still notImplemented (Phase 5b baseline)", () => {
    expect(SCRAPE_ADAPTERS.retweets).toBe(notImplementedAdapter);
    expect(SCRAPE_ADAPTERS.quotes).toBe(notImplementedAdapter);
  });

  it("search is no longer notImplemented (Phase 5b)", () => {
    expect(SCRAPE_ADAPTERS.search).not.toBe(notImplementedAdapter);
  });
});

describe("dispatchScrape", () => {
  it("delegates to the registered adapter for the given kind", () => {
    const fakeAdapter: ScrapeAdapter = (input) => ({
      source: `scrape:test:${(input.context?.tag as string) ?? ""}`,
      nodes: [],
      edges: [],
    });
    registerScrapeAdapter("search", fakeAdapter);
    const r = dispatchScrape("search", { graphqlJson: {}, context: { tag: "abc" } });
    expect(r.source).toBe("scrape:test:abc");
  });

  it("throws not-implemented for kinds whose adapter is the default", () => {
    expect(() => dispatchScrape("retweets", { graphqlJson: {} })).toThrow(/not implemented/);
  });

  it("throws Unknown ScrapeKind when adapter table has no entry for the given kind", () => {
    expect(() => dispatchScrape("nonexistent" as never, { graphqlJson: {} })).toThrow(
      /Unknown ScrapeKind/,
    );
  });
});

describe("registerScrapeAdapter", () => {
  it("replaces the table entry idempotently", () => {
    const a1: ScrapeAdapter = () => ({ source: "a1", nodes: [], edges: [] });
    const a2: ScrapeAdapter = () => ({ source: "a2", nodes: [], edges: [] });
    registerScrapeAdapter("quotes", a1);
    expect(dispatchScrape("quotes", { graphqlJson: {} }).source).toBe("a1");
    registerScrapeAdapter("quotes", a2);
    expect(dispatchScrape("quotes", { graphqlJson: {} }).source).toBe("a2");
  });
});
