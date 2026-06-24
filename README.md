# World Cup 決勝トーナメント（日本時間 / JST）

BBC Sport の World Cup スケジュール（Knockout Stage）を取得し、キックオフ時刻を
**日本時間（JST）に変換した静的ページ**を生成します。
GitHub Actions が**約30分ごとに再生成→GitHub Pages へ自動デプロイ**するため、
BBC側の更新（対戦カード確定・スコア・日程変更）に追従します。

- データ元: <https://www.bbc.com/sport/football/world-cup/schedule>
- 配信: GitHub Pages（静的配信のため**アクセス数による課金は発生しません**）

## 仕組み

1. `build.js` が BBC のページを取得し、埋め込みJSON（`__INITIAL_DATA__`）から
   `knockoutStage` を抽出。
2. 各試合の UTC 時刻（`date.iso`）を `Intl.DateTimeFormat('Asia/Tokyo')` で JST に変換。
3. 自己完結した `public/index.html` を生成（外部CSS/JS依存なし）。
4. `.github/workflows/deploy.yml` が cron（`*/30 * * * *`）で上記を実行しPagesへデプロイ。

ブラウザから直接BBCを叩くとCORSで失敗するため、取得・変換はCI（サーバー側）で行います。

## ローカルで生成・確認

```bash
node build.js                 # public/index.html を生成
npx serve public              # もしくは: python3 -m http.server -d public 8000
```

## デプロイ手順（Cloudflare Pages）

GitHub Actions でビルドし、**Cloudflare Pages** へデプロイします。公開URLは
`https://<プロジェクト名>.pages.dev` となり、GitHub ユーザー名は出ません。

1. **プロジェクト作成（一度だけ）** — ローカルで:
   ```bash
   npx wrangler login                 # 既存の Cloudflare アカウントでログイン
   npx wrangler pages project create wc-knockout-jst --production-branch=main
   npx wrangler whoami                # Account ID を控える
   ```
2. **API トークン発行** — Cloudflare ダッシュボード → My Profile → API Tokens →
   Create Token → 権限 **Account · Cloudflare Pages · Edit** を付与。
3. **GitHub Secrets 登録** — リポジトリ Settings → Secrets and variables → Actions:
   - `CLOUDFLARE_API_TOKEN` … 手順2のトークン
   - `CLOUDFLARE_ACCOUNT_ID` … 手順1の Account ID
4. push すると Actions がビルド＆デプロイ。以降 push と30分ごとの cron で自動更新。

> プロジェクト名は `.github/workflows/deploy.yml` の `CF_PAGES_PROJECT` で変更可。
> 不要になったら Pages プロジェクトを削除すれば公開停止（＝一時的なURL）。
> リポジトリは private のままでも CI から問題なくデプロイできます。

## カスタマイズ

- 更新頻度: `.github/workflows/deploy.yml` の `cron` を変更（例: `*/10 * * * *`）。
  GitHub の cron は負荷により数分遅延・スキップされることがあります。
- 見た目: `build.js` 内の `<style>` を編集。
