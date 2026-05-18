#!/usr/bin/env node
/**
 * pickaxe-cli/workspaces/proxy{N}/.api-key を読んで、
 * Vercel に貼り付けやすい `PICKAXE_API_KEY_N=<value>` 形式で出力する。
 *
 * 使い方:
 *   node scripts/print-pickaxe-env.js
 *
 * 環境変数:
 *   PICKAXE_CLI_DIR  pickaxe-cli ディレクトリのパス
 *                    (デフォルト: ~/pickaxe-cli)
 *
 * 出力をそのまま Vercel Dashboard → Settings → Environment Variables に
 * 1 行ずつ追加すれば、/api/pickaxe-proxy がキーを引けるようになる。
 *
 * 注: このスクリプトは秘密鍵をターミナルに表示する。スクショ共有等に注意。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = process.env.PICKAXE_CLI_DIR
  || path.join(os.homedir(), 'pickaxe-cli');
const WORKSPACE_COUNT = 7;

function readKey(idx) {
  const file = path.join(ROOT, 'workspaces', `proxy${idx}`, '.api-key');
  if (!fs.existsSync(file)) {
    return { ok: false, error: `not found: ${file}` };
  }
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) {
    return { ok: false, error: `empty: ${file}` };
  }
  return { ok: true, key: raw };
}

console.error(`[info] reading from ${ROOT}/workspaces/proxy{1..${WORKSPACE_COUNT}}/.api-key`);
console.error('');

let ok = 0;
for (let i = 1; i <= WORKSPACE_COUNT; i++) {
  const r = readKey(i);
  if (r.ok) {
    process.stdout.write(`PICKAXE_API_KEY_${i}=${r.key}\n`);
    ok++;
  } else {
    console.error(`[warn] PICKAXE_API_KEY_${i} skipped: ${r.error}`);
  }
}

console.error('');
console.error(`[done] ${ok}/${WORKSPACE_COUNT} keys printed.`);
console.error('       Vercel Dashboard → Project → Settings → Environment Variables');
console.error('       で各行を追加してください (Production / Preview / Development すべてに)');
