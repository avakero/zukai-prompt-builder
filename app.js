/**
 * 図解プロンプトビルダー — App Logic
 * Nano Banana Pro 専用
 */

(function () {
  'use strict';

  // ============================================================
  // 定数定義
  // ============================================================

  const STORAGE_KEY = 'zukai-prompt-builder';
  const MAX_IMAGES = 5;

  const STYLE_DEFS = {
    A: {
      label: '手書き風（アナログ）',
      desc: '色鉛筆や水彩のタッチ。温かみのあるパステル調。線画はラフに、塗りはムラを残す。デジタル感を排除する。'
    },
    B: {
      label: 'ビジネス風（フラットデザイン）',
      desc: '直線的で整ったベクター調。信頼感のある寒色系やモノトーン。無駄な装飾を省き、情報の視認性を最優先する。'
    },
    C: {
      label: 'ポップ・コミック',
      desc: '太い主線、鮮やかな原色使い。アメコミや元気な印象。'
    },
    D: {
      label: 'シンプル・ミニマル',
      desc: '線画のみ、または最低限の色数。洗練された印象。'
    }
  };

  const LAYOUT_DEFS = {
    A: { label: '並列リスト', desc: '要点まとめ' },
    B: { label: '比較図', desc: 'VS構造、左右対比' },
    C: { label: 'ステップ進行', desc: 'ロードマップ、手順' },
    D: { label: '4象限マトリクス', desc: '分布、ポジショニング' },
    E: { label: 'サイクル図', desc: '循環、ループ' },
    F: { label: 'ピラミッド', desc: '階層構造' },
    G: { label: '【複合・お任せ】', desc: '文章の内容を解析し、A〜Fを組み合わせたり、最適なオリジナル構成を自動で組むモード。' }
  };

  const COLOR_PRESET_LABELS = {
    'パステルピンク＆水色': 'パステルピンク＆水色',
    'ネイビー＆ゴールド': 'ネイビー＆ゴールド',
    'グリーン＆ナチュラル': 'グリーン＆ナチュラル',
    'モノトーン': 'モノトーン',
    'サンセットオレンジ': 'サンセットオレンジ',
    'ラベンダー＆パープル': 'ラベンダー＆パープル',
    'アクアブルー': 'アクアブルー',
    'アースカラー': 'アースカラー'
  };

  // ============================================================
  // 状態管理
  // ============================================================

  let state = {
    text: '',
    style: 'A',
    layout: 'G',
    format: '1:1',
    colorMode: 'auto', // 'auto' | 'preset' | 'custom'
    colorValue: '',
    customColor: '#3b82f6',
    theme: 'sakura',
    mode: 'single' // 'single' | 'carousel'
  };

  // カルーセル状態
  let carouselData = null; // parsed JSON
  let carouselPrompts = []; // 生成されたプロンプト配列

  // キャラクター画像（メモリ内保持、永続化なし）
  // { name: string, dataUrl: string, blob: Blob }
  let characterImages = [];

  // ペーストキュー状態
  // { type: 'text'|'image', label: string, content: string|Blob, thumb?: string }
  let pasteQueue = [];
  let pasteQueueIndex = 0;

  // ============================================================
  // DOM 参照
  // ============================================================

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    contentText: $('#contentText'),
    charCount: $('#charCount'),
    generateBtn: $('#generateBtn'),
    outputSection: $('#outputSection'),
    promptText: $('#promptText'),
    copyPromptBtn: $('#copyPromptBtn'),
    themeSelector: $('#themeSelector'),
    toast: $('#toast'),
    toastMessage: $('#toastMessage'),
    customColorPicker: $('#customColorPicker'),
    colorAutoBtn: $('#colorAutoBtn'),
    resetAllBtn: $('#resetAllBtn'),
    styleBadge: $('#styleBadge'),
    layoutBadge: $('#layoutBadge'),
    formatBadge: $('#formatBadge'),
    colorBadge: $('#colorBadge'),
    // 画像アップロード
    imageUploadZone: $('#imageUploadZone'),
    imageFileInput: $('#imageFileInput'),
    imageThumbnails: $('#imageThumbnails'),
    imageBadge: $('#imageBadge'),
    // ペーストキュー
    pasteQueue: $('#pasteQueue'),
    pasteQueueItems: $('#pasteQueueItems'),
    pasteQueueProgress: $('#pasteQueueProgress'),
    pasteQueueCta: $('#pasteQueueCta'),
    pasteQueueHint: $('#pasteQueueHint'),
    pasteQueueClose: $('#pasteQueueClose'),
    pasteProgressFill: $('#pasteProgressFill'),
    // モード切替
    modeTabs: $('#modeTabs'),
    modeContentSingle: $('#modeContentSingle'),
    modeContentCarousel: $('#modeContentCarousel'),
    // カルーセル
    carouselJsonInput: $('#carouselJsonInput'),
    expandCarouselBtn: $('#expandCarouselBtn'),
    copyTemplateBtn: $('#copyTemplateBtn'),
    carouselBadge: $('#carouselBadge'),
    carouselPreviewSection: $('#carouselPreviewSection'),
    carouselSlides: $('#carouselSlides'),
    carouselSlideCount: $('#carouselSlideCount'),
    carouselPreviewTitle: $('#carouselPreviewTitle'),
    carouselGenerateBtn: $('#carouselGenerateBtn'),
    carouselOutputSection: $('#carouselOutputSection'),
    carouselOutputCards: $('#carouselOutputCards'),
    // モード出力
    modeContentSingleOutput: $('#modeContentSingleOutput'),
    modeContentCarouselOutput: $('#modeContentCarouselOutput')
  };

  // ============================================================
  // localStorage 永続化
  // ============================================================

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // ストレージ書き込みエラーは無視
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        state = { ...state, ...parsed };
      }
    } catch (e) {
      // パースエラーは無視
    }
  }

  // ============================================================
  // テーマ（ライト・ダーク・桜モード）
  // ============================================================

  const THEMES = ['light', 'sakura', 'dark'];

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);

    // テーマセレクターのアクティブ状態更新
    if (els.themeSelector) {
      els.themeSelector.querySelectorAll('.theme-selector__btn').forEach(btn => {
        const isActive = btn.dataset.theme === theme;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    }

    // 桜の花びらアニメーション 制御
    if (theme === 'sakura') {
      startSakuraPetals();
    } else {
      stopSakuraPetals();
    }

    saveState();
  }

  function setTheme(theme) {
    if (THEMES.includes(theme)) {
      applyTheme(theme);
    }
  }

  // ============================================================
  // 選択カード制御
  // ============================================================

  function activateCard(group, value) {
    $$(`[data-group="${group}"]`).forEach(card => {
      const isActive = card.dataset.value === value;
      card.classList.toggle('active', isActive);
      card.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  function updateBadges() {
    const styleDef = STYLE_DEFS[state.style];
    els.styleBadge.textContent = `${state.style}: ${styleDef.label.split('（')[0]}`;

    const layoutDef = LAYOUT_DEFS[state.layout];
    const layoutLabel = state.layout === 'G' ? 'お任せ' : layoutDef.label;
    els.layoutBadge.textContent = `${state.layout}: ${layoutLabel}`;

    els.formatBadge.textContent = state.format;

    if (state.colorMode === 'auto') {
      els.colorBadge.textContent = 'お任せ';
    } else if (state.colorMode === 'custom') {
      els.colorBadge.textContent = `カスタム (${state.customColor})`;
    } else {
      els.colorBadge.textContent = state.colorValue;
    }
  }

  // ============================================================
  // 配色制御
  // ============================================================

  function clearColorSelections() {
    $$('.color-swatch').forEach(sw => {
      sw.classList.remove('active');
      sw.setAttribute('aria-checked', 'false');
    });
    els.customColorPicker.classList.remove('active');
    els.colorAutoBtn.classList.remove('active');
  }

  function setColorAuto() {
    clearColorSelections();
    els.colorAutoBtn.classList.add('active');
    state.colorMode = 'auto';
    state.colorValue = '';
    updateBadges();
    saveState();
  }

  function setColorPreset(swatch, colorName) {
    clearColorSelections();
    swatch.classList.add('active');
    swatch.setAttribute('aria-checked', 'true');
    state.colorMode = 'preset';
    state.colorValue = colorName;
    updateBadges();
    saveState();
  }

  function setColorCustom(hex) {
    clearColorSelections();
    els.customColorPicker.classList.add('active');
    state.colorMode = 'custom';
    state.customColor = hex;
    state.colorValue = hex;
    updateBadges();
    saveState();
  }

  // ============================================================
  // 文字数カウント
  // ============================================================

  function updateCharCount() {
    const len = els.contentText.value.length;
    els.charCount.textContent = `${len.toLocaleString()} 文字`;
  }

  // ============================================================
  // プロンプト生成
  // ============================================================

  function generatePrompt() {
    const text = els.contentText.value.trim();
    if (!text) {
      showToast('テキストを入力してください');
      els.contentText.focus();
      return;
    }

    const styleDef = STYLE_DEFS[state.style];
    const layoutDef = LAYOUT_DEFS[state.layout];

    let colorInstruction = 'お任せ（内容に合った最適な配色を選んでください）';
    if (state.colorMode === 'preset') {
      colorInstruction = state.colorValue;
    } else if (state.colorMode === 'custom') {
      colorInstruction = `テーマカラー: ${state.customColor}`;
    }

    const hasImages = characterImages.length > 0;
    const imageNote = hasImages
      ? `\n\n## ■キャラクター画像\n添付した${characterImages.length}枚のキャラクター画像を図解内に登場させてください。\nキャラクターの外見は変更せず、そのままのデザインを維持してください。`
      : '';

    // === 統一プロンプト（命令書 + 依頼内容を一体化） ===
    const prompt = `# 命令書：万能・図解デザイナーAI（Nano Banana Pro専用）
あなたは、ユーザーの意図を汲み取り、最適なビジュアルを設計するプロの図解デザイナーです。

## ■基本方針
* ユーザー専属デザイナーとして、丁寧かつ親しみやすく振る舞う。
* ユーザーの指定した「スタイル」に合わせて画風を完全に切り替える。
* 不明点があれば確認の質問をする。

## ■スタイル定義
* **A：手書き風** — 色鉛筆や水彩のタッチ。温かみのあるパステル調。
* **B：ビジネス風** — フラットデザイン。信頼感のある寒色系。
* **C：ポップ** — 太い主線、鮮やかな原色。元気な印象。
* **D：ミニマル** — 線画のみ、最低限の色数。洗練された印象。

## ■レイアウト定義
* **A：並列リスト**（要点まとめ）
* **B：比較図**（VS構造、左右対比）
* **C：ステップ進行**（ロードマップ、手順）
* **D：4象限マトリクス**（分布、ポジショニング）
* **E：サイクル図**（循環、ループ）
* **F：ピラミッド**（階層構造）
* **G：お任せ** — 最適な構成を自動で組む。

## ■禁止事項
* 指定されたキャラの外見変更（キャラ使用時）
* 意味のない英語の羅列
* 実在ブランドのロゴ描写

---

## ■今回の依頼内容

以下の内容で図解を作成してください。

### 内容テキスト
${text}

### スタイル: ${state.style} — ${styleDef.label}
${styleDef.desc}

### レイアウト: ${state.layout} — ${layoutDef.label}
${layoutDef.desc}

### フォーマット: ${state.format}

### 配色: ${colorInstruction}${imageNote}`;

    els.promptText.textContent = prompt;
    els.outputSection.classList.add('visible');

    // スクロールして出力を表示
    setTimeout(() => {
      els.outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    // テキストを状態に保存
    state.text = text;
    saveState();

    // ペーストキューを構築・表示
    buildPasteQueue(prompt);
  }

  // ============================================================
  // クリップボードコピー
  // ============================================================

  async function copyToClipboard(textEl, btn) {
    const text = textEl.textContent;
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      showToast('クリップボードにコピーしました！');
    } catch (err) {
      // フォールバック
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('コピーしました！');
    }

    // ボタンの見た目を一時的に変更
    btn.classList.add('action-btn--copied');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      コピー済み
    `;
    setTimeout(() => {
      btn.classList.remove('action-btn--copied');
      btn.innerHTML = originalHTML;
    }, 2000);
  }

  // ============================================================
  // Toast 通知
  // ============================================================

  let toastTimer = null;

  function showToast(message) {
    if (toastTimer) clearTimeout(toastTimer);
    els.toastMessage.textContent = message;
    els.toast.classList.add('visible');
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('visible');
    }, 2500);
  }

  // ============================================================
  // リセット
  // ============================================================

  function resetAll() {
    state = {
      text: '',
      style: 'A',
      layout: 'G',
      format: '1:1',
      colorMode: 'auto',
      colorValue: '',
      customColor: '#3b82f6',
      theme: state.theme // テーマはリセットしない
    };

    // 花びらが飛んでいる場合はそのまま維持
    if (state.theme === 'sakura') startSakuraPetals();

    els.contentText.value = '';
    els.outputSection.classList.remove('visible');
    els.promptText.textContent = '';
    els.customColorPicker.value = '#3b82f6';

    // 画像・ペーストキューもクリア
    characterImages = [];
    renderImageThumbnails();
    closePasteQueue();

    applyUIState();
    updateCharCount();
    saveState();
    showToast('すべてリセットしました');
  }

  // ============================================================
  // キャラクター画像管理
  // ============================================================

  function handleImageFiles(files) {
    const remaining = MAX_IMAGES - characterImages.length;
    if (remaining <= 0) {
      showToast(`画像は最大${MAX_IMAGES}枚までです`);
      return;
    }

    const filesToAdd = Array.from(files).slice(0, remaining);

    filesToAdd.forEach(file => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        characterImages.push({
          name: file.name,
          dataUrl: e.target.result,
          blob: file
        });
        renderImageThumbnails();
        updateImageBadge();
      };
      reader.readAsDataURL(file);
    });
  }

  function removeImage(index) {
    characterImages.splice(index, 1);
    renderImageThumbnails();
    updateImageBadge();
  }

  function renderImageThumbnails() {
    els.imageThumbnails.innerHTML = '';
    characterImages.forEach((img, i) => {
      const div = document.createElement('div');
      div.className = 'image-thumbnail';
      div.innerHTML = `
        <img src="${img.dataUrl}" alt="${img.name}">
        <button class="image-thumbnail__remove" type="button" aria-label="削除" data-index="${i}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <span class="image-thumbnail__order">${i + 1}</span>
      `;
      div.querySelector('.image-thumbnail__remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeImage(i);
      });
      els.imageThumbnails.appendChild(div);
    });
  }

  function updateImageBadge() {
    if (characterImages.length === 0) {
      els.imageBadge.textContent = '任意';
    } else {
      els.imageBadge.textContent = `${characterImages.length}枚`;
    }
  }

  // ============================================================
  // ペーストキュー
  // ============================================================

  function buildPasteQueue(prompt) {
    pasteQueue = [];
    pasteQueueIndex = 0;

    // テキストアイテム（1つに統合）
    pasteQueue.push({
      type: 'text',
      label: '図解プロンプト',
      content: prompt
    });

    // 画像アイテム
    characterImages.forEach((img, i) => {
      pasteQueue.push({
        type: 'image',
        label: `キャラ画像${i + 1}`,
        content: img.blob,
        dataUrl: img.dataUrl,
        fileName: img.name
      });
    });

    renderPasteQueue();
    els.pasteQueue.classList.add('visible');
  }

  function renderPasteQueue() {
    const total = pasteQueue.length;
    const done = pasteQueueIndex;

    // 進捗
    els.pasteQueueProgress.textContent = `${done}/${total}`;
    const pct = total > 0 ? (done / total) * 100 : 0;
    els.pasteProgressFill.style.width = pct + '%';

    // アイテムリスト
    els.pasteQueueItems.innerHTML = '';
    pasteQueue.forEach((item, i) => {
      let statusClass = 'paste-queue__item--pending';
      let iconHTML = '';
      if (i < pasteQueueIndex) {
        statusClass = 'paste-queue__item--done';
        iconHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      } else if (i === pasteQueueIndex) {
        statusClass = 'paste-queue__item--current';
        iconHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      }

      const thumbHTML = item.type === 'image'
        ? `<img class="paste-queue__item-thumb" src="${item.dataUrl}" alt="">`
        : '';

      const div = document.createElement('div');
      div.className = `paste-queue__item ${statusClass}`;
      div.innerHTML = `
        <span class="paste-queue__item-icon">${iconHTML}</span>
        ${thumbHTML}
        <span>${item.label}</span>
      `;
      els.pasteQueueItems.appendChild(div);
    });

    // CTAボタン
    if (pasteQueueIndex >= total) {
      els.pasteQueueCta.className = 'paste-queue__cta paste-queue__cta--complete';
      els.pasteQueueCta.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        ✨ すべて完了！
      `;
      els.pasteQueueHint.textContent = 'Geminiに貼り付けて図解を生成してください';
    } else {
      const currentItem = pasteQueue[pasteQueueIndex];
      const typeIcon = currentItem.type === 'image'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      els.pasteQueueCta.className = 'paste-queue__cta';
      els.pasteQueueCta.innerHTML = `
        ${typeIcon}
        コピー: ${currentItem.label}
      `;
      if (pasteQueueIndex === 0) {
        els.pasteQueueHint.textContent = '💡 ボタンを押してGeminiにCtrl+Vで貼り付けてください';
      } else {
        els.pasteQueueHint.textContent = '💡 Geminiに貼り付けたら次をコピーしてください';
      }
    }
  }

  async function copyNextInQueue() {
    if (pasteQueueIndex >= pasteQueue.length) return;

    const item = pasteQueue[pasteQueueIndex];

    try {
      if (item.type === 'text') {
        await navigator.clipboard.writeText(item.content);
        showToast(`📋 ${item.label} をコピーしました`);
      } else if (item.type === 'image') {
        // 画像をPNG Blobに変換してクリップボードへ
        const pngBlob = await convertToPngBlob(item.dataUrl);
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob })
        ]);
        showToast(`🖼️ ${item.label} をコピーしました`);
      }

      pasteQueueIndex++;
      renderPasteQueue();
    } catch (err) {
      console.error('Copy failed:', err);
      // テキストのフォールバック
      if (item.type === 'text') {
        const textarea = document.createElement('textarea');
        textarea.value = item.content;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast(`📋 ${item.label} をコピーしました`);
        pasteQueueIndex++;
        renderPasteQueue();
      } else {
        showToast('⚠️ 画像のコピーに失敗しました。HTTPS環境が必要です');
      }
    }
  }

  function convertToPngBlob(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Blob conversion failed'));
        }, 'image/png');
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function closePasteQueue() {
    els.pasteQueue.classList.remove('visible');
    pasteQueue = [];
    pasteQueueIndex = 0;
  }

  // ============================================================
  // UI状態の復元
  // ============================================================

  function applyUIState() {
    // テーマ
    applyTheme(state.theme);

    // テキスト
    if (state.text) {
      els.contentText.value = state.text;
    }

    // 選択カード
    activateCard('style', state.style);
    activateCard('layout', state.layout);
    activateCard('format', state.format);

    // 配色
    clearColorSelections();
    if (state.colorMode === 'auto') {
      els.colorAutoBtn.classList.add('active');
    } else if (state.colorMode === 'preset') {
      const swatch = $(`.color-swatch[data-color="${state.colorValue}"]`);
      if (swatch) {
        swatch.classList.add('active');
        swatch.setAttribute('aria-checked', 'true');
      }
    } else if (state.colorMode === 'custom') {
      els.customColorPicker.classList.add('active');
      els.customColorPicker.value = state.customColor;
    }

    // バッジ更新
    updateBadges();
    updateCharCount();

    // モード復元
    if (state.mode && state.mode !== 'single') {
      switchMode(state.mode);
    }
  }

  // ============================================================
  // イベントリスナー
  // ============================================================

  function initEvents() {
    // テキスト入力
    els.contentText.addEventListener('input', () => {
      state.text = els.contentText.value;
      updateCharCount();
    });

    // テキストエリアからフォーカスが外れた時に保存
    els.contentText.addEventListener('blur', () => {
      state.text = els.contentText.value;
      saveState();
    });

    // 選択カードクリック
    $$('.selection-card').forEach(card => {
      card.addEventListener('click', () => {
        const group = card.dataset.group;
        const value = card.dataset.value;

        if (group === 'style') state.style = value;
        else if (group === 'layout') state.layout = value;
        else if (group === 'format') state.format = value;

        activateCard(group, value);
        updateBadges();
        saveState();
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });

    // 配色プリセット
    $$('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        setColorPreset(swatch, swatch.dataset.color);
      });
    });

    // カスタムカラーピッカー
    els.customColorPicker.addEventListener('input', (e) => {
      setColorCustom(e.target.value);
    });

    els.customColorPicker.addEventListener('click', () => {
      if (state.colorMode !== 'custom') {
        setColorCustom(els.customColorPicker.value);
      }
    });

    // お任せボタン
    els.colorAutoBtn.addEventListener('click', setColorAuto);

    // 生成ボタン
    els.generateBtn.addEventListener('click', generatePrompt);

    // コピーボタン
    els.copyPromptBtn.addEventListener('click', () => {
      copyToClipboard(els.promptText, els.copyPromptBtn);
    });

    // テーマセレクター
    if (els.themeSelector) {
      els.themeSelector.querySelectorAll('.theme-selector__btn').forEach(btn => {
        btn.addEventListener('click', () => {
          setTheme(btn.dataset.theme);
        });
      });
    }

    // リセットボタン
    els.resetAllBtn.addEventListener('click', () => {
      if (confirm('すべての設定と入力をリセットしますか？')) {
        resetAll();
      }
    });

    // Ctrl+Enter でプロンプト生成
    els.contentText.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        generatePrompt();
      }
    });

    // ===== 画像アップロード =====
    els.imageFileInput.addEventListener('change', (e) => {
      handleImageFiles(e.target.files);
      e.target.value = ''; // リセットして同じファイルの再選択を許可
    });

    // ドラッグ＆ドロップ
    els.imageUploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.imageUploadZone.classList.add('dragover');
    });

    els.imageUploadZone.addEventListener('dragleave', () => {
      els.imageUploadZone.classList.remove('dragover');
    });

    els.imageUploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.imageUploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) {
        handleImageFiles(e.dataTransfer.files);
      }
    });

    // ===== ペーストキュー =====
    els.pasteQueueCta.addEventListener('click', copyNextInQueue);

    els.pasteQueueClose.addEventListener('click', closePasteQueue);

    // ===== モード切替 =====
    if (els.modeTabs) {
      els.modeTabs.querySelectorAll('.mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          switchMode(tab.dataset.mode);
        });
      });
    }

    // ===== カルーセルイベント =====
    if (els.expandCarouselBtn) {
      els.expandCarouselBtn.addEventListener('click', expandCarousel);
    }
    if (els.copyTemplateBtn) {
      els.copyTemplateBtn.addEventListener('click', copyCarouselTemplate);
    }
    if (els.carouselGenerateBtn) {
      els.carouselGenerateBtn.addEventListener('click', generateCarouselPrompts);
    }
  }

  // ============================================================
  // モード切替
  // ============================================================

  function switchMode(mode) {
    if (mode !== 'single' && mode !== 'carousel') return;
    state.mode = mode;

    // タブ UI
    els.modeTabs.querySelectorAll('.mode-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // コンテンツ切替（テキスト入力 / JSON入力）
    els.modeContentSingle.style.display = mode === 'single' ? '' : 'none';
    els.modeContentCarousel.style.display = mode === 'carousel' ? '' : 'none';

    // 生成ボタン＋出力の切替
    if (els.modeContentSingleOutput) {
      els.modeContentSingleOutput.style.display = mode === 'single' ? '' : 'none';
    }
    if (els.modeContentCarouselOutput) {
      els.modeContentCarouselOutput.style.display = mode === 'carousel' ? '' : 'none';
    }

    // ペーストキューをクリア
    closePasteQueue();

    saveState();
  }

  // ============================================================
  // カルーセル：AIテンプレートコピー
  // ============================================================

  const CAROUSEL_TEMPLATE = `以下のJSON形式で、カルーセル投稿用のデータを生成してください。
そのままコピーして使えるよう、余計な説明は不要で、JSONだけを出力してください。

## JSON仕様
\`\`\`json
{
  "title": "カルーセルのタイトル",
  "style": "A",
  "format": "1:1",
  "color": "auto",
  "slides": [
    {
      "page": 1,
      "role": "cover",
      "content": "表紙のテキスト内容"
    },
    {
      "page": 2,
      "role": "body",
      "layout": "A",
      "content": "本文スライドの内容"
    },
    {
      "page": 3,
      "role": "cta",
      "content": "まとめ・CTAのテキスト"
    }
  ]
}
\`\`\`

## フィールド説明
- **style**: A(手書き風), B(ビジネス風), C(ポップ), D(ミニマル)
- **format**: "1:1"(正方形), "3:4"(縦長), "16:9"(横長)
- **color**: "auto" or プリセット名(例:"パステルピンク＆水色") or 色コード(例:"#3b82f6")
- **slides[].role**: "cover"(表紙), "body"(本文), "cta"(まとめ・CTA)
- **slides[].layout**: A(並列リスト), B(比較図), C(ステップ), D(4象限), E(サイクル), F(ピラミッド), G(お任せ)

## 依頼内容
以下のテーマでカルーセル投稿を作成してください：

【ここにテーマを記入】`;

  async function copyCarouselTemplate() {
    try {
      await navigator.clipboard.writeText(CAROUSEL_TEMPLATE);
      showToast('📋 AIテンプレートをコピーしました！');
    } catch (err) {
      const textarea = document.createElement('textarea');
      textarea.value = CAROUSEL_TEMPLATE;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('📋 テンプレートをコピーしました！');
    }
  }

  // ============================================================
  // カルーセル：JSON展開
  // ============================================================

  function expandCarousel() {
    const raw = els.carouselJsonInput.value.trim();
    if (!raw) {
      showToast('JSONを貼り付けてください');
      els.carouselJsonInput.focus();
      return;
    }

    // JSONパース
    let data;
    try {
      // コードブロック(```json ... ```)で囲まれている場合を除去
      let cleaned = raw;
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      data = JSON.parse(cleaned);
    } catch (e) {
      showToast('⚠️ JSONの形式が正しくありません');
      return;
    }

    // バリデーション
    if (!data.slides || !Array.isArray(data.slides) || data.slides.length === 0) {
      showToast('⚠️ slides配列が必要です');
      return;
    }

    if (data.slides.length > 20) {
      showToast('⚠️ スライドは最大20枚までです');
      return;
    }

    carouselData = data;
    els.carouselBadge.textContent = `${data.slides.length}枚`;

    // JSONの値をUIに反映
    applyJsonToUI(data);

    renderCarouselPreview();
    els.carouselPreviewSection.style.display = '';

    setTimeout(() => {
      els.carouselPreviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    showToast(`✅ ${data.slides.length}枚のスライドを展開しました`);
  }

  /**
   * JSONのグローバル設定をUIに反映する
   */
  function applyJsonToUI(data) {
    // スタイル
    if (data.style && STYLE_DEFS[data.style]) {
      state.style = data.style;
      activateCard('style', data.style);
    }

    // フォーマット
    if (data.format) {
      state.format = data.format;
      activateCard('format', data.format);
    }

    // 配色
    if (data.color) {
      clearColorSelections();
      if (data.color === 'auto') {
        state.colorMode = 'auto';
        state.colorValue = '';
        els.colorAutoBtn.classList.add('active');
      } else if (data.color.startsWith('#')) {
        state.colorMode = 'custom';
        state.customColor = data.color;
        els.customColorPicker.value = data.color;
        els.customColorPicker.classList.add('active');
      } else {
        state.colorMode = 'preset';
        state.colorValue = data.color;
        const swatch = $(`.color-swatch[data-color="${data.color}"]`);
        if (swatch) {
          swatch.classList.add('active');
          swatch.setAttribute('aria-checked', 'true');
        }
      }
    }

    updateBadges();
    saveState();
  }

  // ============================================================
  // カルーセル：スライドプレビュー描画
  // ============================================================

  const ROLE_LABELS = {
    cover: '表紙',
    body: '本文',
    cta: 'CTA'
  };

  function renderCarouselPreview() {
    if (!carouselData) return;

    els.carouselSlideCount.textContent = `${carouselData.slides.length}枚`;
    if (carouselData.title) {
      els.carouselPreviewTitle.textContent = carouselData.title;
    }

    els.carouselSlides.innerHTML = '';
    carouselData.slides.forEach((slide, i) => {
      const role = slide.role || 'body';
      const roleLabel = ROLE_LABELS[role] || role;
      const layout = slide.layout || (role === 'body' ? 'G' : '');
      const layoutDef = layout ? LAYOUT_DEFS[layout] : null;
      const content = slide.content || '';

      const card = document.createElement('div');
      card.className = 'carousel-slide-card';
      card.style.animationDelay = `${i * 0.05}s`;

      card.innerHTML = `
        <div class="carousel-slide-card__page">${slide.page || i + 1}</div>
        <div class="carousel-slide-card__body">
          <div class="carousel-slide-card__meta">
            <span class="carousel-slide-card__role carousel-slide-card__role--${role}">${roleLabel}</span>
            ${layoutDef ? `<span class="carousel-slide-card__layout-badge">${layout}: ${layoutDef.label}</span>` : ''}
          </div>
          <div class="carousel-slide-card__content">${escapeHtml(content)}</div>
        </div>
        <div class="carousel-slide-card__actions">
          <button class="action-btn action-btn--copy" type="button" data-slide-index="${i}" title="このスライドのプロンプトをコピー">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      `;

      // 個別コピーボタン
      card.querySelector('.action-btn--copy').addEventListener('click', () => {
        const prompt = buildSlidePrompt(slide, i);
        navigator.clipboard.writeText(prompt).then(() => {
          showToast(`📋 スライド${slide.page || i + 1}をコピーしました`);
        }).catch(() => {
          showToast('⚠️ コピーに失敗しました');
        });
      });

      els.carouselSlides.appendChild(card);
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================
  // カルーセル：スライドプロンプト構築
  // ============================================================

  function buildSlidePrompt(slide, index) {
    if (!carouselData) return '';

    // UIの設定値を使用（JSON展開時にUIに反映済み）
    const globalStyle = state.style;
    const globalFormat = state.format;
    const totalSlides = carouselData.slides.length;

    const styleDef = STYLE_DEFS[globalStyle] || STYLE_DEFS['A'];
    const role = slide.role || 'body';
    const roleLabel = ROLE_LABELS[role] || role;
    const layout = slide.layout || (role === 'body' ? state.layout : 'G');
    const layoutDef = LAYOUT_DEFS[layout] || LAYOUT_DEFS['G'];
    const content = slide.content || '';
    const page = slide.page || index + 1;

    // 配色はUIの設定を使用
    let colorInstruction = 'お任せ（内容に合った最適な配色を選んでください）';
    if (state.colorMode === 'preset' && state.colorValue) {
      colorInstruction = state.colorValue;
    } else if (state.colorMode === 'custom') {
      colorInstruction = `テーマカラー: ${state.customColor}`;
    }

    // キャラクター画像の指示
    let charImageNote = '';
    if (characterImages.length > 0) {
      charImageNote = `\n\n### キャラクター画像
添付したキャラクター画像を図解内に配置してください。
* キャラクターの外見（髪型・服装・体型）は変えずそのまま使用すること。
* 図解の内容とマッチしたポーズや表情をつけること。
* 添付画像${characterImages.length}枚`;
    }

    return `# 命令書：万能・図解デザイナーAI（Nano Banana Pro専用）
あなたは、ユーザーの意図を汲み取り、最適なビジュアルを設計するプロの図解デザイナーです。

## ■基本方針
* ユーザー専属デザイナーとして、丁寧かつ親しみやすく振る舞う。
* ユーザーの指定した「スタイル」に合わせて画風を完全に切り替える。
* 不明点があれば確認の質問をする。

## ■スタイル定義
* **A：手書き風** — 色鉛筆や水彩のタッチ。温かみのあるパステル調。
* **B：ビジネス風** — フラットデザイン。信頼感のある寒色系。
* **C：ポップ** — 太い主線、鮮やかな原色。元気な印象。
* **D：ミニマル** — 線画のみ、最低限の色数。洗練された印象。

## ■レイアウト定義
* **A：並列リスト**（要点まとめ）
* **B：比較図**（VS構造、左右対比）
* **C：ステップ進行**（ロードマップ、手順）
* **D：4象限マトリクス**（分布、ポジショニング）
* **E：サイクル図**（循環、ループ）
* **F：ピラミッド**（階層構造）
* **G：お任せ** — 最適な構成を自動で組む。

## ■禁止事項
* 指定されたキャラの外見変更（キャラ使用時）
* 意味のない英語の羅列
* 実在ブランドのロゴ描写

## ■カルーセル投稿の注意事項
* これはカルーセル投稿の **${page}枚目 / 全${totalSlides}枚** です
* 全スライドで統一感のあるデザインにしてください
* ページ番号「${page}/${totalSlides}」を右下に小さく入れてください
* このスライドの役割: **${roleLabel}**

---

## ■今回の依頼内容

以下の内容で図解を作成してください。

### 内容テキスト
${content}

### スタイル: ${globalStyle} — ${styleDef.label}
${styleDef.desc}

### レイアウト: ${layout} — ${layoutDef.label}
${layoutDef.desc}

### フォーマット: ${globalFormat}

### 配色: ${colorInstruction}${charImageNote}`;
  }

  // ============================================================
  // カルーセル：全プロンプト生成 → ペーストキュー投入
  // ============================================================

  function generateCarouselPrompts() {
    if (!carouselData || !carouselData.slides.length) {
      showToast('先にJSONを展開してください');
      return;
    }

    carouselPrompts = [];
    pasteQueue = [];
    pasteQueueIndex = 0;

    // 出力カード描画
    els.carouselOutputCards.innerHTML = '';

    carouselData.slides.forEach((slide, i) => {
      const prompt = buildSlidePrompt(slide, i);
      carouselPrompts.push(prompt);

      // ペーストキューにテキストアイテムとして追加
      pasteQueue.push({
        type: 'text',
        label: `スライド ${slide.page || i + 1}（${ROLE_LABELS[slide.role] || slide.role || '本文'}）`,
        content: prompt
      });

      // キャラクター画像がある場合、各スライドのプロンプト直後に画像をキューに追加
      characterImages.forEach((img, imgIdx) => {
        pasteQueue.push({
          type: 'image',
          label: `スライド${slide.page || i + 1} キャラ画像${imgIdx + 1}`,
          content: img.blob,
          dataUrl: img.dataUrl,
          fileName: img.name
        });
      });

      // 出力カードを生成
      const card = document.createElement('div');
      card.className = 'output-card';
      card.innerHTML = `
        <div class="output-card__header">
          <span class="output-card__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            スライド ${slide.page || i + 1} — ${ROLE_LABELS[slide.role] || '本文'}
          </span>
          <div class="output-card__actions">
            <button class="action-btn action-btn--copy" type="button" data-carousel-copy="${i}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              コピー
            </button>
          </div>
        </div>
        <div class="output-card__body">
          <pre class="output-text">${escapeHtml(prompt)}</pre>
        </div>
      `;

      // 出力カード内のコピーボタン
      card.querySelector('[data-carousel-copy]').addEventListener('click', function() {
        const idx = parseInt(this.dataset.carouselCopy);
        navigator.clipboard.writeText(carouselPrompts[idx]).then(() => {
          showToast(`📋 スライド${carouselData.slides[idx].page || idx + 1}をコピーしました`);
        });
      });

      els.carouselOutputCards.appendChild(card);
    });

    // 出力セクション表示
    els.carouselOutputSection.classList.add('visible');

    // ペーストキュー表示
    renderPasteQueue();
    els.pasteQueue.classList.add('visible');

    setTimeout(() => {
      els.carouselOutputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    showToast(`✨ ${carouselData.slides.length}枚分のプロンプトを生成しました`);
  }

  // ============================================================
  // 初期化
  // ============================================================

  // ============================================================
  // 桜の花びらアニメーション
  // ============================================================

  const SAKURA_PETAL_SRC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB3aWR0aD0iNDAiIHpvb21BbmRQYW49Im1hZ25pZnkiIHZpZXdCb3g9IjAgMCAzMCAzMC4wMDAwMDEiIGhlaWdodD0iNDAiIHByZXNlcnZlQXNwZWN0UmF0aW89InhNaWRZTWlkIG1lZXQiIHZlcnNpb249IjEuMCI+PGRlZnM+PGZpbHRlciB4PSIwJSIgeT0iMCUiIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGlkPSI5NzFmYWVhMTViIj48ZmVDb2xvck1hdHJpeCB2YWx1ZXM9IjAgMCAwIDAgMSAwIDAgMCAwIDEgMCAwIDAgMCAxIDAgMCAwIDEgMCIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIi8+PC9maWx0ZXI+PGZpbHRlciB4PSIwJSIgeT0iMCUiIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGlkPSI2ZGI0ZDVkNmZlIj48ZmVDb2xvck1hdHJpeCB2YWx1ZXM9IjAgMCAwIDAgMSAwIDAgMCAwIDEgMCAwIDAgMCAxIDAuMjEyNiAwLjcxNTIgMC4wNzIyIDAgMCIgY29sb3ItaW50ZXJwb2xhdGlvbi1maWx0ZXJzPSJzUkdCIi8+PC9maWx0ZXI+PGNsaXBQYXRoIGlkPSIyMjE5OTIwYjk0Ij48cGF0aCBkPSJNIDMuNSAwIEwgMjYgMCBMIDI2IDI5LjAzMTI1IEwgMy41IDI5LjAzMTI1IFogTSAzLjUgMCAiIGNsaXAtcnVsZT0ibm9uemVybyIvPjwvY2xpcFBhdGg+PG1hc2sgaWQ9IjBhMmY2YjQ1NGIiPjxnIGZpbHRlcj0idXJsKCM5NzFmYWVhMTViKSI+PGcgZmlsdGVyPSJ1cmwoIzZkYjRkNWQ2ZmUpIiB0cmFuc2Zvcm09Im1hdHJpeCgwLjA4NjY5MzUsIDAsIDAsIDAuMDg2NTI2NywgLTguMzM4NTAxLCAtNS4zMzg4MTQpIj48aW1hZ2UgeD0iMCIgeT0iMCIgd2lkdGg9IjcyMCIgeGxpbms6aHJlZj0iZGF0YTppbWFnZS9wbmc7YmFzZTY0LGlWQk9SdzBLR2dvQUFBQU5TVWhFVWdBQUF0QUFBQUxKQ0FBQUFBQzQ1VXNUQUFBQUFtSkxSMFFBLzRlUHpMOEFBQmtZU1VSQlZIaWM3ZDFwdEIxVm1jYnhaKzlLUWlZSVJBZ2lCRVFtRVFWVUVLTW9Eb0NoUVdSMnRZTGFTanYxb29GRmc0MjJ1cm9WMjNheEZGQnhXQzRuRUcxQXBVRXhpSUxNaENGQ0NBbUVFRUlJSklIQWhRUnVrbnVyOXRzZkVpQmlnQ1MzNnV4ZHRmKy9iM3doKzlSNTdudmUvZFkrZFNRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU5BbUx2WUNVdWNreVdLdkF1dXFpTDJBeEhtVEpGZndoOThTdkZFdnlkbm9jUnBZTmlDcE1LTlFwNDlBdnhSbkgvM3M1aHBZY3ZjdHQ4NWVLUlVXWXE4STJIQ0ZQbGxhTUxOZ3kyNzgwajdESmU5anJ3bllVSVUrMEc5bFZWVlZXVm13L3FzK3RhWGtpRFRheVd2M2g2MDBNek1Mb1N3dDJOd3pkeWZTYUNldkxXNTVOcytyTTEwRmUvS25reHlSUnZzNDUzNjJacDdOekVKVkJldS9jRjhuejJZYTdWTG9kS3VDdlZCVkJ1cy9mdzg1SW8wMjhUcDRoZjE5bnMwc2xNSDZ6bm8xZlFkYXhHdjdPVmF0TGMrckk3M2doTEhNOE5BV1RxTisvOElHK29XTng0MlRSU3VOZGlqMDFaZktzNWxWbGEzOHdiWVVhYlJCb1VNSDF0NUFyOUYzVkpVOStMRkNKQnFwODlybGdSZHRvTmRzcGMxKysxcmFEaVRPYWRTVWwyazRudTg3Rm4zU1U2U1JOSyt2clZ1ZVY4MDdMdGlXSW8yRUZUcDg4T1VhNkRXS2RHbjNIODVNR3NueTJtWGVPalRRYXhScFcvbjEwWHp6QjJseUd2V0hkVzA0bmkzU2xWMjFxL2lTRmxMa2RjWjY1dGtzbExiZ0tOb09KS2pRWVM4N2dWNXJvZ2UvTXB4cEIxTGo5Wm9YUDhMeFVxcktmcnNWalRUUzRqVGlzdlZ1T0o0cjBqUDJwcEZHVXJ5K3NFSDFlWFdpRngzTlJCb0pLVFI1K2ZvMzBNOHBiZkJVT1JLTlJIaHRkODhHRjJnenN5cll1YVBZR2lJTlR2NUNHeHhDbnMycTBpN2NqRVFqQ1Y2bkQ2ayttNW1GMHE3WmdXRUhFbERvUFU4UG9ZRitQdEV6WGsraUVaM1RsdE0zY0dMM3drVGZ0eGVKUm1STy9vSTY4bXhtcFMzWW4wUWpya0luck8wcEhCdVk2Q2NPSWRHSXlldnRmVVBlRWE2UjZDY1BJOUdJeDJtTDIycHFPTXpNckxLbFI1Qm9ST1Axd3pyemJGYlowcU5JTkNMeE90NUNUUTMwODRrK25FUWpDcTgzUFZwZkEvMWNvcDk4UDRsR0JFNmIzbFJ2dzdFNjBYM3ZJOUhvUGE5dk41Qm5zOUlXdnBWRW85Y0tmYVR1QnZxNVJOKzNHeWVWMEZ0ZWV5eXN2WUYrTHRIVGR5VFI2Q1duVGE1dHBPRlluZWdiSjVCbzlKRFgyYzNsMmF5MFg0L2l0MDNSTTRXT0M4MDAwS3VFMHM3bFcxazlsZlUyM0lmZHp4OXJEZllFenRsYlZsN3YrWTF3OUlMVHhsYzMyWENZbVlWUWZTenZxb0dlOFRxejZUeWJWZGEzTDRuR21yeHZwQTB0OUtGR0cralZTcHU1SGFNT1BHZFZtRjFSK0hxZjR1SzEyOE5OVGFCZmtPakx4ekRxNkpYa1B3eWRqZGhsL0xBd2FHWW1WOVFXYW1jYi8zejNxaGN2MzFjN2o1MUNvSHNrOVF2dGJPVFpIMTZ4Zk9IY0IrYzhNUC9oWnlUSmVaa05lWERndzFrbjlpVFBrcG4vNXg4VlZVLytyZXlsSCtoelRnaXJPdENxNzZIWjk4NmNNVzkxcW9jVzZxTDY4SGs5ZS9YQkx6bGtxZys5K2NjeWwzaWdmZmpFajRLY3llUldOZFBMNXMyZGRzZjk4NWRKa25jYm1tb2Y5cHl5WmVqWlZxMHFicCs4eERHT3pwN1hHeGMvdDNFTG9TckxWZi94NUIyL09PMjlyL1RTcXQzaWV2OS9uY1pkMy96RTdtODJoajlPdlhhZ2VVN0RYL2lESnlGVVpSbk16QVlmK3VNM1A3clhlRW1TWDgvTm90TzVQYzJ6aGNvK2xmNEdIQTN6T21XdGc3VVF5dFdwN3AvOW0zL2ZmOXRDV3E5UWUzMjZ0cWR3ckd1aXJlOHRUS043SU9YUFFSOWVkOVdMTjdwbXR1cUhlbXpoM1ROdm5UWjNwU1RuRlY2K1V5MnFTWmR2MnJzR2VwV3F1T0dnWmJUUldYTjZ1Y2R6UGQrQTlFMzl6ais5YVp3a3VlSmxmaGpDMS93VWpuVlUycG1VNkt4NUhWS3R3L05Bbnc5MS85M25uL1NlTFNSSkx4RnE1L1NUQ0htMllDVlBDTXVaMDhqcjFqbDRJYXdlZ0F6T3ZmaTB0Mi91cEJlOXExam9KQ3Q3MjBDdlV0bU1MWk51OGRDb1FzZXY1ODR0VkdWbEZtemxuRXMrZjhBRWFhMmhMblJnRGMrQjNpQ2xmWSttbzJuSlZneG5tMS8zMnZYZnVabVo4NUxDZ2x0dnZtM0dFcjN3N29zUDIwL1p1ZGNid21mWDVzSUhMK2FHWWFhOFR0M0FzM0RQTmRVRHN5OCtjYSt4a3VTZmJhbWRSbDhlbzRGZXBiSlpXNlZiUXRBa3AxZHUyRys2cnJZcTFNR1czL205aiswMlFzOTJIMTdmaUpkbnM5SytROU9ScDBLbkR6bDV6L2JVZmRlZGNlRG1rbFFNMDBlckhwenBmL0VWMmVCQlREb2FsZWdIb0xPdHI5dStobGJYRk9TOEZPYmZjdVhOOXczWXZwZThJbElEdlVyd3QrelA3WlVNRlRxdHRtK1RQTnQ5UEhuOUZ3NmJHYlBoTURNcjdVdVU2Q2FsV2FHZHZlTDZEUmh4dkRoYlBmeXcyQy9ZWE44QnR6UHBhRTZhV3hTdkQ5V2FaemxmdUZCVlpySC9nRjIxMlgrSVBEY255WTgvRjhhYzlhcTZzK2VjOXduOC9UcnRPbnNHajU1cFRQeDNlQzI4M3ZmbVJtcHA3UG9zeVpsT0h4OFNXRWhISlJub1NoOVhaOTl6SDk3d21SVCtzam9xeFN2cnc2U3JONHJlN1RZbStFZjN2WTk5WVVPU3JOQTZkcU9xczNtV3J5YWNFbnNOM1pWZ29GMlkrUDRrUHpucTRuWHMyNkxlM3VteUJLK3IxMEVUTzl0QlM1S3J4cHdzNWh6TlNDL1FydkxIcUxzZHRDUjVIVG01eWNkUzV5eTl5K3IwdG5ja3VLdzZ1Y3FkUEt6VEgwTHhwSmljSTBkMGVFc29TZkoyNEtGSlh2cjJTKzZxdWpCK2NxZTNoSkxrZ2s3cS9GOXRITWtGMm12U2F6c2ZhSGw3eHhIZGY1VXhKQmRvMHhIcWZ1MXlRWjhaUVJmZGdOUUM3Y0pXQitSUXVyeTk4K0RrTG40WHBIWk52ZDQ5c2RzenUxVmMwS2RkOXorSmVpKzFRQWNkME4xelNXdnllcy8rT1h3VTlWcGlnWGIyeXYzeWVKdGROZXg0YmhmV0w3RkFlKzJ6ZlE0ZGh5U3ZRL2JpZG1IdEVydWlwc2w1ZEJ5U3EwWi9JdllhT2lpdFFMc3c3bDE1ZEJ5U3ZJN1lpVU4zZFV2cmdqcTljYWRzQXUycUNjZGs4Mko3SnJWQTcxdmtNOHR5T21hVGZGNXRqeVFWYUZmcGJiSFgwRU11N003Tmxib2xkVDJkdHRzem93OWhaL3B3QnJmNWV5dXhRTys5VlNaRE8wbVMxMzU3Wi9RSDNCTkpCZHEwVHk1RE8wbVNxOFllRlhzTlhaTlNvRjBZUGluMkduckw2UU9iNWZRWDNBTkpCVm83N0pyVWdocm53aTRINXZXS0c1ZlMxWFI2L2ZpOFRqYzQwMUU4dXJGV0tRWGF0SGRXTGJRa3IvMTI1a0JIblZLNm1FRjd4RjVDcjdtd3hmdVljOVFwb1VBN2JiRnpkbSt1NlFqUEtMcEdTUVY2aDYyekM3VFhQbS9LN2tVM0thbEF2ejYvNzQyNmF0VEJzZGZRS1FrRjJ2U0dETC9DNFRSNVpIWi94ZzFLSjlBdStOZkZYa01FVG51K2daNmpQdWtFV3RveW43UFF6M1BWU0w0c1c2TjBBdTAwY2NzODM5bURNam9EM3JpVUFyM055UHhhYU1scno5M3kvRU51UkRxQmxsN2Q4Y2RDcjUwTEcrZnpQY3JtcFJObzA0NFpEamtrbWQ2bEt2WWlPaU9aUUx1Z0hXT3ZJUTZudmJhaFJOY2xtVUJMNHpKOVc1MU4zQ3VsOTZIZGtybVFUdU1uWkJyb29QM3piTGFha0V5Z3BhM0h4VjVCSkU3dkdNM053cG9rRTJpbjdZZGxldFRkYWNmOGpoazJKWmxBUzF0bE9iV1Q1TUxvZlFoMFRaSUp0R25yMkV1SXhqU0pMMkxWSktGQWJ4RjdDZEU0N1RrMjAwK24yaVVVNk0xaUx5RWFweDF5UEpmVmlGUUM3VFR5RmZtK3AyRXNUMUNxU1NxQmxrWnRFbnNGMFRqVG01bEUxeU9kUUk4Y0dYc0Y4VGk5Y1JTVDZGcWtFbWluVWFOaXJ5RWVwNTIycCtlb1JTcUJsallaay9GYmFwdnVrdkdycjFNNmdSNlhjOHNSdER0TmRDMVNDYlRUeUNMMkdxTGFnMERYSXBWQVM4Tnpma2VkZHVIV1NpM1NDZlNJMkF1SXlXbnJpVFRSZFVnbjBNTmpMeUFxRzhlQnUxcWtFK2hoc1JjUWt3dDZmZXcxZEVNNmdjNjlQdTJROHg2aVBpa0ZPdTgzZEtmaDNDdXNRVXFCenBuVHhBbXgxOUFKNlFRNm5aWEU0RFFodjRkak55R2RHR1grbFEwYnhkeXVEdWtFdXN6Ni9YUkIyOGRlUXlla0UrakIyQXVJYmJ2TWQ4WDFJTkRKMkpaQTF5Q2RRQTlrM1hMSWFldFJuT1lZdW5RQ1BaaDdmWHJWK05ncjZJSlVBbTE2SnUrZXcybmMrTHcvbytxUlNxQ2xwY3RqcnlDeTBjenRhcEJPb0pmMVo3MHBja0ZieFY1REY2UVNhRk4vZit3MXhHVUV1ZzZwQkZwYWtYbWdtZHZWSXAxQVAvTjQ3dS9uSzNLL0FIVklKZERtd2hPeDF4RGJlTThnZXNoU0NiU2Nub3E5aExpY3hvK092WVlPU0NqUWo4UmVRbXhqTW41MlZHMlNDYlFJOU1pTkdFUVBXVUtCZmxBKzUwMlIwK2lOWTYraEE1SUp0R25lMDVuWHA0d2ZLRnlmaEFLOXBDL3pzZFZHRzlOeURGa3lnWmI2SG82OWdzaGN4bytyckUweWdUWTM4RURlRmRvME52WVNPaUNaUU12cm50aExpSXRBMXlHZFFFdHpzeDV6T0ltV1kralNDYlJwZnBuNW5vZ2JLME9YVHFDbCtVdXlicUtOQ2wyRGRBSnRlbVJ1MW9ITy9BR3NOVWtvMEg1Z1Z1dzFSRWFnaHk2ZFFNdHBldXdsUkpiMXIzTFVKS0ZBbSs2b2lxemYwYXgvbGFNbVNRVjY5c041bDZpOGZ3ZXNIZ2tGV2xwMFg5NkJ6bnhxV1l1RUFtMWVkOFJlUTF3RWV1Z1NDclNjYnN6NlhpR0Jya0ZLZ1RaTmZ6enI5elR6Wjc3WElxMUF6NXVaOVp0YXhWNUFCeVFWNktLOEx2WWFvaXBqTDZBRFVncTBwQnV5YnFMemZ2NXFQWklLZE5EdEQ3aU1BNTM1TTk5cmtWU2d6UzIrTGVkSk5DM0gwQ1VWYUhsZG0zT1JXaGw3QVIyUVZxQk4xeXpMdG9sMldoRjdDUjJRV3FCblRzKzE1ekFwK3djSzF5Q3hRQmZWSDNJTnRKeWVqcjJFRGtncjBETDljVVcrUjBpZmliMkFEa2d1MEhmZW1tdUpka1lQUFhTcEJib1l1RExYUUt0Y251MUxyMDlpZ1picDh2NWNlNDRWUzJPdm9BUFNDL1MwbS9NOG9HUmF6cVp3NkpJTGRHRVg1WHB2WlhuZXY5UllqOVFDTGRPVXhUN0xFcTBWM0NrY3V1UUNIZHk4UDJkYXFKWnlZMlhva2d1MHZDN0s4Z3lwNlFuR2RrT1hYcUNEcnB5VzV4blNwNVRuNjY1VmVvRzI0cGtMOCt3NUhzOTFOMXluOUFJdDAyOGZ5M0lVdllCQUQxMkNnUTV1OXU4eUhFVTdMWXE5aEM1SU1OQnkrbmwrRDdrenA4ZGlyNkVMVWd4MDBGLytsRitKZHYzejg5dzYxQ3ZGUUt2UXp6TGM4Qzk5Z2tBUFhaS0JEdnJkdE54RzBhYkhub3k5aGk1SU10QldMUHRSN0RYMG1tblJzdGhyNklJa0E2MmdDKzdLN2tESG9nemJyUHFsR1dncm52cHg3RFgwM0h6RzBEVklNOUFLK3RXY3ZFcTAwOE1FdWdhSkJ0cUtSVC9NYXM5dlhnL0ZYa01uSkJwb0JmMTBkcEZWaWU1Zm1OVmZjRk5TRGJUNXg4Nk52WVplTWkxK2hFRFhJTlZBeS9Uem5BWWRwa2NlajcyR1RrZzMwRVhmMmNxcFp0MC93TlN1QnNrR1drRVgzSkRUN2NKNUNiOFhMWkx1UlRTLy9NeHNialdZMHoyeDE5QU42UVphUVpkYzdITHBvdjNBM0p6NnErWWtIR2g1ZlgxWkp1ZWlUWXM1UEZxTGxBTWQvTzAvek9aYzlJSWxzVmZRRFNrSFdxWnZ6YzNqN29wcHptQXUrNFZtcFIzbzR1R3Y1akc2YzVxVjlsdlJHbWxmeGFEei81REQzUlZ6bWhsN0RSMlJkcURORDM1NWFRNzdRdmZVbkN3K2lacVhkcUFWL0sxblo3QXZORDMwRUlHdVJlS0JsdWxiZiszK3Z0QTBheWw3d2xva0graWk3L1NCRE82QXowaituV2lKNUM5ajVhLzRidGViRHZPYUhuc05YWkY4b0dVNjQ2OUZGWHNWelhKOTk5QkMxNk1GZ2ZhUGYzNncyNU1PMDl3SENYUTkwZyswZ3AvUzhVbUhhZnB5OW9UMWFFR2daVHJqdGs0M0hVNS9iY1ViMFFadHVJNVdQSG5pVXgyZTNabXY3cUxqcUVrYkFxM0szL2psRHAvcE1DMjh0N3V2cnNkYUVXaVp2bjF4ZDg5MG1HWXVqTDJHem1oSm9IMDRaVmFIbTQ2YjFPMHhUZysxSTlBS3hmeVRWM1QwaHFFVnVpSDJHcnFqSllGV1ZWenhYeDJkM1prV3pPem9TNHVnTFlGVzBEZCsyYzNabldrV0xYUnRXaE5vODlYSnQzY3owYm85ZExTYmlxQTFnVmJ3aTA5NG9vTWJRL082bVFmcDFxWTlnVllvYmpxMWc5Tm9jd3VuMFVMWHBvaTlnUFZnZnRydy9heHIxU3o0Njc4WGV3MGQwcUlLTFpuKzg1SU8zbCs1cmxWbEpYSHRDclFmL05UVWptME1yUWhUdTlkSHhkT3FRQ3Y0UnovNVVMYzJocWE1MHdsMGZkb1ZhSVZpK25GTE90VjFtRzVmd2xubytyUXMwS3FLYTA0YTdOTFUxdW1hMXIwSktXdmR0YXlLWDV6U29lR2QrYWR2Nk02clNVRDc5dGZtcHhiN0JkZVI0WjI1Vzg3c1VnY1ZYZXNxdEdUNnlubEY2RWhWTTExYmNuUzBSbTBNdEJ2ODdHODZNdXF3SWx4TngxR25GZ1phNXAvKytCWGRHRWViNXR4Qm9PdlV4a0FyK0tjK2RsTW5FbTI2Z2FGZHJWb1phQVcvNkNOM2RTRFI1blJWUzkrQ1ZMWDBhb1ppemdmdjZVQ2kvYVBYMDNIVXFxV0JWbFhNT25wMjZ4TWROSFVlUjBkcjFkWkFxeXBtSEhOZjJ4UHROS1dGZHdLUzF0cEFxeXJ1UEdwT3V4TnR2dTh2ZEJ6MWFtK2dWUlhUajJwMzF4RjAyeXdDWGE4V0IxcFZjV2ZiKytnL0dyY0o2OVhtUUtzcXBoODVxNmphR2drcmxrNmhRTmVzMVlGV1ZjdzRmRnByRXgxMDg5MEV1bWJ0RHJTcTR0N0RyeC9XMHBOS1RsZlNjZFN0NVlGVzVlY2ZlV1U3YTdUNVpYK2lRTmV0N1lGVzhJOGVjMmtyYTNUUTFEc0pkTjFhSDJnRi8rU3hQeTZzZmNsd3VveU9vM1lkdUU5bGZ1WHZScnhUMXJMdnNKanZPLzF4VHRyVnJRT0Jsam45K1psM0R3dnRTblR3VjN5WGpxTjI3Vzg1SkpuOG1jZjIrVmJkWWpHblN6dFJUaExUaVVETHJManc2SWRhTmV3dy8vQ2ZPR2hYdjI0RVdsWVZmejd3OWpaOWRkWjA5VU4wMFBYclNLQ2xxcmpuME4rM0o5SG1kVkYzTG41Q3VuTk5LLy9Ja2Q4dHJDV2Y0dWJ1dXBxT293SGRDYlNDR3pqaHhJR1diQTFOZjFqV3BTZWFKYU5EZ1piSm5mUEJkbXdOclZoNVNldzFkRk9YQWkyejR0TEpON2Foa1E2YWVndEQ2Q1owS3RDeXlzODg1SUwwRzJsenVxRGl0bmNUdWpiYU43Lzhzb0YzREt2U2ZwaWorUVduUHhWN0VkM1VyUW90S2JqcXE0Yy9tSGpiWWZyamZJYlFqZWhjb0dWV1hIN2dWVW0zSFZib04xMzdNUzgwcU5DWU0wc3JMVldWM1RxU1FEZWpleFZhVXVYNy8rMjRSMU9lMzEyd2dpMGgxb1B6ZXNOZnJLcGkxK0sxQ3JaNHgyNVdrZ1IwOUxwYThIY2RmSmI1Skl0MDBKUTVMdUVXSDBueVRvZmRiMldJWFkvL1RyQndRRmNMQ1Jya0NyMzZzZ1RianNwdUhNR1dzQ2tkcmhSVytYbEhmKzdwQk51T0N3YllFbUpEZUs5SlU2MU1xa2hYTm44aUJib3hYYnYxL2JkTXhmeGZEOXRyZUVwM3dvTS8vMWNjSE1XRzhrNy9NRE9oSWgyc2Y1OHVOM3BvbXZPYThQM0JaTVlkcFhIWEcwUGpwYVB2VDJUY0VZSWQxZkUrRDQxelh0dWNWMXFWUUpHdTdKWXhWT2dHWmRITldmQUxqanQ2dGsvaUJONHZubUZtaHlGelhsdCtkeUQ2NXJDeUIxNUpnVzVTRmhWYWtwbC85RitPbkZFbzdzbC8wOFdMbU5rMUtaLzlpWGwzNzYvS040ME1FU3VrK2FXbkxPS3JLcWlIODA2VHJyWVFiNEpYMnM5b09GQWY1elhxWHgreEt0SzhJOWpLZmJOcDh0QVQzbXZIbnd4R0drcVhkcm1qUXFOV3prdVRiNHZTZDRSZ1IxQ2dVVGZ2dGNucGk2M3FlYVJMdTNrakNqVHE1NTEyT205bHIvdU9VTmtuTXBvcW9ZZWNsdzZhYXFHbjkxa3F1M05UQ2pTYTRaM0duUEJnVC91T3lrNmtnMFpUbkhmYTVweW5leGZweXVaTW9FQ2pPYzQ3dmVYU3NsZVJMdTAwT21nMHlua05QL1JHNjhudXNMSUh0cVpBbzJIZWFjeG43dW5GVkxxMC82YURSdk84MCtaZldOaDRwSU10Mm9sQW93ZWNkOXJwbkw2R1crblMvb2M4b3plY2wzYjd5ZkltSXgxczhjNEVHcjNpdmR3N0x4bG9ydkVvN1Z2a0dUM2tuZndCVnpZMXd3djIyQzRFR2ozbG5VWjg0T3JReUdIcDByNUpudEZqemp0dDlJODNoL3FyZExERnJ5WFE2RGxYT0kwOTdqWUxOVWVhRGhxUk9PKzB5ZkczMWx1bGd6M0tEQnFST08rMDhVZHVzaG9uSHFXZFFaNFJqU3VjUmg5M1ExVlhwQ3Vidngybk9CQ1I4MDZqajd5NnJDZlNwWDJSWTNhSXkzbW5FZSsvZEdVTmthNXNEay8vUW5TdWNQTHYvZCtsRnNxaERhWXJPNVVPR2dsd2haTjc4dytlc0RDVTg5S1YzYnNGQlJwcDhFNTYzZGZuRFdVd1hkbG42YUNSRE8rbGJUNDNQV3hvTTgwRHpwRVk3Nld4eDE1WGJ0QkREMEt3RDFPZ2tSYm5uVVllZEdIL0JuUWVwVjNMcjhZaU9jNDcrYjNQZm1SOUl4MnNQSVFDalFTNXdrbmJuWEtYaGZYcFBFcTdpUHFNUkhrdmpUdnU4cWZYdlV3SFd6NkpHVFNTNWIxVXZQVTdqNnhybVM3dFhQS01sTG5DU2R1ZU9tMXdYWjVPVTlsQ3ZobUwxSGtualpsOC9oTVdxcGNwMDZWOWhUd2pmZDVMMnZXTGR3ZDd5UzhnVm5idmxtd0owUWF1Y05LNFl5NWRhdUZGN3lEeWZITzBpZmVTMy8yLzdxck15clZtdXJUclJsR2cwUjZ1Y05JbVIveDJxWVcxSERFTlZyNlBEaHJ0NHIxVTdQSEZXd2Z0Nzc1Vlc5b3ZxYzlvSFZjNGFlU0JQMTFrd2RZczA4SDYza2lCUmh0NUwrazFuN3lpZjgzV283UXp5VE5heW5rbkZYdC83YzdLYk5Wd21wRWQyczBYVGhwMzBQY1hXckNxckNvN25wRWQyczE3U1JNLzhYK1BXeWp0enh5RFJ1dTV3a3QrdDlPdTZsL3hianBvZElFdm5GUzg4d09VWjNTRkx5VDZqVmk0OEExd1RpSDJHZ0FBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQWlPUC9BWFZIQ2xIT2hKZHBBQUFBQUVsRlRrU3VRbUNDIiBoZWlnaHQ9IjcxMyIgcHJlc2VydmVBc3BlY3RSYXRpbz0ieE1pZFlNaWQgbWVldCIvPjwvZz48L2c+PC9tYXNrPjwvZGVmcz48ZyBjbGlwLXBhdGg9InVybCgjMjIxOTkyMGI5NCkiPjxnIG1hc2s9InVybCgjMGEyZjZiNDU0YikiPjxnIHRyYW5zZm9ybT0ibWF0cml4KDAuMDg2NjkzNSwgMCwgMCwgMC4wODY1MjY3LCAtOC4zMzg1MDEsIC01LjMzODgxNCkiPjxpbWFnZSB4PSIwIiB5PSIwIiB3aWR0aD0iNzIwIiB4bGluazpocmVmPSJkYXRhOmltYWdlL3BuZztiYXNlNjQsaVZCT1J3MEtHZ29BQUFBTlNVaEVVZ0FBQXRBQUFBTEpDQUlBQUFBUzdJT1lBQUFBQm1KTFIwUUEvd0QvQVArZ3ZhZVRBQUFnQUVsRVFWUjRuT3pkNlpOYzE1bmYrZTl6N3BLWlZZWENRaFEyVm9Ha1NKRmlGYnBKV2kwMUtiY3N5dDIyWThJUk00NEpGaDB4bm9oWkl1Yk52TFQvQUFBenI5MmVOL1BhUzB4TWoxRnl0Q2ZHNDdDbUY0TGRhalc2cllWU0kwc3RpUnRRUlFMRWprSlZMamZ2UGMrOHlNSWlOa1dSUUFHNS9UNGhSVUFKQkhSUW1YbnY3ejduT2VlQWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUlpSWlJaUl5T2RpZ3g2QXlOaHk5Ny81b3BtK2RDSXlpWFR0RTNrb1BqRnRzTGEyL1l1RkJSUStSRVJFNUVINGJaMnEwKzExZTcxZVdaV2xsKzd1cDA1dC85NzU4MzcrZlArWGd4NnZpTWhEbHd4NkFDTGo1azZBNkYyN2RYWHFadDdKYTFWdEs5K3FVL2UzTC9yOGs5MTJwOWZheXY3c083enlDdEQ4OXJlWFgzbmxxYTkrOWZUcDA0TWN0NGpJdzZTS3JzaE84bE9uV0Z4a2Fjay8zTExOSGx0RmpQM3ZtWHRJa2pSVUdkVzBuWi9mdS9EdXhieWVXZ3B2dm5GeWRmVzF4ZGVXNXBaNFZmTXNJaktlZEdrVDJURis2dFQyTDVaZXNURGxiU3hrbEQzTU1DTUVRa0pWeHJMalNiRFV3b0djZzdNWHYzZTIvTENjLytHTEhMLzdWeWwyaU1pWTBVVk5aR2U0TzgwbXE2dCs5UGw0Y0Q1Y0s2M0NZM1U3T2ppT201azdJU0hQc2VDOU5vYnRTcmVPNUxYM0NXa1duc3Z2L1RzVk8wUmtiT2h5SnJJRC9JVHpEWGdWUC9laE5YYkhEenNoQmk4TCs0U3YySGJ5QURjQ3RUckVXSFpvWk9YK1dscGhNNW50VXV3UWtYRVRCajBBa1pIbjd2Z0tiOEszMzdJblpxc1BXNEhzbDZRTndQb0p3akE4ZXJkRnB4UElRNW5uYTYzcWNzdXVkWUc0Vld6LzhTYitobGF5aU1qSTA1T1R5SVB5czJkWldzSU1kODVlSmphOHMvVkwwc1luL3dVQTdvU1Vlc09MTnBsMzlxU05vM3ZqZTBYNE56bkg0VFM4Q3FwMmlNakkwc1ZMNUlHNE8ydHJuRG5qajgzYmtXZnBwSFE3R1BmMzVmTCtQRXU5NGIyT3A3RTZQSjE4TDRSLzJPQ2VBb2N5aDRpTUlsMjVSTzdmM1ptT3R6OGttNGxYaWhDZEdIbVFUT0R1Umo5MnhGNmJSZ2hIcHN2emx2NTY3ZDQvcGRnaElxTkZQUndpOStsdTJyaFZNTGVQYTBXdzlFSFRCdjBvWVhqMDlsYUlGcW82NzJ4NHVua1plaHZGblQrbExVcEZaTFFvY0lqY3I1VW00TTNMN01vNTF5S3BlYS83b0duakRqTXp3eXR2YlVLV0ZlbSt0eTdidFU1MWNhdTZkVTgvcVRLSGlJd0lCUTZSKytHblRzRUdyNi9RcmVKUHJrUG1uZlpEbU9Zd002TXM2SFlTcTRWcnBWMXVGMlYxODcwdUoyRUpmdGtwY1NJaVEwYUJRK1J6YzNjV0YySGQvOGZuYmJiT1prbW5Zdy92eG0rR1FhY1ZxaXBRcjcxM2F5YTJWNDV6NDcwQ3RHNVdSRWFEK3M1RVBwODd0L2JpM01WOGV0clhDdk5BcjlpeHlaUmY5Zjl0YVU3QVE2ODMzMGl2cE9IL2F0elpFMTJkcENJeXRGVGhFUG1jVGdNVTcvWXVQWEhJMXdvTHVaZVBKRzF3dTdHaktpaDZabFBwK1k2bmJZNFQzOS91NmxBbnFZZ01MVDBQaVh3T2ZzcVpoVE1VcjdWUzJ3cGwzVHZ0UVh5TDNCMUxNNUlRS2JwUDdNb3JUL1pQQVRUaFc5Z0pmYlZGWkxpb3dpSHlXYms3aTdCQjlXb3JxUmVoQlozMlEyemQrRFQ5WnRLZUY3MFFHclZ6bTl4cys5VTJ3TGRvempWUDNUNjNWa1JrU0Nod2lId20yMU1WUzNTKzJpMlhxbkNySktTNFA2TEpsRTlrWmtSdnQ0Sm55WWI1eFUzZ3hqKzZzanEzK3ZMOHZKODlxK2tWRVJrZUNod2luODFwZ09MZDhzb1R0ZnpEamxudDBiVnVmQm96TTRvdXZTcFVkZi9SNWFuNStqZVBQcit3dnM3U0VrMzhoREtIaUF5RmdWOHVSVWFBbnpyRjdNdWNXU2hlYStmV29Vd0gxTHJ4eS9VWHNOU25ZdFgxdlNFazBZN3U1eVI4QTE3VjZoVVJHVHhkaGtSK0JUL2h6RFdaVzYzbVhtRmhKcmxaVWpyK3dGdVlQd1R1MGRJOG10T3c4UHcrUDFmYUV5bE5XTVZlSDdyUmlzaEUwWlNLeUtkeGQ3NEJsNWZpL05mTDUzZlpSZ25KY0tZTndDeFE5a0lWUXkvekgxMnh1ZFRmN2JJSzgvaFpyWmdWa1VGUzRCRDVWS2ZoVmZ4M3l2REtvZnhDTHlUMTRXamQrT1hNaU5IYmJiTmEvT2tWbStyNlFvdDFXSUptVTVsRFJBWkZnVVBrbC9KVFRoZE80bnVLK0pPclJrWjd5NFovSXJKLzdsdTdGU3lQRndvNzJQT0ZjNXc4eWRJU0t6cDdSVVFHWStndm5TSUQ0dTc5N2djLzBLN20yK0Y2Rlp3ZE9IMytFWExja2d6ek9PMzJUdGYrNGVQY0RodHFJeFdSUjB3VkRwRlBjR2ZYRFg2enNCY3N2VVZJc2poU2FRTXdqTEpIR2NOVzhLTTFuT29IZHpkQkgrellSR1RTS0hDSWZKTFRBUDV1eWRHY3RSWWhwMWVFa1VvYjI4d2dlbFVGci9OWFZ6Zi9WcnU4MVFGbzRxZVVPVVRrMFZIZ0VQazRQM1dLN2hvbm9kT0xmMzJWS3FHOU5laEJQUWl6R0wyOWhlY3piMVZwdFBoT2gxVkFtVU5FSGgwRkRwRmY0TzRzTHJKeHh2L3VCelpkaEJiMGVvTWUxQU16TS9CMkt3azU3OTRxWjhycXlWYi9kNVE1Uk9UUkdNRVNzY2hEYzZlendkYytzbjB6OFdldFFPYTk3Z2lzVFBsc29zZFFtOEo2dlFOcGVqNno4MVBRaEZWNy9mVkJEMDFFeHB3cUhDTDNhRFlCdjNEWkZnN0dkN3NoblJxbnRBRUVDMTYwaVdsMnNXZUgzZWMvZ0ZVV0Y5VkRLaUlQbXdLSHlEWjNaM2FXbFJWdnhmalhWME1aYUcyT1Q5YTR6VEF2T25qaVY5cng0RlE4OWdwTFM2dzBmVmtuMm92SVF6UitsMU9SKzNGM011V2RENnRzVjNLNWF3NnhHdGZ2aUx0Ym1rZXJmRjhhUHR5MC8rM1BXVnhrYVVsSHJvaklRNklLaHdnQUowNEQvdWI3ZG5BMnZWWllrdnY0cGczQXpHTFpEUjdzV21XSFp2eS9lNFdsSldqNktkVTVST1NoVU9BUXdkMVptc05PVW5wOHJ5RGtYclRIcVhYakV3VUxsRVZ3aXplcXVEZ1ZIMStEVlZqVXVoVVJlUmpHL0pJcThpdmQ3WmY4aisvdzdGNXVPbVVKak5hbW92ZlBuU1NMd1gwMzlsRXJmTERRZjFsekt5S3lzM1JOa1lsMnQzWGpadGUyS2k2MmlSREx5ZnBxZUNUTlk0aStKd2tYY3Z0Z3V2K3lNb2VJN0NCTnFjaGtPMzBhOEhmWGJIZXR1cnhGa3Zta3BRMmdQN2NTZzEwcjdVakZndllFRTVHZHA4QWhrOHRQT2QwNVRwNms1YkY1UGJHNmQ4ZS9kZU9UV2ZDcUZ5emxac2xDR1o5b0FTenFqRGNSMlRFVGVXMFZ1ZWYwK2ZqWTJ6Ni9QOWtvcVNxWW1OYU5UK0s0WmZWSXJ6eGNUemFUNUpsRy8zV2RaUzhpRDA3WEVabEVkeDdjaS9jNmxuZVNqNnJnUnRtYjVMVFI1N2psaldpOTNwRXNxV1hwckRLSGlPd01UYW5JUkRwOUdpamZYZHQ4cWg0dWxTSEp2RkxhZ1A0K3BOMTJJSzlkNkhWbXEzYXI2TCt1dVJVUmVVQUtIREp4L05RcHVsMU9ucVFWOTZ4ZVM1SUpidDM0SkdibW5SWldtLzV4Y1hVcUw5cGwvM1ZsRGhGNUVBb2NNbGx1bno2L1VYMzl2N0I4SnJRcTJpM1RuZlFYbVptM3Q0eHNmdldxM2VwdHYzcDZrRU1Ta1ZHbnB6cVpJSGVlMGVQN0Y4cTBubjVVQmc4VHQrdkdaOVQvV2RYcWNTclNxNFZ2VGZFeWJHaHpEaEc1VDZwd3lDUzV2ZXRHZVBKd2RqV0d0RDZKdTI1OFJ2Mk9scUxMUnVsNU8zNTlpdzNRNWh3aWNyOTBxWjBJZnNJQkZtRVJsbUFpRngzNHFWUE16bkxtakwvMjM3dnRDcjNNdXkyMWJ2d3FUa2c5b1hvc3Q0K1M1UDJwL2tkb0FqOC9JdktBZE5VWWM5dVRDRTM0RmdESEFkYlcxbGdIV0poZllQdm9qREcvaGJnN3pTYXJxNzcvaWZqRUY1TnJKWldEYTJYS3IrUzRaYlZvWmZGa2FodjEydEY2Ly9YeC9zQ0l5STdUSldPYzNidXNvUHBlejBzdmp3UU9XejFMVmxaV2xsbG0rZlp2Lys0YTY3QU10eVBJT04xTzd2NGMzcnRBVXZPcmJqRlFGa29ibjVIalZwLzIyTG4wNHY1OTdUSnJwSXpYSjBSRUhnRmRNc2JXM1dQSk9wWFZrK0w4cHFkZXB1SDZnZW42VHkra3R5Q3hYWHYzMkZ6Q2owUDRXc0twRmU1RWtOOWRZMzJkWlppZloyR0JFYis3K0J0djhPcXJ2THZHRnhiNDhXVzhyc21Vejh0eGE4eVFkSHY3NjltQktkYmdqQnBJUmVSejBQVmliUGx4NXdUK25aNzlWaGFiMTJpVkFBRTNNNE0wVk1HdGtWVzFVSHQ4Vi96OUMyeWEveHJWM0Q3ZUQvbHZwWnhhQVZoZUJsaTcvWmVPWVBIRFR6bXpUYzU4eTEvN0h5ek1VT2JlM2xMYStOemN3Y2lTYXNZczFzSmZUYXVaUTBRK0YxMHN4cE83c3dLdjQzL2M4cm10NEEyNlhZQVFDSUVrQmFqS1dIWXhNQ29MbG1OWnFBTFhuOW0zNy9jdnBKdTMvQVZqYmgvNzk0UXNZWVh0NHNkcFdHM3k5Q3lMREgveDQ4NkJLYjcvYlZzNEVHOTBnMW8zN3A4VE10TFkyNStudlpvOVZldS9Pc3dmQUJFWkhycFNqS0c3dTAzOHYxditYRGZaZ0xMYzNsYkIrc1Z4QUhNd0l5U2tLVW1DR2IwaVZnWEJMQVJQOEVaYXphVDVvUm4vMlpZSEkwM1luNFFMS2Y4bkxLN2NMbjZzc2I3TzZpcmRMcGN2MjRrVEEvcEhmNEo3ZHQzb1ZGa251MVFSamFxbmovMTk2NSswQWoxZWZJenYvQVcvOVp1Y09HRW5UdzU2WENJeUFyUVB4N2k1MjdweG8xTWQ2OWxHSkRydW1HRUdodlYvWlpqaEhxc3lkanZlM3ZMV0prVXZlQkpDelVJOWVEM2M2S1ZyVy9FSGw3MnpSYmRkRkp1aG5mSkY0dCs3RUk5K1BYNTR4WXVLaFFYVzE1bWQ1ZkpsK0liLzcyZjlQNTMzOCtmZGZWaDJ3bTZYNGNsNnVGSVNjbGZhZUREOWsxWkk2cXhlOHpMQmpObFpQM1ZxME9NU2tSR2dpKys0NmQvbXZWTmFQZVhIVi9EYTUybVFkQnk0cHdTU0pLVFo5aFJNMFlydW5waWw1cG5GNlRSYjJCMS9kb0hORGI5eDlmck1WTGt4ZStqUHZuQzMrUEZ0QUJZSDAvbHhOM2hkYXR1VkRsWHVyVTBWLzNkQXY1a2p6K0lNOWhkL1lyV0N4VVdXbHZTekZaRlBwMnZFV0xrN2lYQzF6ZVYyNktaMDJ2ZmZyOURQTG1iZ2dMbVJwbVFaWnBSbHJBb0NIckFraVhWNis2Zit3OTdHMy92dXhkbk1iQ0cxWWcvL01tSHhkdWZIMnRyYStqcXdNVHU3OVBCdlRuN3FWUDh1NkJkYmZyTWJ0bng3VWtrM3hSM2hUcEpFODNDdzVtWExuanpVZjFtWlEwUStoYVpVeHNzSmdQaEd0K3hWb1IzcDlSNG9VbHAvL29YdEtSaWNxdlJPMjlzdGV0M2dGaXhQa3VsQUxkeXNhdTlzdlBiVzVabXB4R2R6eTJvY1RlTHZiTVg1ZGx3dnZGT3hzTEN3dm41bWZYMXBhWW0xdGZQZi9lNzU3MzczN05tekQyUGF4VStjNFBKbFZsZjkvWXRXVmJaVkVkVW91cVBNUEZZaHJWZFhDM3Z5a0wrN0J0dmJ4b3VJL0RJS0hPUEQzVmtDdzZwZWZybERzdE1IaFpoQmYxRUxBREhTNjNwNzA5dGJJUklzTTZ1bnlWVFNJcjYzVmYzd2tzKzBmSGU3NnJTdG5zU2ZYYmorekF1L2MrekxWeTllK1lYdzBXejZxVlArM2UvNkRvVVBkOGRmNC9KbHYvYXNQWG1vdWx4WXlIVmd5bzR6ekx1dHhHcHg5Um9kNStSSnVsMDFjNGpJcDlCVmVFemN2VnYvVVpjdkZseHFVL0hvSHV2ZHNYNzdCeFloVGNoeWtvU3FqRVVuQmdzcFZaNVdlVkovZXJmLzdNS056VnRXVDZwOXM0OEY1ODAzQVphWGQyUzNEeis3bmJyODM1NzM1NmREekxYSDE4UGlqcGtud2VacXJML05CMitybVVORVBvVXVEV05pKzBaN29lSnd3bHRYSVBlaU01aDMxejF1eHdVMzUvYXkyeFNjb2gwTlM4M1QwSzJIeHRON2dmakRuNUtsdG0vV2pzemQzZTNqZDljQWxqL2ZWaDkrNmhUekw3Tys0TFcyUDljTmJmT2lhN2crNXcrTE8zbU5VUEhDWTN6L3gzejUxemw5MnI3NXpVRVBTMFNHa1M3RTQ4RGQrMXROODNKQnQ4MHRwK2dPUzh2QzdjNVQ2L2RzcGhsWkRoNDdMWUpaWmxWd3BwTjBibDljMi9MTVltNmNTN0svazNQcTg2MTJ1WE04VzN6aWxUQTNGYS9GRUNGV3cvSnpHRlA5WTFaSWUrNjM3RnYva3RkZVU1RkRSRDZScmd2allIc3A3SVhTRHFmODhESmtReFE0N25WNzVzWGNzWVEwSmMwQWV1MktHRUtvTWl2cmFlOWcwdmlEalpBbDFkOUt2ZGliLzV1N3ExM1cxdGFBalkyTmp5MTF1YnM4WisxaU1kdW92MXRDTXFRL2hESFRYeVdiaG1wZkZyYXUyTEduK3k4cmM0akl4NmhwZE9UZHZkZldlL0duMXdtMTRiM1Jtckc5NTFqQUk3M0NPMXZlMmFLS2llV2tqZFRyOWV2RjlNL2E5a3pPTXpuZDdPWlRTZTkzdHVJVDdYaWhpTDFxWVdIaHpKa3ovYVV1ZnY2ZUhjWk9BL0J1R1JZTzFjNzNTR28rdEQrRU1kTmZOVzFwc2xIYUZ3Nzd6OCtCVnF5SXlDZlFGWG5rK2RtekxDMVY2eDkxOXM0MGZ0b0twSlRGaUwyejI5TXViTWVSTkNOTndXUFJ4dkEwVUxOcVR5MC9OSFBqbll0a1NVelk5L2djSzdmblhIN3dBNjdPOE4xbmVhMk50U2t6NzZoUjlKRnlkNXVhaVJSbU4rM2YvV3RlZnBtTkRYdjk5VUdQUzBTR2lDN0tvODNkV1Z2anpKbnlONzZlZG1zVXFYZmFvLzJtYmsrN21Ma1RBbGxPa2xLVnNkZnhMRmdhNHJTbCsvZkZEeTVRUzZnblZrdnNqLzZBdVRsUHZtUkg2bHd2aVZGN2ZEMXE3cGpGeE1MQkd1ZmY1b04zdEdKRlJENUdsNFBSMWk5dnhMTi8zWDM2aWNicUpxUlVvMWJlK0tVYzM5N25kSHVUOWF4R3NOaHR1Ym1sZUo1VisyYnlnemtRbSsvSFhidlRxeVZWUUx0dURJUTd0VHJXNDRYOXZ2b3pXM3lXWnRPT0hSdjBzRVJrV09pNlBNTHVsRGZpVjc4Uk9obmRsSFpyZkovczNUSHcyM011R1ZVWnk2Nm53YkxndTNPNzJnMWtYblRIOWQ4Ly9CeTN4blRNQ3ZKZStQNmY4UExMTEN5b3lDRWlmZW1nQnlBUG9ObGthY2x2dGNNVEIvamg1ZjY5ZUh6MWIxd0dUbGw0MlRNSUlTWGtSUHhTMTl5b09ycTlEWkE1ZER2V285eGQ1OWQrTXl3c0RIcEVJakpFZEhVZVZYZktHLzd5cTc2VmhXNTRvSFBhUnRHOTI1dHViKzQxU2YvOG9lUzQxYWZ3SXU3T2JIL2RabkswUkZaRUFDMkxIV0hOSmdzTEhIdkJGdWE4WGZJUVRrRWJkcmNYMlJxbXRERWtER2kzcVBCWTBhNzZMejZNSS9wRVpPUW9jSXl5bFJWcXM3eDdJNm1jYm1mUW94a3NwWTBoMFovNFNwS2IwZVlhM2lrSFBSNFJHUllLSENPcC84Z1lmLzAzL0VhWFc1Rzg0ZjFIZlpHQk02UG9rdVR4cDlkcGxRQk4vSVNLSENLVFRvRmpOSjAremRJU205M3FzWDMwS2pwdFU5VmFob2NaUldHYnBhWG1mM0tPYjhIMlhyQWlNcmtVT0VhUHV6TTN4OG1UMU9waHM2RFdjS0xLR3pKVVBKYVdUOFgxTFNyZ0pJdHo2dVFRbVhCYUZqdUNtckMwUkhzbVBIM0FmN0tKRitPOUhGWkdrVGwwV2lFWXorM2p3Mk1zTDNIaXhLQUhKU0tEcEFySGlIRjNabUVGRGh4a3JiQ1FVZllHUFNpUnY4SE1QWkxWdWRyekF3dVlzYlNrSW9mSUpOT1Q4WWpadm1SL1ZIRXc0VWRYSWZmdWlCK2VJdVBLSFN3RzRsdzllZWVzL2ZiWCtpOXJXdzZSeWFRS3g2aHBBckJWY2Y0V1JVVzNvM1pSR1ZKbWJvUzhrZHpxMm05L2pZdmJLMVpFWkRJcGNJeVM3ZkxHU2VoVTNPcFJuMWE3cUF3encrbTByQWk4ZTRNeXNnS3oyZ2RNWkVLcGFYU2tOR0VKdWlXTERYNjRpZmVVTldTNG1SdVdadHdzZUNubjZ4V0hra0VQU1VRR1F4V09rYkxlWkFYc0l1OWVwNEplZ1o0VlpiZ1owR2xENFAwTm45Sm01eUtUUzRGalpHeGZvMWRQZXF2SFZxUTI1ZWFhVDVIaDUyYUV0THBSMkd6T3hRclV5U0V5aVRTbE1qcWFUZjdCRW8vMWJQR2cvMlRMckZEV2tKRmdPSjEya2lhY3UwVmFZeVhoWmR4ZHkxVkVKb29xSEtOamRwYVZGUTRlNFdKcElhVlhESHBBSXArUnVVRmFaNlBENDduL25ZcUZRWTlJUkI0NUJZN1JzRDJmc3J4TTIybVhwSm5yUUhZWkhlYlFiZEgxOHZ4TjN2OHh3TXJLb0FjbElvK1VBc2VJYU1MQ0FoK1VQSDZRVGtWUDYxTmtwSmc1a0UrbE4zdmM2dlY3ajlRNktqSlJkTnNhRGY2Zm5BMzRRc0ZNaTgyS3NnVFVNU3FqeEowUVlpQWNtZlkvL3BIOWsxYzRqWDFUbjJHUlNhRUt4d2k0dlQ0RnVpVzlpcnp1cHJRaG84Yk1QWVo4S2w1dDg4SUxuSVRMK0FrVk9VUW1oVmFwakloL0FGK3FlR0tLSDJ4aG1rK1JrV1FPUmNlSTlzV0VGeS94MWdIbXRFQldaRktvd2pFSzF0WUFzaHVzYjNwMDdmY2xvOHJNcThyeUJoZGFmZ1FXVjNoNlZwMGNJaE5DRlk1aDV6Z3JheXlzK0xHdkdZbmxEZSswdFlHQmpDakRLVXN2Sy92S0FXWmU1UGtGbWlweWlFd0VWVGlHM3F1bitXY0x2SDJVVHVuZGN0Q2pFWGxndmNKSWVIZUQyaTVXVnZqMnQxWGlFSmtFQ2h4RDcrazVUcHhrN3lGNzZxQlZVUXRpWmNTWkEwbktyWUtiQlVYRlAvdG5IRDgrNkZHSnlFT253REgwbG1IeE9MOFJ1TkxDVXNvZTZ1Q1FVV2J1ZEx2MDRQQitqanlCTzB0TGd4NlVpRHgwZWxvZWF1N09HaXpnYjdlczFjRnEzdDQwdldzeTRoeTN4alNoeThFcDlqZjZMNm96U1dTOHFjSXg5QmFJdmNxZW1hcXFpaGlWRVdVTUdGQ1dkQ1A3RzF5OEFxaDFWR1RzYVpYS2NGdGJZMkhCcnQ0b1BNK2lVeFhtT3BKZXhvRFJLOGd6M3JuSk8wMys5TkwyMm04UkdWK3FjQXk5bFJXNlZkNkpaaWxWcVFLSGpBZkhTVEphVmR6czhmcnI2R2dWa1hHbjI5ZFE4N05uV1ZyaUorc3dUWmw1dTZVM1RNYUVPMG1LeGU0VDlldzdaOE0vZW9VbWRrd2ZjSkd4cGEvMzhOcCs0Q3ZodzAxdWRDSDNUbHR2bUl3UGQrb05hakhXYStFL04zZ1pGdFE2S2pLMjFNTXg5TG9sKzJhNDNNWkt3NVVSWld5NG1XSGU3WVV2N1dFcWNrQXp2Q0xqVE4vd0lkYnZvcnZ1WE5rZ09tV3BEVGhrbkpnN1JZZWVjNkhGZERYbzRZakl3NlhBTWR4V29LZ29uTHlPUjYxUGtiRmk1aDZ0TnMzTkRwM3RiZnZWT2lveXJoUTRodFQyWlhjWm9sTlVKS2tyYk1qWU1ZZXFvbHZ4V0lOZUhQUndST1FoVXVBWVlnc0FQTk1nUnFwSzNSc3lubnBkZW5DeHhlVUticzhraXNqWVVlQVlibVVFWWk5UzlUdEdSY2FMbWJ0VGEzQ3RUYWRrQlRTcklqS210RXBsV0sydHNiREE1ZXZZVkhDSXBWYW95TmlLVHVrc051SjBGUTRtZ3g2TmlEd1VxbkFNcS9WMVZsYjg4blZ1ZGJHRXFPbHRHVS9tVHRHbGlzWDZsbFUzQUcxekxqS1dGRGlHMVNvQUYySXNJbGtPYUltS2pDY3pZa1ZXejdkNnZ0RmhaWVdOalVHUFNVUjJuZ0xITUhKMzV1ZFpYY1lhb1hJc2FJbUtqREUzc0VEUnM2TGtLMTlCYlJ3aTQwajNzV0cwZmJWOUh5N2RJdThRNnRyVVhNWmNrcnBWOXZ3TUZ3TlAxWFN1aXNqNFVZVmpLRFVCQ0pHdjdzS2hxclJFUmNhWk8yWFBDS3gxdVFZcnNEN29JWW5JVGxQZ0dGWW5nY2hISGFKVFZjb2JNczdNM0NDcjAzWHZ4bjREazJaVlJNYU1sc1VPcFhVNER0K3ZtT3ZoRUhYTWhJdzVjNmpLNkdYNFdvUDVpcU5hSENzeWJsVGhHRXF6c0FLcDA2bklhcmhyaVlxTXYxNHZsTTdsTFhJdGpoVVpRd29jUTZtL0p2WWp4MTJucU1oRTZDK096V3ZjS0x4VHNySXk2QUdKeUE1VDRCaEs4N0FLdTZEU05MWk1DamNJYWV5VTlKemxaZFRHSVRKZUZEaUdVZzJPUTFaUm9YWlJtUkRtVUphaGgzM3hFRVZrWVdIUUl4S1JuYVNtMGFGejU2bk9EMkhYb2hLSFRKQ3loOEdITFN6amNOREpzU0xqUklGamVObjhqRi90bWtmVHNXMHlDZnB0SFBVR214MXVCTDZUTVR2b0lZbkl6dEdVeXJDS0ViQ3F3blZzbTB3S04waFN1bmlwM1RoRXhvMHFITU9xY2pvdDkyQzR5aHN5SWZwdEhFNWxYNXZpOFlvbnRCdUh5UGhRaFdOWVZaRmVBbzVyUWtVbVNkbWpkQzV1VXROdUhDSmpSWUZqV0pWUWxPWVFJNm9xeTRRd3FFb0xDVnNsM1VxN2NZaU1Fd1dPNGROL3BMdCtneTEzWEQwY01rbk16Y2hxOUNJL1BzdnlzaktIeU5oUTRCZys2N0N5d2cwZ2FpcEZKby9qMEsxOGVoZG1MQ3lvYjFSa1BLaHBkUGlzQTh2Y3ZNUzBZUUhYeVcweVFjeWhxbUwwOEhlL0V2LzhMOExMWHgzMGlFUmtaNmpDTVlUNkd5ek9Rb1hwRFpMSlU1VWhVbHpZdENkZUFyVDlsOGg0VUlWamlMbHRIeEtybVJXWkhBWlZTWmJsVys2dGl1OWt6QTk2U0NLeUUvUUFQYXk4dnd1U3lLUXhOOGhxOUFxN2NBbGd0VG5vSVluSURsRGdHRnI5Mm9ZeWgweXFBblk1cXllWjEzNmpJdU5BVXlwRDYvWVYxa3pudDhtRXNlM3RaNzcyQkVmL0orYVBESG84SXJJREZEaUdXTlFPSERLSkRLY3NIYXdOY3djSFBSd1IyUm1hVWhsaTF2K3Z0amFYQ2VNUVN6eHlkWU9yMnVCY1pFd29jQXd0SjNBN2JXaEtSU1pNakdZSmhYT2xZbVdGOVVHUFIwUWVtQUxIMERLaTQ2NkRWR1RpMk8wTnpvdUtqeUlzOTQrcUY1R1JwaDZPSWFadFJtVnlPV1pVRmVmVytPQVFhMmNHUFI0UmVWQ3FjQXdyQTd0ZDNsQ05ReWFRTzczQUxqaGhXaGtyTWdaVTRSaENhN0NBYlpEVzhaNTZPR1FDbVVPczhKSi8vQldlL0V0Kzh5dURIcEdJUENoVk9JYlBQTERDYnJaN09MUkNSU1pRZno0bEdsZmJ2UERTb0VjaklqdEFnV1A0ek1QeU1udU1Xcmk5TWxaa3dyZ1RJeEhha1N0YUdTc3lEaFE0aHMvR0FrQzVtOFF3Q0FvY01vazhWbGlncUxnV3RUSldaQXdvY0F5bGs1QUdhaW1BQloyb0loUEh6SUE4cDFkeTR5WXNzNjdFSVRMYUZEaUcwbkZJQTN2cW1HRkJUYU15Z2R3Z0pCRG96TUlLR3pxbFhtUzBhWlhLOEZrQzRGQ0EvdUpZMCtibU1ybUs2T2ZkUGxoV0Q0ZklxRk9GWTFoOS8vdUFCN0RnbWxLUnllUzRWK3lhNVFUTUwyZ3JEcEdScHNBeGxFNmM0RGQrdy8vdGZ6U0RvQ2tWbVV5R1J4ejd4MU44RDA0TWVqZ2k4bUFVT0lhT21iRyt6b2tUZG11RGtBeDZPQ0tEWWRzcll3M2d5NE1lallnOE1QVndES1ZYbHBuZDhObm5MVEVxemFmSVJES0lidjN5M2tlWE9IaUFablBRWXhLUis2Y0t4MUNhbllWbEdyVUllS1dXVVpsUS9kT1MyMUJHVHA0YzlHaEU1SUVvY0F5bCtYbFlZYzl1cjBHM2F6cWtYaWFRZzBlUGNHT1RYdVQ0OFVFUFNFUWVpQUxIVU9ydmJ2NllKV2tHcms0T21WQWV6WXdxZXBKQnYvSW5JcU5LUFJ4RGFXRUJzUDE3S2J2eE1pRWtlQnowbUVRZU9YZmN5OEtUclp1Y09jMjg5djRTR1dHcWNBeXgxSmllRGdHU1JGTXFNb25jQ1VsYVJXNDRvT05VUkVhYUFzZXdXbHNqU2ZqWlJTd2hCRmZicUV5YS9tYytCQnp6V1ZnR1ZUaEVScGdDeHpBeU05WmhaY1Uzalh6N3RjRU9TZVNSTTdoOW5Bcjk3bzJGZ1k1SFJCNklBc2N3V3laUUpVWlp1cnYyRzVWSlpFYU0rdXlMakFFRmptRzFzY0F5eEQxSmJwUkZzS0Jycmt3aU0wcUZiWkZ4b01BeHJPYmhKTjM5Q1h2ckpFYVNvQ1BjWk1LNEdXYTQ0eHNBNk1CWWtSR213REdzTHNOeC9HSm83cWw3Q0tTcG52RmtndDJFRlMxVEVSbHAyb2RqV0wwSzM2WnhKanhkdG16R0NDbTRXa2Rsd2pnWTVzekNGUzFTRVJsdHFuQU1LZXRQb0N4U0N4WlR4NlBTaGt3cW96dkw4akliU2h3aUkwd1ZqaUcyQ0F1d0ZrSlo4NnN0QTl6VnlTR1RxTHViazdDb1piRWlJMHdWamlGMkJzRE9CUTZZR2FTWmFod3lpU3JqRWdDckF4NklpRHdJQlk0aDFnU0RidUJLU2RydkcxWGlrTWtUb3RiRmlvd0JCWTRoZGhMKytScS9uZERhSkF0WTBHVlhKcEdwZjBsa0hDaHdEQy9EV0lhVkZXWnlwc3llbEtZQUFCLzhTVVJCVkhONkhYT1VPVVJFWkJRcGNBeTk1V1ZxQ1hzenZDSkpsVGRrNHVnekx6SVdGRGlHMjhJQ1FIQm1hNFJBbHJ0V3FjaWtjWmdEWUhIQUF4R1JCNkZsc1VQdnovK2M5WFdlZnBINmZtTFE5bDh5Y2N5WmcrUFFIUFJJUk9RQnFNSXgxT3hPUGFObTFCTzZiWE53bFpobGtnU2p2Z0V3cTdOVVJFYVlBc2ZRbTUxbGVabDNaem1ZZ0pQbEtuREl4REJ3Y0c1dXNMTEN1czVTRVJsaENoeERiMm1KMzEzanZ6ekEvM2VUUEpCbXFtL0laSW1CL21HeHloc2lvMHlCWTlodHo2cWNXaUZQcVFVOG1oS0hUQTZIWU5odVdOYnBiU0lqVFUyam8yQVpGcGE1Y0pXUXM3RkZTSWlWRGxXUnNXZnVlQ1E0ekFLZ3MxUkVScGdxSEtPZ3Z6ZzJjUTVPa3dYeWZOQURFbmxVM0xYVHFNaDRVT0FZRVd0cnZQa0c3MzVFYm9TZzNUaGtBamhBclBxYjdvcklxRlBnR0FIYmJSekx5OVFUWmpLNkxUUFQ0bGdaYy8wUHVFZFN3L3BkbzFvV0t6TENGRGhHeFBhc0Npek1rZ1R5MnFBSEpQTHdtUkVqaWJISFlFVTlveUlqVFlGamRLeXQ4U2R2OE80bDZxbG1WV1F5R0VBYTJHTXNMeXR3aUl3MDNiUkdocDgvejhJQ0gxN0ZHcXh2Z2hHajFxckkySEluU1NCeWVKcmRHVE01OSs2OUt5S2pSaFdPMGRHZlZVbjNjbmlLRlBLNmlod3l6c3l3NEc3TXBDVDZxSXVNUE8zRE1WSytEUnVCSnp2TVpuU2l1YXZDSWVQTE1TTTRXVVdxSzVYSXlGT0ZZMlNZR2UvQUtud3Y0V0FqOXJxazJhQUhKZkxRT0ppWkdWTlRxbkNJakFFRmpwRnlHZGJXK0o4ei8rUHJvWmFRNVk0V3g4cjRzdUQ5UzFUUWxVcGs1T201WWNUNFB6L1B3aG5mL2MzNGRKcmNxQ2hMREwyUE1uNGN0L28wVmRmUDFXelBESytDbWtaRlJwbWVHMGJOUDloZ2Vaa0ZUNTdlUTNCcWRkVTRaR3laa2JwZGhHL0NpVUVQUmtRZWpBTEhxRmxhWWcwN084ZDdiZW9KaVRia2tMRm1ScnJKQ1ZoZlUzbERaS1FwY0l3WU0yTURsdUd0aExtVWJzZENvbTNPWld5bGdhT3d1TUlyZ3g2SmlEd1lCWTRSdEFRcjhGL24vcFpSVDZqVlhBOStNbmJNSVZhWVU3OEZ5OHl1RDNwRUl2SkFGRGhHajVuUkJJZWJTVGtUdkxObDZDdzNHUy85ejNOWmtCaDdkc01LODlyWVhHUzA2ZEY0SkxrN1RXSmFzTm0yVUZpb2U3ZXQ5MUxHaHpzaGdjaVI2Umkzd3NJQjF0YnM2TkZCRDB0RTdwOHFIQ09wM3owWGZwemIzcnJ0cmxIMUROQjZGUmtYRVFpQllHM3Jzbjh2M043YVgwUkdsZ0xIS0Z2R3VyZjR3aXdXeVd2S0d6STJna0ZJTUJwSDl2R1dBYXdNZWt3aThtQVVPRWJXRXF5dGNmWU4xcTR3bFdseVRNYUpZeVNCQUd1M1FqZkZvRG5vTVluSWcxSGdHRlZteHNZR3k4dmN1czV6dTZrS3NwcG1WV1JjT0JZSUFUTmVoVk53Y3RBakVwRUhvek1ZUjluU0VtdHJOTi95bVQzZVNFSVI2S2tQV01hRGdaTUdPZ25BeTVnKzJTSWpUaFdPRVhadmtTTTh2NDlZa0t2SUllUEEzSW1SQkRadnNRTHJhNE1la1lnOEtBV09FYmUweE5xYXJmNm9lditqV0U5SUV0ZURvSXc2ZHpCNlhiS1V4TlF2S2pJZUZEaEcyOTBpUjBwcklhUFh0VFJUa1VOR1hnaTQwMGlZUzFoZVJwdCtpWXcrUFEyUFBMKzl4Mmp2ZWp1NTFBN3RoRzRISFhNbEk4eEpjN3preTNQMElsbEFCOU9MakQ1Vk9FYmVuUXV4ZGJKYnorM0RDL0thZGpxWDBlVVlTVW93b0o4MlJHUU02TXM4THRaSXY1UE9ySFdaU2xTM2toSG5oRURtL1B3aXdKbzZSa1hHZ1FMSE9MaHpabjJTSmp5M2oxQlNhNmpJSWFQTkVtN0J5Z3JybWs4UkdRY0tIT05pQ1lERHFWOXBWN00xeWdKUTk2aU1JZ09xSG9rUkRKWUhQUndSMlJsNmJoZ2YvZTVSMytweHVXTTNDa0p0KytSNmtSSGlqZ1hNbWF1VDFwaXZzWVlkMWNkWVpPU3B3akUrK21Wbm04N3NXc2JCQmtYTExOSEVpb3dZZ3pUMVlCeEltVXNBZEV5c3lGaFE0Qmc3VGZoLzZseURxWlI2WFhGRFJveERTQ3lCcVNrdFVSRVpKL28ranhVejR6SWNoMWJLVXcxNmJjdHlkWExJQ0hHREpCQUNQNzlJQ0ZxaUlqSTJGRGpHenF1d0J1L25YREoyOVkrdE4yVU9HUlhtNEU0ZTJMekZ5Z3JyNjFxaUlqSWVGRGpHelowbHN1UXBYOXpqS2RRYmloc3lHdm90UjcyQzFEeFZ6aEFaSy9wS2o2RTdtNTM3emE1dGRPT2xUb2lCV0dtL2N4bDI3aVFwWGhVTFU1bDM3ZkJqckszWjBhT0RIcGFJN0FCVk9NYlEzYzNPZDllOG5sRlBxZFZjWVVOR1FwS1NXSDVveHMvdEFWalFHaFdSTWFIQU1aN3VUbnYzTnNQU1BtSmhlVjFMWkdYSXVVR2FrZ2IvOTYzd1NzTHZEbnBBSXJKekZEakdXck5wZjNhYVA3dklub3l5aTVreWh3dzdJNmJHcG5FS2JXb3VNazRVT01hV21iRzZ5dXpML09FaDM4cGlMYVUrcFlrVkdWN3U1bEIwUWkzelh6ZlF0dVlpWTBYM256SG5ieml2NHUrVTluUWFmM0ExaE5TTHJ0NTFHVWJ1SktsNzFadHZaTlR0Y0taTnpVWEdpYjdNWSs3dWlwWFZyazExdWRxbGN0eTFZa1dHamp1MU9ySEQzem9ZZTFYSUV0Q1Vpc2o0MEpUS21OdStYamV4bFZyVnltSWoxYlljTXB6YytrdFVVbjUrTVdTSjloZ1ZHVE1LSE9QdnpuN24zdDdjV054YnhjTHFEZGZlb3pKa3pDRlcxQklTWTJVRmxUZEV4b3UrenhQQjNXazJXVjB0ZitQcmFaam1hb2ZLOEVvZkFCa1c3cGk1dWMzVlNFdm05MnZMTDVFeG93ckhSTmhlc2ZMeXkrbFRoeTVOcDB4bjVCbU96bGlSWVdHUVpoWUNCL1o4Ly8xM2dKVXpad1k5SmhIWlNRb2NrOEplZjcyL2FXTTVrNTE4Ymc5ZTBaaFczSkFoNFJocFJvci9iTzNXK25remF6YWJneDZVaU93a1ZkUW55SjBWSyt2blAzcHMxMnp0M0Zid2xLS3JGU3N5Y0k1Yll5WmExMjU4WUJmK2V1WFAvL3oxZi9FdkJqMG9FZGxKdXROTWxqdk5ITlVUaThtQmhYaTFDSlhqVVpsREJxbS9UdHRnVDgyN2wrMG5QMlIrM3I3MnRVRVBTMFIya3FaVUpzdDJNOGY4ZkhKdTlXYlZEdE1KdFpvcmJjaGdtWkdrQkpqUEx4L1l5L0l5OC9PREhwT0k3REFGam9sanI3L083Q3pMeS9GR1dQblMzaGdxYTB5NXpsaVJ3WEVneTBqc1pLTlI3dDhMT2lSV1pBenAwWFlTdVR1bjRVMnUvRGRGNDBpdi92Tk9RdVpGMi9SNWtFSFlidUJJT2xmeTNvRm5EckcyeHNLQ051RVFHVE9xY0V3aU0rTk4rQWI3djVqWExnYmZtN3NYRmxLdGtwVUI2Si9aMW0xN25zeGxRVnQraVl3cmZhc25sN3ZUaEZYaVl5MC9XaVMzbkY1UHg2eklBQ1FwVnZMa0xyOSsxWjZlcDltMFk4Y0dQU1lSMldHcWNFd3VNMk1WWmdsL09oVzZOZXBRcXcxNlVESnhITWh5RDhIUDlZekROR0ZwYWRDREVwR2RwOEF4MGV4MW93YkhzVWJHODN1aFpHcEdEYVR5cUJtV0o5UVNmcUFUWWtYR2xyN1lrKzV1dk5nc0lhM2V2cEtRcTRGVUhwSHRIVGk4M0ZkUDZnMTdQR2NOTzZyUG5zZ1lVb1ZqMHQxOW1weEpyMTY2V0IxcHVQY3NxNkU2aHp3Q0JtbE9HdEtuZDNNdUFkQjZXSkV4cGNBaDI1bWoyV3orOGZmL2RPTzlHOVhlQkM5SlUyVU9lZGo2TzNERXhQei92bWgvTytGMzF3WTlJaEY1V0JRNEJNRE1WbGRYRjFuY2YvN3g1TU9jMlJ5REVQQTQ2S0hKT0RPSEdFTXRJVEZPYVVHc3lEalRkMXZ1OGxPM1N4cDdXOHdYdmxsYVZRRmFLQ3NQaFRzaHdaMGpVNFFPUng1amJjMk9IaDMwc0VUa29WQ0ZRKzZ5MXcxZ0Z2NXNxbDNXZkRyUW1ISXp6YTNJdzVMbjVNYjhOSW1EZGpRWEdXY0tIUElMN2l5VWpWUFpENS9mRnltc1B1V0dOaUdWSGVjR0lTRTEzcm5Jbjd6Qm1obzRSTWFaU3VYeWNYY1d5dDVzbGNWVXV2L0gxNHpjTzF0YUtDczc2ZmFDV0E3V3NSNEwreldmSWpMZWRBdVJUM0FuYzNSYVpYc3EzZlBEcTViVWxEbGtSemxaalZqdzdBSFNpb2EyL0JJWmM1cFNrVTl3NTdwZm4wcDNiWmIyN0dQUXMvcTBhOUdLN0JBSDBvdzA0Y01XalFSTnA0aU1Pd1VPK1dSM01rYzZrOGFQTG5iM0pWUmRxMDI1bWpsa0o1aERWVElkdUJWWWdWV1ZOMFRHbkFLSC9GTGJONEJtTTN6L1Q5UDJabkcwRnIxbmVVT1pReDZVTzBucVZjSCtCaHZHS3J3ejZDR0p5RU9td0NHZnhzeFlYV1Z4TWZuaWtlUmFVdTZ2UlM4c3IrdUFOM2tRYmtaZXM0Qy9WOUJLbVlQTGd4NlRpRHhrcW1IS3IrYnVOR0dWNm9WMm5JN1o1UTVrT3VCTjdwODc5UVo1RDZ2elY5TXNZc2YwV1JJWmM2cHd5SzltWnF6Q0lzbXpqYkIxbzlnZlZPZVErOWVmVHlrNjdLMnhPMk1aWmdjOUpCRjUrQlE0NURPeDE0MGxhRGFUSDMwM2FXMVZCOUxvUGFzMWxEbms4M0l6OHR4eTQ5QU15UWJvaEZpUmlhREFJWi9WM1g2T1orZkRabGJ1U1dKVktIUElmYkdZSmY3dVI3eXBEVVpGSm9YbVRlWHp1ZHZQc2RDcW5vcnBoVTZ3bW5kYVd0TW9uMG4vd0xZUU9URFZURHBMUjdUQnFNaWtVSVZEUHAvdGZnNUkxcWJTYzBrNFVJdXhhL1dwUVk5TFJrTi9mUXFwMmNKTUp3RjBZSnZJcEZEZ2tNOXQrMUJaQ09jYVZTZnRmbW02c2k3MUtjMnR5SzlrN2hneFM4Nis5OUdYZFdDYnlDUlJHVnp1azU5eUZtR0phcU5JUXU3dlhEWnIwR2x0SDhvbDhqZjE1MU1zOHNTMGx4MDcvSmptVTBRbWgyNE1jdi91bERUS3pkN21UTGI3clV1V1RIdDd5NVE1NUpNNFdMMUI3UExpZmk1VkhOQ0JiU0lUUkZNcWN2L3VPVzhsbTNtblp5OGVpTmF4dklhRnFHUGU1Ryt3ZmtKdEdPKzFlVk1IdG9sTUZnVU9lU0RibWVNMDZmK1JYVm9yLzlkamo4VzBJRXVESmFpbFErN2xUcExHYnB0ZE9UMWpHVFpVM2hDWklQcTJ5dzd3RTg0MzRGV0Fxei9yN0MxYnRHTndvK3BoQ3JVQzIvTXBVM2pYcTAzYkZTbGFMQzBwY0loTUR0ME1aQWZZQ2V1bkRlQ3gzNnR6cys2N1F3eU90aitYYlc1QVZWWlRDVE1aYjMwUGRXK0lUQmdGRHRrWnQ4K3loK09FOVNtN1ZJdDdNcWZVVnFRQ2dKR2t4Q0o1ck1aVXl2THlvTWNqSW8rYW5qQmtKMjN2UTdvQjYvalJ0ajJUVk9jM2tyVGg3VTF6dEhSbFlqbHVqWmxJeDdLNmZXbWFOVmhRaFVOa3NxakNJVHZKek95WXNRNWc1eHZWUnV3K04rV3hiZlVwUWtCTFZ5YVR1emtVbmRCSW1NbFlBYzJuaUV3ZUJRN1plZHRia1M2U1BGV3ZyMmIyd3Y1b0hiS01rR3JweW9USzZ3UjRabzlkQ3YzMUtTSXlhZlNRSVEvTDNkWU5BeWYrOUVab1JkeThWK2pwZHFMMDUxTUlIY0lVcHhxOEJrdXFjSWhNSEZVNDVHSFp2cU9zZ0FOWW8xN3RDbTdSK3FldXFOUXhJZHlOUUhlTFBUbjFoT09nK1JTUmlhVEFJUStSbVhGN09ZTDlSVDFVdVIydVZkNnh4aFJteWh5VHdNMm8xVWtEais5aUtnRllHdlNZUkdRUUZEams0YnE3WFBabDdMbXBzcEZ0dmpnWHJhQldJMmczMHZGbjdoQmpqci9mNWsrMG5ibkk1Rkxna0lkdWUrbktBa0M2dTVhc1hmamhyejFXNW1VTWtPYnV2ajNwSW1NcHpTaTc0ZkEwU2FMdHpFVW1tUUtIUENKM2JqTXpDNGUvZlBKa3IzUFY5K1l4Vk5hWWRsQ3BZeXc1VGw2amx0S0p0cENENWxORUpwY0Noenc2dDZkWG1ody8zbmo3UjF5KzFWdW9lZFd5eGpRV2xEbkdqYnU1MFcwelpjeGsvZGRVM2hDWldQcnl5NlBtN2pTYmJNeXl2aEQvZGhHTzVQSHNOU3ZjM0x6czZZWTBQdHlwMWZHQ2wrYTRXSElvUllGRFpJS3B3aUdQbXBuWnNXT3NMN0JJT0pJRGRuZ3E3Z294Ukt0UE9Wb3hPMFpDb0o3d2ZvYy9UZFV1S2pMaDlMUWhBM1B2b1c3VnBWYmxubnpVVHJ4RzBTRkdIYnd5MnR4SlVyZG9YNXhsSXpDZjBjU082VDBWbVZ5cWNNakEzRnRkVHc1TWNTNjc4dXY3WTlyMUpHajF5cWh6ZzFyTmFuaXJaRDREdFl1S1REb0ZEaGtrTTdzVE8vS3Y1Z2VObXhlSnU1T1k5RmV2YUhPdzBlUnVHSjB0cG5PYlZydW9pSUFDaHd5RGV6ZEIvOE5yYjl5TXJmRGtqTWVPMWVva2FkUVpzNk1vcjFkcDRLbmRiQ1dESG9xSURBVTljOGl3Y1BkbXN6azdPN3V3c0ZEODV3OC8vTXFSb3orNVRyc0tTZTZkdG9HNk9rYUdPL1ZHckZYV2FOaGYxbmtaRmxUaEVKbDB1Z1RJY0hGM1RwL216VGZoK0xYLzZzcnNYTTB1dFpOMGltNkhxc1JVa3h0K1RwSzdsZmI4ako5TjdDdTUya1ZGQkUycHlMQXhNOTU4azhYWE9NNGYvZnlOamFxMStZVmF0QmJCeU90YU5EdjhIS2psbGdWL0o5cC96R21xWFZSRVFCVU9HVTczVHE4QTFlVVd0MHE3MlExSjNZdXVWWldtVjRhVU95RzRZWWRxdkhtV2YvSTFUbVBmMUpzbElxU0RIb0RJSitqUDk5L1pxQ09abS9LMGExK1lyZjdxVXBLa2hOUjdYWFYxRENFM3MxckRyTzFuL3NMKzI3L1BSLytjZi9wUEJ6MG9FUmtLbWxLUjRYVnZtNkh0clhtN0Z3N09WTHVTU004YTA1Z1d6UTRiTjNlS1R0WEkyWlZ6NmhSYURTc2l0K2xhSUNQZ0YvWWt2ZHd1RXRLMXJiUXlJNkhvWUtaU3gxQndwOVp3ZXZiaVk3NTZ4UmIzMDJ6YXNXT0RIcGFJREFWZHBtVTAvRUxtK0duaG5WNmM2WVViUlpwTjBXbmoyZ3A5Q0xqVG1JNjEwcWFtN0V5dTFiQWljaTlOcWNob3VIZFAwdVM1UFAzMzArbTdINlpmT2hCRG15d2hyMnNyOUVGejBzeDc3ZkRjSHRMQU1td29iWWpJWGJvY3lJaHg5N3NyTGMzODM3d1pmK3NsdTk0TzJSVGRMbFVQTTMyd0h6M0hyVEdORjM2NFlYT04vb3NLSENKeWh5NEhNbnEycDFmKzFiL2kzRGs0N3IvVnM5L095ck5YUTBGSWN1KzJ6VjB6TEkrVU8wbUN4ZDdobVhRNnRkMDVTaHNpOG9zMHBTS2paM3Q2NWR5NS92NWc5dHNaUnRLYUNRZW5xdGl4dkVhYWFZdXdSOGtOYW5VeVMvRisyaEFSK1JnOWdzZ0kyeTUxbklaWEFZcDNQN2owaGNlUC9Qd0d0NHFRcXBuMFVlblhrd3dPTnRoYlk1ZktHeUx5Q1ZUaGtCRzJYZXA0ZGZ0LzVsOTRmUDdreVRKcDlSYnFsYmRKQTdVNmFpWjl5TnlNV3NPendORmQxSFEyckloOE1qMkZ5Smh3ZDVwTmxwYUF1Tkgxelo2M28yMjBrNlJCMGZPcTFNNmtENGZqa0Nic1RidjdwMnF6Mi9NcHFuQ0l5TWZvb2lEanczK3hhU051ZE1Oc3JmenJxMkVyaHF4QnQrM3VodXRqdjRNY3JGYkhpN2RmM0Q5L3Nhd2ZTbEhhRUpGUG91dUNqSnVQeDQ0YjNWNlA4T0d0cExTUVpuVGFvRkxIem5HblZtUEdpbG9qMTJaZkl2TExxWWREeHMyOVc0UUJZVTh0clZrNE1PWDdzeXAycU5kSmMwZU5IVHZCbmJ6bWxEeXpPMDhUYmZZbElwOUNnVVBHMDcyM3ZXUTJUdzVQeGV2MUt5OGRpRFdQOUt3K1JVaTBkSFlIaE9EVHFWOHZPSnpBN1EzWlJFVCtCZ1VPR1Z0M1N4MHJZR1F2NWdlaHVuU3ArOVN1YUFXRzFhWXdVK0s0WDA2V1UzWEQ0VDIwYnZaZlVubERSSDRaQlE0WmMyYkc2M0FjVGdOa2J6emJlR3pLejMvWU96aGRXY2ZUeFBMNjdiNFBaWS9Qd1RIU2xFYks1VXYyM2RPc3JRMTZSQ0l5MUJRNFpQd1paaWVOVitFMFBIRWE5K1I3djlZcjByZCtmYTZZVHFxeVE2MXVXWTVyaHVXemMwc3lMenM4V1NkM2xwZloyRkI1UTBRK2hTNFFNbG5jbmRNd3Q5MXRzSG1ydmJWclkrNm5lZGpxa1RibzlTaDdFWUx1blovS2NadWFpYUV3NnJiWTZCK25wOEFoSXA5Q0Z3aVpSQjliT2x2ZTZxVFU0L3BWMmpGa0RUb2Q5OHBkc2VPWGNDZEpzY2pSV2I4ZTdQY3l2b0Y5VXo4ckVmazBtbEtSU2ZTeHBiUHByanE3NE9CTWIyRTJXamVhVzJNNmhPQ2FaUGtrYmxDclVVK0owWjdOZUEzZUhQU1lSR1RvNmFGRUp0ckhkd2s3WFhpc3FzVWsrZWltbFJheSt2YitwRHJ2L2c1M2t0UXQyaE96WEFzOG02SEZLU0x5R2FqQ0lSUHRGMG9kVGNLYmVmS25qYlJ0eVF0ejhVRGRZeXNtWnJVR21JT3FIZHcraWQ3cWlWK3MrTDJNNXFBSEpDSWpRb0ZENUhicytCWUFpNFNuTXVEbXZ0ci84dUtCdURlcnZCdlRZTFg2OXFZZGt4dzczQzJrRkMwT1pwWW5ISWZMS20rSXlHZWlLNFhJTC9qWUpNc1BWMy8rMHVJWGk3ZHZaTGQ2N2trSUtVVUhkNHdKL1BvNGJvM3BTSUhWd3JGcExVNFJrYzlPRlE2UlgzQm5rbVZsWmNYTVhscjhJc0FzNzd3MFYrNUtLem94VGNoci9WUFpKNnZhNFc0aDlhSlRIc200a25KUzVRMFIrUndVT0VRK2dabTkvdnJyeDQ4ZlAzMzZOSkMvK1FmUFFIVWt2L2FpVmJOSjVWM3FkY3RxRXpYSjBsK2NZdldRWGtqQ216VVd0VGhGUkQ0SFBaMklmQnAzcDlsa2JvNERCL3F2bEgvV1NmOTJ2ZnJaVGQvcXBKNFJVb3EyWTJPK2tzV2RKSTNFMEYrYzhsekdhZTI5SVNLZmd5b2NJcC9Hek96WXNUdHBBMGovc0k0UjN2TDBwWU85bVZCNXg5UE04bnFFTVQ1KzFzM0lhMkVtalY3eVhBYnc2b0NISkNLalJZRkQ1RmU3dTNyMk5Ed0JqdGtmWUtTOTZlU2xBK1ZzcUdLYkxMWGFGT01aTzl5UzFNdDI1NURSdmRWL1NkMGJJdks1cElNZWdNakk2TjlpdHlkWitBYU9rUUVjbnI3MHpKNERQNzlaYmJaQ2xscGFvOU55M0p6eG1HUnhzQ3kzck15dnRjUDN2d012czdBdzZFR0p5SWdaaDZ1aHlLUG5mNk9HMGJwMDQ3MERlNzcwM3ZWd283UVl5R3Y5TTFsR1AzWTRhUTRsejAxeGZaUDVnelNiZHV6WW9FY2xJaU5HVXlvaTkrTmpwN0VBVTIvK3dSSlVNMll2emJFMzdjV3RhTkVhMHlTSnUwUC9QeVBJSVVuaWRPNUZ3dnhCZ0tXbFFZOUpSRWFQQW9mSS9ic2JPNXBOdnZFTklELzlCNEFmYUdRdkhLd2VuNm5vUkhPYm5pSE44VkZjUU92a3RWZ1c0Ym5kZExMK1MrcmVFSkg3b0F1SHlNN1k3dTJZblFYNkxRN3h2USs0MVFzSDlwZFh1OWF1a3F4T2RJcU8yK2lzb1hXblZtY3FlbVBLenRSNEdSWVVPRVRrZnFqQ0liSXorZ3RvN2VqUk93MlY0YW5IdysvL2EvL0pGZk42OFlWZFpkcUxzUnV6ekdvTnpFWmdNWXM3dFhwRndiTjc3ZFlHeTdDaHRDRWk5MG1CUTJTSDNiT0c5alN2dldiZmZETDVkOVA1bFNTMjZsZS9iT1cwVmQ2SlNiRDZGQ0U0REc5dmg0Tlh6S2ErZnBubWFkYldVUE9HaU53dlBheUlQRVR1em1tWVkvdFdiWlQvNGEvVGYvaWw2dHhHdU5uelhneDVnNktnN0xtWjRjUHpsWFN3V29QWTVhWDkvcE9mMmZQUGFuR0tpRHdJN2NNaDhoRGQzYm9ET0ExT3lwY3dhLy9sV3pOZmVhRmMyNGczaTBBdjFCdTIzZDdoN29TQlQxdTRtNW4zMnY5L2UvZXlXOWRWeGdIOFcydWZ1eDI3TkhicWdoSktRS1JLQkdrVExtWlFxUkZNRVJKcXdudUVCNEFYeURNZ21KRlVqSkNnQThBREpOUUJrVUE0UUdqVFNpY2hidUpDY1lydDQzUDJYZ3pzRkRtZ0NoUTcxOTl2ZUhRdSt3ejIwbjkvYTMxck5iUHRmUEduS1cxRU05YWNBdHdQVXlxdzczWW1XVjZOaUlpbHBTamxaKzllallocWZDZksydFpuWjV0dTA1UlJkTHVwTzhnNWw0Yzl5VkpTUkc4UTNTcS9jelY5NTVzeEhNYVZLMVp2QVBkRDRJQUg1RzdzZUhWNWVYbHhjWEU0SE9ham4ycjk1SWVkMisvVmg5ci9PTld1cDZNdUc1RlM2azlGMWRvcGpEejRoYVdscEpSamF5TTkyNG5iMTZPVVdGdEw1ODQ5Nk1zQW5pd2VXZURoS0tYRTBsTE16MjlQVlV4dXJzUmI3N1JlK2RyNHhrYjF0L1hZcXZOMkcrMW9WRkpKRC9CV0xWRlNiNnJKbzNodkxmLzZSM0g4dFRoN1Fua0R1RThxSFBCd3BKVFNtVE1mTFl4b1BiL1FXcmtlS1ZYWC8xem0rNk9qQjVwdTNUU2phRmVwUHgyNWl2S0EybWhUMVlySjVuaWhFN2RTeFBmaXltMXBBN2gvQWdjOFRMdjJLaDBPNDhLRi9OV1hxb1ZCcDEyVitYNCtkV2d5Mng0M20wMnBveitJVGplaTNGM2hzUy9obzVRU25XN1R6KzFiclh6MWhUZ2V6cUVIOW9RSEYzaUUzSE1tWEZsWkxaTW9INDdyK1lPdFcrdXh2cFZ6TzZwMmpEYWpxWGZldEpmbGh4S3RibE1tK2NXNWN1VjIrdko4TEVVNlk1UUE5b0FLQnp4Qzdqa1RMaTNNNWQvOHFucngrZGI3S1ZJdm56NVVIOGlsM21oU0UvMUJkSG9Sc2IxajZaNlZPMUlwMCsyeXVwcmVYWXJoVUhVRDJDc0NCenh5ZHMyekxDN0djSmcvMzg0LzdwWExxL2xtblY2ZW54eVptbFRqcGhsRnU1MTZVNUdyblc2Vyt3Z2VKVXAwK3BIcTZ0aHNkQ0xPbm8yMU5hczNnTDFpTklGSDNhN3RTaTlkaW5Obm16Zi9Ha2NuZWU1SWZlMkRmS2RPa3pyYS9XaEtqRFpMS25mdjZ2L243aTRsVWlvNTB0eFV2TjJLcjNkM3ZrTGdBUGFJQ2djODZsSks2VXlLRTlzTFN4Zmp3akIvNVpONTdnZGw1ZmY1UnBOT0hod3ZkQ2J0Y1QzWmlGWk8vZW5JN2RoZVdmby9GenkyZC9vcXZWemVpdmhHTnk3dC9PNysvU25nYVNOd3dPTmg1elRhN3g2Sjg0Y2psaUplU3d0ZlRDdS9pQlRWalVHZTcxVmZlbTcwYkh0YzF1dVlSTGVYdXYzSTFjNlp0QitmUEVwSnFTcmp6ZnpjSUc2MW8wUXNTeHZBSGpPbXdHT3BsQkxMeS9IR1RFVEUrY01SMFl6cUdOWE5oK082YXJYKy9zOVlyMU9KM0JuRVpCSmJvNCtaYWlsUlVuKzZxVVlwRGRMRlhyd1djVUxnQVBhWU1RVWViLy9ab2RLOGVlc3Z2ZXJZeVlQcjE5WTZtM1hlbUVTSjNPbkgrTDhlUzF1aTFZbFV4OHR6NWJlMzAybXRzTUMrTUtVQ2o3ZDdPbWxqT2ZMUER4Mjcrc3NVOFhiMFV1bmwwL1BsRTkwNnJUY3hqbTQzZGZ1UlcxR2FmeDhSbDZJKzBONGNycVpyV21HQi9TSnd3Sk1nM1JXdlI4d3ZYNXBadkRnY2Z1Rm9wM3E5WHk2djVyWHI4Y0hOMFdkbXh2Mm1MbHQxVEtJL2xicURrbEowQnlXYVAzMXV0bWxwaFFYMmtaRUZua3ozTnROZXVWS2YvRlkwbTlXM0Y3ZFd0dkw3ZDZwUkUwMmtsQ1p6cmEzWi91QVpyYkRBUGxMaGdDZlRybWJhbVptWVdheCs5MUpWRHlPbDFoLyttUHRUNmRUODZHQy9udTIyUHYxTXYxZDk5S21IZTluQWs4cmdBaytGOHYwUzg4dHgrWTA0SG5IK2ZGeUs1cFU2cHB1SXlOUHRFRFdBZldhSWdhZExLU1dXSTJZaUR1OTZYZUFBOXBVaEJwNUc5elRUU2hzQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU96eUw0OUZidCtXVm1IV0FBQUFBRWxGVGtTdVFtQ0MiIGhlaWdodD0iNzEzIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJ4TWlkWU1pZCBtZWV0Ii8+PC9nPjwvZz48L2c+PC9zdmc+';
  let sakuraAnimationId = null;
  let sakuraPetals = [];
  const MAX_PETALS = 25;

  function createSakuraPetal() {
    const container = document.getElementById('sakuraPetalsContainer');
    if (!container) return;

    const petal = document.createElement('img');
    petal.src = SAKURA_PETAL_SRC;
    petal.alt = '';
    petal.className = 'sakura-petal';
    petal.draggable = false;

    const size = 10 + Math.random() * 18;
    const startX = Math.random() * window.innerWidth;
    const driftX = (Math.random() - 0.5) * 200;
    const endDrift = driftX + (Math.random() - 0.5) * 100;
    const duration = 6 + Math.random() * 8;
    const delay = Math.random() * 2;
    const midRotate = 90 + Math.random() * 270;
    const endRotate = midRotate + 90 + Math.random() * 180;
    const opacity = 0.4 + Math.random() * 0.5;

    petal.style.setProperty('--petal-size', size + 'px');
    petal.style.setProperty('--start-x', startX + 'px');
    petal.style.setProperty('--drift-x', driftX + 'px');
    petal.style.setProperty('--end-drift', endDrift + 'px');
    petal.style.setProperty('--mid-rotate', midRotate + 'deg');
    petal.style.setProperty('--end-rotate', endRotate + 'deg');
    petal.style.setProperty('--petal-opacity', opacity);
    petal.style.left = '0px';
    petal.style.top = '-20px';
    petal.style.animation = `sakuraFall ${duration}s ease-in-out ${delay}s forwards`;

    container.appendChild(petal);

    // アニメーション終了後に削除
    setTimeout(() => {
      if (petal.parentNode) {
        petal.parentNode.removeChild(petal);
      }
    }, (duration + delay) * 1000 + 100);

    return petal;
  }

  function startSakuraPetals() {
    stopSakuraPetals();

    // 最初にいくつか作成
    for (let i = 0; i < 8; i++) {
      setTimeout(() => createSakuraPetal(), i * 300);
    }

    // 定期的に新しい花びらを追加
    sakuraAnimationId = setInterval(() => {
      const container = document.getElementById('sakuraPetalsContainer');
      if (container && container.children.length < MAX_PETALS) {
        createSakuraPetal();
      }
    }, 800);
  }

  function stopSakuraPetals() {
    if (sakuraAnimationId) {
      clearInterval(sakuraAnimationId);
      sakuraAnimationId = null;
    }
    const container = document.getElementById('sakuraPetalsContainer');
    if (container) {
      container.innerHTML = '';
    }
  }

  function init() {
    // 桜アイコンにdata URIを設定
    const sakuraIcon = document.getElementById('sakuraIconImg');
    if (sakuraIcon) sakuraIcon.src = SAKURA_PETAL_SRC;

    loadState();
    applyUIState();
    initEvents();
  }

  // DOM準備完了後に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
