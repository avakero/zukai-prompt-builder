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

| プラン | 解放される機能 |
|---|---|
| `free` | 単一プロンプト生成 / スタイル・レイアウト・フォーマット・配色・キャラクター画像 |
| `standard` | + AIでカルーセルJSON生成 / カルーセルモード |
| `pro` | + 画像一括生成(Pickaxe) / 季節テーマ |
| `lifetime` | `pro` と同等 |

タグでの個別解放(`beta`, `internal`, `vip`)も可能。詳細は [app.js](app.js) の `PLAN_FEATURES` / `TAG_FEATURE_GRANTS` 定数を参照。

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
