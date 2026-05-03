# 17 MCP Servers thread (Week 1 旗艦の1つ)

- 元記事: https://dev.to/ryosuke_tsuji_f08e20fdca1/we-built-17-mcp-servers-to-let-ai-run-our-internal-operations-3lk2
- 投稿目標: 2026-05-03 JST 20:00-22:00 (= US ET 7:00-9:00 Sunday morning, DST)
- 構成: 5本 chain (1 → 2 → 3 → 4 → 5、各 reply は **直前** tweet 宛)
- 文字数: 全て 280字以内 (note_tweet 不使用、API で post 可能)
- Tweet 2/3 は元の long-form 版を 280字に圧縮。意図は保持。

## 投稿後の流れ

1. 投稿完了したら 5本の tweet ID を取得
2. `threads/posted/2026-05-03-17mcp.md` に投稿後 metadata 書き出し
3. `operations/log.md` に追記
4. 30分後 / 1時間後 / 24時間後の analytics 取得 → `analytics/daily/2026-05-03.md`
5. Active engagement: 投稿後 30分は他人の post に質的 reply 1-2 本

---

## Tweet 1/5

```
1/ Built 17 MCP servers in 3 months to give AI access to our entire internal operations.

Not "AI assists with operations"—AI runs slices of them. Databases, infrastructure, CI/CD, observability, project management, code editing, even deployment for non-engineers.

🧵
```

## Tweet 2/5 (圧縮版)

```
2/ Why 17 servers instead of one monolithic? Three reasons:

— Auth scope isolation: GWS needs Workspace scopes; DB query doesn't
— Deploy independence: Grafana changes don't break DB queries
— Per-user: engineers add all, marketing only GWS

Small servers, narrow scopes.
```

## Tweet 3/5 (圧縮版)

```
3/ The count matters less than the foundation.

One OAuth lib (PKCE + RFC 8414 auto-discovery) means new servers add ~10 lines. Upstash Redis as shared session store—one login, all servers. Tool calls logged to BigQuery via shared package.

Boring infra, fast iteration.
```

## Tweet 4/5

```
4/ Most underrated lesson: start read-only.

GCloud, AWS, Git—all read-only first. Writes get added explicitly with per-user ACLs in Firestore. Path traversal blocked by regex. SQL validator + DB GRANT layer for queries.

The security conversation stays manageable this way.
```

## Tweet 5/5

```
5/ Built solo, alongside running the company as CTO. The "AI infrastructure as building blocks" available in 2026 (MCP, Claude Code, Cloud Run) makes this kind of system tractable for individuals now.

Full writeup with architecture diagrams:
https://dev.to/ryosuke_tsuji_f08e20fdca1/we-built-17-mcp-servers-to-let-ai-run-our-internal-operations-3lk2
```
