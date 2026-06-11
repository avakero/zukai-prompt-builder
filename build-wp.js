/**
 * WordPress固定ページ用ビルドスクリプト
 * index.html + index.css + app.js を1つの scoped HTML にまとめる
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const css  = fs.readFileSync(path.join(dir, 'index.css'), 'utf8');
const js   = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

// ============================================================
// CSS スコープ化
// ============================================================

const scopedCSS = css
  // :root → .zpb-root
  .replace(/:root\s*\{/g, '.zpb-root {')
  // [data-theme="xxx"] → .zpb-root[data-zpb-theme="xxx"]（全テーマ対応）
  .replace(/\[data-theme="(\w+)"\]/g, '.zpb-root[data-zpb-theme="$1"]')
  // body, html のグローバルスタイルを除去
  .replace(/^html\s*\{[\s\S]*?\}/m, '')
  .replace(/^body\s*\{[\s\S]*?\}/m, '')
  // *, *::before を .zpb-root 内にスコープ
  .replace(/^\*,\s*\*::before,\s*\*::after\s*\{/m, '.zpb-root *, .zpb-root *::before, .zpb-root *::after {')
  // prefers-reduced-motion 内のセレクタ全体 (*, *::before, *::after) をスコープ化する。
  // 先頭の * だけ置換すると *::before / *::after がグローバルのまま残り、
  // 埋め込み先 WordPress ページ全体のアニメーションを止めてしまう。
  .replace(
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{/g,
    '@media (prefers-reduced-motion: reduce) { .zpb-root *, .zpb-root *::before, .zpb-root *::after {'
  )
  // :focus-visible スコープ化
  .replace(/^:focus-visible\s*\{/m, '.zpb-root :focus-visible {')
  // img スコープ化
  .replace(/^img\s*\{/m, '.zpb-root img {')
  // a, a:hover スコープ化
  .replace(/^a\s*\{/m, '.zpb-root a {')
  .replace(/^a:hover\s*\{/m, '.zpb-root a:hover {');

// ============================================================
// JS スコープ化
// ============================================================

const scopedJS = js
  .replace(/document\.documentElement\.setAttribute\('data-theme'/g,
    "document.getElementById('zpb-root').setAttribute('data-zpb-theme'")
  .replace(/dataset\.theme/g, 'dataset.zpbTheme')
  .replace(/data-theme/g, 'data-zpb-theme');

// ============================================================
// JS を base64 エンコード（WordPress/Elementor の文字エスケープ対策）
// ============================================================
// インラインJSは WordPress/Elementor/プラグインの各種フィルタで
// 任意の文字（>, <, &, クォート、空行、ピリオド等）を勝手に変換されるため、
// JSの中身を base64 文字列にして、ページ側では tiny bootstrap だけ書く。
// base64 は [A-Za-z0-9+/=] のみで構成されるため、WP はこれを変換しない。
const jsBase64 = Buffer.from(scopedJS, 'utf8').toString('base64');

// ============================================================
// HTML body コンテンツ抽出
// ============================================================

const bodyMatch = html.match(/<body>([\s\S]*?)<script/);
const scopedBody = bodyMatch
  ? bodyMatch[1].trim().replace(/data-theme/g, 'data-zpb-theme')
  : '';

// 抽出失敗ガード: index.html の構造変更 (body 内へのインライン <script> 追加など) で
// 本文が途中で切れた / 空になった場合は、壊れた埋め込みファイルを出力せず失敗させる。
const MIN_BODY_CHARS = 30000;
if (!bodyMatch || scopedBody.length < MIN_BODY_CHARS) {
  console.error(`❌ body 抽出に失敗しました (抽出サイズ: ${scopedBody.length} 文字, 期待: ${MIN_BODY_CHARS} 文字以上)`);
  console.error('   index.html の <body> 内に <script> タグを追加した場合、抽出 regex の見直しが必要です。');
  process.exit(1);
}

// ============================================================
// 出力生成
// ============================================================

const output = `<!--
  ===============================================
  図解プロンプトビルダー — WordPress固定ページ用
  ===============================================
  使い方:
  1. WordPress管理画面 → 固定ページ → 新規追加
  2. 「カスタムHTML」ブロックを追加
  3. このファイルの内容をすべて貼り付ける
  4. 公開する
  ※ もしテーマとスタイルが競合する場合は、
     テンプレート「空白」や「全幅」を選択してください
-->

<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+JP:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>

<style>
/* === WordPress用スコープ化CSS === */
.zpb-root {
  font-family: 'Inter', 'Noto Sans JP', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: var(--surface-secondary);
  color: var(--text-primary);
  transition: background-color 250ms cubic-bezier(0.4, 0, 0.2, 1),
              color 250ms cubic-bezier(0.4, 0, 0.2, 1);
  /* 親コンテナの max-width を突破して画面幅いっぱいに背景を広げる */
  width: 100vw;
  max-width: 100vw;
  margin-left: calc(50% - 50vw);
  margin-right: calc(50% - 50vw);
  overflow-x: hidden;
}
${scopedCSS}
</style>

<div class="zpb-root" id="zpb-root" data-zpb-theme="light">
${scopedBody}
</div>

<script>
// ===== bootstrap: base64 でJS本体をロード（WP/Elementor のフィルタ回避） =====
(function(){
  var b64 = "${jsBase64}";
  try {
    // UTF-8 として正しく復号
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var code = new TextDecoder('utf-8').decode(bytes);
    // Blob URL で外部スクリプトとしてロード
    var url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    var s = document.createElement('script');
    s.src = url;
    s.onload = function(){ URL.revokeObjectURL(url); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    console.error('[ZPB bootstrap] failed:', e);
    var gate = document.getElementById('lineLoginGate');
    if (gate) {
      var err = document.getElementById('lineStateError');
      var loading = document.getElementById('lineStateLoading');
      var msg = document.getElementById('lineErrorMessage');
      if (loading) loading.classList.remove('active');
      if (err) err.classList.add('active');
      if (msg) msg.innerHTML = 'スクリプト初期化に失敗しました。<br><small>' + (e.message || e) + '</small>';
    }
  }
})();
</script>`;

fs.writeFileSync(path.join(dir, 'wordpress-embed.html'), output, 'utf8');

// 古い別ファイル版が残っていれば削除（混乱防止）
try {
  fs.unlinkSync(path.join(dir, 'wordpress-embed.js'));
  console.log('🧹 旧 wordpress-embed.js を削除しました');
} catch (e) {
  // 元から無ければOK
}

console.log('✅ wordpress-embed.html を生成しました！');
console.log(`   サイズ: ${(Buffer.byteLength(output) / 1024).toFixed(1)} KB`);
console.log('');
console.log('📋 WordPress配置手順:');
console.log('   wordpress-embed.html の中身をすべて「カスタムHTML」ブロックに貼り付けるだけ');
