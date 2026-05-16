# 🎨 図解プロンプトビルダー

**Nano Banana Pro 専用** — 文章を貼り付けてオプションを選ぶだけで、AI図解生成用の構造化プロンプトを自動作成できるWebツール。

## ✨ 機能

- **テキスト入力** — 図解にしたい文章を貼り付けるだけ
- **スタイル選択** — 手書き風 / ビジネス風 / ポップ / ミニマル
- **レイアウト選択** — 並列リスト / 比較図 / ステップ / 4象限 / サイクル / ピラミッド / お任せ
- **フォーマット選択** — 1:1 / 3:4 / 16:9
- **配色プリセット** — 16種類のカラーパレット + カスタムカラー
- **キャラクター画像アップロード** — ドラッグ＆ドロップ対応（最大5枚）
- **ペーストキュー** — 生成されたプロンプトを順番にコピーできるモバイル対応UI
- **3モードテーマ** — ライト / ダーク / 🌸桜モード（春限定）

## 🚀 使い方

### ローカルで開く

`index.html` をブラウザで開くだけで使えます。

### WordPress に埋め込む

```bash
node build-wp.js
```

`wordpress-embed.html` が生成されます。HTML / CSS / JS を1ファイルに統合した自己完結型のファイルです。

## 📁 ファイル構成

| ファイル | 説明 |
|---------|------|
| `index.html` | メインHTML |
| `index.css` | スタイルシート |
| `app.js` | アプリケーションロジック |
| `build-wp.js` | WordPress埋め込み用ビルドスクリプト |
| `sakura-petal.svg` | 桜モード用花びらSVG |
| `sakura-petal-base64.txt` | Base64エンコード済み花びらデータ |

## 🛠️ 技術スタック

- HTML / CSS / JavaScript（フレームワーク不使用）
- レスポンシブデザイン対応
- ダークモード & 桜モード対応

## 🔐 中央認証API (Phase 1)

`/api/me` は Vercel + Supabase で動作し、LIFF access token を検証して LINE userId とプラン情報を返します。

### 環境変数

`.env.example` を `.env.local` にコピーし、Vercel の Project Settings → Environment Variables にも同じものを登録してください。

| キー | 用途 |
|---|---|
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（**絶対にコミット禁止 / クライアント露出禁止**） |
| `LINE_CHANNEL_IDS` | LIFFアプリが紐付く LINEログインチャネルIDをカンマ区切り |
| `ALLOWED_ORIGINS` | クロスオリジン呼び出しを許可するオリジンをカンマ区切り |
| `LOG_LEVEL` | `info` / `debug` |

### Supabase スキーマ適用

1. Supabase でプロジェクト作成（リージョン: `ap-northeast-1` 推奨）
2. SQL Editor で `supabase/migrations/0001_phase1_auth.sql` を実行
3. Service Role キーを `SUPABASE_SERVICE_ROLE_KEY` に設定

### Vercel デプロイ

```bash
npm install
vercel deploy
```

### 手動でプランを昇格させる

```sql
-- 'Uxxxx...' の部分は実際の line_user_id (auth_audit_log や subscriptions から確認)
update subscriptions
set plan = 'pro',
    expires_at = '2026-12-31 23:59:59+09'
where line_user_id = 'Uxxxx...';

-- タグを付ける場合
insert into user_tags (line_user_id, tag) values ('Uxxxx...', 'beta')
on conflict (line_user_id, tag) do nothing;
```

ユーザーがアプリを再読み込みすれば、次回 `/api/me` で新しいプランが返ります。

### ローカル動作確認

```bash
# Vercel CLI でローカルサーバ起動
vercel dev

# 別ターミナルで実トークンを使って疎通確認 (LIFFモバイルで liff.getAccessToken() をコンソール出力して取得)
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/me
```

`localhost` で `index.html` を直接開いた場合は LIFF と `/api/me` をスキップし、擬似プロファイル (`plan='pro'`) でアプリ本体が起動します。

## 📝 ライセンス

MIT
