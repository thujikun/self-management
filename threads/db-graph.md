# DB Graph thread (Week 2 旗艦 #1)

- 元記事: https://dev.to/ryosuke_tsuji_f08e20fdca1/democratizing-internal-data-building-an-mcp-server-that-lets-you-search-991-tables-in-natural-1da5
- 投稿目標: 2026-05-05 (火) JST 20:00 = US ET 7:00 Tuesday morning, DST
- 構成: 5本 chain (1 → 2 → 3 → 4 → 5、各 reply は **直前** tweet 宛)
- voice 確認済: em-dash 0本 / 1人称 we 多用 / 具体数字 / 汎用praise なし / "isn't X — it's Y" なし
- Tweet 2,3,4,5 は 280字以内に収まることを確認済

## Tweet 1/5

```
991 tables. 15 schemas. Nobody in our company knew them all, including me. So we built an MCP server that lets anyone query them in natural language. Costs ~$10/month. Here's how 🧵
```

## Tweet 2/5

```
The hard part wasn't query execution. It was the dictionary. Schema relationships lived in specific people's heads, ORM definitions, scattered docs. We needed to materialize that knowledge so AI agents could navigate it without asking humans every time.
```

## Tweet 3/5

```
We separated knowledge from access. Dictionary tools (search, describe, trace relationships) are open to all engineers. Query tools (read prod data) require auth + PII auto-redact + Secret Manager passwords. Public knowledge, gated access.
```

## Tweet 4/5

```
Surprising part: we let Gemini generate descriptions for all 991 tables. Was it always right? No. So we layered human review on top, persisted in Firestore, and made it survive daily rebuilds. AI for first-pass coverage, humans for long-tail correctness.
```

## Tweet 5/5

```
All on a single BQ-backed graph. Zero static AWS creds (GCP OIDC → AWS STS → VPC Lambda). Variant detection means daily rebuild costs $0.10-0.20. Full writeup with the auth chain and PII pipeline:
https://dev.to/ryosuke_tsuji_f08e20fdca1/democratizing-internal-data-building-an-mcp-server-that-lets-you-search-991-tables-in-natural-1da5
```
