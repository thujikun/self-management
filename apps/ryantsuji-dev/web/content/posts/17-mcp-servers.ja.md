---
title: "社内業務をAIに開放 — 自社MCPサーバー群一挙公開！"
publishedAt: "2026-04-07"
updatedAt: "2026-04-28"
slug: "17-mcp-servers"
summary: "airCloset で 3 ヶ月で構築した 17 個の社内 MCP サーバー一挙公開。DB / インフラ / Docs / PM / Observability / CI まで AI に開放。"
tags:
  - "ai"
  - "gcp"
  - "typescript"
  - "mcp"
  - "claude"
lang: "ja"
syndication:
  zenn:
    id: "d9fc317c1336c2"
  devto:
    id: 3467141
    slug: "we-built-17-mcp-servers-to-let-ai-run-our-internal-operations-3lk2"
---

## はじめに

前回の記事で、全社17DB・994テーブルを安全に横断検索・クエリ実行できる「DB Graph MCP」を紹介しました。

https://zenn.dev/aircloset/articles/2731787582881a

ありがたいことに反響をいただいたので、今回は **DB Graph 以外に社内で運用している MCP サーバー群** をまとめて紹介します。

これらは2026年1月から約3ヶ月で構築したもので、現在社内で稼働している MCP サーバーは DB Graph を含めて **17個**。DB、インフラ、ドキュメント、プロジェクト管理、Observability、CI/CD、さらには非エンジニアによるコード修正・デプロイまで、社内業務と、かなり幅広い全領域をAIから操作できる状態になっています。

## 全体像

まず全サーバーの一覧です。

| カテゴリ | サーバー | 説明 |
|---------|---------|------|
| **データ** | DB Graph | [全社DB辞書 + 実DBクエリ（前回記事）](https://zenn.dev/aircloset/articles/2731787582881a) |
| **インフラ** | GCloud | GCPリソース read-only 参照 |
| | AWS | AWSリソース read-only 参照 |
| **ドキュメント・ナレッジ** | GWS | Google Workspace全サービス操作 |
| | Git Server | 全社Gitリポジトリ read-only 参照 |
| **グラフ** | Code Graph | コードベース解析（関数→API→DB→イベントの依存追跡） |
| | Product Graph | code + DB + docs 統合ナレッジグラフ |
| | Biz Graph | [施策×指標の関連性グラフ](https://zenn.dev/aircloset/articles/7a0b06cb2a35d8) |
| **可観測性** | Grafana | ログ・メトリクス・アラート参照 |
| **CI/CD** | CircleCI | パイプライン実行・ビルドログ・テスト結果 |
| **プロジェクト管理** | Project Management | BQ/Firestore/Sheets連携のPM支援 |
| **業務特化** | Stylist Insights | スタイリスト パフォーマンス・KPIデータ |
| | UX Insights | UX分析用BQ集計データ |
| | freee | freee API連携 |
| **開発基盤** | Workspace | 社内モノレポのACL付き編集・デプロイ |
| | Sandbox | [非エンジニア向けアプリデプロイ](https://zenn.dev/aircloset/articles/65efe9614f8e73) |

これらは全て **TypeScript で実装**され、**Pulumi で GCP にデプロイ**され、**Google OAuth で認証**されています。

## 設計思想

### なぜこんなに分けたのか

1つの巨大な MCP サーバーに全機能を詰め込むこともできますが、あえてサーバーを分けています。理由は：

- **認証スコープの分離** — GWSサーバーにはWorkspace APIのスコープが必要だが、DBクエリサーバーには不要。スコープを最小限にすることで権限の暴発を防ぐ
- **デプロイ独立性** — Grafanaサーバーの変更がDBクエリに影響しない。障害の爆発半径を小さくする
- **ユーザーごとの選択** — エンジニアは全部入れるが、マーケチームはGWSだけ、のように必要なものだけ `.mcp.json` に追加すればいい

### 共通基盤

全サーバーに共通するパターンがあります。

**認証**: 共通パッケージで Google OAuth 2.0 + PKCE を実装。RFC 8414 の自動検出に対応しており、`.mcp.json` に URL を書くだけで Claude Code が自動的に認証フローを開始します。ビジネスサイド向けにはClaudeの組織設定で社内向けにカスタムコネクタとして追加するだけです。

```json
{
  "mcpServers": {
    "server-name": {
      "type": "http",
      "url": "https://mcp-xxx.your-domain.example/mcp"
    }
  }
}
```

これだけ。`auth` ブロック不要。全サーバーでこの形式です。

**セッション管理**: Upstash Redis で全サーバー共通のセッションストア。SSO Cookie により、1回ログインすれば全サーバーにアクセスできます。

**ツール利用ログ**: 全ツール呼び出しを BigQuery に記録しています。誰がいつ何のツールを使ったかが全て追跡可能。利用率やエラー率、使われ方を見て改善サイクルを回しています。

## インフラ系: GCloud / AWS

みなさん、Cloud環境の調査をAIにやらせたいと思ったこと、もしくはやったことはありませんか？

そして同時に思ったはずです。**「それやらせて大丈夫か？」** と。

私の場合、管理者権限まで持っていたりするのでなおさら怖い。というわけで **絶対に参照しかできない MCP** を作成しました。

こだわりポイントは2つ：
1. **OIDC / STS / Impersonate を使ったセキュアな認証** — 永続的な credentials は一切使わない
2. **アカウント別に必ずログが残る** — GCP Audit Log / CloudTrail に個人のメールアドレスが記録される

### GCloud MCP

```
Claude Code → MCP Server → gcloud CLI subprocess → GCP APIs
```

`gcloud` CLI を Cloud Run 上で実行します。ポイントは **OAuth スコープで書き込みを原理的に不可能にしている** こと。

- OAuth スコープ: `cloud-platform.read-only`
- GCP API はスコープと IAM の **両方** をチェックするため、ユーザーが管理者権限を持っていても書き込み不可
- GCP Audit Log にユーザーのメールアドレスが記録される
- 退職時は Google Workspace アカウント無効化で自動失効

```
# こんなことができる
「prod の Cloud Run サービス一覧を見せて」
「このサービスの環境変数を確認して」
「Secret Manager のシークレット一覧を出して」
```

### AWS MCP

GCloud と同じ思想ですが、AWS は Google OAuth を直接受けられないため、間に STS を挟みます。

```
Claude Code → MCP Server → GCPメタデータ → ID Token
                         → AWS STS AssumeRoleWithWebIdentity → 一時credentials
                         → aws CLI subprocess → AWS APIs
```

**2層の安全装置**:
1. IAM Role に `ReadOnlyAccess` ポリシーのみアタッチ
2. 一時 credentials の有効期限（1時間）

マルチAWSアカウントにも対応しています。`profile` パラメータでアカウントを切り替えられ、CloudTrail には `assumed-role/mcp-aws-readonly/user@example.com` の形式で記録されます。

## ドキュメント・ナレッジ系: GWS / Git Server

### GWS (Google Workspace) MCP

Google Workspace の **全サービス** を Claude Code から操作できるサーバーです。

```
Claude Code → MCP Server → gws CLI subprocess → Google Workspace APIs
```

[gws CLI](https://github.com/nicholasgasior/gws) をリモート実行する構成。ユーザーの OAuth アクセストークンをそのまま渡すので、**各自の権限でアクセス**します。自分のDriveは見えるが、他人のDriveは見えない。

OAuth認証と同時にGoogle Workspaceの認可も通るので、**MCP に接続した時点で自分のWorkspaceリソースに即座にアクセスできる**のが体験として良いところです。追加のログインやトークン設定は一切不要。

```
# こんなことができる
「このスプレッドシートの売上データをまとめて」
「先週のカレンダーから会議の議事録を抽出して」
「このドキュメントの内容を要約して」
```

### Git Server MCP

全社 Git リポジトリを **read-only** で参照するサーバーです。

作った動機は **GitHub MCP のレートリミット回避** です。GitHub の公式 MCP サーバーは内部的に GitHub API を叩くため、レートリミットに縛られます。AIにコードベースを調査させると驚くほどあっという間に上限に達して使い物にならなくなる。

Git Server MCP は GCE VM 上で全リポジトリの main ブランチクローンを保持しており、**ローカルの git コマンドで操作するためレートリミットが一切ない**。いくらでもクエリできます。

| ツール | 説明 |
|--------|------|
| `git_blame` | 各行の最終変更コミットを取得 |
| `git_log` | コミット履歴 |
| `git_grep` | リポジトリ横断テキスト検索 |
| `git_show` | コミット詳細 |
| `git_diff` | コミット間の差分 |
| `read_file` | ファイル読み取り |
| `list_files` | ファイル一覧 |
| `search_repos` | リポジトリ検索 |

GitHub アカウントがなくても、OAuth 認証さえ通ればコードを読めます。

## Observability: Grafana MCP

公式 `mcp/grafana` Docker イメージを Cloud Run にデプロイし、OAuth プロキシを前段に置く構成。

```
Claude Code → OAuth Proxy → mcp-grafana → Grafana Cloud
```

PromQL / LogQL クエリ、ダッシュボード参照、アラートルール確認などが可能です。

ここで重要なのは、Grafana のダッシュボードやアラートルール自体もリポジトリ内で **Pulumi (TypeScript)** として定義されていること。つまり：

1. アプリケーションコードを書く
2. そのアラートルールも同じリポジトリで定義する
3. 本番でアラートが発火する
4. Claude Code が Grafana MCP でログを読む
5. 同じリポジトリのコードを修正する

**コード → インフラ → 可観測性 → 調査 → 修正** のループが完全に閉じています。

## CI/CD: CircleCI MCP

CircleCI API v2 と連携するサーバー。共有 CircleCI トークンを Google SSO 認証の背後に配置し、チーム全員がトークン管理なしで利用可能。

```
Claude Code → OAuth Proxy → CircleCI MCP (sidecar) → CircleCI API v2
```

Cloud Run のマルチコンテナ構成で、公式 `@circleci/mcp-server-circleci` をサイドカーとして動かし、前段に OAuth プロキシを置いています。

```
# こんなことができる
「mainブランチの最新パイプラインのステータスを教えて」
「このビルドの失敗ログを見せて」
「フレーキーテストを検出して」
```

## プロジェクト管理: Project Management MCP

Firestore の課題管理操作と、Slack・Meet の会話をセマンティック検索できるサーバーです。

主な機能：
- **課題管理**: Firestore 上の Issue の作成・ステータス更新・一覧取得（スプレッドシート dual-write 付き）
- **コンテキスト検索**: Meet の会議メモや Slack の会話を **ベクトル検索 + Gemini 要約** で横断検索
- **プロジェクト概要**: 担当プロジェクトのマイルストーン・メンバー・設計書・テストケースの参照
- **Backlog 連携**: チケットの親子関係を BQ 経由で取得

## 業務特化系

### Stylist Insights / UX Insights MCP

それぞれスタイリストのパフォーマンス・KPIデータ、UX分析用の集計データにアクセスするサーバー。BQ の集計テーブルに対するクエリインターフェースを提供します。

### freee MCP

freee API に OAuth 認証付きで接続するプロキシサーバー。会計データの参照に使います。

## 開発基盤: Workspace / Sandbox

ここが一番ユニークなところかもしれません。

### Workspace MCP — GitHub アカウント不要のコード編集

社内モノレポの **ACL 付きファイル編集・コミット・PR作成・デプロイ** を提供するサーバーです。

**GitHub アカウント不要**。Google Workspace アカウント（OAuth）のみで利用可能です。

```
1. workspace_init          → worktree 作成、ブランチ初期化
2. workspace_write_file    → コード編集
3. workspace_diff          → 変更確認
4. workspace_commit        → コミット
5. workspace_push          → GitHub に push
6. workspace_deploy        → feature ブランチからデプロイ（テスト）
7. 動作確認 OK
8. workspace_create_pr     → レビュー依頼
```

アクセス制御は Firestore で管理。管理者が各ユーザーに対して **編集・デプロイ可能なスタック（ディレクトリ）** を設定します。

```json
{
  "allowedPaths": ["apps/web/xxx/", "apps/api/xxx/"],
  "allowedStacks": ["api-xxx", "pages-xxx"],
  "role": "developer"
}
```

これにより、非エンジニアでも **自分に許可されたスタックだけを安全に編集・デプロイ** できます。実際に、非エンジニアのメンバーが AI + Workspace MCP でフルスクラッチのKPIダッシュボードの改善を行っています。

### Sandbox MCP — 非エンジニアのアプリデプロイ

さらに踏み込んで、**非エンジニアが自分のアプリを社内公開** できるサーバーです。

```
1. sandbox_init_repo(app_name: "my-tool")    → リポジトリ初期化
2. sandbox_write_file(...)                    → ファイル書き込み
3. sandbox_publish(app_name: "my-tool")       → Cloud Run デプロイ
   → https://sbx-{nickname}--my-tool.example.com/
```

gcloud も Docker も不要。Claude に「こういうツールが欲しい」と言うだけで、アプリが社内URLで公開されます。

公開されたアプリは **Cloudflare Access で Google Workspace 認証** がかかるため、社内メンバーだけが安全にアクセスできます。インターネットに公開されていても組織外からはアクセス不可能です。
詳細は[こちら](https://zenn.dev/aircloset/articles/65efe9614f8e73)にまとめています。

## グラフ系: Code Graph / Product Graph / Biz Graph

コードベースやビジネスロジックをグラフ構造で解析するサーバー群です。

| サーバー | 対象 | 特徴 |
|---------|------|------|
| DB Graph | [全社DB（前回記事）](https://zenn.dev/aircloset/articles/2731787582881a) | テーブル辞書 + セマンティック検索 + 実DBクエリ + PII匿名化 |
| Code Graph | 全社のソースコード（複数リポジトリ横断） | 静的解析で関数→API→DB→イベントの依存をリポジトリをまたいで追跡 |
| Product Graph | 社内モノレポ全体 | code + DB + docs を統合したナレッジグラフ。全ノードにビジネスコンテキスト付き |
| Biz Graph | [ビジネス施策と指標](https://zenn.dev/aircloset/articles/7a0b06cb2a35d8) | 施策×指標の関連性グラフ |

それぞれ設計思想が異なり、解決する課題も違います。DB Graphは[前回記事](https://zenn.dev/aircloset/articles/2731787582881a)、Biz Graphは[こちらの記事](https://zenn.dev/aircloset/articles/7a0b06cb2a35d8)で詳しく紹介しています。

## セキュリティモデル

全サーバーに共通するセキュリティの考え方を整理します。

### 多層防御

```
Layer 1: Google Workspace OAuth + ドメイン制限
  → 組織ドメインのみ。組織外はログイン不可

Layer 2: SSO + セッション管理
  → Upstash Redis、7日TTL、スライディングウィンドウ

Layer 3: サーバーごとのスコープ制限
  → GCloud: cloud-platform.read-only
  → AWS: ReadOnlyAccess ポリシー
  → DB Graph: SELECT のみ + PII匿名化

Layer 4: データレベルの保護
  → PII自動匿名化（40+カラムパターン）
  → 機密データセットは BQ IAM で制御
  → 本番DBはリードレプリカのみ

Layer 5: 監査ログ
  → 全ツール呼び出しを BQ に記録
  → GCP Audit Log / CloudTrail に個人メール記録
```

### 退職時の自動失効

全サーバーが Google OAuth に依存しているため、**Google Workspace アカウントを無効化するだけで全MCPへのアクセスが自動失効** します。個別のトークン失効やアカウント削除は不要です。

## まとめ

自社 MCP サーバーを開発・運用して得た知見をまとめます。

**1. 認証は共通化すべき**
OAuth の実装を共通パッケージにしたことで、新しいサーバーの追加が圧倒的に楽になりました。認証まわりのコードは各サーバーで10行程度です。

**2. read-only から始める**
GCloud / AWS / Git Server はすべて read-only です。まず読み取りだけ許可し、本当に必要になったら書き込みを追加する。このアプローチでセキュリティの議論がシンプルになります。

**3. 既存ツールをラップする**
gcloud CLI、aws CLI、gws CLI、CircleCI MCP — 既存のCLIやMCPサーバーを OAuth プロキシの背後に置くだけで、チーム全員が安全に使えるようになります。ゼロから作る必要はありません。

**4. 非エンジニアへの開放が一番楽しみ**
Workspace MCP と [Sandbox MCP](https://zenn.dev/aircloset/articles/65efe9614f8e73) により、GitHub アカウントを持たないメンバーでもコードを修正しデプロイできる基盤が整いました。まだ作ったばかりで大きな成果はこれからですが、ここが一番ポテンシャルがあると思っています。

**5. 全てを同じリポジトリで管理する**
アプリケーション、インフラ（Pulumi）、可観測性（Grafana アラートルール）、MCP サーバー、全てが1つのモノレポにあります。これにより「コードを書く → デプロイする → 監視する → 問題を見つける → 修正する」のループが完全に閉じます。

---

DB Graph MCP の記事で「テーブル間の繋がり方が特定の人の頭の中にのみ存在する」という課題を紹介しました。MCP サーバー群の全体像を見ると、これは DB に限った話ではないことがわかります。

**インフラの状態、コードの依存関係、ドキュメントの内容、プロジェクトの進捗、ユーザーの行動ログ** — これらすべてが「特定の人の頭の中」にある状態を解消するのが、MCP サーバー群の本質的な役割です。

知識をAIがアクセスできる形で外部化する。それが全MCPサーバーの共通テーマです。
