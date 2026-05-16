---
title: "非エンジニアの「作りたい」と「安全に公開したい」を両立する Sandbox MCP を作った"
publishedAt: "2026-04-27"
updatedAt: "2026-05-16"
slug: "sandbox-mcp"
summary: "AI で作れるようになった非エンジニアのアプリを、Web/API/DB/Cron 込みで 1 コマンドで社内公開できる Sandbox MCP の設計。"
tags:
  - "ai"
  - "typescript"
  - "mcp"
  - "cloudflare"
  - "claude"
lang: "ja"
syndication:
  zenn:
    id: "65efe9614f8e73"
  devto:
    id: 3559369
    slug: "bridging-i-want-to-build-and-i-want-to-publish-safely-for-non-engineers-sandbox-mcp-392a"
---

みなさまこんにちは！エアークローゼットでCTOをしている[辻](https://x.com/RyanAircloset)です。

これまでに [DB Graph MCP](https://zenn.dev/aircloset/articles/2731787582881a)、[社内MCP群の全体像](https://zenn.dev/aircloset/articles/d9fc317c1336c2)、[Biz Graph MCP](https://zenn.dev/aircloset/articles/a820ce302ec5e9) と、社内向けに作っている MCP サーバーを順に紹介してきました。

今回はその中でもちょっと毛色が違うものを取り上げます。**Sandbox MCP** ── 非エンジニアの社員が AI と一緒に作ったアプリを、**ワンコマンドで社内に安全に公開できる**プラットフォームです。

「Claude Code でアプリを作れるなら、それをそのまま社内に出せばいいじゃん」という話を、**安全に**実現する仕組みです。

## 背景：作るのは簡単になったが、公開は難しいまま

Claude Code をはじめとする AI コーディングエージェントの普及で、いま社内の景色が大きく変わりつつあります。

これまで「アプリを作る」と言うと、エンジニアの仕事でした。要件定義してデザインを起こして、フロントを書いてバックエンドを書いて DB を設計して、CI/CD を組んで本番にデプロイする ── 全部できる人が必要だった。

ところが今は、PdM やデザイナー、CS のメンバーが Claude Code に「こういう画面を作って」と話しかけて、その場でモックアップが立ち上がる時代です。エアークローゼットでも、

- 新規プロジェクトのモックアップ
- 調査結果をビジュアル化したインタラクティブなレポート
- チーム内だけで使う KPI ダッシュボード
- 業務効率化のためのちょっとしたツール

こういった**非エンジニアからのアウトプット**が、確実に増えてきています。「とりあえずこれで運用してみよう」という話まで出るようになった。

ところが、ここで大きな壁にぶつかります。

### 作るのは簡単。でも、安全に公開するのは難しい

ローカルで動くものを作るのは、AI のおかげで誰でもできるようになりました。`python -m http.server 8000` で立ち上げて自分の Mac で見るところまでは、5 分もかからない。

でも「これチームに見せたい」「他の人に触ってもらいたい」となった瞬間、ハードルが一気に上がります。

- **どこで動かす？** クラウドにデプロイするなら GCP / AWS のアカウント・権限・課金。
- **URL は？** ドメイン取得、DNS 設定、SSL 証明書、Cloudflare 設定。
- **認証は？** 社外秘情報を扱うなら社員限定にしたい。OAuth 実装、社内ドメイン制限。
- **データは？** localStorage で十分？ それとも DB が要る？ DB 立てるならパスワード管理は？
- **デプロイは？** Docker 書ける？ Cloud Run の設定、環境変数、SA、IAM。
- **セキュリティは？** AI が書いたコードに脆弱性があったら？ 認証バイパスがあったら？

これらを「**全部 AI に書かせる**」ことは原理的にはできます。ただし出来上がりは **AI 任せ**。Cloudflare の設定が間違っていて全世界に公開されていたとか、認証処理がバイパスされていたとか、本番 DB に書き込めるサービスアカウントが渡されていたとか ── そういう事故が起きるリスクは、AI がコードを書けば書くほど高まります。

非エンジニアが「ちょっと作ってみたい」と言ったときに、**作る側が責任を持つべきこと**と、**プラットフォームが標準で守るべきこと**を明確に分ける必要があるんです。

加えてもう1つ、地味だけど大事な問題があります。

### UI の一貫性とデータの混在

非エンジニアがそれぞれ独立にアプリを作ると、

- ある人は React、ある人は Vue、ある人は素の HTML
- ボタンのデザインも色もバラバラ
- ある人は localStorage、ある人は Google Sheets、ある人は Firebase

これが10アプリ20アプリと増えていくと、社内のツール群が**カオス**になります。利用者は「このツールはどこで作ってるんだっけ？」「このボタンはなんで他と挙動が違うの？」となる。

社内ツールであっても、**最低限の統一感**は欲しい。デザインも、データの置き場所も。

## Sandbox MCP — 「作る」と「公開」の間に立つプラットフォーム

そこで作ったのが **Sandbox MCP** です。

非エンジニアが Claude Code に「これ作って」と言うだけで、

1. UI Kit を使った統一デザインのアプリが生成され
2. ローカルで動作確認でき
3. ワンコマンドで `https://sbx-{nickname}--{app-name}.example.com/` にデプロイされ
4. Cloudflare Worker 上の自前 OAuth で社内 SSO が強制され
5. データは Firestore の専用 DB に分離して保存される

── ここまでが、AI とのチャット 1 セッション内で完結します。

「作った人」が責任を持つのは**機能**だけ。**公開のセキュリティ・データの分離・ドメインと SSL・認証**は、Sandbox MCP のプラットフォームが標準で担保します。

![System Overview](https://static.zenn.studio/user-upload/333f7e179c20-20260430.png)

### 規模感

| リソース | 内容 |
|---------|------|
| MCP ツール | 10 個（publish, status, schedule, list, delete, write_file, read_file, list_files, init_repo, unschedule） |
| 対応ランタイム | Python (Flask + gunicorn), Node.js, 静的 HTML/SPA, カスタム Dockerfile |
| URL | `sbx-{nickname}--{app-name}.example.com`（Universal SSL でカバー、ACM 不要） |
| 認証 | Cloudflare Worker 上で動かす自前 OAuth (Google Workspace `@air-closet.com`) |
| データ | Firestore named DB `sandbox` に nickname × app 単位で名前空間分離 |
| インフラ | 自前 Git Server (GCE) + Cloud Run + Cloudflare Worker + KV |
| デプロイ時間 | 通常 2〜5 分（git push 〜 公開 URL 反映まで） |

ここからは、Sandbox MCP の中身を順に見ていきます。

## できること — Web、API、DB、定期実行まで

Sandbox MCP は「とりあえず社内に出したい」を網羅できるよう、4 種類のアプリ形態に対応しています。

| 種別 | 判定 | 用途 |
|---|---|---|
| **Python** | `.py` ファイルあり | Flask + gunicorn でAPI、画面付き分析ツール |
| **Node.js** | `package.json` あり | Express で API + 画面、Bun も可 |
| **静的 HTML/SPA** | `.html` のみ（Python/Node なし） | nginx で配信、React/Vue dist 対応 |
| **カスタム** | `Dockerfile` を含める | 任意のランタイム（Go、Rust、Bun、何でも可） |

このどれかであれば、追加の設定なしに `sandbox_publish` 一発でデプロイされます。

さらに、`sandbox_schedule` を使えば **Cloud Scheduler に乗ったバッチアプリ**も同じ仕組みで動かせます。「毎朝 9 時に Slack へリスクサマリーを投げる」みたいなものを、ボタン1つで cron 化できる。

```
sandbox_schedule(
  app_name: "risk-alert",
  schedule: "0 9 * * *",
  path: "/api/cron",
  timezone: "Asia/Tokyo"
)
```

これで Cloud Scheduler がアプリの `/api/cron` を毎朝 9 時に叩いてくれます。スケジューラの設定 UI を開く必要も、cron 文法を IaC に書き起こす必要もありません。

## フロントエンド — sandbox-ui-kit による統一デザイン

非エンジニアが作ったアプリでも、**社内のツール群として一貫性を持たせたい**。これを担うのが `sandbox-ui-kit` リポジトリです。

`mcp-sandbox.example.com/git` 上に専用リポジトリを置いてあり、以下を提供しています。

| ファイル | 内容 |
|---|---|
| `sandbox-ui.css` | デザイントークン + glass morphism コンポーネントスタイル（dark/light 対応） |
| `sandbox-ui.js` | テーマ切替・モーダル・トースト等の汎用 JS |
| `sandbox-db.js` | SandboxDB クライアント SDK（後述） |
| `index.html` | Storybook 形式の全コンポーネントカタログ |
| `README.md` | 全 API ドキュメント |

ポイントは、これを **AI が読んで活用する**ことを前提に設計していることです。

`sandbox_publish` ツールの description には次のように書いてあります。

> アプリ作成時はまず read_file で README.md を読み、UI Kit を活用すること。

Claude Code は新しいアプリを作るとき、`read_file` でこの README.md を取得し、自分のアプリにどの CSS/JS を読み込むべきか、どのコンポーネント名を使えばいいかを理解した上でコードを生成します。**人間が UI ガイドラインを口頭で説明する代わりに、AI 向けの「使い方」を一箇所に集約**しているわけです。

結果として、誰が（AI と）作ったアプリでも、ボタン・モーダル・フォームの見た目が揃います。

## バックエンド — 自動 Dockerfile 生成 + Cloud Run

「Docker は書きたくない」「ランタイムの設定を考えたくない」── これも非エンジニアの典型的な要望です。

Sandbox MCP は、**ソースファイルの種類を見て自動的に Dockerfile を生成**します。

```typescript
// apps/mcp/git-server/src/sandbox/tools.ts
if (hasPy) {
  dockerfile = generatePythonDockerfile(hasRequirements);
  // requirements.txt も自動生成（なければ）
  if (!hasRequirements) {
    await writeFile('requirements.txt', 'flask\ngunicorn\n');
  }
} else if (hasPackageJson) {
  dockerfile = generateNodeDockerfile(true);
} else if (hasHtml) {
  dockerfile = generateStaticDockerfile();
}
```

例えば Python アプリは

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
CMD ["python", "-u", "$(ls *.py | head -1)"]
```

が自動生成され、`requirements.txt` がなければ `flask` + `gunicorn` を勝手に入れてくれます。AI が `from flask import Flask` で始まるコードを書いても、依存ライブラリが解決されない事故は起きません。

Cloud Run へのデプロイは `gcloud run deploy --source` を使い、Cloud Build がイメージを焼いてくれます。アプリ作者は `Dockerfile` を**書いてもいいし書かなくてもいい**。書かなければ標準が当たる、書けばカスタムできる ── 非エンジニアにもエンジニアにも優しい設計です。

![Deploy Flow](https://static.zenn.studio/user-upload/d0069340db94-20260430.png)

## データベース — localStorage と Firestore の透過的フォールバック

「データを保存したい。でも DB の設定はしたくない。」

これに答えるのが **SandboxDB SDK** です。同じコードが、ローカルでは `localStorage`、デプロイ後は Firestore で動きます。

```html
<script src="https://mcp-sandbox.example.com/api/db/sdk.js"></script>
<script type="module">
  const db = new SandboxDB({ token: googleOAuthAccessToken });

  // 保存（どこに保存されるかは hostname で自動判定）
  const { id } = await db.collection('items').add({ name: 'test' });

  // 一覧
  const items = await db.collection('items').get();

  // 1件取得・更新・削除
  await db.collection('items').doc(id).update({ name: 'updated' });
  await db.collection('items').doc(id).delete();
</script>
```

SDK の中身はこうなっています。

```javascript
this._isLocal = location.hostname === 'localhost'
              || location.hostname === '127.0.0.1';

async add(data) {
  if (this._db._isLocal) return this._localAdd(data);  // localStorage
  return this._req('', 'POST', data);                  // Firestore REST API
}
```

`localhost` で動かしている間は localStorage を使い、`sbx-*.example.com` にデプロイされた瞬間に Firestore に切り替わる。**コード側は一切変更不要**です。

これによって、AI と一緒にアプリを開発するときの体験が劇的に良くなります。

- ローカル: ネットワーク不要・認証不要で全機能が動く
- デプロイ後: 同じコードがそのまま動き、データはちゃんと永続化される
- 開発時のデータが Sandbox 以外のシステムに混ざらない（物理的に届かない）

### Firestore の名前空間分離

デプロイ後のデータパスは厳密に分離されています。

```
sandbox_data/{nickname}--{app}/{collection}/{docId}
```

- `nickname`: OAuth で解決したユーザー識別子
- `app`: Sandbox アプリ名
- `_createdAt` / `_updatedAt`: SDK が自動付与

異なるアプリのデータには物理的に到達できません。同じ人が作った別のアプリ間でも、パスが違うので分離されます。

そして何より重要なのは、**Sandbox 用に `sandbox` という named database を切っている**こと。社内の他システムが使っている `(default)` DB とは完全に別の Firestore データベースです。Sandbox アプリのコードがどう暴走しても、Sandbox 以外のデータには絶対に触れない構造になっています。

## インフラ — Wildcard DNS + Cloudflare Worker + 自前 Git Server

ここからが Sandbox MCP のインフラ的な見どころです。

### URL の決まり方

公開 URL は

```
https://sbx-{nickname}--{app-name}.example.com/
```

の形式です。`nickname` は **MCP の OAuth セッションから自動取得**します。Sandbox MCP に Google でログインしたときの email から、Firestore の `users` コレクションを引いて nickname を解決する。利用者は「私は誰」を毎回入力する必要がありません。

```
r.tsuji@air-closet.com → users[r.tsuji@air-closet.com].nickname → "ryan"
                                                       ↓
                                  sbx-ryan--todo-app.example.com
```

> **補足**: `users` コレクションは別の社内パイプライン（HR システムや Google Workspace ディレクトリと連携した日次バッチ）で**事前に社員情報を Firestore に同期済み**です。Sandbox MCP 側はそれを参照するだけで、社員マスタを自前で持つ必要はありません。

これが効くのは、URL を見るだけで「誰のアプリか」が分かることです。チーム内で「ryan さんの todo-app 見て」と言うときに URL を読み上げると、自然に作者名が伝わる。社内のオーナーシップが明確になります。

### Cloudflare Worker による即時公開

新しいサブドメインを公開するとき、普通は以下が必要です。

1. DNS の A/CNAME レコードを追加
2. SSL 証明書を発行（ACM や Let's Encrypt で 15〜30 分待ち）
3. ロードバランサや DomainMapping の設定

Sandbox MCP はこれを全部スキップします。仕組みは Cloudflare の **Edge Router Worker** です。

![URL Routing](https://static.zenn.studio/user-upload/581144c2932b-20260430.png)

DNS は `*.example.com` に対する **wildcard** + Cloudflare proxy で固定されており、Universal SSL が自動で全サブドメインをカバーします。Cloudflare Worker が `*.example.com/*` の全トラフィックを受け、サブドメインに応じてルーティングします。

ロジックは 3 段階です。

```typescript
// apps/worker/edge-router/src/index.ts
export async function handleRequest(request, env) {
  const url = new URL(request.url);

  // ① sbx-* プレフィックス → Sandbox ルーティング
  const sandboxSub = extractSandboxSubdomain(url.hostname);
  if (sandboxSub !== null) {
    return handleSandboxRequest(request, url, sandboxSub, env);
  }

  // ② KV route:{subdomain} に登録済み → Cloud Run proxy
  const subdomain = extractSubdomain(url.hostname);
  if (subdomain) {
    const proxyResponse = await handleCloudRunProxy(request, url, subdomain, env);
    if (proxyResponse) return proxyResponse;
  }

  // ③ 上記以外 → fetch(request) でパススルー
  return fetch(request);
}
```

`sandbox_publish` のデプロイ完了時にやっていることは、**Cloudflare KV に `route:{nickname}/{app}` キーを書き込むだけ**。これで新しいサブドメインがその瞬間にルーティング可能になります。

```typescript
await kvPut(`route:${nickname}/${appName}`, serviceUrl);
```

DNS 設定なし、SSL 発行待ちなし、IaC デプロイなし。MCP ツールの実行中にすべてが完了します。

### 自前 Git Server で大規模アプリも push できる

実はこの仕組みは、当初は **git をまったく使わない** 設計で作り始めていました。

主なユーザーが PdM や CS などビジネスサイドの社員になることを想定していたので、「git の概念を覚えてもらうのはハードルが高い、MCP ツールだけで完結させよう」と考えていたんです。`sandbox_write_file` でファイルを書いて `sandbox_publish` でデプロイ ── これで全部済むはず、と。

ところがこのアプローチは、すぐに 2 つの壁にぶつかりました。

**壁 1: チャンク分割が頻発する**

MCP のツール呼び出しは HTTP リクエストで送られるため、1 回のペイロードサイズに上限があります。React/Vue でビルドしたバンドルや、画像を含む SPA、ファイル数が数十個ある業務ツールなどは、そのままだと送れない。`sandbox_write_file` の `append` モードでチャンク分割して送る運用にしたものの、AI が「ファイル A の前半 → ファイル A の後半 → ファイル B の前半 → ...」を繰り返すたびにエラー復旧やリトライが走り、デプロイが不安定になりました。

**壁 2: トークン消費が膨大**

これが本当の問題でした。AI に「このアプリをデプロイして」と頼むと、AI はソースコード全体を MCP ツールの引数として送ります。**ファイル内容がそのまま会話のコンテキストに乗る**ため、数千行のアプリだと一気にトークンを食い尽くす。デプロイ 1 回で数万トークン使うことも珍しくなく、Claude Code のセッションがあっという間に圧縮対象になります。

さらに、AI は「送ったあと、念のため確認」みたいな挙動で `sandbox_read_file` で同じファイルをまた読み返したりする。**書く・読む・書くを繰り返してトークンが燃えていく**わけです。

そこで方針転換して、**git push を併用する**設計に切り替えました。git push なら：

- ファイルサイズ制限なし
- 差分転送なので 2 回目以降は速い
- ソースコードが MCP の会話コンテキストに乗らない（AI のトークンを消費しない）

ビジネスサイドの社員が手で `git push` を叩く想定はないものの、**Claude Code が裏で git コマンドを実行する**のであればハードルにはなりません。利用者は「これ作って・公開して」と言うだけで、AI が必要に応じて `git init && git push` を勝手に走らせてくれる。

### なぜ自前の Git Server なのか

git push を採用するとなると、次は「どこにリポジトリを置くか」の問題です。GitHub の組織アカウントを使う案もありましたが、これも見送りました。

非エンジニアの社員も含めて**全員に GitHub アカウントを発行・管理する**のは、コスト的にも運用的にも割に合わない。1 アプリ作るだけのために GitHub のシート代を払うのは、明らかにオーバーキルです。

幸い、エアークローゼットでは別目的で **自前の Git Server を GCE 上に運用していました**。社内向けの「コード調査用 read-only Git MCP」をホストするための VM で、リポジトリを `/mnt/repos/` 配下にクローンしてある構成です。

ここに **Git Smart HTTP Protocol** のエンドポイントを足して、`sandbox-apps` リポジトリを 1 つ追加するだけで、Sandbox 用の git 受け口が完成しました。VM はもともと動いているので増分コストはほぼゼロ、認証は既存の Google OAuth 基盤に乗せられる、リポジトリ管理は OS のディレクトリ操作だけで済む。新規にインフラを立てるより、既存の社内 Git Server に間借りするほうが圧倒的にシンプルでした。

### 実際の利用フロー

```bash
# 1. MCP ツールで Git URL を取得（nickname は自動）
sandbox_init_repo(app_name: "my-app")
# → https://mcp-sandbox.example.com/git/sandbox/ryan/my-app.git

# 2. ローカルでコミット（AI が裏で実行）
cd ~/my-app/
git init && git add . && git commit -m "init"
git remote add sandbox <返された URL>

# 3. push
git push sandbox main
# Username: oauth2accesstoken
# Password: $(gcloud auth print-access-token)

# 4. デプロイ
sandbox_publish(app_name: "my-app", description: "...")
```

認証は Google OAuth トークンを Basic Auth のパスワードに乗せる方式（GCP Source Repos と同じパターン）。`@air-closet.com` 以外は通りません。GitHub アカウント不要で、社員なら誰でも push できます。

リモートリポジトリは `receive.denyCurrentBranch=updateInstead` で動作しているため、push と同時にサーバー側のワーキングツリーが更新されます。Cloud Run はこのディレクトリを `--source` として参照するので、push と publish の間に余計な手順は要りません。

なお、小さなアプリ（数ファイル・各数百行以下）であれば、引き続き `sandbox_write_file` 経由でも問題なくデプロイできます。**規模に応じて MCP 経由 / git push を使い分ける**設計です。

## セキュリティ — 4 つの独立したゲート

ここまでが「便利に作れる」話。ここからは「**安全に公開できる**」話です。

冒頭で書いた通り、AI に書かせたコードを人目に晒すのはリスクが高い。だからこそ Sandbox MCP は、**アプリの実装に依存せずに**安全性を担保する仕組みを四重に張っています。

![Security Layers](https://static.zenn.studio/user-upload/a5947d51b590-20260430.png)

### ① 公開画面のゲート — Cloudflare Worker 上の自前 OAuth

`sbx-*.example.com` は、**ルーティング用に動かしている同じ Cloudflare Worker が認証ゲートも兼ねる**構成にしています。利用者がアクセスすると、Worker がまず `cortex_session` Cookie を検証し、未認証なら Google Workspace SSO 開始用のエンドポイント（`auth.example.com/__edge/auth/start`）にリダイレクトします。`@air-closet.com` のアカウントでログインしないと Cloud Run に到達できません。

これは **アプリの実装に依存しません**。AI が認証処理を1行も書いていなくても、Worker が先に止めます。「うっかり公開」が物理的に発生しない構造です。

#### なぜ ZeroTrust Access から自前 OAuth へ移行したか

最初は **Cloudflare ZeroTrust Access** で同じことを実現していました。Cloudflare の管理画面で `@air-closet.com` ドメイン制限を設定するだけで終わるので、コードをいっさい書かずに SSO ゲートが立てられる ── 起動時の選択としては理想的でした。

ただ、**ZeroTrust の Free 枠は 50 ユーザー**です。利用社員数の増加と Sandbox MCP の利用拡大で枠が埋まりつつあり、Pay-as-you-go（約 $7/ユーザー/月）に切り替えると無視できないコストになります。そのため**人数制限のない自前 OAuth に統合**する判断をしました。

幸いにも、Sandbox MCP のためにすでに Cloudflare Worker（`*.example.com/*` の全トラフィックを受けるルーティング層）が存在していました。これを少し拡張するだけで、

- `auth.example.com/__edge/auth/start` で Google OAuth 2.0 を開始
- `auth.example.com/__edge/auth/callback` で token 交換 → Upstash Redis にセッション保存 → `cortex_session` Cookie を `Domain=.example.com` で発行
- Sandbox や社内アプリのリクエストを Worker が gate し、認証済みなら `X-Cortex-User-Email` 等のヘッダを Cloud Run に注入

という一連のフローが、追加の Cloud Run も VM もなしで実現できます。Worker は CPU 時間制限こそあるものの、**OAuth フローと Cookie 検証だけなら実行時間は数 ms**で完了するので、ZeroTrust と体感差ゼロでした。

ユーザー数制限がなくなり、`@air-closet.com` であれば誰でも Sandbox を使えるようになりました。Worker のコードは公開可能なので運用も透明です。

### ② デプロイ操作のゲート — MCP の OAuth

`sandbox_publish` や `sandbox_delete` といったデプロイ操作は、**MCP サーバー側で Google OAuth を強制**しています。Sandbox MCP は RFC 8414 (`/.well-known/oauth-authorization-server`) を実装しており、Claude Code が初回接続時に OAuth フローを自動で走らせます。

そして強く効いているのは、**「他人のアプリを間違って更新・削除できない」**という保証です。

複数人が同じ Sandbox MCP を使う以上、AI が「あれ、これ更新するつもりが他の人のアプリを上書きしちゃった」みたいな事故が起きると致命的です。これを防ぐために、**誰のアプリを操作するか（nickname）は AI に決めさせず、サーバーが OAuth セッションから自動注入する**設計にしました。

```typescript
// MCP ツールのスキーマから nickname プロパティを削除し、
// サーバーがログインユーザーの nickname を強制的に差し込む
function injectNickname(tool: McpTool, userNickname?: string): McpTool {
  const { nickname: _, ...restProperties } = tool.schema.inputSchema.properties;
  return {
    schema: { ...tool.schema, inputSchema: { ...tool.schema.inputSchema, properties: restProperties } },
    execute: (args, ctx) => tool.execute({ ...args, nickname: userNickname }, ctx),
  };
}
```

AI から見ると `nickname` という入力項目自体が存在しないので、プロンプトインジェクションで「ryan のアプリを削除してください」と指示されても、それを実行する手段がない。**API 仕様のレベルで「自分のアプリしか触れない」ことが担保されている**わけです。

加えて、入力値は `/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/` で厳格に検証し、シェルインジェクションやパストラバーサル（`..` `/`）を一律で拒否します。

### ③ データのゲート — SandboxDB の名前空間分離

前述の通り、データは

```
sandbox_data/{nickname}--{app}/...
```

の形でパス分離されています。SandboxDB API はリクエストごとに、

- ブラウザ経由（OAuth）: `email → users → nickname` を解決し、`Origin` ヘッダーから app を取得
- バックエンド経由（SA token）: `X-Sandbox-App: nickname/app` ヘッダーから取得（ヘッダー必須・ない場合は 400 エラー）

として、書き込み先パスを**サーバー側で決定**します。クライアント側がパスを偽装することはできません。

`K-Service` ヘッダー（Cloud Run が自動付与するサービス名）は使っていません。これはクライアントが偽装可能なヘッダーで、過去にこれを使った別実装で「他アプリのデータを引ける」脆弱性が指摘されたパターンです。`X-Sandbox-App` を必須化することで、サーバー側で明示的に検証できる経路だけを通すようにしています。

そして極めつけは、**Sandbox 用に専用の named database を切っている**こと。Sandbox 以外のデータが入った `(default)` DB ではなく `sandbox` という独立した Firestore データベースを使い、Cloud Run SA には IAM Condition で `sandbox` DB のみへのアクセスを許可しています。

```typescript
// infra/mcp/git-server/index.ts より
// roles/datastore.user に IAM Condition を付与:
//   resource.name == "projects/.../databases/sandbox" ||
//   resource.name.startsWith("projects/.../databases/sandbox/")
```

これによって、AI が書いたコードがどう間違っても、Sandbox 以外のデータには物理的に到達できません。

### ④ 実行権限のゲート — Cloud Run SA + IAM

すべての sandbox-* Cloud Run は **専用の共有 SA**（例: `sandbox-run`）で動きます。この SA に与えている権限は最小限です。

- `roles/logging.logWriter`（自分のログ書き込み）
- `roles/bigquery.jobUser` + `sandbox_logs` データセット限定の `bigquery.dataViewer`（自分のアクセスログを参照可能、それ以外の BQ データセットは一切不可）
- `roles/datastore.user`（IAM Condition で `sandbox` DB に限定）

与えていない権限。

- Sandbox 以外のデータが入った `(default)` Firestore へのアクセス
- 社内システムが業務利用している BQ データセットへのアクセス
- Secret Manager への直接アクセス
- 他の Cloud Run サービスの管理権限

つまり、**Sandbox アプリが本気で暴走しても、被害は `sandbox_data` と `sandbox_logs` に閉じる**。Sandbox の外には影響が出ません。

## ログ設計 — アプリが自分のアクセスログをクエリできる

Sandbox アプリも、運用上ログを見たいシーンが出てきます。「このページ何回見られた？」「誰がエラーに当たった？」とか。

そこで、Cloud Run のリクエストログを **Logging Sink で BigQuery に転送**しています。

```typescript
// infra/mcp/git-server/index.ts より
const sandboxLogSink = new gcp.logging.ProjectSink('sandbox-logs-sink', {
  destination: `bigquery.googleapis.com/projects/${projectId}/datasets/sandbox_logs`,
  filter: [
    'resource.type="cloud_run_revision"',
    'resource.labels.service_name:"sandbox-"',
    'logName:"run.googleapis.com%2Frequests"',
  ].join(' AND '),
  bigqueryOptions: { usePartitionedTables: true },
});
```

`sandbox_logs` データセットは **project owner のみアクセス可**な ACL で保護されており（remoteIp や User-Agent 等の PII が含まれるため）、Sandbox 用 SA には専用の `bigquery.dataViewer` を限定付与しています。

これで、アプリ側から自分のアクセスログを BigQuery で集計可能になります。「このアプリの先週の利用者数を Slack に投げる」みたいな運用を、Sandbox 内で完結できる。

## ツール設計 — AI に「正しく使ってもらう」工夫

最後に、Sandbox MCP のツール定義の話を少しします。MCP の本質的な勝負どころは、ここにあると個人的には思っています。

Sandbox MCP は 10 個のツールを公開しています。

| ツール | 用途 |
|--------|------|
| `sandbox_publish` | デプロイ開始（非同期） |
| `sandbox_deploy_status` | デプロイ状況確認 |
| `sandbox_init_repo` | git push 用リポジトリ初期化 |
| `sandbox_write_file` | ファイル書き込み（overwrite/append） |
| `sandbox_list` | アプリ一覧 |
| `sandbox_delete` | アプリ削除 |
| `sandbox_schedule` | Cloud Scheduler 設定 |
| `sandbox_unschedule` | Cloud Scheduler 削除 |
| `sandbox_read_file` | ソースコード読み取り |
| `sandbox_list_files` | ファイル一覧 |

AI が「いま何のツールを呼ぶべきか」を正しく判断できるかは、**ツールの description に何を書くか**でほぼ決まります。

例えば `sandbox_publish` の description には、ツールの機能だけでなく以下を全部書いてあります。

- 対応アプリ種別と必要ファイル（Python / Node.js / 静的HTML / カスタム）
- 各種別での起動コマンドと PORT 要件
- ファイルの送り方の使い分け（write_file vs git push）
- SandboxDB の使い方（SDK のサンプルコード付き）
- UI Kit の使い方（read_file で README.md を取得して活用するよう明示）

この情報があるから、AI は

1. ユーザーが「Slack の絵文字スコアを表示するツール作って」と言う
2. → `sandbox_publish` の description で「UI Kit の README を先に読め」という指示を見る
3. → `read_file` で `sandbox-ui-kit/README.md` を取得
4. → ガイドラインに沿った HTML/CSS/JS を生成
5. → SandboxDB SDK の使い方も description に書いてあるのでデータ保存も組み込む
6. → `sandbox_publish` を呼ぶ

という流れを、ユーザーに何も追加質問せずに自分で組み立てられます。**「何ができるか」だけでなく「何をやるべきか」までツール定義に書く**のが、AI 向け設計のキモです。

逆に、ツール定義をそっけなく書きすぎると、AI は何度も人間に「次は何をすればいいですか？」と聞き返してきます。description は人間向けのドキュメントというより、**AI 向けの runbook** だと考えるとうまくいきます。

## まとめ

Sandbox MCP は、AI 時代の社内ツール開発における 2 つの課題に答えるために作りました。

- **作る**は AI で誰でもできるようになった
- **安全に公開する**は依然として難しいまま

このギャップを埋めるために、

- フロント / バックエンド / DB / インフラ / 認証 / 公開ドメイン / SSL の **全レイヤーをプラットフォーム側で標準化**
- AI が自然に正しい使い方をできるように **ツール description に runbook を埋め込み**
- 4 層のアクセスゲート（Worker 自前 OAuth / MCP OAuth / ns 分離 / IAM）で **「実装の正しさに依存しない」安全性** を担保

を実現しました。

作ってみて改めて感じるのは、**AI と一緒に開発する時代のプラットフォームの役割は変わってきている**ということです。これまでのプラットフォームは「人間に使いやすい」を目指していました。これからは「**AI に正しく使われる**」も目指す必要がある。ツールの description は AI 向けのドキュメントですし、安全性は「AI が間違ったコードを書く」前提で設計しないといけない。

そして同時に、**作る側の責任を限定する**ことで、「ちょっと触ってみる」のハードルを徹底的に下げる。これが、非エンジニアの「作りたい」気持ちを業務改善のアウトプットに変えていく入口になります。

次回は、ここまで紹介してきた MCP 群の上で実際に動いている社内 AI Bot の話を書こうと思っています。

この記事が、社内向けプラットフォームの設計に悩んでいる方の参考になれば嬉しいです。

---

私がCTOをしている株式会社エアークローゼットでは、AIと共に新しい開発体験を作り上げていくエンジニアを募集しています。興味のある方は、ぜひエンジニア採用サイト [エアクロクエスト](https://corp.air-closet.com/recruiting/developers/) をご覧ください！
