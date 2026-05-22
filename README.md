# 🎨 図解ビルダーPRO MAX

文章を貼り付けてオプションを選ぶだけで、AIで図解カルーセル画像をまとめて生成できる Web ツール。LINE 公式アカウントの友だち限定で配布する LIFF アプリとして動作します。

## ✨ 機能

### 共通

- **テキスト入力** — 図解にしたい文章を貼り付けるだけ
- **スタイル選択** — 手書き風 / ビジネス風 / ポップ・コミック / ミニマル
- **レイアウト選択** — 並列リスト / 比較図 / ステップ進行 / 4象限マトリクス / サイクル図 / ピラミッド / お任せ（複合）
- **フォーマット選択** — 1:1 / 3:4 / 16:9
- **配色プリセット** — 16種類のカラーパレット + カスタムカラー + 「お任せ」
- **キャラクター画像アップロード** — ドラッグ＆ドロップ対応（最大5枚）。img2img 経由でスライド全体に同一キャラを登場させられる
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
- **AIモデル選択** — `gpt-image-2`（OpenAI 推奨）/ `gemini-2.5-flash-image-preview`（Google）/ `imagen-3.0-generate-002`（Google）。Pickaxe 系モデルは `pickaxe_internal` タグ保持者のみ
- **画像一括生成** — OpenAI / Gemini に直接プロキシ経由で並列発火。3〜5並列で 5枚 3分弱（gpt-image-2 medium）
- **キャラクター参照 (img2img)** — gpt-image-2 / Gemini 2.5 Flash Image で各スライドに同一キャラを描画
- **個別画像の再生成** — 失敗時や気に入らない時にスライド単位で再生成（モデル切替可、失敗時は別プロバイダにフォールバック提案）
- **24時間ジョブ復元** — タブを閉じても、別タブ・別デバイスから 24時間以内の生成結果を自動復元
- **画像URLコピー** — Supabase Storage の公開URL を1タップでクリップボードへ
- **投稿キャプション・ハッシュタグ管理** — 本文 / タグを分けてコピー、または一括コピー

### 認証・配布

- **LINE LIFF ログインゲート** — LINE公式アカウントの友だちのみ利用可能
- **`/api/me` 中央認証API** — LIFFアクセストークンをサーバー検証し、製品ごとのプラン情報を返す
- **機能ゲート** — `window.hasFeature(key)` でクライアント側を制御
- **タグ別アクセス** — `pickaxe_internal` 等のタグで個別解放

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
| `api/me.js` | `/api/me` 認証＋エンタイトルメント取得 |
| `api/openai-image.js` | OpenAI gpt-image-2 / DALL·E 3 プロキシ（character refs 対応） |
| `api/gemini-image.js` | Google Imagen 3 / Gemini 2.5 Flash Image プロキシ |
| `api/pickaxe-proxy.js` | Pickaxe API プロキシ（内部限定、`pickaxe_internal` タグ必須） |
| `api/upload-character-image.js` | キャラ参照画像を Supabase Storage にアップロード |
| `api/log-generation.js` / `api/log-slide.js` | 生成ジョブ・スライド単位のテレメトリ書込 |
| `api/job.js` | 生成ジョブの取得（復元 UX 用） |
| `api/_lib/` | LINE トークン検証 / Supabase クライアント / CORS / 画像Storage ユーティリティ |
| `supabase/migrations/` | DB スキーマ（後述） |
| `build-wp.js` / `wordpress-embed.html` | WordPress 埋め込み用ビルドスクリプトと成果物 |
| `sakura-petal.svg` / `sakura-petal-base64.txt` | 桜モード用パーティクル素材 |
| `vercel.json` / `package.json` | Vercel デプロイ設定・依存定義 |

## 🛠️ 技術スタック

- フロント: HTML / CSS / JavaScript（フレームワーク不使用、IIFE 構成）
- 認証: LINE LIFF SDK + Vercel Serverless Functions
- DB / Storage: Supabase (PostgreSQL + Storage)
- AI 画像生成（公開）: **OpenAI gpt-image-2** / Google Imagen 3 / Gemini 2.5 Flash Image
- AI 画像生成（内部限定）: Pickaxe API（NanoBanana2 / GPT Image2）— 7月末まで個人サブスク利用
- AI JSON 生成: Straico API / Gemini API
- レスポンシブ対応 / ライト・ダーク・季節テーマ対応

## 🔐 中央認証API + 機能ゲート

`/api/me?product=<product_code>` は Vercel + Supabase で動作し、LIFF access token をサーバー検証して **製品ごとの** プラン情報を返します。1 ユーザー × N 製品のエンタイトルメントを `entitlements` テーブルで管理し、クライアント側は `window.hasFeature(key)` で機能ゲートします。

### 環境変数

`.env.example` を `.env.local` にコピーし、Vercel の Project Settings → Environment Variables にも同じものを登録してください。

| キー | 用途 |
|---|---|
| `SUPABASE_URL` | Supabase プロジェクト URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role キー（**絶対にコミット禁止 / クライアント露出禁止**） |
| `LINE_CHANNEL_IDS` | LIFFアプリが紐付く LINEログインチャネルIDをカンマ区切り |
| `DEFAULT_PRODUCT_CODE` | `?product=` 未指定時のフォールバック製品コード |
| `ALLOWED_ORIGINS` | クロスオリジン呼び出しを許可するオリジンをカンマ区切り |
| `OPENAI_API_KEY` | OpenAI gpt-image-2 / DALL·E 3 用 |
| `GEMINI_API_KEY` | Google AI Studio で発行した Imagen / Gemini 用キー |
| `PICKAXE_API_KEY_1` 〜 `_7` | Pickaxe ワークスペース別デプロイメントキー（内部限定） |
| `PICKAXE_MODEL_INPUT_ID_{N}` / `PICKAXE_PROMPT_INPUT_ID_{N}` | Pickaxe form-chat の入力UUIDを上書き（通常不要） |
| `LOG_LEVEL` | `info` / `debug` |

### Supabase スキーマ適用

Supabase でプロジェクト作成（リージョン: `ap-northeast-1` 推奨）後、SQL Editor で **順番に** 実行:

| Migration | 内容 |
|---|---|
| `0001_phase1_auth.sql` | `subscriptions` / `user_tags` / `auth_audit_log` |
| `0002_phase2_entitlements.sql` | `products` マスタ + `subscriptions` → `entitlements` リネーム |
| `0003_character_refs_storage.sql` | Storage バケット `character-refs`（キャラ参照画像、24h 自動削除） |
| `0004_generation_jobs.sql` | `generation_jobs` / `generation_slides`（生成ジョブのテレメトリ + 復元用、24h 自動削除） |
| `0005_generated_images_storage.sql` | Storage バケット `generated-images`（AI 生成画像本体、24h 自動削除） |

Service Role キーを `SUPABASE_SERVICE_ROLE_KEY` に設定。

### (推奨) pg_cron でクリーンアップ自動化

Supabase Studio → Database → Cron Jobs で日次実行:

```sql
select public.cleanup_old_character_refs();
select public.cleanup_old_generation_jobs();
select public.cleanup_old_generated_images();
```

### Vercel デプロイ

```bash
npm install
vercel deploy
```

`vercel.json` の `maxDuration` 設定（Pro プラン前提）:

| エンドポイント | maxDuration |
|---|---|
| `api/me.js` / `api/upload-character-image.js` | 10 秒 |
| `api/log-generation.js` / `api/log-slide.js` / `api/job.js` | 10 秒 |
| `api/openai-image.js` / `api/gemini-image.js` | 180 秒 |
| `api/pickaxe-proxy.js` | 300 秒 |

### プランと機能マッピング（初期値）

| プラン | 解放される機能キー | 含まれる機能 |
|---|---|---|
| `free` | `core.single` | 単体モード(単一プロンプト生成) / スタイル・レイアウト・フォーマット・配色・キャラクター画像・ペーストキュー |
| `standard` | + `mode.carousel`, `ai.json` | + カルーセルモード / AIによるカルーセルJSON自動生成（Straico・Gemini）/ キャプション・ハッシュタグ生成 |
| `pro` | + `ai.imagegen`, `theme.seasonal` | + 画像一括生成（OpenAI gpt-image-2 / Gemini）/ 個別再生成 / 季節テーマ / 24h ジョブ復元 |
| `lifetime` | `pro` と同じ | `pro` と同等 |

### タグによる個別解放

| タグ | 解放される追加機能 |
|---|---|
| `beta` | `ai.json` / `ai.imagegen` / `theme.seasonal`（free でも AI 機能を試せる） |
| `internal` | beta と同等 + `mode.carousel` |
| `vip` | internal と同等 |
| **`pickaxe_internal`** | **`provider.pickaxe`**（Pickaxe モデル選択肢を UI に表示し、`/api/pickaxe-proxy` を許可） |

詳細は [app.js](app.js) の `PLAN_FEATURES` / `TAG_FEATURE_GRANTS` / `FEATURE_REQUIRED_PLAN` 定数を参照。

### 手動でプラン / タグを変更

```sql
-- プラン昇格 ('Uxxxx...' は実際の line_user_id。auth_audit_log や entitlements から確認)
update public.entitlements
  set plan = 'pro',
      expires_at = '2026-12-31 23:59:59+09'
  where line_user_id = 'Uxxxx...'
    and product_code = 'zukai-builder';

-- 自分にだけ Pickaxe を使わせる
insert into public.user_tags (line_user_id, tag) values ('Uxxxx...', 'pickaxe_internal')
  on conflict (line_user_id, tag) do nothing;

-- beta タグを付与（全製品共通）
insert into public.user_tags (line_user_id, tag) values ('Uxxxx...', 'beta')
  on conflict (line_user_id, tag) do nothing;
```

ユーザーがアプリを再読み込みすれば、次回 `/api/me` で新しいプラン / タグが返ります。

### 新しい製品を追加する手順

1. `products` テーブルに行を追加:
   ```sql
   insert into public.products (code, name) values ('xxx-app', 'XXX アプリ');
   ```
2. その新アプリ側で `PRODUCT_CODE = 'xxx-app'` を `app.js`（または相当箇所）に設定
3. 新アプリでログインが走ると `/api/me` 経由で `entitlements` に `(line_user_id, product_code='xxx-app', plan='free')` が自動 upsert される

このリポジトリの `/api/me` / `api/_lib/*` ロジックは無変更で済みます。

## 🖼️ 画像生成アーキテクチャ

```
Browser (LIFF)
   ↓ buildImagePrompt() でプロンプト組立 (provider 別最適化)
   ↓ callPickaxeAPI() = 統一 dispatcher
   │   imageGenState.model から自動でプロバイダ判定
   ↓
┌─────────────────────────────────────────────────┐
│ /api/openai-image  (gpt-image-2 / DALL·E 3)     │
│ /api/gemini-image  (Imagen 3 / 2.5 Flash Image) │
│ /api/pickaxe-proxy (NanoBanana2 / GPT Image2)   │← pickaxe_internal タグ必須
└─────────────────────────────────────────────────┘
   ↓ 返却された base64 画像
   ↓ uploadGeneratedImage() で Supabase Storage 'generated-images' に保存
   ↓ 公開URLを応答
Browser
   ↓ generation_slides に image_url を書込 (Phase 1 logging)
   ↓ localStorage 'zukai-last-job-id' に jobId 保存
   
[24h 以内に再訪]
Browser
   ↓ restoreLastJob() が /api/job?id=... を叩く
   ↓ Supabase から jobs + slides 取得 → グリッド復元
```

### 重要な制約

- **24時間で自動削除**: `generation_jobs` / `generation_slides` / Storage `generated-images` / `character-refs` のすべてが 24h 後に cleanup 関数で削除される（要 pg_cron 設定）
- **OpenAI Tier 1 制限**: gpt-image-2 は 5 IPM。並列度は OpenAI=3、Gemini=5、Pickaxe=7 に分けてある
- **Pickaxe stagger**: Pickaxe は Modal cold start 衝突回避のため 8秒スタガー必須。OpenAI/Gemini は 0.5〜1.5秒
- **タイムアウト階層**: Browser 200s ≥ Vercel maxDuration 180s ≥ Proxy abort 170s（OpenAI/Gemini）/ Browser 320s ≥ Vercel 300s ≥ Proxy 290s（Pickaxe）

## 🧰 デバッグヘルパ

ブラウザコンソールから:

```js
zukaiDebug.listModels()        // 登録モデル一覧（プロバイダ・char refs 対応有無）
zukaiDebug.getModel()          // 現在のモデル
zukaiDebug.setModel('gpt-image-2')  // 切替（localStorage に永続化）
zukaiDebug.clearModel()        // モデル永続化をクリア
zukaiDebug.clearLastJob()      // 復元用 jobId をクリア（次回リロードで前回結果が出なくなる）
```

## 📝 ライセンス

MIT
