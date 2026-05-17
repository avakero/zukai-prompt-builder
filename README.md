# 🎨 図解ビルダーPRO MAX

**Nano Banana Pro 専用** — 文章を貼り付けてオプションを選ぶだけで、AI図解生成用の構造化プロンプトを自動作成できるWebツール。LINE公式アカウントの友だち限定で配布する LIFF アプリとして動作します。

## ✨ 機能

### 共通

- **テキスト入力** — 図解にしたい文章を貼り付けるだけ
- **スタイル選択** — 手書き風 / ビジネス風 / ポップ・コミック / ミニマル
- **レイアウト選択** — 並列リスト / 比較図 / ステップ進行 / 4象限マトリクス / サイクル図 / ピラミッド / お任せ（複合）
- **フォーマット選択** — 1:1 / 3:4 / 16:9
- **配色プリセット** — 16種類のカラーパレット + カスタムカラー + 「お任せ」
- **キャラクター画像アップロード** — ドラッグ＆ドロップ対応（最大5枚）。プロンプト内に「外見維持で登場させる」指示が自動付与され、ペーストキューにも画像が並ぶので Nano Banana Pro 側に順番に渡せます
- **ペーストキュー** — 生成されたプロンプト・画像を順番にコピーできるモバイル対応UI
- **テーマ切替** — ライト / 季節（自動切替）/ ダーク。季節テーマは月に応じて自動選択（🌸 桜 / 🌿 新緑 / 🌊 夏 / 🍁 紅葉 / ❄️ 冬）

### モード

| モード | 内容 |
|---|---|
| **単体** | 単一の図解プロンプトを生成 |
| **カルーセル** | カルーセル投稿用に複数スライド分のプロンプトをまとめて生成（スライドごとにキャラ画像が自動で挿入される） |

### カルーセルモード限定機能

- **AIでカルーセルJSON自動生成** — テーマや元文章を入れるだけで AI が構成（タイトル / スライド枚数 / トーン / 役割割当）を作成
  - プロバイダ: **Straico**（複数モデルを統一APIで利用）/ **Gemini 直接**
  - 投稿キャプション + ハッシュタグ（10〜15個）も同時生成
- **画像生成スタイルプリセット** — 手書き風 / フラットビジネス / ポップ＆カラフル / ミニマルモノクロ / インフォグラフィック / 黒板チョーク風 / カスタム
- **AIモデル選択** — `NanoBanana2`（Geminiベース）/ `GPT Image2`（OpenAIベース）
- **画像一括生成** — Pickaxe API 経由でスライド画像をまとめて生成（複数 deployment キーをローテーションして並列実行）
- **個別画像の再生成** — 失敗時や気に入らない時にスライド単位で再生成（モデル切替可）
- **投稿キャプション・ハッシュタグ管理** — 本文 / タグを分けてコピー、または一括コピー

### 認証・配布

- **LINE LIFF ログインゲート** — LINE公式アカウントの友だちのみ利用可能
- **`/api/me` 中央認証API** — LIFFアクセストークンをサーバー検証し、製品ごとのプラン情報を返す
- **機能ゲート** — `window.hasFeature(key)` でクライアント側を制御

## 🚀 使い方

### ローカルで開く（オフライン動作確認）

`index.html` をブラウザで直接開けば、LIFF と `/api/me` をスキップし擬似プロファイルで起動します。AIによる JSON / 画像生成を試したい場合は次のセクションを参照してください。

### ローカルで API も含めて動作確認

```bash
npm install
npm run dev   # = vercel dev
```

URL クエリで擬似プラン / タグを切替可能:

```
http://localhost:3000/?plan=free
http://localhost:3000/?plan=standard
http://localhost:3000/?plan=pro
http://localhost:3000/?plan=free&tags=beta   # プラン free だが beta タグで AI 機能が解放される
```

### WordPress に埋め込む

```bash
npm run build:wp   # = node build-wp.js
```

`wordpress-embed.html` が生成されます。HTML / CSS / JS を1ファイルに統合した自己完結型のファイルです。

## 📁 ファイル構成

| パス | 説明 |
|---------|------|
| `index.html` / `index.css` / `app.js` | フロントエンド本体 |
| `api/me.js` | `/api/me` 認証＋エンタイトルメント取得 API |
| `api/_lib/` | LINE トークン検証 / Supabase クライアント / CORS ユーティリティ |
| `supabase/migrations/` | DB スキーマ（Phase 1 認証 + Phase 2 マルチ製品エンタイトルメント） |
| `build-wp.js` | WordPress埋め込み用ビルドスクリプト |
| `wordpress-embed.html` | ビルド成果物（HTML/CSS/JS 単一ファイル） |
| `sakura-petal.svg` / `sakura-petal-base64.txt` | 桜モード用パーティクル素材 |
| `vercel.json` / `package.json` | Vercel デプロイ設定・依存定義 |

## 🛠️ 技術スタック

- フロント: HTML / CSS / JavaScript（フレームワーク不使用）
- 認証: LINE LIFF SDK + Vercel Serverless Functions
- DB: Supabase (PostgreSQL)
- AI: Straico API / Gemini API（JSON生成）, Pickaxe API（画像生成: NanoBanana2 / GPT Image2）
- レスポンシブ対応 / ライト・ダーク・季節テーマ対応

## 🔐 中央認証API + 機能ゲート (Phase 1 + Phase 2)

`/api/me?product=<product_code>` は Vercel + Supabase で動作し、LIFF access token をサーバー検証して **製品ごとの** プラン情報を返します。1 ユーザー × N 製品のエンタイトルメントを `entitlements` テーブルで管理し、クライアント側は `window.hasFeature(key)` で機能ゲートします。

### 環境変数

`.env.example` を `.env.local` にコピーし、Vercel の Project Settings → Environment Variables にも同じものを登録してください。

| キー | 用途 |
|---|---|
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（**絶対にコミット禁止 / クライアント露出禁止**） |
| `LINE_CHANNEL_IDS` | LIFFアプリが紐付く LINEログインチャネルIDをカンマ区切り |
| `DEFAULT_PRODUCT_CODE` | `?product=` 未指定時のフォールバック製品コード(Phase 2.x で必須化予定) |
| `ALLOWED_ORIGINS` | クロスオリジン呼び出しを許可するオリジンをカンマ区切り |
| `LOG_LEVEL` | `info` / `debug` |

### Supabase スキーマ適用

1. Supabase でプロジェクト作成（リージョン: `ap-northeast-1` 推奨）
2. SQL Editor で順番に実行:
   - `supabase/migrations/0001_phase1_auth.sql`
   - `supabase/migrations/0002_phase2_entitlements.sql` (multi-product 対応)
3. Service Role キーを `SUPABASE_SERVICE_ROLE_KEY` に設定

### Vercel デプロイ

```bash
npm install
vercel deploy
```

### プランと機能マッピング(初期値)

| プラン | 解放される機能キー | 含まれる機能 |
|---|---|---|
| `free` | `core.single` | 単体モード(単一プロンプト生成) / スタイル・レイアウト・フォーマット・配色・キャラクター画像・ペーストキュー |
| `standard` | + `mode.carousel`, `ai.json` | + カルーセルモード / AIによるカルーセルJSON自動生成（Straico・Gemini）/ キャプション・ハッシュタグ生成 |
| `pro` | + `ai.imagegen`, `theme.seasonal` | + 画像一括生成（Pickaxe / NanoBanana2 / GPT Image2）/ 個別再生成 / 季節テーマ |
| `lifetime` | `pro` と同じ | `pro` と同等 |

タグでの個別解放(`beta`, `internal`, `vip`)も可能。詳細は [app.js](app.js) の `PLAN_FEATURES` / `TAG_FEATURE_GRANTS` / `FEATURE_REQUIRED_PLAN` 定数を参照。

### 手動でプランを昇格させる

```sql
-- 'Uxxxx...' の部分は実際の line_user_id (auth_audit_log や entitlements から確認)
update public.entitlements
  set plan = 'pro',
      expires_at = '2026-12-31 23:59:59+09'
  where line_user_id = 'Uxxxx...'
    and product_code = 'zukai-builder';

-- タグを付ける場合 (全製品共通)
insert into public.user_tags (line_user_id, tag) values ('Uxxxx...', 'beta')
  on conflict (line_user_id, tag) do nothing;
```

ユーザーがアプリを再読み込みすれば、次回 `/api/me` で新しいプランが返ります。

### 新しい製品を追加する手順

1. `products` テーブルに行を追加:
   ```sql
   insert into public.products (code, name) values ('xxx-app', 'XXX アプリ');
   ```
2. その新アプリ側で `PRODUCT_CODE = 'xxx-app'` を `app.js`(または相当箇所)に設定
3. 新アプリでログインが走ると `/api/me` 経由で `entitlements` に `(line_user_id, product_code='xxx-app', plan='free')` が自動 upsert される

このリポジトリの `/api/me` / `api/_lib/*` ロジックは無変更で済みます。

### ローカル動作確認

```bash
# Vercel CLI でローカルサーバ起動
vercel dev

# 実トークンで疎通(LIFFモバイルで liff.getAccessToken() をコンソール出力して取得)
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/me?product=zukai-builder"
```

`localhost` で `index.html` を直接開いた場合は LIFF と `/api/me` をスキップし、擬似プロファイルでアプリ本体が起動します。URL クエリで擬似プラン/タグを切替可能:

```
http://localhost:3000/?plan=free
http://localhost:3000/?plan=standard
http://localhost:3000/?plan=pro
http://localhost:3000/?plan=free&tags=beta   # プラン free だが beta タグで AI 機能が解放される
```

## 📝 ライセンス

MIT
