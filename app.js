/**
 * 図解プロンプトビルダー — App Logic
 */

(function () {
  'use strict';

  // ============================================================
  // 定数定義
  // ============================================================

  const STORAGE_KEY = 'zukai-prompt-builder';
  const MAX_IMAGES = 5;

  // AI（Gemini / Straico）API 設定
  const AI_STORAGE_KEY = 'zukai-ai-config';
  const GEMINI_STORAGE_KEY_LEGACY = 'zukai-gemini-config'; // 旧キー（移行用）

  // Gemini 直接
  const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash';
  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const GEMINI_MODELS = [
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash（推奨・高速）' },
    { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite（最速・低コスト）' },
    { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro（高品質・低速）' }
  ];

  // Straico（マルチモデル対応プロキシ）
  // ※ 実在モデル ID は /v1/models のレスポンス（2026-05 時点）に基づく。
  //   "google/gemini-2.5-flash" は Straico のラインアップから外れているため要注意。
  const STRAICO_ENDPOINT = 'https://api.straico.com/v1/prompt/completion';
  const STRAICO_DEFAULT_MODEL = 'google/gemini-3-flash-preview';
  // 「Model not found」検知時のフォールバック（最も汎用的に安定するモデル）
  const STRAICO_FALLBACK_MODEL = 'openai/gpt-4o-mini';
  // Straico 側で廃止／改名された旧モデル ID → 自動的に置き換える
  const STRAICO_MODEL_REMAP = {
    'google/gemini-2.5-flash': 'google/gemini-3-flash-preview',
    'anthropic/claude-haiku-4-5': 'claude-haiku-4-5-5'
  };
  // 内蔵デフォルトキー（ユーザーが独自キー未設定でもStraicoを利用可能にする）
  // ※ ブラウザに配信されるため、配布範囲に応じて差し替え・無効化してください
  const STRAICO_DEFAULT_API_KEY = 'WR-qLuslnqOHBAV3ni7xtagY9FuOpVzm34FH9MTFzZIzDPM95mE';
  const STRAICO_MODELS = [
    { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（推奨・高速）' },
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite（最速・最安）' },
    { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview（高品質）' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini（JSON出力安定）' },
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini（バランス）' },
    { id: 'openai/gpt-5-mini', label: 'GPT-5 mini（新世代）' },
    { id: 'claude-haiku-4-5-5', label: 'Claude Haiku 4.5（軽量Claude）' }
  ];

  const PROVIDER_META = {
    straico: {
      label: 'Straico',
      models: STRAICO_MODELS,
      defaultModel: STRAICO_DEFAULT_MODEL,
      keyPlaceholder: 'Straicoダッシュボードで取得したAPIキー',
      helpUrl: 'https://platform.straico.com/user-settings',
      helpLabel: 'Straico でAPIキーを取得する',
      desc: 'Straico API は複数のAIモデル（Gemini/GPT/Claude）を統一APIで利用できます。<br>キーはお使いのブラウザ内（localStorage）にのみ保存され、Straico以外には送信されません。'
    },
    gemini: {
      label: 'Gemini 直接',
      models: GEMINI_MODELS,
      defaultModel: GEMINI_DEFAULT_MODEL,
      keyPlaceholder: 'AIzaSy...',
      helpUrl: 'https://aistudio.google.com/apikey',
      helpLabel: 'Google AI Studio でAPIキーを取得する',
      desc: 'Google AI Studio で取得した Gemini API キーを入力してください。<br>キーはお使いのブラウザ内（localStorage）にのみ保存され、Google以外には送信されません。'
    }
  };

  // Pickaxe API 設定
  // 旧構成: 1ワークスペース内に複数 deployment を作って並列化していたが、
  //         Pickaxe バックエンド (Modal.com) のリソース共有により真の並列が
  //         効かず 504 多発。
  // 新構成: 別ワークスペース × 7 を用意し、それぞれに画像生成 Pickaxe を
  //         デプロイ。デプロイメントキーは Vercel 環境変数
  //         (PICKAXE_API_KEY_1 .. _7) に保存し、ブラウザはキー本体を持たず
  //         keyIndex (0..6) のみをサーバーに伝える。
  const PICKAXE_WORKSPACE_COUNT = 7;

  // 画像生成スタイルプリセット定義
  // 旧 Pickaxe ワークスペースは事前設定でスタイルバイアスを持っていたが、
  // 直接 OpenAI gpt-image-2 / Gemini を叩く現構成ではプロンプトに完全な
  // 視覚指示を載せる必要があるため、各 preset を具体化している。
  // (色パレット・線の太さ・テクスチャ・アンチパターン明記)
  const IMAGE_GEN_STYLE_PRESETS = {
    handdrawn: {
      label: '手書き風イラスト',
      prompt: '温かみのある手描きイラスト風。色鉛筆・水彩・クレヨンで描いたような質感、紙のテクスチャが透ける表現。線はわざとラフに、塗りはムラを残す。色調はパステルカラー(やわらかいピンク・ミント・水色・クリーム色)。日本語テキストは手書き風(ハネ・トメが見える書き文字感)。デジタル感・ベクター感・写実的CGは厳禁。アナログで人間味のあるタッチを最優先。'
    },
    flat: {
      label: 'フラットビジネス',
      prompt: 'フラットデザインのビジネスイラスト。ベクター調の整った直線とジオメトリックな形状。シャドウ・グラデーション最小限。色は信頼感のある寒色系(ネイビー・スレートブルー・グレー・白)を主体に、アクセントに1色だけ温かい色(オレンジまたはコーラル)。余白を大きく取り、要素を厳選した整理されたレイアウト。日本語テキストはモダンなゴシック体で明瞭に配置。手描き感・テクスチャ・複雑な装飾は厳禁。'
    },
    pop: {
      label: 'ポップ＆カラフル',
      prompt: '鮮やかな原色のポップ＆コミック調イラスト。太く力強い黒の主線(マンガのインク線)、明るく彩度の高い色(赤・黄・青・緑)のフラット塗り。スクリーントーン・効果線・吹き出し・「ボン」などのオノマトペ演出を多用。元気で勢いのある躍動的な構図。日本語テキストはマンガ風(太字・縁取り・斜体)で目立たせる。落ち着いた配色・暗いトーン・写実的タッチは厳禁。'
    },
    minimal: {
      label: 'ミニマルモノクロ',
      prompt: 'ミニマルでクリーンな線画図解。細く一様な黒い線(均等幅のストローク)による線画主体、塗りは最小限または無し。要素を極限まで削ぎ落とした洗練された構成、余白を大胆に取る。色はモノクローム(黒+白)、またはデュオトーン(黒+1色のアクセント)のみ。日本語テキストは細めの明朝体またはサンセリフで控えめに。装飾・グラデーション・テクスチャ・複雑な背景は厳禁。'
    },
    infographic: {
      label: 'インフォグラフィック',
      prompt: 'モダンなインフォグラフィック図解スタイル。アイコン化された人物・物・矢印・数値・データバー・円グラフなどのデータビジュアル要素を組み合わせる。情報階層が明確で、見出し・小見出し・数値・キャプションが整理されて配置されている。色は1〜2色の鮮やかなアクセントカラー(青またはエメラルド+オレンジなど)+グレースケール。日本語テキストはサンセリフ系で読みやすく。マンガ的演出・手描き感・写実描写は厳禁。'
    },
    chalkboard: {
      label: '黒板チョーク風',
      prompt: '黒板にチョークで描いた手書き風図解。背景は深いダークグリーンの黒板テクスチャ(縞ムラ・チョーク粉のかすれ)。線と文字はチョーク質感(白・黄・水色・ピンクのパステル系)、ややかすれて粉っぽい。授業ノートのような親しみやすく整理されたレイアウト。日本語テキストはチョーク風の手書き(ハネ・トメ・かすれ)。デジタル感・グラデーション・写実的描写は厳禁。'
    },
    custom: {
      label: 'カスタム',
      prompt: ''
    }
  };

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

  // 画像生成状態
  // デフォルトは OpenAI gpt-image-2 (2026-05-20 のスパイクで採用決定)。
  // Pickaxe ('GPT Image2' / 'NanoBanana2') は provider.pickaxe タグ保持者のみ
  // 選べるよう UI 側でカードが非表示になる。
  let imageGenState = {
    selectedPreset: 'handdrawn',
    customStyle: '',
    model: 'gpt-image-2',
    // { slideIndex, imageUrl, stylePrompt, contentPrompt, model, status: 'loading'|'success'|'error', error?, failedModel? }
    generatedImages: [],
    regenSlideIndex: -1,
    regenSelectedModel: 'gpt-image-2'
  };

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
    // 投稿キャプション
    postCaption: $('#postCaption'),
    postCaptionBodyBlock: $('#postCaptionBodyBlock'),
    postCaptionBody: $('#postCaptionBody'),
    postCaptionTagsBlock: $('#postCaptionTagsBlock'),
    postCaptionTags: $('#postCaptionTags'),
    postCaptionTagCount: $('#postCaptionTagCount'),
    copyCaptionAllBtn: $('#copyCaptionAllBtn'),
    copyCaptionBodyBtn: $('#copyCaptionBodyBtn'),
    copyCaptionTagsBtn: $('#copyCaptionTagsBtn'),
    carouselGenerateBtn: $('#carouselGenerateBtn'),
    carouselOutputSection: $('#carouselOutputSection'),
    carouselOutputCards: $('#carouselOutputCards'),
    // モード出力
    modeContentSingleOutput: $('#modeContentSingleOutput'),
    modeContentCarouselOutput: $('#modeContentCarouselOutput'),
    // 画像生成
    imageGenPresets: $('#imageGenPresets'),
    imageGenStyleBadge: $('#imageGenStyleBadge'),
    imageGenCustomWrapper: $('#imageGenCustomWrapper'),
    imageGenCustomStyle: $('#imageGenCustomStyle'),
    modelBadge: $('#modelBadge'),
    imageGenBtn: $('#imageGenBtn'),
    imageGridSection: $('#imageGridSection'),
    imageGrid: $('#imageGrid'),
    imageGridBadge: $('#imageGridBadge'),
    // 再生成モーダル
    regenModalOverlay: $('#regenModalOverlay'),
    regenModalTitle: $('#regenModalTitle'),
    regenModalClose: $('#regenModalClose'),
    regenModalPreview: $('#regenModalPreview'),
    regenStylePrompt: $('#regenStylePrompt'),
    regenContentPrompt: $('#regenContentPrompt'),
    regenModalCancel: $('#regenModalCancel'),
    regenModalSubmit: $('#regenModalSubmit'),
    regenModelGptImage2: $('#regenModelGptImage2'),
    regenModelGeminiFlashImage: $('#regenModelGeminiFlashImage'),
    regenModelNano: $('#regenModelNano'),
    regenModelGPT: $('#regenModelGPT'),
    regenModelHint: $('#regenModelHint'),
    // AI生成（Gemini / Straico）
    aiThemeInput: $('#aiThemeInput'),
    aiProvider: $('#aiProvider'),
    aiSlideCount: $('#aiSlideCount'),
    aiTone: $('#aiTone'),
    aiGenerateBtn: $('#aiGenerateBtn'),
    aiGenerateBtnLabel: $('#aiGenerateBtnLabel'),
    aiSettingsBtn: $('#aiSettingsBtn'),
    aiGenBadge: $('#aiGenBadge'),
    // APIキー設定モーダル
    apiKeyModalOverlay: $('#apiKeyModalOverlay'),
    apiKeyModalClose: $('#apiKeyModalClose'),
    apiKeyModalDesc: $('#apiKeyModalDesc'),
    apiKeyInput: $('#apiKeyInput'),
    apiKeyToggleBtn: $('#apiKeyToggleBtn'),
    apiKeyDefaultNote: $('#apiKeyDefaultNote'),
    apiModelSelect: $('#apiModelSelect'),
    apiKeyHelpLink: $('#apiKeyHelpLink'),
    apiKeyHelpLinkLabel: $('#apiKeyHelpLinkLabel'),
    apiKeyCancelBtn: $('#apiKeyCancelBtn'),
    apiKeySaveBtn: $('#apiKeySaveBtn'),
    apiKeyDeleteBtn: $('#apiKeyDeleteBtn'),
    providerTabs: $$('.provider-tab')
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
        state = Object.assign({}, state, parsed);
      }
    } catch (e) {
      // パースエラーは無視
    }
  }

  // ============================================================
  // テーマ（ライト・ダーク・季節モード）
  // ============================================================

  // 季節テーマ定義
  const SEASONAL_THEMES = {
    sakura: { icon: '🌸', badge: '🌸 春限定', months: [3, 4] },
    shinryoku: { icon: '🌿', badge: '🌿 新緑', months: [5, 6] },
    natsu: { icon: '🌊', badge: '🌊 夏', months: [7, 8] },
    kouyou: { icon: '🍁', badge: '🍁 紅葉', months: [9, 10, 11] },
    fuyu: { icon: '❄️', badge: '❄️ 冬', months: [12, 1, 2] },
  };

  function getSeasonalTheme() {
    const month = new Date().getMonth() + 1;
    for (const [id, def] of Object.entries(SEASONAL_THEMES)) {
      if (def.months.includes(month)) return Object.assign({ id: id }, def);
    }
    return Object.assign({ id: 'sakura' }, SEASONAL_THEMES.sakura);
  }

  const currentSeason = getSeasonalTheme();
  const THEMES = ['light', currentSeason.id, 'dark'];

  // ============================================================
  // プラン → 機能マッピング (Phase 2)
  // ============================================================

  const PRODUCT_CODE = 'zukai-builder';
  window.__PRODUCT_CODE__ = PRODUCT_CODE;

  // 上位プランは下位プランの機能を全て継承する
  const PLAN_FEATURES = {
    free: ['core.single'],
    standard: ['core.single', 'mode.carousel', 'ai.json'],
    pro: ['core.single', 'mode.carousel', 'ai.json', 'ai.imagegen', 'theme.seasonal'],
    lifetime: ['core.single', 'mode.carousel', 'ai.json', 'ai.imagegen', 'theme.seasonal']
  };

  // タグによる個別解放 (プランより強い、上書き専用)
  // 'provider.pickaxe': Pickaxe (個人サブスク利用) を選べるかどうか。7月末のサブスク
  //   終了とともに使わなくなる予定。タグ持ちユーザー (=オーナー本人) のみ表示。
  const TAG_FEATURE_GRANTS = {
    beta: ['ai.json', 'ai.imagegen', 'theme.seasonal'],
    internal: ['ai.json', 'ai.imagegen', 'theme.seasonal', 'mode.carousel'],
    vip: ['ai.json', 'ai.imagegen', 'theme.seasonal', 'mode.carousel'],
    pickaxe_internal: ['provider.pickaxe']
  };

  // feature key → ユーザー向けに案内する必要プラン
  const FEATURE_REQUIRED_PLAN = {
    'mode.carousel': 'STANDARD',
    'ai.json': 'STANDARD',
    'ai.imagegen': 'PRO',
    'theme.seasonal': 'PRO'
  };

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
      stopSeasonalPetals();
    } else if (theme === 'shinryoku') {
      stopSakuraPetals();
      startSeasonalPetals();
    } else {
      stopSakuraPetals();
      stopSeasonalPetals();
    }

    saveState();
  }

  function setTheme(theme) {
    if (!THEMES.includes(theme)) return;
    if (SEASONAL_THEMES[theme]) {
      if (!gateOrToast('theme.seasonal', '季節テーマ')) return;
    }
    applyTheme(theme);
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
    if (els.styleBadge) {
      const styleDef = STYLE_DEFS[state.style];
      els.styleBadge.textContent = `${state.style}: ${styleDef.label.split('（')[0]}`;
    }

    if (els.layoutBadge) {
      const layoutDef = LAYOUT_DEFS[state.layout];
      const layoutLabel = state.layout === 'G' ? 'お任せ' : layoutDef.label;
      els.layoutBadge.textContent = `${state.layout}: ${layoutLabel}`;
    }

    if (els.formatBadge) els.formatBadge.textContent = state.format;

    if (els.colorBadge) {
      if (state.colorMode === 'auto') {
        els.colorBadge.textContent = 'お任せ';
      } else if (state.colorMode === 'custom') {
        els.colorBadge.textContent = `カスタム (${state.customColor})`;
      } else {
        els.colorBadge.textContent = state.colorValue;
      }
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

  // 機能ゲート: hasFeature が true なら true を返し処理続行可、false ならトースト表示して false
  // 同一キーの連打は 1.5 秒スロットルでトースト 1 回に抑制
  // 未ログイン (匿名 / open-access / fallback) と ログイン済み低プランで文言を分ける
  const _lastGateToast = {};
  function gateOrToast(featureKey, displayName) {
    if (window.hasFeature(featureKey)) return true;
    const now = Date.now();
    if (now - (_lastGateToast[featureKey] || 0) < 1500) return false;
    _lastGateToast[featureKey] = now;
    const profile = window.__USER_PROFILE__ || {};
    if (typeof isProfileAuthenticated === 'function' && !isProfileAuthenticated(profile)) {
      showToast(`🔒 ${displayName}は LINE公式の友だち追加 + ログインで利用できます`);
    } else {
      const plan = FEATURE_REQUIRED_PLAN[featureKey] || 'STANDARD';
      showToast(`🔒 ${displayName}は ${plan} プラン以上で利用できます`);
    }
    return false;
  }

  // ============================================================
  // リセット
  // ============================================================

  function resetAll() {
    // ===== シングルモードの state =====
    state = {
      text: '',
      style: 'A',
      layout: 'G',
      format: '1:1',
      colorMode: 'auto',
      colorValue: '',
      customColor: '#3b82f6',
      theme: state.theme, // テーマはリセットしない
      mode: 'single'
    };

    // 花びらが飛んでいる場合はそのまま維持
    if (state.theme === 'sakura') startSakuraPetals();

    els.contentText.value = '';
    els.outputSection.classList.remove('visible');
    els.promptText.textContent = '';
    els.customColorPicker.value = '#3b82f6';

    // ===== 画像 / ペーストキュー =====
    characterImages = [];
    renderImageThumbnails();
    closePasteQueue();

    // ===== カルーセルモードの state / UI =====
    carouselData = null;
    carouselPrompts = [];
    if (els.carouselJsonInput) els.carouselJsonInput.value = '';
    if (els.carouselBadge) {
      els.carouselBadge.textContent = '未入力';
      els.carouselBadge.classList.remove('section__badge--active', 'section__badge--success');
    }
    if (els.carouselPreviewSection) els.carouselPreviewSection.style.display = 'none';
    if (els.carouselSlides) els.carouselSlides.innerHTML = '';
    if (els.carouselSlideCount) els.carouselSlideCount.textContent = '';
    if (els.carouselPreviewTitle) els.carouselPreviewTitle.textContent = '';
    if (els.carouselOutputSection) els.carouselOutputSection.classList.remove('visible');
    if (els.carouselOutputCards) els.carouselOutputCards.innerHTML = '';

    // ===== 投稿キャプション =====
    if (els.postCaptionBodyBlock) els.postCaptionBodyBlock.hidden = true;
    if (els.postCaptionTagsBlock) els.postCaptionTagsBlock.hidden = true;
    if (els.postCaptionBody) els.postCaptionBody.value = '';
    if (els.postCaptionTags) els.postCaptionTags.innerHTML = '';
    if (els.postCaptionTagCount) els.postCaptionTagCount.textContent = '';

    // ===== AI生成 入力欄 =====
    if (els.aiThemeInput) els.aiThemeInput.value = '';

    // ===== 画像生成 state / UI =====
    imageGenState.generatedImages = [];
    imageGenState.regenSlideIndex = -1;
    imageGenState.selectedPreset = 'handdrawn';
    imageGenState.customStyle = '';
    if (els.imageGenCustomStyle) els.imageGenCustomStyle.value = '';
    if (typeof selectImageGenPreset === 'function') {
      selectImageGenPreset('handdrawn');
    }
    if (els.imageGrid) els.imageGrid.innerHTML = '';
    if (els.imageGridSection) els.imageGridSection.style.display = 'none';
    if (els.imageGridBadge) els.imageGridBadge.textContent = '';

    // 直近ジョブの復元キャッシュも消す（次回リロードで前回生成が出てこない）
    try { localStorage.removeItem('zukai-last-job-id'); } catch (_) {}

    // ===== シングルモードへ戻す =====
    if (typeof switchMode === 'function') {
      switchMode('single');
    }

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
    if (!els.imageBadge) return;
    if (characterImages.length === 0) {
      els.imageBadge.textContent = '任意';
      els.imageBadge.classList.remove('section__badge--success', 'section__badge--active');
    } else {
      els.imageBadge.textContent = `${characterImages.length}枚`;
      els.imageBadge.classList.remove('section__badge--active');
      els.imageBadge.classList.add('section__badge--success');
    }
  }

  // ------------------------------------------------------------
  // キャラクター画像の公開URL確保（Pickaxe API 用）
  // ------------------------------------------------------------
  // /api/upload-character-image に dataUrl を POST して Supabase Storage 上の
  // 公開 HTTPS URL を取得する。同じ画像は1度だけアップロードし、結果は
  // characterImages[i].publicUrl にキャッシュする。
  //
  // 注: Vercel のリクエストボディ上限は 4.5MB なので、大きな画像はあらかじめ
  // クライアント側で縮小・JPEG化してから送信する。

  // 画像を canvas で縮小し、JPEG dataUrl にして返す。
  // 既に十分小さい場合は元の dataUrl をそのまま返す。
  function compressDataUrlIfNeeded(dataUrl, maxDimension = 1280, quality = 0.85, maxBytes = 2_500_000) {
    return new Promise((resolve, reject) => {
      // 既に小さい場合はスキップ (base64 文字数 ≒ バイト数 * 4/3)
      const approxOriginalBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
      if (approxOriginalBytes <= maxBytes && /^data:image\/jpeg/.test(dataUrl)) {
        return resolve(dataUrl);
      }

      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDimension / Math.max(width, height));
        const targetW = Math.round(width * scale);
        const targetH = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        // 背景を白で塗ってから描画 (PNG透過対策。JPEG変換で黒くならないように)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        // JPEGで品質を下げつつ目標サイズ以下にする
        let q = quality;
        let out = canvas.toDataURL('image/jpeg', q);
        let attempts = 0;
        const decodedSize = (s) => Math.ceil((s.length - s.indexOf(',') - 1) * 0.75);
        while (decodedSize(out) > maxBytes && q > 0.4 && attempts < 5) {
          q -= 0.1;
          out = canvas.toDataURL('image/jpeg', q);
          attempts++;
        }
        resolve(out);
      };
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      img.src = dataUrl;
    });
  }

  async function uploadOneCharacterImage(img) {
    if (img.publicUrl) return img.publicUrl;

    let token = null;
    try {
      token = (typeof liff !== 'undefined' && liff.getAccessToken) ? liff.getAccessToken() : null;
    } catch (_) { token = null; }
    if (!token) throw new Error('LINE認証トークンが取得できません');

    // 大きい画像は送信前に縮小
    let dataUrlToSend;
    try {
      dataUrlToSend = await compressDataUrlIfNeeded(img.dataUrl);
    } catch (err) {
      console.warn('[upload] compress failed, sending original:', err.message);
      dataUrlToSend = img.dataUrl;
    }

    const res = await fetch('/api/upload-character-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ dataUrl: dataUrlToSend, filename: img.name })
    });

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j && j.error ? `: ${j.error}` : ''; } catch (_) {}
      throw new Error(`アップロード失敗 (${res.status}${detail})`);
    }

    const data = await res.json();
    if (!data || !data.publicUrl) throw new Error('publicUrl が応答に含まれていません');
    img.publicUrl = data.publicUrl;
    return data.publicUrl;
  }

  // 未アップロード画像をまとめて処理し、全画像の公開URL配列を返す。
  // 失敗時は throw して呼び出し側でハンドルする。
  async function ensureCharacterImageUrls() {
    if (characterImages.length === 0) return [];
    const urls = [];
    for (const img of characterImages) {
      const url = await uploadOneCharacterImage(img);
      urls.push(url);
    }
    return urls;
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
        else if (group === 'model') {
          imageGenState.model = value;
          if (els.modelBadge) els.modelBadge.textContent = value;
          // 選択を永続化 (リロード後も維持)。zukaiDebug.setModel と同じキーに統一。
          try { localStorage.setItem('zukai-debug-model', value); } catch (_) {}
        }

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
    if (els.copyCaptionAllBtn) {
      els.copyCaptionAllBtn.addEventListener('click', copyCaptionAll);
    }
    if (els.copyCaptionBodyBtn) {
      els.copyCaptionBodyBtn.addEventListener('click', copyCaptionBody);
    }
    if (els.copyCaptionTagsBtn) {
      els.copyCaptionTagsBtn.addEventListener('click', copyCaptionTags);
    }
    if (els.carouselJsonInput && els.carouselBadge) {
      els.carouselJsonInput.addEventListener('input', () => {
        const hasValue = els.carouselJsonInput.value.trim().length > 0;
        // 既に「success（X枚）」状態なら触らない
        if (els.carouselBadge.classList.contains('section__badge--success')) return;
        if (hasValue) {
          els.carouselBadge.textContent = '入力中';
          els.carouselBadge.classList.add('section__badge--active');
        } else {
          els.carouselBadge.textContent = '未入力';
          els.carouselBadge.classList.remove('section__badge--active');
        }
      });
    }

    // ===== AI生成（Gemini） =====
    if (els.aiGenerateBtn) {
      els.aiGenerateBtn.addEventListener('click', generateCarouselJsonWithAi);
    }
    if (els.aiSettingsBtn) {
      els.aiSettingsBtn.addEventListener('click', openApiKeyModal);
    }
    if (els.apiKeyModalClose) {
      els.apiKeyModalClose.addEventListener('click', closeApiKeyModal);
    }
    if (els.apiKeyCancelBtn) {
      els.apiKeyCancelBtn.addEventListener('click', closeApiKeyModal);
    }
    if (els.apiKeySaveBtn) {
      els.apiKeySaveBtn.addEventListener('click', saveApiKeyFromModal);
    }
    if (els.apiKeyDeleteBtn) {
      els.apiKeyDeleteBtn.addEventListener('click', deleteApiKeyFromModal);
    }
    if (els.apiKeyToggleBtn) {
      els.apiKeyToggleBtn.addEventListener('click', toggleApiKeyVisibility);
    }
    if (els.apiKeyModalOverlay) {
      els.apiKeyModalOverlay.addEventListener('click', (e) => {
        if (e.target === els.apiKeyModalOverlay) closeApiKeyModal();
      });
    }
    if (els.aiThemeInput) {
      els.aiThemeInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          generateCarouselJsonWithAi();
        }
      });
    }
    if (els.aiProvider) {
      els.aiProvider.addEventListener('change', onAiProviderChange);
    }
    if (els.providerTabs && els.providerTabs.forEach) {
      els.providerTabs.forEach(tab => {
        tab.addEventListener('click', () => {
          switchApiKeyModalProvider(tab.dataset.provider);
        });
      });
    }

    // ===== 画像生成スタイルプリセット =====
    if (els.imageGenPresets) {
      els.imageGenPresets.querySelectorAll('.image-gen-preset').forEach(preset => {
        preset.addEventListener('click', () => {
          selectImageGenPreset(preset.dataset.preset);
        });
        preset.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); preset.click(); }
        });
      });
    }

    // ===== 画像一括生成 =====
    if (els.imageGenBtn) {
      els.imageGenBtn.addEventListener('click', generateAllImages);
    }

    // ===== 一括ダウンロード =====
    const bulkDlBtn = document.getElementById('bulkDownloadBtn');
    if (bulkDlBtn) {
      bulkDlBtn.addEventListener('click', downloadAllImages);
    }

    // ===== ライトボックス =====
    const lightboxOverlay = document.getElementById('lightboxOverlay');
    if (lightboxOverlay) {
      lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) closeLightbox();
      });
    }
    const lightboxClose = document.getElementById('lightboxClose');
    if (lightboxClose) {
      lightboxClose.addEventListener('click', closeLightbox);
    }
    const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');
    if (lightboxDownloadBtn) {
      lightboxDownloadBtn.addEventListener('click', () => {
        const idx = parseInt(lightboxDownloadBtn.dataset.slideIndex);
        const imgData = imageGenState.generatedImages[idx];
        if (imgData && imgData.imageUrl) {
          downloadImage(imgData.imageUrl, idx);
        }
      });
    }
    // Escキーでライトボックス閉じる
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('lightboxOverlay');
        if (overlay && overlay.classList.contains('active')) {
          closeLightbox();
        }
      }
    });

    // ===== 再生成モーダル =====
    if (els.regenModalClose) {
      els.regenModalClose.addEventListener('click', closeRegenModal);
    }
    if (els.regenModalCancel) {
      els.regenModalCancel.addEventListener('click', closeRegenModal);
    }
    if (els.regenModalSubmit) {
      els.regenModalSubmit.addEventListener('click', submitRegeneration);
    }
    if (els.regenModalOverlay) {
      els.regenModalOverlay.addEventListener('click', (e) => {
        if (e.target === els.regenModalOverlay) closeRegenModal();
      });
    }
    // 再生成モーダルのモデル切替 (全プロバイダ対応)
    [els.regenModelGptImage2, els.regenModelGeminiFlashImage, els.regenModelNano, els.regenModelGPT].forEach(btn => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        const idx = imageGenState.regenSlideIndex;
        const img = idx >= 0 ? imageGenState.generatedImages[idx] : null;
        const failedModel = img && img.status === 'error' ? img.failedModel : null;
        updateRegenModelSelection(btn.dataset.model, failedModel);
      });
    });
  }

  // ============================================================
  // モード切替
  // ============================================================

  function switchMode(mode) {
    if (mode !== 'single' && mode !== 'carousel') return;
    if (mode === 'carousel' && !gateOrToast('mode.carousel', 'カルーセルモード')) return;
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

    // カルーセルモードでは「画像生成スタイル」が新しいスタイル選択を担当するため、
    // ChatGPT貼り付けプロンプト用の旧スタイル/レイアウト/配色セクションは隠す
    // （混乱を避けるため）。フォーマットは両方の生成で共通利用するので残す。
    // キャラクター画像 (sectionImages) はカルーセルモードでも参考画像として
    // Pickaxe API に渡せるようになったため、両モードで表示する。
    const carouselOnlyHidden = ['sectionStyle', 'sectionLayout', 'sectionColor'];
    carouselOnlyHidden.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = mode === 'carousel' ? 'none' : '';
    });

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
  // AI（マルチプロバイダ）: 設定管理
  // ============================================================

  function defaultAiConfig() {
    return {
      provider: 'straico',
      straico: { apiKey: '', model: STRAICO_DEFAULT_MODEL },
      gemini: { apiKey: '', model: GEMINI_DEFAULT_MODEL }
    };
  }

  function loadAiConfig() {
    const cfg = defaultAiConfig();
    try {
      const saved = localStorage.getItem(AI_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.provider === 'gemini' || parsed.provider === 'straico') {
          cfg.provider = parsed.provider;
        }
        if (parsed.straico) {
          cfg.straico.apiKey = parsed.straico.apiKey || '';
          cfg.straico.model = parsed.straico.model || STRAICO_DEFAULT_MODEL;
          // Straico 側で廃止／改名された旧モデル ID は読込時に新 ID へ自動移行
          if (Object.prototype.hasOwnProperty.call(STRAICO_MODEL_REMAP, cfg.straico.model)) {
            cfg.straico.model = STRAICO_MODEL_REMAP[cfg.straico.model];
          }
        }
        if (parsed.gemini) {
          cfg.gemini.apiKey = parsed.gemini.apiKey || '';
          cfg.gemini.model = parsed.gemini.model || GEMINI_DEFAULT_MODEL;
        }
        return cfg;
      }
      // 旧Gemini設定からのマイグレーション
      const legacy = localStorage.getItem(GEMINI_STORAGE_KEY_LEGACY);
      if (legacy) {
        const parsed = JSON.parse(legacy);
        cfg.gemini.apiKey = parsed.apiKey || '';
        cfg.gemini.model = parsed.model || GEMINI_DEFAULT_MODEL;
        // 旧ユーザーはGemini設定済みなのでデフォルトをGeminiに
        if (cfg.gemini.apiKey) cfg.provider = 'gemini';
        saveAiConfig(cfg);
      }
    } catch (e) { }
    return cfg;
  }

  function saveAiConfig(cfg) {
    try {
      localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) { }
  }

  /**
   * 指定プロバイダの実効APIキー（ユーザー設定 > 内蔵デフォルト）を返す
   */
  function getEffectiveApiKey(provider, cfg) {
    if (provider === 'straico') {
      return cfg.straico.apiKey || STRAICO_DEFAULT_API_KEY;
    }
    return cfg.gemini.apiKey;
  }

  // ============================================================
  // APIキー設定モーダル
  // ============================================================

  let apiKeyModalActiveProvider = 'straico'; // モーダル内で現在編集中のプロバイダ

  function openApiKeyModal() {
    const cfg = loadAiConfig();
    apiKeyModalActiveProvider = cfg.provider;
    renderApiKeyModalForProvider(apiKeyModalActiveProvider, cfg);
    els.apiKeyModalOverlay.classList.add('active');
    setTimeout(() => els.apiKeyInput.focus(), 100);
  }

  function closeApiKeyModal() {
    els.apiKeyModalOverlay.classList.remove('active');
  }

  /**
   * 指定プロバイダ用にモーダル内のフィールドを再描画
   */
  function renderApiKeyModalForProvider(provider, cfg) {
    const meta = PROVIDER_META[provider];
    if (!meta) return;
    const cur = (provider === 'straico') ? cfg.straico : cfg.gemini;

    // タブ active 状態
    els.providerTabs.forEach(tab => {
      const isActive = tab.dataset.provider === provider;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // 説明
    els.apiKeyModalDesc.innerHTML = meta.desc;

    // APIキー入力
    els.apiKeyInput.value = cur.apiKey || '';
    els.apiKeyInput.type = 'password';
    els.apiKeyInput.placeholder = meta.keyPlaceholder;

    // 内蔵デフォルトキー注記
    const hasBuiltin = provider === 'straico' && !!STRAICO_DEFAULT_API_KEY;
    if (els.apiKeyDefaultNote) {
      els.apiKeyDefaultNote.style.display = hasBuiltin ? '' : 'none';
    }

    // モデル選択肢を再構築
    els.apiModelSelect.innerHTML = '';
    meta.models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      els.apiModelSelect.appendChild(opt);
    });
    els.apiModelSelect.value = cur.model || meta.defaultModel;

    // ヘルプリンク
    els.apiKeyHelpLink.href = meta.helpUrl;
    els.apiKeyHelpLinkLabel.textContent = meta.helpLabel;
  }

  function switchApiKeyModalProvider(provider) {
    if (provider !== 'straico' && provider !== 'gemini') return;
    apiKeyModalActiveProvider = provider;
    renderApiKeyModalForProvider(provider, loadAiConfig());
  }

  function saveApiKeyFromModal() {
    const apiKey = els.apiKeyInput.value.trim();
    const model = els.apiModelSelect.value || PROVIDER_META[apiKeyModalActiveProvider].defaultModel;

    // Straicoは内蔵キーがあればAPIキー空でも保存可
    const hasBuiltin = apiKeyModalActiveProvider === 'straico' && !!STRAICO_DEFAULT_API_KEY;
    if (!apiKey && !hasBuiltin) {
      showToast('⚠️ APIキーを入力してください');
      els.apiKeyInput.focus();
      return;
    }

    const cfg = loadAiConfig();
    if (apiKeyModalActiveProvider === 'straico') {
      cfg.straico = { apiKey, model };
    } else {
      cfg.gemini = { apiKey, model };
    }
    // 保存したプロバイダをアクティブに切替
    cfg.provider = apiKeyModalActiveProvider;
    saveAiConfig(cfg);

    // メイン画面のプロバイダ選択も同期
    if (els.aiProvider) els.aiProvider.value = cfg.provider;

    updateAiBadge();
    closeApiKeyModal();
    showToast('✅ APIキーを保存しました');
  }

  function deleteApiKeyFromModal() {
    const provider = apiKeyModalActiveProvider;
    if (!confirm(`${PROVIDER_META[provider].label} の保存済みAPIキーを削除しますか？`)) return;
    const cfg = loadAiConfig();
    if (provider === 'straico') {
      cfg.straico = { apiKey: '', model: STRAICO_DEFAULT_MODEL };
    } else {
      cfg.gemini = { apiKey: '', model: GEMINI_DEFAULT_MODEL };
    }
    saveAiConfig(cfg);
    renderApiKeyModalForProvider(provider, cfg);
    updateAiBadge();
    showToast('🗑️ APIキーを削除しました');
  }

  function toggleApiKeyVisibility() {
    els.apiKeyInput.type = els.apiKeyInput.type === 'password' ? 'text' : 'password';
  }

  function updateAiBadge() {
    if (!els.aiGenBadge) return;
    const cfg = loadAiConfig();
    const apiKey = getEffectiveApiKey(cfg.provider, cfg);
    const meta = PROVIDER_META[cfg.provider];
    if (!apiKey) {
      els.aiGenBadge.textContent = `${meta.label} (キー未設定)`;
      return;
    }
    const model = cfg.provider === 'straico' ? cfg.straico.model : cfg.gemini.model;
    const shortModel = model.replace(/^google\//, '').replace(/^openai\//, '').replace(/^anthropic\//, '').replace(/^gemini-/, '');
    els.aiGenBadge.textContent = `${meta.label} • ${shortModel}`;
  }

  /**
   * メイン画面のプロバイダ選択変更時
   */
  function onAiProviderChange() {
    const newProvider = els.aiProvider.value;
    const cfg = loadAiConfig();
    cfg.provider = newProvider;
    saveAiConfig(cfg);
    updateAiBadge();
  }

  // ============================================================
  // Gemini API: カルーセルJSON生成
  // ============================================================

  const TONE_DESC = {
    friendly: '親しみやすく、フレンドリーで読みやすい口調',
    professional: 'プロフェッショナルで信頼感のある、しっかりした口調',
    casual: 'カジュアルでフランクな、SNSらしい口調',
    educational: '丁寧に解説する教育的な口調。専門用語には必ず補足を入れる',
    inspirational: '読者の心を動かす感動的・モチベーショナルな口調'
  };

  function buildGeminiPrompt(theme, slideCount, tone) {
    const toneDesc = TONE_DESC[tone] || TONE_DESC.friendly;
    const slideCountDesc = slideCount === 'auto'
      ? '内容に応じて適切な枚数（5〜10枚程度推奨）'
      : `${slideCount}枚（厳守）`;

    return `あなたはInstagramカルーセル投稿の構成専門家です。以下のテーマや元文章から、カルーセル投稿用のJSONを生成してください。

# 出力ルール
- 必ず指定のJSON形式のみを出力し、説明文やマークダウンのコードブロック記号(\`\`\`)は一切付けないでください
- 各スライドの content は、画像内に表示するテキストとして読みやすい量・長さに整えてください
- 表紙(cover)はキャッチーで、思わずスワイプしたくなる訴求にしてください
- 本文(body)は1枚1メッセージの原則で、情報を整理してください
- 最後(cta)は内容のまとめや読後感を残す締めくくりにしてください
- ❌ CTAで「保存」「コメント」「いいね」「フォロー」などSNS上のアクションを促す表現は使わないでください（読者が自然に内容を持ち帰れる締め方にする）
- 投稿キャプション(caption)はInstagramの本文として使用します。冒頭1〜2行で続きを読みたくなる引きを作り、その後にスライド内容を補足／深掘りする本文を続け、最後に読後感を残す締めくくりを置いてください（保存やフォローを直接促す表現は禁止）。改行は \\n を使い、絵文字も自然に活用して構いません。300〜600文字を目安にしてください。
- ハッシュタグ(hashtags)はテーマと関連性の高いものを10〜15個、日本語・英語を織り交ぜて配列で返してください。"#" を必ず含め、半角スペースや句読点は含めないでください。

# トーン
${toneDesc}

# スライド枚数
${slideCountDesc}

# JSON仕様
{
  "title": "カルーセル全体のタイトル（保存用の短い見出し）",
  "caption": "Instagram投稿のキャプション本文（改行は \\n、複数段落OK）",
  "hashtags": ["#タグ1", "#タグ2", "..."],
  "style": "A" | "B" | "C" | "D",
  "format": "1:1" | "3:4" | "16:9",
  "color": "auto" or プリセット名,
  "slides": [
    { "page": 1, "role": "cover", "content": "表紙テキスト" },
    { "page": 2, "role": "body", "layout": "A"|"B"|"C"|"D"|"E"|"F"|"G", "content": "本文" },
    ...
    { "page": N, "role": "cta", "content": "まとめ・CTA" }
  ]
}

# フィールド説明
- title: カルーセルを一言で表す短い見出し（30文字以内目安）
- caption: Instagramの投稿本文。フック → 本編 → 締めの3部構成。スライド本文と同じことを繰り返さず、補足や具体例・体験談を交えて深掘りする
- hashtags: 投稿で使うハッシュタグの配列。10〜15個、重複なし、"#" 必須
- style: A(手書き風), B(ビジネス風), C(ポップ), D(ミニマル) — テーマに最適なものを選択
- format: "1:1"(正方形), "3:4"(縦長), "16:9"(横長) — 通常はInstagram向けに"1:1"推奨
- color: "auto"(おまかせ) 推奨
- slides[].layout (bodyのみ): A(並列リスト), B(比較図), C(ステップ), D(4象限), E(サイクル), F(ピラミッド), G(お任せ) — 各スライドの内容に最適なものを選択

# テーマ／元文章
${theme}

---
上記を踏まえ、JSONのみを出力してください。`;
  }

  function extractJsonFromText(text) {
    if (!text) return null;
    let cleaned = text.trim();
    // コードブロック記号を除去
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    // 最初の { から最後の } までを抽出
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last === -1 || last < first) return null;
    const jsonStr = cleaned.slice(first, last + 1);
    try {
      return { jsonStr, parsed: JSON.parse(jsonStr) };
    } catch (e) {
      return null;
    }
  }

  async function callGeminiApi(apiKey, model, prompt) {
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.8,
        topP: 0.95,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error && errJson.error.message) {
          errMsg = errJson.error.message;
        }
      } catch (e) { }
      throw new Error(errMsg);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
      throw new Error('APIから空のレスポンスが返されました');
    }
    return text;
  }

  /**
   * Straico API 呼び出し（複数モデル対応プロキシ）
   * - models は配列で渡す（仕様）
   * - レスポンスはネスト深め＋形が揺れるためフォールバックチェーンで取り出す
   */
  async function callStraicoApi(apiKey, model, prompt) {
    const res = await fetch(STRAICO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        models: [model],
        message: prompt
      })
    });

    if (!res.ok) {
      let errBody = '';
      try { errBody = await res.text(); } catch (e) { }
      console.error('Straico HTTP error:', res.status, errBody.slice(0, 1000));
      let detail = '';
      try {
        const parsed = JSON.parse(errBody);
        detail = parsed.message || parsed.error || parsed?.error?.message || '';
      } catch (e) {
        detail = errBody.slice(0, 200);
      }
      const err = new Error(`Straico HTTP ${res.status}${detail ? ': ' + detail : ''}`);
      err.status = res.status;
      err.detail = detail;
      err.modelNotFound = res.status === 422 && /model not found/i.test(detail);
      throw err;
    }

    const data = await res.json();
    const comp = data?.data?.completions?.[model];

    // フォールバックチェーン（モデルごとに形が変わる）
    const candidates = [
      comp?.completion?.choices?.[0]?.message?.content,
      typeof comp?.completion === 'string' ? comp.completion : null,
      data?.data?.completion?.choices?.[0]?.message?.content,
      typeof data?.data?.completion === 'string' ? data.data.completion : null,
      typeof data?.completion === 'string' ? data.completion : null
    ];
    for (const c of candidates) {
      if (c && typeof c === 'string' && c.trim()) return c;
    }

    console.error('Straico response shape unexpected:', JSON.stringify(data).slice(0, 1000));
    throw new Error('Straicoから想定外のレスポンス形式が返されました');
  }

  async function generateCarouselJsonWithAi() {
    if (!gateOrToast('ai.json', 'AIでカルーセルJSON生成')) return;
    const theme = els.aiThemeInput.value.trim();
    if (!theme) {
      showToast('⚠️ テーマや元文章を入力してください');
      els.aiThemeInput.focus();
      return;
    }

    const cfg = loadAiConfig();
    const provider = cfg.provider;
    const apiKey = getEffectiveApiKey(provider, cfg);
    if (!apiKey) {
      showToast('🔑 まずAPIキーを設定してください');
      openApiKeyModal();
      return;
    }

    const model = provider === 'straico' ? cfg.straico.model : cfg.gemini.model;
    const slideCount = els.aiSlideCount.value;
    const tone = els.aiTone.value;
    const prompt = buildGeminiPrompt(theme, slideCount, tone);

    // ローディング状態
    els.aiGenerateBtn.disabled = true;
    els.aiGenerateBtn.classList.add('ai-generate-btn--loading');
    const originalLabel = els.aiGenerateBtnLabel.textContent;
    els.aiGenerateBtnLabel.textContent = `${PROVIDER_META[provider].label}が生成中…`;

    try {
      let text;
      if (provider === 'straico') {
        try {
          text = await callStraicoApi(apiKey, model, prompt);
        } catch (e) {
          // モデル未提供（プラン/キーで Gemini など制限）→ 安定モデルで自動再試行
          if (e && e.modelNotFound && model !== STRAICO_FALLBACK_MODEL) {
            showToast(`⚠️ ${model} は利用できません。${STRAICO_FALLBACK_MODEL} で再試行します`);
            text = await callStraicoApi(apiKey, STRAICO_FALLBACK_MODEL, prompt);
            cfg.straico.model = STRAICO_FALLBACK_MODEL;
            saveAiConfig(cfg);
          } else {
            throw e;
          }
        }
      } else {
        text = await callGeminiApi(apiKey, model, prompt);
      }

      const extracted = extractJsonFromText(text);
      if (!extracted) {
        throw new Error('生成されたテキストからJSONを抽出できませんでした');
      }
      if (!extracted.parsed.slides || !Array.isArray(extracted.parsed.slides) || extracted.parsed.slides.length === 0) {
        throw new Error('生成されたJSONに有効な slides 配列がありません');
      }

      // JSON入力欄に整形して挿入
      els.carouselJsonInput.value = JSON.stringify(extracted.parsed, null, 2);

      const hasCaption = typeof extracted.parsed.caption === 'string' && extracted.parsed.caption.trim();
      const tagCount = Array.isArray(extracted.parsed.hashtags) ? extracted.parsed.hashtags.length : 0;
      const extras = [];
      if (hasCaption) extras.push('キャプション');
      if (tagCount) extras.push(`#タグ${tagCount}`);
      const extraLabel = extras.length ? ` + ${extras.join(' / ')}` : '';
      showToast(`✨ JSONを生成しました（${extracted.parsed.slides.length}枚${extraLabel}）`);

      // そのまま自動展開
      expandCarousel();
    } catch (err) {
      console.error(`${provider} API error:`, err);
      const msg = err && err.message ? err.message : String(err);
      showToast(`⚠️ 生成エラー: ${msg}`);
    } finally {
      els.aiGenerateBtn.disabled = false;
      els.aiGenerateBtn.classList.remove('ai-generate-btn--loading');
      els.aiGenerateBtnLabel.textContent = originalLabel;
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
    els.carouselBadge.classList.remove('section__badge--active');
    els.carouselBadge.classList.add('section__badge--success');

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

    renderPostCaption(carouselData);

    els.carouselSlides.innerHTML = '';
    carouselData.slides.forEach((slide, i) => {
      const card = buildCarouselSlideCard(slide, i);
      els.carouselSlides.appendChild(card);
    });
  }

  function normalizeHashtag(raw) {
    if (raw == null) return '';
    let tag = String(raw).trim();
    if (!tag) return '';
    tag = tag.replace(/\s+/g, '');
    if (!tag.startsWith('#')) tag = '#' + tag;
    return tag.length > 1 ? tag : '';
  }

  function renderPostCaption(data) {
    if (!els.postCaption) return;

    const caption = typeof data.caption === 'string' ? data.caption.trim() : '';
    const rawTags = Array.isArray(data.hashtags) ? data.hashtags : [];
    const tags = [];
    const seen = new Set();
    rawTags.forEach((t) => {
      const n = normalizeHashtag(t);
      if (n && !seen.has(n)) {
        seen.add(n);
        tags.push(n);
      }
    });

    const hasCaption = !!caption;
    const hasTags = tags.length > 0;

    els.postCaption.hidden = !(hasCaption || hasTags);

    if (els.postCaptionBodyBlock) els.postCaptionBodyBlock.hidden = !hasCaption;
    if (els.postCaptionTagsBlock) els.postCaptionTagsBlock.hidden = !hasTags;

    if (hasCaption && els.postCaptionBody) {
      els.postCaptionBody.value = caption;
      autoSizeCaption();
    }

    if (hasTags) {
      if (els.postCaptionTagCount) els.postCaptionTagCount.textContent = `（${tags.length}個）`;
      els.postCaptionTags.innerHTML = '';
      tags.forEach((tag) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'post-caption__tag';
        btn.textContent = tag;
        btn.title = 'クリックで個別コピー';
        btn.addEventListener('click', () => {
          navigator.clipboard.writeText(tag).then(() => {
            showToast(`📋 ${tag} をコピーしました`);
          }).catch(() => showToast('⚠️ コピーに失敗しました'));
        });
        els.postCaptionTags.appendChild(btn);
      });
    }

    // 編集内容を carouselData に反映（コピーやエクスポート時の整合性のため）
    if (hasCaption && els.postCaptionBody && !els.postCaptionBody._bound) {
      els.postCaptionBody.addEventListener('input', () => {
        if (carouselData) carouselData.caption = els.postCaptionBody.value;
        autoSizeCaption();
      });
      els.postCaptionBody._bound = true;
    }
  }

  function autoSizeCaption() {
    if (!els.postCaptionBody) return;
    els.postCaptionBody.style.height = 'auto';
    els.postCaptionBody.style.height = `${Math.max(els.postCaptionBody.scrollHeight, 160)}px`;
  }

  function getCurrentHashtags() {
    if (!carouselData || !Array.isArray(carouselData.hashtags)) return [];
    const tags = [];
    const seen = new Set();
    carouselData.hashtags.forEach((t) => {
      const n = normalizeHashtag(t);
      if (n && !seen.has(n)) {
        seen.add(n);
        tags.push(n);
      }
    });
    return tags;
  }

  function copyCaptionBody() {
    const text = (els.postCaptionBody?.value || '').trim();
    if (!text) {
      showToast('⚠️ コピーする本文がありません');
      return;
    }
    navigator.clipboard.writeText(text)
      .then(() => showToast('📋 本文をコピーしました'))
      .catch(() => showToast('⚠️ コピーに失敗しました'));
  }

  function copyCaptionTags() {
    const tags = getCurrentHashtags();
    if (!tags.length) {
      showToast('⚠️ コピーするハッシュタグがありません');
      return;
    }
    navigator.clipboard.writeText(tags.join(' '))
      .then(() => showToast(`📋 ハッシュタグ ${tags.length} 個をコピーしました`))
      .catch(() => showToast('⚠️ コピーに失敗しました'));
  }

  function copyCaptionAll() {
    const body = (els.postCaptionBody?.value || '').trim();
    const tags = getCurrentHashtags();
    if (!body && !tags.length) {
      showToast('⚠️ コピーする内容がありません');
      return;
    }
    const parts = [];
    if (body) parts.push(body);
    if (tags.length) parts.push(tags.join(' '));
    const combined = parts.join('\n\n');
    navigator.clipboard.writeText(combined)
      .then(() => showToast('📋 投稿キャプションをまとめてコピーしました'))
      .catch(() => showToast('⚠️ コピーに失敗しました'));
  }

  function buildCarouselSlideCard(slide, i) {
    const role = slide.role || 'body';
    const roleLabel = ROLE_LABELS[role] || role;
    const layout = slide.layout || (role === 'body' ? 'G' : '');
    const layoutDef = layout ? LAYOUT_DEFS[layout] : null;
    const content = slide.content || '';

    const card = document.createElement('div');
    card.className = 'carousel-slide-card';
    card.style.animationDelay = `${i * 0.05}s`;
    if (slide._edited) card.classList.add('carousel-slide-card--edited');

    card.innerHTML = `
      <div class="carousel-slide-card__page">${slide.page || i + 1}</div>
      <div class="carousel-slide-card__body">
        <div class="carousel-slide-card__meta">
          <span class="carousel-slide-card__role carousel-slide-card__role--${role}">${roleLabel}</span>
          ${layoutDef ? `<span class="carousel-slide-card__layout-badge">${layout}: ${layoutDef.label}</span>` : ''}
          <span class="carousel-slide-card__edited-badge" data-edited-badge title="この本文は編集されています" ${slide._edited ? '' : 'hidden'}>編集済み</span>
        </div>
        <div class="carousel-slide-card__content" data-view>${escapeHtml(content)}</div>
        <textarea class="carousel-slide-card__editor" data-editor rows="4" hidden></textarea>
        <div class="carousel-slide-card__edit-hint" data-edit-hint hidden>Ctrl/⌘+Enter で保存 / Esc でキャンセル</div>
      </div>
      <div class="carousel-slide-card__actions" data-actions-view>
        <button class="action-btn action-btn--edit" type="button" title="本文を編集">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button class="action-btn action-btn--copy" type="button" title="このスライドのプロンプトをコピー">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <div class="carousel-slide-card__actions" data-actions-edit hidden>
        <button class="action-btn action-btn--save" type="button" title="保存（Ctrl/⌘+Enter）">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button class="action-btn action-btn--cancel" type="button" title="キャンセル（Esc）">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `;

    const viewEl = card.querySelector('[data-view]');
    const editorEl = card.querySelector('[data-editor]');
    const hintEl = card.querySelector('[data-edit-hint]');
    const actionsView = card.querySelector('[data-actions-view]');
    const actionsEdit = card.querySelector('[data-actions-edit]');
    const editedBadge = card.querySelector('[data-edited-badge]');

    const autoSize = () => {
      editorEl.style.height = 'auto';
      editorEl.style.height = `${Math.max(editorEl.scrollHeight, 80)}px`;
    };

    const enterEditMode = () => {
      editorEl.value = slide.content || '';
      viewEl.hidden = true;
      editorEl.hidden = false;
      hintEl.hidden = false;
      actionsView.hidden = true;
      actionsEdit.hidden = false;
      autoSize();
      editorEl.focus();
      const len = editorEl.value.length;
      editorEl.setSelectionRange(len, len);
    };

    const exitEditMode = () => {
      viewEl.hidden = false;
      editorEl.hidden = true;
      hintEl.hidden = true;
      actionsView.hidden = false;
      actionsEdit.hidden = true;
    };

    const saveEdit = () => {
      const newContent = editorEl.value;
      const originalContent = slide.content || '';
      if (newContent === originalContent) {
        exitEditMode();
        return;
      }
      slide.content = newContent;
      slide._edited = true;
      viewEl.textContent = newContent;
      editedBadge.hidden = false;
      card.classList.add('carousel-slide-card--edited');
      exitEditMode();
      if (carouselPrompts.length > 0) {
        showToast('💾 本文を更新しました（「全プロンプト生成」を押し直すと反映されます）');
      } else {
        showToast('💾 本文を更新しました');
      }
    };

    card.querySelector('.action-btn--edit').addEventListener('click', enterEditMode);
    card.querySelector('.action-btn--save').addEventListener('click', saveEdit);
    card.querySelector('.action-btn--cancel').addEventListener('click', exitEditMode);
    editorEl.addEventListener('input', autoSize);
    editorEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exitEditMode();
      }
    });

    card.querySelector('.action-btn--copy').addEventListener('click', () => {
      const prompt = buildSlidePrompt(slide, i);
      navigator.clipboard.writeText(prompt).then(() => {
        showToast(`📋 スライド${slide.page || i + 1}をコピーしました`);
      }).catch(() => {
        showToast('⚠️ コピーに失敗しました');
      });
    });

    return card;
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
      card.querySelector('[data-carousel-copy]').addEventListener('click', function () {
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
  // 画像生成スタイルプリセット制御
  // ============================================================

  function selectImageGenPreset(presetId) {
    imageGenState.selectedPreset = presetId;

    // UI更新
    if (els.imageGenPresets) {
      els.imageGenPresets.querySelectorAll('.image-gen-preset').forEach(p => {
        const isActive = p.dataset.preset === presetId;
        p.classList.toggle('active', isActive);
        p.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    }

    // バッジ更新
    const presetDef = IMAGE_GEN_STYLE_PRESETS[presetId];
    if (els.imageGenStyleBadge && presetDef) {
      els.imageGenStyleBadge.textContent = presetDef.label;
    }

    // カスタム入力欄の表示切替
    if (els.imageGenCustomWrapper) {
      els.imageGenCustomWrapper.style.display = presetId === 'custom' ? '' : 'none';
    }
  }

  function getCurrentStylePrompt() {
    const presetId = imageGenState.selectedPreset;
    if (presetId === 'custom') {
      return (els.imageGenCustomStyle ? els.imageGenCustomStyle.value : '') || '';
    }
    const preset = IMAGE_GEN_STYLE_PRESETS[presetId];
    return preset ? preset.prompt : '';
  }

  // ============================================================
  // Pickaxe API 呼び出し
  // ============================================================

  // 注: 画像URL抽出は /api/pickaxe-proxy 側で行うようにしたため
  // ブラウザ側のヘルパーは削除した。

  // ============================================================
  // 画像生成プロバイダ抽象化
  // ============================================================
  // Pickaxe (個人用、7月末まで利用予定) と OpenAI / Gemini (公開用) を
  // 1つの dispatcher で透過的に扱う。model 名から自動的にプロバイダを判定。
  //
  // ⚠️ Pickaxe オプションは UI 上ではタグ 'pickaxe_internal' を持つユーザー
  //    にだけ見せる想定 (フェーズB の UI 対応で実装)。
  const IMAGE_GEN_MODEL_REGISTRY = {
    // --- Pickaxe (個人用) ---
    'NanoBanana2':                    { provider: 'pickaxe', label: 'Pickaxe / NanoBanana2',   internal: true, supportsCharRefs: true },
    'GPT Image2':                     { provider: 'pickaxe', label: 'Pickaxe / GPT Image2',    internal: true, supportsCharRefs: true },
    // --- OpenAI ---
    'gpt-image-2':                    { provider: 'openai',  label: 'OpenAI gpt-image-2',      internal: false, supportsCharRefs: true },
    'gpt-image-1':                    { provider: 'openai',  label: 'OpenAI gpt-image-1',      internal: false, supportsCharRefs: true },
    'dall-e-3':                       { provider: 'openai',  label: 'OpenAI DALL·E 3',         internal: false, supportsCharRefs: false },
    // --- Gemini (Google) ---
    'imagen-3.0-generate-002':        { provider: 'gemini',  label: 'Google Imagen 3',         internal: false, supportsCharRefs: false },
    'gemini-2.5-flash-image-preview': { provider: 'gemini',  label: 'Gemini 2.5 Flash Image',  internal: false, supportsCharRefs: true }
  };
  function getProviderForModel(model) {
    const def = IMAGE_GEN_MODEL_REGISTRY[model];
    // 未登録モデルは Pickaxe 経由として扱う (歴史的互換: 旧 Pickaxe モデル文字列が来ても動く)
    return def ? def.provider : 'pickaxe';
  }

  // デバッグ/スパイク用: モデル切替をブラウザコンソールから行うためのヘルパを公開。
  // 本来の app.js は IIFE で閉じているため、UI 完成までの暫定的な「裏口」。
  // モデル選択は localStorage 'zukai-debug-model' に保存され、ページリロード後も維持される。
  // 利用例:
  //   window.zukaiDebug.listModels()        → 登録モデル一覧
  //   window.zukaiDebug.getModel()          → 現在のモデル
  //   window.zukaiDebug.setModel('gpt-image-2')  → 切替 + 永続化
  //   window.zukaiDebug.clearModel()        → 永続化したモデル設定をクリア (デフォルトに戻す)
  const ZUKAI_DEBUG_MODEL_KEY = 'zukai-debug-model';

  // ページロード時、保存済みのデバッグモデルがあればそれを imageGenState に反映する。
  // UI カード (selection-card) の active 状態も同期させる。
  function _syncModelCardUI(model) {
    // activateCard を使ってカードのハイライトを同期 (この時点で DOM は存在する)
    if (typeof activateCard === 'function') {
      try { activateCard('model', model); } catch (_) {}
    }
  }
  try {
    const savedModel = localStorage.getItem(ZUKAI_DEBUG_MODEL_KEY);
    if (savedModel && IMAGE_GEN_MODEL_REGISTRY[savedModel]) {
      imageGenState.model = savedModel;
      _syncModelCardUI(savedModel);
      console.log('[zukaiDebug] restored from localStorage: model =', savedModel,
        '/ provider =', IMAGE_GEN_MODEL_REGISTRY[savedModel].provider);
    } else {
      _syncModelCardUI(imageGenState.model);
      console.log('[zukaiDebug] active model =', imageGenState.model,
        '/ provider =', getProviderForModel(imageGenState.model),
        '(default; use zukaiDebug.setModel(...) to switch)');
    }
  } catch (_) {}

  window.zukaiDebug = window.zukaiDebug || {};
  window.zukaiDebug.listModels = function () {
    return Object.entries(IMAGE_GEN_MODEL_REGISTRY).map(([id, def]) => ({
      id,
      provider: def.provider,
      label: def.label,
      internal: def.internal,
      supportsCharRefs: def.supportsCharRefs
    }));
  };
  window.zukaiDebug.getModel = function () {
    return imageGenState.model;
  };
  window.zukaiDebug.setModel = function (model) {
    if (!IMAGE_GEN_MODEL_REGISTRY[model]) {
      console.warn('[zukaiDebug] unknown model:', model, '— allowed:',
        Object.keys(IMAGE_GEN_MODEL_REGISTRY).join(', '));
      return null;
    }
    imageGenState.model = model;
    try { localStorage.setItem(ZUKAI_DEBUG_MODEL_KEY, model); } catch (_) {}
    _syncModelCardUI(model);
    console.log('[zukaiDebug] imageGenState.model =', model,
      '/ provider =', IMAGE_GEN_MODEL_REGISTRY[model].provider,
      '(saved to localStorage, persists across reloads)');
    return model;
  };
  window.zukaiDebug.clearModel = function () {
    try { localStorage.removeItem(ZUKAI_DEBUG_MODEL_KEY); } catch (_) {}
    console.log('[zukaiDebug] localStorage cleared. Reload page to reset to default.');
  };
  // 直近の生成ジョブの復元キャッシュを消す。リロード時に「前回の生成」が出なくなる。
  window.zukaiDebug.clearLastJob = function () {
    try { localStorage.removeItem('zukai-last-job-id'); } catch (_) {}
    console.log('[zukaiDebug] last job id cleared. Reload page to confirm no restoration.');
  };

  // 同時実行数とリトライ設定
  // Pickaxe deployment キーは単独だと並列実行に制限があるため、
  // 複数キーをローテーション利用することで N 並列を実現する。
  // 同時実行数。デプロイメントキーは複数あるが、Pickaxe バックエンド
  // (Modal.com) は実際には共通リソースを取り合うため、同一ワークスペース内
  // の複数 deployment では真の並列にならない。
  // 新構成では別ワークスペース × 7 にそれぞれ独立した画像生成 AI を置く。
  // 修正後タイムアウト (Browser 320s > Vercel 300s > Proxy 290s) での実測 (2026-05-19):
  //   7 並列 + stagger 8s → 初回 5/7・リトライ込み 7/7・wall-clock 430s ★最良
  //   7 並列 + stagger 4s → 初回 2/7 (ゲートウェイ詰まり) wall-clock 903s
  //   4 並列 + stagger 8s → 初回 0/4 (290s 同時 timeout → スロット解放と
  //     後発スライドが同時発火し集中バースト連鎖) wall-clock 844s
  // 並列数を絞ると「タイムアウト周期=290s 毎の集中バースト」を生むため逆効果。
  // 7 ワークスペースを一斉に散らして発火するのが結果的に最も詰まりにくい。
  const PICKAXE_CONCURRENCY = 7;
  const PICKAXE_MAX_RETRIES = 2;
  const PICKAXE_RETRY_DELAY_MS = 2000;
  // 1試行あたりのフロントエンド側タイムアウト (ミリ秒)。
  // プロキシ側が 290s で諦めて 504 を返す → ブラウザはその応答を読み終える
  // 必要があるので、プロキシ + Vercel ハードキル (300s) よりさらに余裕を持って
  // 320s 待つ。これより前に AbortError を出すと、Pickaxe が裏で完了していても
  // 取得できないので必ずプロキシより長くする。
  const PICKAXE_REQUEST_TIMEOUT_MS = 320_000;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 共通: 画像生成プロキシ POST ヘルパ。
  // どのプロバイダの endpoint でも、LIFF認証 + AbortController による
  // タイムアウト管理 + エラーレスポンス整形を統一する。
  async function _postImageGenProxy(endpoint, body, timeoutMs) {
    let token = null;
    try {
      token = (typeof liff !== 'undefined' && liff.getAccessToken) ? liff.getAccessToken() : null;
    } catch (_) { token = null; }
    if (!token) throw new Error('LINE認証トークンが取得できません');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const e = new Error(`タイムアウト（${Math.round(timeoutMs / 1000)}秒以内に応答なし）`);
        e.status = 0;
        e.isTimeout = true;
        throw e;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      let detail = '';
      try {
        const j = await res.json();
        detail = j && j.detail ? `: ${typeof j.detail === 'string' ? j.detail.substring(0, 200) : JSON.stringify(j.detail).substring(0, 200)}` : '';
        if (j && j.error) detail = `${j.error}${detail}`;
      } catch (_) {}
      const err = new Error(`API Error ${res.status}${detail ? ` (${detail})` : ''}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    if (!data || !data.imageUrl) {
      throw new Error('画像URLが応答に含まれていません');
    }
    return data.imageUrl;
  }

  // Pickaxe 1試行 (旧 callPickaxeAPIOnce)
  async function callPickaxeAPIOnce(prompt, model, aspectRatio, keyIndex, refImageUrls) {
    const payload = { prompt, model, aspectRatio, keyIndex };
    if (Array.isArray(refImageUrls) && refImageUrls.length > 0) {
      payload.imageUrls = refImageUrls;
    }
    return _postImageGenProxy('/api/pickaxe-proxy', payload, PICKAXE_REQUEST_TIMEOUT_MS);
  }

  // OpenAI 1試行 (gpt-image-2 / gpt-image-1 / dall-e-3)
  // 実測で gpt-image-2 + img2img (char refs あり) は 60s 以上かかるケースあり。
  // Vercel maxDuration 180s + proxy abort 170s なので、ブラウザ側は更に長く 200s 待つ。
  const OPENAI_REQUEST_TIMEOUT_MS = 200_000;
  async function callOpenAIImageOnce(prompt, model, aspectRatio, refImageUrls) {
    const payload = { prompt, model, aspectRatio };
    if (Array.isArray(refImageUrls) && refImageUrls.length > 0) {
      payload.imageUrls = refImageUrls;
    }
    return _postImageGenProxy('/api/openai-image', payload, OPENAI_REQUEST_TIMEOUT_MS);
  }

  // Gemini 1試行 (Imagen 3 / Gemini 2.5 Flash Image)
  // OpenAI と同じく Vercel 180s + proxy 170s + browser 200s で揃える
  const GEMINI_REQUEST_TIMEOUT_MS = 200_000;
  async function callGeminiImageOnce(prompt, model, aspectRatio, refImageUrls) {
    const payload = { prompt, model, aspectRatio };
    if (Array.isArray(refImageUrls) && refImageUrls.length > 0) {
      payload.imageUrls = refImageUrls;
    }
    return _postImageGenProxy('/api/gemini-image', payload, GEMINI_REQUEST_TIMEOUT_MS);
  }

  function isRetryable(err) {
    // ネットワークエラー（"Failed to fetch"）、タイムアウト、429/5xx はリトライ対象
    if (!err) return false;
    if (err.isTimeout) return true; // AbortControllerによるタイムアウト
    if (err.name === 'TypeError') return true; // fetch network error
    if (err.status === 429) return true;
    if (err.status >= 500 && err.status < 600) return true;
    return false;
  }

  // ワークスペース keyIndex のラウンドロビン用カーソル (0..PICKAXE_WORKSPACE_COUNT-1)
  let _keyCursor = 0;
  function nextKeyIndex() {
    const idx = _keyCursor % PICKAXE_WORKSPACE_COUNT;
    _keyCursor++;
    return idx;
  }

  // 統一エントリポイント。model 名から自動的にプロバイダを判定して dispatch する。
  // 関数名 callPickaxeAPI は歴史的経緯で残しており、実態はマルチプロバイダ dispatcher。
  // preferredKeyIndex は Pickaxe 経路でのみ使われる (OpenAI/Gemini ではワークスペース概念がない)。
  async function callPickaxeAPI(prompt, model, aspectRatio, preferredKeyIndex, refImageUrls) {
    const provider = getProviderForModel(model);
    let lastErr;
    for (let attempt = 0; attempt <= PICKAXE_MAX_RETRIES; attempt++) {
      try {
        if (provider === 'pickaxe') {
          // 初回は割り当てワークスペースを使用、リトライ時は別ワークスペースにフォールバック
          const keyIndex = (attempt === 0 && Number.isInteger(preferredKeyIndex))
            ? preferredKeyIndex
            : nextKeyIndex();
          return await callPickaxeAPIOnce(prompt, model, aspectRatio, keyIndex, refImageUrls);
        } else if (provider === 'openai') {
          return await callOpenAIImageOnce(prompt, model, aspectRatio, refImageUrls);
        } else if (provider === 'gemini') {
          return await callGeminiImageOnce(prompt, model, aspectRatio, refImageUrls);
        } else {
          throw new Error(`unknown provider for model: ${model}`);
        }
      } catch (err) {
        lastErr = err;
        if (attempt >= PICKAXE_MAX_RETRIES || !isRetryable(err)) break;
        // 指数バックオフ
        await sleep(PICKAXE_RETRY_DELAY_MS * Math.pow(2, attempt));
      }
    }
    throw lastErr;
  }

  // 並列数を制限して非同期タスクを実行
  async function runWithConcurrency(items, limit, worker) {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        await worker(items[idx], idx);
      }
    });
    await Promise.all(runners);
  }

  // ============================================================
  // 画像の一括並行生成
  // ============================================================

  function buildImagePrompt(slideContent, stylePrompt, presetLabel, providerHint) {
    // OpenAI gpt-image-2 / Gemini は明示的かつ簡潔な指示が効きやすい。
    // 一方 Pickaxe ワークスペースは独自バイアスがあるため、スタイル指示を
    // 冒頭・末尾の両方で強調する従来フォーマットの方が安定する。
    // providerHint で経路ごとに最適化する。
    if (providerHint === 'openai' || providerHint === 'gemini') {
      return [
        `## 画風スタイル: ${presetLabel || 'カスタム'}`,
        stylePrompt,
        ``,
        `## 図解の内容`,
        slideContent,
        ``,
        `## 制約条件`,
        `- 1枚の完結したイラストとして仕上げる(複数コマや分割はしない)`,
        `- 図解内のテキストは日本語(漢字・ひらがな・カタカナ)で記載し、文字が崩れないよう丁寧に描画`,
        `- 装飾的な枠線・外枠・ロゴ・ウォーターマークは入れない`,
        `- 背景は上記の画風スタイルに合うシンプルなものに`,
        `- 上記スタイルから外れず、忠実に従うこと`
      ].join('\n');
    }
    // Pickaxe (歴史的フォーマット、後方互換維持)
    const styleHeader = presetLabel
      ? `【最優先：画風スタイル＝「${presetLabel}」】\n${stylePrompt}`
      : `【最優先：画風スタイル】\n${stylePrompt}`;
    return `${styleHeader}\n\n` +
      `上記の画風スタイルを必ず厳守してください。他のスタイルに勝手に変えないこと。\n\n` +
      `## コンテンツ\n以下の内容を図解画像として生成してください:\n${slideContent}\n\n` +
      `## 注意事項\n- 図解内のテキストは日本語で記載すること\n- ページ全体を1枚の画像として完成させること\n- 装飾的な枠線やロゴは不要\n\n` +
      `## 最終再確認\n画風は必ず「${presetLabel || 'ユーザー指定'}」: ${stylePrompt}`;
  }

  // 1枚あたりの想定生成時間（秒）。
  // 当初 70s で見積もっていたが、Pickaxe の混雑時は 120-240s ぐらいまで
  // 伸びることがあるため、ユーザーへの「残り時間」を過小に見せないよう
  // 中央値寄りの値にしている。
  const ESTIMATED_SEC_PER_IMAGE = 120;

  // 生成中に表示するヒント（30秒に1回程度ローテーション）
  const GENERATION_TIPS = [
    '💡 各スライドは個別にクリックで再生成できます',
    '🎨 完成後、お気に入りでないものだけ再生成すれば時間を節約できます',
    '✨ プロンプトに「日本語テキスト」を強調すると文字崩れが減ります',
    '🖼️ 生成画像は右クリック→保存でダウンロードできます',
    '⚙️ スタイルプリセットを切り替えて再生成すると印象が大きく変わります',
    '📐 スライドのアスペクト比は「フォーマット」で変更可能です'
  ];

  function estimateRemaining(totalCount, doneCount) {
    const remaining = totalCount - doneCount;
    const sec = Math.ceil((remaining / PICKAXE_CONCURRENCY) * ESTIMATED_SEC_PER_IMAGE);
    if (sec <= 0) return 'まもなく完了';
    if (sec < 60) return `残り約${sec}秒`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `残り約${m}分${s}秒` : `残り約${m}分`;
  }

  let _progressTimerId = null;
  let _generationStartTime = 0;
  let _tipRotateIndex = 0;
  let _tipTimerId = null;

  function startProgressTicker(total) {
    _generationStartTime = Date.now();
    if (_progressTimerId) clearInterval(_progressTimerId);
    _progressTimerId = setInterval(() => updateProgressUI(total), 500);
    if (_tipTimerId) clearInterval(_tipTimerId);
    _tipRotateIndex = 0;
    rotateTip();
    _tipTimerId = setInterval(rotateTip, 8000);
  }

  function stopProgressTicker() {
    if (_progressTimerId) { clearInterval(_progressTimerId); _progressTimerId = null; }
    if (_tipTimerId) { clearInterval(_tipTimerId); _tipTimerId = null; }
  }

  function rotateTip() {
    const tipEl = document.getElementById('imageGenTip');
    if (!tipEl) return;
    tipEl.textContent = GENERATION_TIPS[_tipRotateIndex % GENERATION_TIPS.length];
    _tipRotateIndex++;
  }

  function updateProgressUI(total) {
    const settled = imageGenState.generatedImages.filter(g => g.status !== 'loading').length;
    const success = imageGenState.generatedImages.filter(g => g.status === 'success').length;
    const errors = imageGenState.generatedImages.filter(g => g.status === 'error').length;
    // ゲージは「成功」だけを進行とみなす。失敗は完了扱いにしない。
    const pct = total > 0 ? Math.round((success / total) * 100) : 0;
    const elapsed = Math.round((Date.now() - _generationStartTime) / 1000);
    const remaining = estimateRemaining(total, settled);

    const barFill = document.getElementById('imageGenProgressFill');
    const pctLabel = document.getElementById('imageGenProgressPct');
    const countLabel = document.getElementById('imageGenProgressCount');
    const timeLabel = document.getElementById('imageGenProgressTime');

    if (barFill) barFill.style.width = `${pct}%`;
    if (pctLabel) pctLabel.textContent = `${pct}%`;
    if (countLabel) {
      countLabel.textContent = errors > 0
        ? `${success} / ${total} 成功（失敗 ${errors}）`
        : `${success} / ${total} 完了`;
    }
    if (timeLabel) timeLabel.textContent = `経過 ${elapsed}秒 ・ ${remaining}`;

    if (els.imageGridBadge) els.imageGridBadge.textContent = `${success} / ${total}`;
  }

  function ensureProgressBarDOM() {
    if (document.getElementById('imageGenProgress')) return;
    const grid = els.imageGrid;
    if (!grid || !grid.parentNode) return;
    const wrap = document.createElement('div');
    wrap.id = 'imageGenProgress';
    wrap.className = 'image-gen-progress';
    wrap.innerHTML = `
      <div class="image-gen-progress__top">
        <span class="image-gen-progress__count" id="imageGenProgressCount">0 / 0 完了</span>
        <span class="image-gen-progress__pct" id="imageGenProgressPct">0%</span>
      </div>
      <div class="image-gen-progress__bar"><div class="image-gen-progress__fill" id="imageGenProgressFill"></div></div>
      <div class="image-gen-progress__bottom">
        <span class="image-gen-progress__time" id="imageGenProgressTime">準備中...</span>
        <span class="image-gen-progress__tip" id="imageGenTip"></span>
      </div>
    `;
    grid.parentNode.insertBefore(wrap, grid);
  }

  function showProgressBar() {
    ensureProgressBarDOM();
    const el = document.getElementById('imageGenProgress');
    if (el) el.style.display = '';
  }

  // ============================================================
  // 生成ジョブの永続化ログ (フェーズ1: Supabase に best-effort で記録)
  // ============================================================
  // 目的: 将来サーバーサイドオーケストレーションに移行する土台。
  //   フェーズ1 では生成フロー自体に影響を与えず、観測データだけを蓄積する。
  // 失敗時の挙動: console.warn を出して黙って続行する。画像生成は止めない。

  function _getLiffToken() {
    try {
      return (typeof liff !== 'undefined' && liff.getAccessToken) ? liff.getAccessToken() : null;
    } catch (_) { return null; }
  }

  async function logGenerationStart(jobId, payload) {
    const token = _getLiffToken();
    if (!token) return false;
    try {
      const res = await fetch('/api/log-generation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ job_id: jobId, ...payload })
      });
      if (!res.ok) {
        console.warn('[ImageGen] log-generation HTTP', res.status);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('[ImageGen] log-generation failed (non-fatal):', e && e.message);
      return false;
    }
  }

  function logSlideResult(jobId, slideIdx, result) {
    // 完全な fire-and-forget。keepalive を付けることで、ユーザーがタブを
    // 閉じても送信は完遂される (フェーズ2 で活きる前提)。
    const token = _getLiffToken();
    if (!token) return;
    try {
      fetch('/api/log-slide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ job_id: jobId, slide_idx: slideIdx, ...result }),
        keepalive: true
      }).catch(e => console.warn('[ImageGen] log-slide failed (non-fatal):', e && e.message));
    } catch (e) {
      console.warn('[ImageGen] log-slide setup failed:', e && e.message);
    }
  }

  async function generateAllImages() {
    if (!gateOrToast('ai.imagegen', '画像一括生成')) return;
    if (!carouselData || !carouselData.slides || carouselData.slides.length === 0) {
      showToast('先にJSONを展開してください');
      return;
    }

    const stylePrompt = getCurrentStylePrompt();
    if (!stylePrompt) {
      showToast('スタイルプロンプトを入力してください');
      return;
    }

    const slides = carouselData.slides;
    const total = slides.length;
    const hasCharRefs = characterImages.length > 0;

    // プロバイダ別の所要時間見積もり
    //   Pickaxe: Modal cold start 込みで重い (1枚 120s ベース)
    //   OpenAI/Gemini text→画像: warm インフラで 15–30s/枚
    //   OpenAI/Gemini img2img (char refs): gpt-image-2 + edits で 60–120s/枚 と判明
    const _activeProvider = getProviderForModel(imageGenState.model);
    let _baseSecPerImage;
    if (_activeProvider === 'pickaxe') {
      _baseSecPerImage = ESTIMATED_SEC_PER_IMAGE;
    } else if (hasCharRefs) {
      _baseSecPerImage = 90;  // img2img は遅い
    } else {
      _baseSecPerImage = 25;
    }
    const perImageSec = _baseSecPerImage;
    const estimatedSec = Math.ceil((total / PICKAXE_CONCURRENCY) * perImageSec);
    const estimatedLabel = estimatedSec < 60
      ? `約${estimatedSec}秒`
      : `約${Math.ceil(estimatedSec / 60)}分`;

    const presetDef = IMAGE_GEN_STYLE_PRESETS[imageGenState.selectedPreset];
    const presetLabel = presetDef ? presetDef.label : 'カスタム';

    // 参考画像があれば先にアップロードして公開URLを取得
    // (失敗時はテキストのみで続行)
    let characterImageUrls = [];
    if (hasCharRefs) {
      showToast(`📤 キャラ画像${characterImages.length}枚をアップロード中...`);
      try {
        characterImageUrls = await ensureCharacterImageUrls();
        console.log('[ImageGen] character ref URLs:', characterImageUrls);
      } catch (err) {
        console.warn('[ImageGen] character image upload failed:', err);
        showToast(`⚠️ キャラ画像のアップロード失敗（テキストのみで生成します）: ${err.message}`);
        characterImageUrls = [];
      }
    }

    // 開始通知（即時実行、ブロッキングなし）
    const refsNote = characterImageUrls.length > 0
      ? `（参考画像${characterImageUrls.length}枚あり）`
      : '';
    showToast(`🎨 ${total}枚を「${presetLabel}」で生成開始${refsNote}（${estimatedLabel}）`);

    const model = imageGenState.model;
    const aspectRatio = state.format;

    // 画像グリッド初期化（全スライドにローディング表示）
    imageGenState.generatedImages = slides.map((slide, i) => ({
      slideIndex: i,
      imageUrl: null,
      stylePrompt: stylePrompt,
      contentPrompt: slide.content || '',
      model: imageGenState.model,
      status: 'loading',
      error: null,
      failedModel: null
    }));

    // UI表示＋プログレスバー
    els.imageGridSection.style.display = '';
    showProgressBar();
    renderImageGrid();
    updateProgressUI(total);
    // 24h カウントダウン: 新規生成なので now を起点に
    updateImageGridNotice(Date.now());

    // スクロール
    setTimeout(() => {
      els.imageGridSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);

    els.imageGenBtn.disabled = true;
    els.imageGenBtn.innerHTML = `
      <span class="spinner" aria-hidden="true"></span>
      生成中...（${estimatedLabel}）
    `;

    startProgressTicker(total);

    // デバッグ: 送信プロンプトをコンソール出力
    console.log('[ImageGen] preset:', imageGenState.selectedPreset, '/ label:', presetLabel);
    console.log('[ImageGen] stylePrompt:', stylePrompt);

    // ワークスペース keyIndex カーソルを毎回リセット（毎回 #1 から開始）
    _keyCursor = 0;

    // 生成ジョブの永続化ログを開始 (フェーズ1: best-effort)。
    // 失敗時は jobId を null に倒して以降の slide ログを no-op にする。
    let jobId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null;
    if (jobId) {
      const logged = await logGenerationStart(jobId, {
        preset_code:        imageGenState.selectedPreset,
        preset_label:       presetLabel,
        style_prompt:       stylePrompt,
        model:              model,
        aspect_ratio:       aspectRatio,
        total_slides:       total,
        has_character_refs: characterImageUrls.length > 0,
        slides: slides.map((s, i) => ({ slide_idx: i, content: s.content || '' }))
      });
      if (!logged) {
        console.warn('[ImageGen] generation logging unavailable, continuing without it');
        jobId = null;
      } else {
        console.log('[ImageGen] generation job logged:', jobId);
        // 復元用: 最新の jobId を localStorage に保存 (ページ閉じても 24h 以内なら復元可)
        try { localStorage.setItem(LAST_JOB_KEY, jobId); } catch (_) {}
      }
    }

    // 各スライドに別ワークスペースを割り当ててワークスペース単位で並列実行
    // ※Pickaxe は Modal cold start 衝突回避のため 8s スタガーが必須 (実測で load-bearing)。
    //   OpenAI は Tier 1 で 5 IPM 制限のため並列度を 3 に下げる (5枚同時発火を回避)。
    //   Gemini は AI Studio で比較的緩いが念のため 5。
    let _activeConcurrency, STAGGER_DELAY_MS;
    if (_activeProvider === 'pickaxe') {
      _activeConcurrency = PICKAXE_CONCURRENCY;  // 7
      STAGGER_DELAY_MS = 8000;
    } else if (_activeProvider === 'openai') {
      _activeConcurrency = 3;                    // Tier 1 安全圏
      STAGGER_DELAY_MS = 1500;                   // 軽くずらして burst を避ける
    } else if (_activeProvider === 'gemini') {
      _activeConcurrency = 5;
      STAGGER_DELAY_MS = 500;
    } else {
      _activeConcurrency = 3;
      STAGGER_DELAY_MS = 0;
    }
    console.log('[ImageGen] provider:', _activeProvider, '/ concurrency:', _activeConcurrency, '/ stagger:', STAGGER_DELAY_MS + 'ms');
    await runWithConcurrency(slides, _activeConcurrency, async (slide, i) => {
      // スタガリング: 各リクエストの開始を i * STAGGER_DELAY_MS だけ遅らせる
      const initialDelay = (i < _activeConcurrency) ? i * STAGGER_DELAY_MS : 0;
      if (initialDelay > 0) await sleep(initialDelay);

      const content = slide.content || '';
      const fullPrompt = buildImagePrompt(content, stylePrompt, presetLabel, _activeProvider);
      const assignedKeyIndex = i % PICKAXE_WORKSPACE_COUNT;
      if (i === 0) console.log('[ImageGen] sample full prompt (slide 1):\n', fullPrompt);
      console.log(`[ImageGen] slide ${i + 1} -> workspace #${assignedKeyIndex + 1} (start delay: ${initialDelay}ms)`);
      const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      try {
        const imageUrl = await callPickaxeAPI(fullPrompt, model, aspectRatio, assignedKeyIndex, characterImageUrls);
        imageGenState.generatedImages[i].imageUrl = imageUrl;
        imageGenState.generatedImages[i].status = 'success';
        imageGenState.generatedImages[i].model = model;
        imageGenState.generatedImages[i].failedModel = null;
        renderImageGrid();
        updateProgressUI(total);
        if (jobId) {
          const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
          logSlideResult(jobId, i, {
            status: 'success',
            image_url: imageUrl,
            workspace_idx: assignedKeyIndex,
            elapsed_ms: elapsedMs
          });
        }
      } catch (err) {
        imageGenState.generatedImages[i].status = 'error';
        imageGenState.generatedImages[i].error = err.message || String(err);
        imageGenState.generatedImages[i].failedModel = model;
        console.error(`[ImageGen] slide ${i + 1} failed:`, err);
        renderImageGrid();
        updateProgressUI(total);
        if (jobId) {
          const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
          const errMsg = (err && err.message ? err.message : String(err)).slice(0, 500);
          logSlideResult(jobId, i, {
            status: 'failed',
            error: errMsg,
            workspace_idx: assignedKeyIndex,
            elapsed_ms: elapsedMs
          });
        }
      }
    });

    stopProgressTicker();
    updateProgressUI(total);

    // ボタン復元
    els.imageGenBtn.disabled = false;
    els.imageGenBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
      </svg>
      画像を一括生成する
    `;

    const successCount = imageGenState.generatedImages.filter(g => g.status === 'success').length;
    showToast(`✨ ${successCount}/${slides.length}枚の画像を生成しました`);
  }

  // ============================================================
  // 画像グリッド描画
  // ============================================================

  function renderImageGrid() {
    const grid = els.imageGrid;
    if (!grid) return;

    const images = imageGenState.generatedImages;
    const total = images.length;
    const successCount = images.filter(g => g.status === 'success').length;

    // バッジ更新（成功した枚数のみカウント。失敗は完了扱いにしない）
    if (els.imageGridBadge) {
      els.imageGridBadge.textContent = `${successCount} / ${total}`;
    }

    // 一括ダウンロードボタンの表示制御
    const bulkDlBtn = document.getElementById('bulkDownloadBtn');
    if (bulkDlBtn) {
      bulkDlBtn.style.display = successCount >= 2 ? '' : 'none';
    }

    grid.innerHTML = '';
    images.forEach((img, i) => {
      const item = document.createElement('div');
      item.className = 'image-grid-item';

      if (img.status === 'loading') {
        item.classList.add('image-grid-item--loading');
        item.innerHTML = `
          <div class="image-grid-item__badge">${i + 1}</div>
          <div class="image-grid-item__skeleton">
            <svg class="image-grid-item__skeleton-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            <span class="image-grid-item__skeleton-text">生成中...</span>
          </div>
        `;
      } else if (img.status === 'error') {
        item.classList.add('image-grid-item--error');
        item.innerHTML = `
          <div class="image-grid-item__badge">${i + 1}</div>
          <div class="image-grid-item__error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <span class="image-grid-item__error-text">${escapeHtml(img.error || 'エラー')}</span>
          </div>
        `;
        item.addEventListener('click', () => openRegenModal(i));
      } else {
        // data URL (フォールバック) は共有不可なのでコピーボタンの挙動を変える
        const isDataUrl = typeof img.imageUrl === 'string' && img.imageUrl.startsWith('data:');
        item.innerHTML = `
          <div class="image-grid-item__badge">${i + 1}</div>
          <img class="image-grid-item__img" src="${img.imageUrl}" alt="スライド ${i + 1}" loading="lazy">
          <div class="image-grid-item__overlay">
            <div class="image-grid-item__overlay-actions">
              <button class="image-grid-item__action-btn" data-action="expand" title="拡大表示">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </button>
              <button class="image-grid-item__action-btn" data-action="download" title="ダウンロード">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </button>
              <button class="image-grid-item__action-btn" data-action="copy-url" title="画像URLをコピー${isDataUrl ? ' (この画像はURL共有不可)' : ''}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              </button>
              <button class="image-grid-item__action-btn" data-action="regen" title="再生成">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              </button>
            </div>
          </div>
        `;
        // 各アクションボタンのイベント
        item.querySelector('[data-action="expand"]').addEventListener('click', (e) => {
          e.stopPropagation();
          openLightbox(i);
        });
        item.querySelector('[data-action="download"]').addEventListener('click', (e) => {
          e.stopPropagation();
          downloadImage(img.imageUrl, i);
        });
        item.querySelector('[data-action="copy-url"]').addEventListener('click', (e) => {
          e.stopPropagation();
          copyImageUrl(img.imageUrl);
        });
        item.querySelector('[data-action="regen"]').addEventListener('click', (e) => {
          e.stopPropagation();
          openRegenModal(i);
        });
        // 画像本体クリックで拡大
        item.querySelector('.image-grid-item__img').addEventListener('click', (e) => {
          e.stopPropagation();
          openLightbox(i);
        });
      }

      grid.appendChild(item);
    });
  }

  // ============================================================
  // ライトボックス（拡大表示）
  // ============================================================

  function openLightbox(slideIndex) {
    const overlay = document.getElementById('lightboxOverlay');
    const img = document.getElementById('lightboxImage');
    const caption = document.getElementById('lightboxCaption');
    const dlBtn = document.getElementById('lightboxDownloadBtn');
    if (!overlay || !img) return;

    const imgData = imageGenState.generatedImages[slideIndex];
    if (!imgData || !imgData.imageUrl) return;

    img.src = imgData.imageUrl;
    img.alt = `スライド ${slideIndex + 1}`;
    if (caption) caption.textContent = `スライド ${slideIndex + 1}`;

    // ダウンロードボタンにデータ付与
    if (dlBtn) {
      dlBtn.dataset.slideIndex = slideIndex;
    }

    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    const overlay = document.getElementById('lightboxOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // ============================================================
  // 画像 URL コピー (Supabase Storage の公開URLをクリップボードへ)
  // ============================================================

  async function copyImageUrl(url) {
    if (!url) {
      showToast('⚠️ コピーできるURLがありません');
      return;
    }
    // C 実装後は基本 https URL だが、Storage アップロード失敗時の data URL フォールバックが
    // 起きていると共有不可。その場合は警告を出してダウンロードを促す。
    if (typeof url === 'string' && url.startsWith('data:')) {
      showToast('⚠️ この画像はURL共有できません。ダウンロードして使ってください');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast('✅ 画像URLをコピーしました');
      } else {
        // 古い環境 (LIFF 内 WebView 等) のフォールバック
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('✅ 画像URLをコピーしました');
      }
    } catch (e) {
      console.warn('[copyImageUrl] clipboard write failed:', e && e.message);
      showToast('⚠️ コピーに失敗しました。右クリック→画像のURLをコピーしてください');
    }
  }

  // ============================================================
  // 保存期限通知バナーの更新
  // ============================================================
  // 24時間で消える Supabase Storage の特性に合わせ、UI に残り時間を表示する。
  // createdAtMs が分かっている場合は残り時間 (h/m) を表示、未確定 (= まだ生成中で
  // jobId 確定前) なら一般文言を出す。残り3時間切ったら「urgent」スタイル。

  function updateImageGridNotice(createdAtMs) {
    const text = document.getElementById('imageGridNoticeText');
    const box  = document.getElementById('imageGridNotice');
    if (!text || !box) return;

    if (!createdAtMs || !isFinite(createdAtMs)) {
      text.innerHTML = '生成画像は<strong>24時間</strong>で自動削除されます。保存するには各画像のダウンロードボタン📥を押してください。';
      box.classList.remove('image-grid-notice--urgent');
      return;
    }

    const totalMs = 24 * 3600 * 1000;
    const remainingMs = totalMs - (Date.now() - createdAtMs);
    if (remainingMs <= 0) {
      text.innerHTML = '生成画像は<strong>まもなく</strong>自動削除されます。ダウンロード済みでない場合は急いで保存してください。';
      box.classList.add('image-grid-notice--urgent');
      return;
    }
    const totalMin = Math.floor(remainingMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const remainStr = h > 0 ? `${h}時間${m}分` : `${m}分`;
    text.innerHTML = `生成画像はあと<strong>${remainStr}</strong>で自動削除されます。保存するには各画像のダウンロードボタン📥または「すべての画像をダウンロード」を押してください。`;
    box.classList.toggle('image-grid-notice--urgent', remainingMs < 3 * 3600 * 1000);
  }

  // ============================================================
  // 画像ダウンロード
  // ============================================================

  async function downloadImage(url, slideIndex) {
    try {
      showToast(`⬇️ スライド ${slideIndex + 1} をダウンロード中...`);
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const fileName = `slide_${slideIndex + 1}.${ext}`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      showToast(`✅ スライド ${slideIndex + 1} を保存しました`);
    } catch (err) {
      console.error('Download failed:', err);
      // フォールバック：新しいタブで開く
      window.open(url, '_blank');
      showToast('⚠️ 直接ダウンロードに失敗しました。新しいタブで開きました');
    }
  }

  async function downloadAllImages() {
    const successImages = imageGenState.generatedImages.filter(g => g.status === 'success');
    if (successImages.length === 0) {
      showToast('ダウンロードできる画像がありません');
      return;
    }

    showToast(`⬇️ ${successImages.length}枚の画像を一括ダウンロード中...`);

    for (let i = 0; i < successImages.length; i++) {
      const img = successImages[i];
      // 連続ダウンロードの間に少し待つ（ブラウザのブロック防止）
      if (i > 0) await sleep(500);
      await downloadImage(img.imageUrl, img.slideIndex);
    }

    showToast(`✅ ${successImages.length}枚の画像をダウンロードしました`);
  }

  // ============================================================
  // 再生成モーダル
  // ============================================================

  function openRegenModal(slideIndex) {
    const imgData = imageGenState.generatedImages[slideIndex];
    if (!imgData) return;

    imageGenState.regenSlideIndex = slideIndex;

    // タイトル更新
    if (els.regenModalTitle) {
      els.regenModalTitle.textContent = `スライド ${slideIndex + 1} — 再生成`;
    }

    // プレビュー
    if (els.regenModalPreview) {
      if (imgData.imageUrl) {
        els.regenModalPreview.innerHTML = `<img src="${imgData.imageUrl}" alt="現在の画像">`;
      } else {
        els.regenModalPreview.innerHTML = '<span style="color:var(--text-tertiary);padding:var(--space-8)">画像なし</span>';
      }
    }

    // プロンプト入力欄
    if (els.regenStylePrompt) {
      els.regenStylePrompt.value = imgData.stylePrompt || getCurrentStylePrompt();
    }
    if (els.regenContentPrompt) {
      els.regenContentPrompt.value = imgData.contentPrompt || '';
    }

    // モデル選択の初期化
    // - 失敗していたら、失敗モデルとは別のモデルを推奨選択
    // - それ以外は、最後に使用したモデル（imgData.model）を選択
    const failedModel = imgData.status === 'error' ? imgData.failedModel : null;
    let initialModel;
    if (failedModel) {
      // 失敗時は別プロバイダにフォールバック提案 (gpt-image-2 ↔ gemini-2.5 ↔ Pickaxe で循環)
      const fallbackChain = {
        'gpt-image-2':                    'gemini-2.5-flash-image-preview',
        'gemini-2.5-flash-image-preview': 'gpt-image-2',
        'NanoBanana2':                    'GPT Image2',
        'GPT Image2':                     'NanoBanana2'
      };
      initialModel = fallbackChain[failedModel] || 'gpt-image-2';
    } else {
      initialModel = imgData.model || imageGenState.model;
    }
    updateRegenModelSelection(initialModel, failedModel);

    // モーダル表示
    if (els.regenModalOverlay) {
      els.regenModalOverlay.classList.add('active');
    }
  }

  function updateRegenModelSelection(selectedModel, failedModel) {
    imageGenState.regenSelectedModel = selectedModel;
    const btns = [
      { el: els.regenModelGptImage2,        model: 'gpt-image-2' },
      { el: els.regenModelGeminiFlashImage, model: 'gemini-2.5-flash-image-preview' },
      { el: els.regenModelNano,             model: 'NanoBanana2' },
      { el: els.regenModelGPT,              model: 'GPT Image2' }
    ];
    btns.forEach(({ el, model }) => {
      if (!el) return;
      el.classList.toggle('active', model === selectedModel);
      el.classList.toggle('regen-model-btn--failed', model === failedModel);
      el.setAttribute('aria-checked', model === selectedModel ? 'true' : 'false');
    });
    if (els.regenModelHint) {
      if (failedModel && selectedModel !== failedModel) {
        els.regenModelHint.textContent = `${failedModel} で失敗したため、${selectedModel} で再試行します。`;
        els.regenModelHint.classList.add('regen-modal__hint--suggest');
      } else if (failedModel && selectedModel === failedModel) {
        els.regenModelHint.textContent = `同じ ${failedModel} で再試行します（別モデルへの切替も可能）。`;
        els.regenModelHint.classList.remove('regen-modal__hint--suggest');
      } else {
        els.regenModelHint.textContent = '';
        els.regenModelHint.classList.remove('regen-modal__hint--suggest');
      }
    }
  }

  function closeRegenModal() {
    if (els.regenModalOverlay) {
      els.regenModalOverlay.classList.remove('active');
    }
    imageGenState.regenSlideIndex = -1;
  }

  async function submitRegeneration() {
    const idx = imageGenState.regenSlideIndex;
    if (idx < 0 || idx >= imageGenState.generatedImages.length) return;

    const stylePrompt = els.regenStylePrompt ? els.regenStylePrompt.value.trim() : '';
    const contentPrompt = els.regenContentPrompt ? els.regenContentPrompt.value.trim() : '';

    if (!stylePrompt) {
      showToast('スタイルプロンプトを入力してください');
      return;
    }

    // モーダル閉じる
    closeRegenModal();

    // 再生成に使うモデル（モーダルで選択されたもの。未選択時は画像保存値→グローバル）
    const selectedModel = imageGenState.regenSelectedModel
      || imageGenState.generatedImages[idx].model
      || imageGenState.model;

    // ローディング表示
    imageGenState.generatedImages[idx].status = 'loading';
    imageGenState.generatedImages[idx].stylePrompt = stylePrompt;
    imageGenState.generatedImages[idx].contentPrompt = contentPrompt;
    const total = imageGenState.generatedImages.length;
    renderImageGrid();
    updateProgressUI(total);

    showToast(`🔄 スライド ${idx + 1} を ${selectedModel} で再生成中...`);

    try {
      const presetDef = IMAGE_GEN_STYLE_PRESETS[imageGenState.selectedPreset];
      const presetLabel = presetDef ? presetDef.label : 'カスタム';
      const _regenProvider = getProviderForModel(selectedModel);
      const fullPrompt = buildImagePrompt(contentPrompt, stylePrompt, presetLabel, _regenProvider);

      // 参考画像があれば同じURLを使い回す (既にアップロード済みのはず)
      let charImageUrls = [];
      if (characterImages.length > 0) {
        try {
          charImageUrls = await ensureCharacterImageUrls();
        } catch (err) {
          console.warn('[Regen] character image upload failed:', err);
          showToast(`⚠️ キャラ画像のアップロード失敗（テキストのみで再生成します）`);
          charImageUrls = [];
        }
      }
      // 再生成では preferredKeyIndex を指定せず、ラウンドロビンに任せる
      const imageUrl = await callPickaxeAPI(fullPrompt, selectedModel, state.format, undefined, charImageUrls);

      imageGenState.generatedImages[idx].imageUrl = imageUrl;
      imageGenState.generatedImages[idx].status = 'success';
      imageGenState.generatedImages[idx].error = null;
      imageGenState.generatedImages[idx].model = selectedModel;
      imageGenState.generatedImages[idx].failedModel = null;
      renderImageGrid();
      updateProgressUI(total);
      showToast(`✅ スライド ${idx + 1} を ${selectedModel} で再生成しました`);
    } catch (err) {
      imageGenState.generatedImages[idx].status = 'error';
      imageGenState.generatedImages[idx].error = err.message;
      imageGenState.generatedImages[idx].failedModel = selectedModel;
      renderImageGrid();
      updateProgressUI(total);
      showToast(`⚠️ ${selectedModel} での再生成に失敗しました（別モデルでお試しください）`);
    }
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

  // ============================================================
  // 季節パーティクル（新緑の葉っぱ）
  // ============================================================

  const LEAF_SVG_SRC = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><path d="M20 2C12 8 4 18 6 30c2-4 6-8 14-10C14 26 10 30 8 34c4-2 10-6 14-14 2 8 1 14 0 18 3-4 6-10 6-18 2 6 4 10 6 12-1-6-2-12-6-18 4 2 8 2 10 2-4-3-8-5-14-6 4-2 8-6 10-8H20z" fill="#22c55e" opacity="0.75"/></svg>`);

  let seasonalAnimationId = null;

  function createSeasonalPetal() {
    const container = document.getElementById('seasonalPetalsContainer');
    if (!container) return;

    const petal = document.createElement('img');
    petal.src = LEAF_SVG_SRC;
    petal.alt = '';
    petal.className = 'seasonal-petal';
    petal.draggable = false;

    const size = 10 + Math.random() * 16;
    const startX = Math.random() * window.innerWidth;
    const driftX = (Math.random() - 0.5) * 180;
    const endDrift = driftX + (Math.random() - 0.5) * 80;
    const duration = 7 + Math.random() * 9;
    const delay = Math.random() * 2;
    const midRotate = 90 + Math.random() * 270;
    const endRotate = midRotate + 90 + Math.random() * 180;
    const opacity = 0.35 + Math.random() * 0.45;

    petal.style.setProperty('--petal-size', size + 'px');
    petal.style.setProperty('--start-x', startX + 'px');
    petal.style.setProperty('--drift-x', driftX + 'px');
    petal.style.setProperty('--end-drift', endDrift + 'px');
    petal.style.setProperty('--mid-rotate', midRotate + 'deg');
    petal.style.setProperty('--end-rotate', endRotate + 'deg');
    petal.style.setProperty('--petal-opacity', opacity);
    petal.style.left = '0px';
    petal.style.top = '-20px';
    petal.style.animation = `leafFall ${duration}s ease-in-out ${delay}s forwards`;

    container.appendChild(petal);

    setTimeout(() => {
      if (petal.parentNode) {
        petal.parentNode.removeChild(petal);
      }
    }, (duration + delay) * 1000 + 100);

    return petal;
  }

  function startSeasonalPetals() {
    stopSeasonalPetals();
    for (let i = 0; i < 6; i++) {
      setTimeout(() => createSeasonalPetal(), i * 400);
    }
    seasonalAnimationId = setInterval(() => {
      const container = document.getElementById('seasonalPetalsContainer');
      if (container && container.children.length < 20) {
        createSeasonalPetal();
      }
    }, 1000);
  }

  function stopSeasonalPetals() {
    if (seasonalAnimationId) {
      clearInterval(seasonalAnimationId);
      seasonalAnimationId = null;
    }
    const container = document.getElementById('seasonalPetalsContainer');
    if (container) {
      container.innerHTML = '';
    }
  }

  function init() {
    // 季節テーマボタンを動的に設定
    const seasonalBtn = document.getElementById('seasonalThemeBtn');
    const seasonalIcon = document.getElementById('seasonalThemeIcon');
    const seasonalBadge = document.getElementById('seasonalBadge');

    if (seasonalBtn) {
      seasonalBtn.dataset.theme = currentSeason.id;
      seasonalBtn.title = currentSeason.icon + ' ' + currentSeason.badge.replace(/[^\u3000-\u9FFF\u4E00-\u9FFF\w]/g, '').trim();
    }
    if (seasonalIcon) {
      seasonalIcon.textContent = currentSeason.icon;
    }
    if (seasonalBadge) {
      seasonalBadge.textContent = currentSeason.badge;
    }

    loadState();

    // 保存済みテーマが季節テーマだが現在の季節と異なる場合、今の季節に切替
    const savedTheme = state.theme;
    const allSeasonIds = Object.keys(SEASONAL_THEMES);
    if (allSeasonIds.includes(savedTheme) && savedTheme !== currentSeason.id) {
      state.theme = currentSeason.id;
    }

    applyUIState();
    initEvents();
    // AIプロバイダ選択を保存値で初期化
    const aiCfg = loadAiConfig();
    if (els.aiProvider) els.aiProvider.value = aiCfg.provider;
    updateAiBadge();
  }

  // ============================================================
  // LINE LIFF 認証 + /api/me プラン情報取得
  // ============================================================

  // /api/me で取得したプラン情報のシングルソース
  // 形 : { lineUserId, product, plan, status, planExpiresAt, tags: string[], updatedAt, source: 'api'|'local-dev'|'open-access'|'fallback' }
  window.__USER_PROFILE__ = null;

  // 機能ゲート: feature key が現プラン/タグで解放されているかを返す
  window.hasFeature = function hasFeature(featureKey) {
    const profile = window.__USER_PROFILE__;
    if (!profile) return false;
    const planActive = profile.status === 'active';
    const planFeats = planActive
      ? (PLAN_FEATURES[profile.plan] || PLAN_FEATURES.free)
      : PLAN_FEATURES.free;
    const tagFeats = (profile.tags || []).flatMap(t => TAG_FEATURE_GRANTS[t] || []);
    return planFeats.includes(featureKey) || tagFeats.includes(featureKey);
  };

  // プロバイダゲート: 内部限定 (Pickaxe など) のモデルカードを表示/非表示する。
  // fetchUserProfile 完了後に呼ばれる。デフォルトでは内部カードは HTML 上 display:none。
  // タグを失ったユーザーが localStorage に古い Pickaxe モデルを残していた場合は
  // デフォルト (gpt-image-2) にリセットして無効選択を回避する。
  function applyProviderGate() {
    const showPickaxe = !!(window.hasFeature && window.hasFeature('provider.pickaxe'));
    // メインのモデル選択カード
    document.querySelectorAll('.selection-card--internal[data-internal="pickaxe"]').forEach(card => {
      card.style.display = showPickaxe ? '' : 'none';
    });
    // 再生成モーダルのモデルボタン
    document.querySelectorAll('.regen-model-btn--internal[data-internal="pickaxe"]').forEach(btn => {
      btn.style.display = showPickaxe ? '' : 'none';
    });
    // タグ未保有ユーザーが Pickaxe モデルを保持していたらデフォルトに戻す
    if (!showPickaxe
        && typeof getProviderForModel === 'function'
        && getProviderForModel(imageGenState.model) === 'pickaxe') {
      console.log('[applyProviderGate] no pickaxe tag, resetting model to default gpt-image-2');
      imageGenState.model = 'gpt-image-2';
      try { localStorage.setItem('zukai-debug-model', 'gpt-image-2'); } catch (_) {}
      if (typeof activateCard === 'function') activateCard('model', 'gpt-image-2');
    }
    console.log('[applyProviderGate] showPickaxe =', showPickaxe, '/ active model =', imageGenState.model);
  }

  // ページごとに別のLIFFアプリを使い分け
  // ※ LIFFはエンドポイントURLを1つしか登録できないため、ページごとに別のLIFFアプリを作成
  const LIFF_IDS = {
    'pro-max': '2009850086-ynnPKSBX', // 図解ビルダーPRO MAX用（新規）
    'default': '2009850086-K3TrYsDF'  // illustrated-prompt-editor-pro 用（既存）
  };

  // 現在のページURLからLIFF IDを判定
  const LIFF_ID = (function () {
    const path = location.pathname || '';
    if (path.indexOf('pro-max') !== -1) return LIFF_IDS['pro-max'];
    return LIFF_IDS['default'];
  })();

  // LINE公式アカウントのID（友だち追加URLに使用）
  // ※ LINE Official Account Manager で確認できるベーシックID（@xxx）またはプレミアムID
  const LINE_OA_ID = '@922tidzy';

  // ログインゲートを非表示にする (デフォルトで .hidden だが念のため)
  function hideLoginGate() {
    const gate = document.getElementById('lineLoginGate');
    if (gate) gate.classList.add('hidden');
  }

  // プロファイルが「LIFF ログイン済み相当」かどうか
  // (local-dev もテスト目的で認証済み扱い、 anonymous / open-access / fallback は未認証扱い)
  function isProfileAuthenticated(profile) {
    if (!profile) return false;
    return profile.source === 'api' || profile.source === 'local-dev';
  }

  // 現在のプロファイルに応じてヘッダの CTA / ユーザープロフィール表示を切替
  function applyHeaderForProfile() {
    const profile = window.__USER_PROFILE__ || {};
    const authenticated = isProfileAuthenticated(profile);

    const cta = document.getElementById('lineLoginCtaBtn');
    const userProfileEl = document.getElementById('lineUserProfile');
    const badge = document.getElementById('lineUserPlanBadge');

    if (authenticated) {
      if (cta) cta.hidden = true;
      if (userProfileEl) userProfileEl.style.display = 'flex';
      if (badge) {
        const plan = (profile.plan || 'free');
        badge.textContent = plan.toUpperCase();
        badge.className = 'line-user-profile__plan line-user-profile__plan--' + plan;
      }
    } else {
      if (userProfileEl) userProfileEl.style.display = 'none';
      if (cta) cta.hidden = false;
    }
  }

  // CTA クリック時: LIFF が使えれば liff.login()、ダメなら友だち追加 URL にフォールバック
  function triggerLineLogin() {
    if (typeof liff !== 'undefined' && typeof liff.login === 'function') {
      try {
        liff.login();
        return;
      } catch (e) {
        console.warn('[LIFF] liff.login() failed; falling back to friend-add URL', e);
      }
    }
    window.location.href = 'https://line.me/R/ti/p/' + encodeURIComponent(LINE_OA_ID);
  }

  function buildFallbackProfile(source) {
    return {
      lineUserId: null,
      product: PRODUCT_CODE,
      plan: 'free',
      status: 'active',
      planExpiresAt: null,
      tags: [],
      updatedAt: null,
      source: source || 'fallback'
    };
  }

  // /api/me を叩いてプラン情報を取得する (失敗しても非ブロッキング)
  async function fetchUserProfile() {
    try {
      const token = liff.getAccessToken();
      if (!token) {
        console.warn('[api/me] no access token available; skipping');
        window.__USER_PROFILE__ = buildFallbackProfile('fallback');
        return;
      }
      const url = '/api/me?product=' + encodeURIComponent(PRODUCT_CODE);
      const res = await withTimeout(
        fetch(url, { headers: { Authorization: 'Bearer ' + token } }),
        8000,
        '/api/me'
      );
      if (!res.ok) {
        console.warn('[api/me] non-200 response:', res.status);
        window.__USER_PROFILE__ = buildFallbackProfile('fallback');
        return;
      }
      const data = await res.json();
      const ent = data.entitlement || {};
      window.__USER_PROFILE__ = {
        lineUserId: data.lineUserId,
        product: data.product || PRODUCT_CODE,
        plan: ent.plan || 'free',
        status: ent.status || 'active',
        planExpiresAt: ent.planExpiresAt || null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        updatedAt: ent.updatedAt || null,
        source: 'api'
      };
      console.log('[api/me] loaded profile:', { plan: ent.plan, tags: data.tags });
      applyProviderGate();
    } catch (e) {
      console.warn('[api/me] failed:', e && e.message);
      window.__USER_PROFILE__ = buildFallbackProfile('fallback');
    }
  }

  // 前回の画像生成ジョブを Supabase から復元する。
  // ブラウザを閉じても 24時間以内なら別タブ・別デバイスから結果を取り戻せる。
  // localStorage 'zukai-last-job-id' にジョブIDを保持し、再訪時に /api/job を叩く。
  const LAST_JOB_KEY = 'zukai-last-job-id';

  async function restoreLastJob() {
    let lastJobId;
    try { lastJobId = localStorage.getItem(LAST_JOB_KEY); } catch (_) { return; }
    if (!lastJobId) return;

    const token = (typeof liff !== 'undefined' && liff.getAccessToken) ? liff.getAccessToken() : null;
    if (!token) {
      console.log('[restoreLastJob] no access token, skip');
      return;
    }

    let res;
    try {
      res = await fetch('/api/job?id=' + encodeURIComponent(lastJobId), {
        headers: { 'Authorization': 'Bearer ' + token }
      });
    } catch (e) {
      console.warn('[restoreLastJob] fetch failed:', e && e.message);
      return;
    }

    if (res.status === 404 || res.status === 403) {
      // ジョブが既に削除済み or 別ユーザーの ID が残存 → localStorage クリア
      try { localStorage.removeItem(LAST_JOB_KEY); } catch (_) {}
      console.log('[restoreLastJob] job not available (status', res.status + '), cleared localStorage');
      return;
    }
    if (!res.ok) {
      console.warn('[restoreLastJob] non-ok status:', res.status);
      return;
    }

    let data;
    try { data = await res.json(); } catch (_) { return; }
    if (!data || !data.job || !Array.isArray(data.slides)) return;

    // 24時間以上前のジョブは復元しない (Storage 画像も消えている可能性高)
    const createdMs = new Date(data.job.created_at).getTime();
    const ageHours = isFinite(createdMs) ? (Date.now() - createdMs) / 3600000 : 999;
    if (ageHours > 24) {
      try { localStorage.removeItem(LAST_JOB_KEY); } catch (_) {}
      console.log('[restoreLastJob] job too old (', ageHours.toFixed(1), 'h), cleared localStorage');
      return;
    }

    // 成功スライドが1枚もない (= 全失敗の死亡ジョブ) は復元しない
    const successSlides = data.slides.filter(s => s.status === 'success' && s.image_url);
    if (successSlides.length === 0) {
      console.log('[restoreLastJob] no successful slides, skip restore');
      return;
    }

    // imageGenState に展開
    const totalSlides = data.job.total_slides || data.slides.length;
    imageGenState.generatedImages = [];
    for (let i = 0; i < totalSlides; i++) {
      const s = data.slides.find(x => x.slide_idx === i);
      imageGenState.generatedImages.push({
        slideIndex:    i,
        imageUrl:      s && s.status === 'success' ? s.image_url : null,
        stylePrompt:   data.job.style_prompt || '',
        contentPrompt: s ? (s.content || '') : '',
        model:         data.job.model || imageGenState.model,
        status:        s && s.status === 'success' ? 'success'
                     : s && s.status === 'failed'  ? 'error'
                     : 'loading',
        error:         s && s.error ? s.error : null,
        failedModel:   null
      });
    }

    // UI に表示
    if (els.imageGridSection) {
      els.imageGridSection.style.display = '';
      renderImageGrid();
      updateProgressUI(totalSlides);
      // 24h カウントダウン: 復元時は Supabase 上の created_at を起点に
      updateImageGridNotice(createdMs);
    }

    // 経過時間表示
    const minutesAgo = Math.max(1, Math.floor(ageHours * 60));
    const ageStr = minutesAgo < 60
      ? `${minutesAgo}分前`
      : `${Math.floor(minutesAgo / 60)}時間${minutesAgo % 60}分前`;
    showToast(`🔁 ${ageStr}の生成結果を復元しました (${successSlides.length}/${totalSlides}枚)`);
    console.log('[restoreLastJob] restored', {
      jobId: lastJobId,
      ageHoursRounded: Math.round(ageHours * 10) / 10,
      successCount: successSlides.length,
      totalSlides
    });
  }

  // (旧 checkFriendship はブロッキングだったため廃止。
  //  新フロー: アプリは常に即起動し、LIFF ログイン済みなら header に PRO/STANDARD/FREE バッジを出すだけ。
  //  友だち追加自体は CTA リンクから誘導する。)

  // LIFF SDKがロードされるまで待機（最大8秒）
  function waitForLiffSdk(timeoutMs) {
    return new Promise((resolve, reject) => {
      if (typeof liff !== 'undefined') return resolve();
      const startTs = Date.now();
      const intervalId = setInterval(() => {
        if (typeof liff !== 'undefined') {
          clearInterval(intervalId);
          resolve();
        } else if (Date.now() - startTs > timeoutMs) {
          clearInterval(intervalId);
          reject(new Error('LIFF SDKの読み込みに失敗しました'));
        }
      }, 100);
    });
  }

  // Promiseをタイムアウト付きで実行
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}がタイムアウトしました (${ms / 1000}秒)`)), ms))
    ]);
  }

  // LIFF初期化＆認証フロー (バックグラウンド実行・非ブロッキング)
  // - アプリは startApp() 時点で既に表示済み。本関数はあくまで「ログイン済みなら本物のプランに昇格」する役割。
  // - 失敗しても匿名フリーのまま継続。
  async function initLiff() {
    console.log('[LIFF] background init start. path=', location.pathname);
    try {
      await waitForLiffSdk(8000);
      await withTimeout(liff.init({ liffId: LIFF_ID }), 10000, 'LIFF init');

      if (liff.isLoggedIn()) {
        console.log('[LIFF] logged in → fetchUserProfile()');
        await fetchUserProfile();
        applyHeaderForProfile();
        // 前回の画像生成結果が 24時間以内にあれば自動復元する (失敗時は黙って続行)
        restoreLastJob().catch(e => console.warn('[restoreLastJob] swallowed error:', e && e.message));
      } else {
        console.log('[LIFF] not logged in → staying anonymous');
        // 匿名のまま。ヘッダの CTA から手動でログインしてもらう。
      }
    } catch (e) {
      console.warn('[LIFF] background init failed; staying anonymous:', e && e.message);
    }
  }

  // ヘッダおよびログインゲート系のイベントリスナー
  function initLoginEvents() {
    // ヘッダの「友だち追加/ログイン」CTA (匿名ユーザー向け)
    const ctaBtn = document.getElementById('lineLoginCtaBtn');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerLineLogin();
      });
    }

    // (旧 lineLoginBtn / lineRetryFriendBtn / lineErrorRetryBtn は
    //  ログインゲート内に残っているが現在は表示されないため配線は省略)

    // ログアウトボタン
    const logoutBtn = document.getElementById('lineLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        try {
          if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) {
            liff.logout();
          }
        } catch (_) { /* noop */ }
        location.reload();
      });
    }
  }

  // ローカル開発時は LIFF をスキップしてアプリ本体を直接起動
  function isLocalDev() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '0.0.0.0';
  }

  // LINE認証不要の公開ページ (/free) かどうか
  function isOpenAccessRoute() {
    const path = location.pathname || '';
    return path === '/free' || path === '/free/' || path.indexOf('/free') === 0;
  }

  // アプリ起動 (常にアプリ本体を即表示。LIFF はバックグラウンドで初期化)
  // 流れ:
  //   1) URL クエリと経路を解析して "ベースライン" プロファイルを作る
  //      - /free or localhost → 既存挙動 (open-access / local-dev)
  //      - それ以外 → 匿名フリー (source='anonymous')
  //   2) アプリ本体を起動 + ヘッダ反映
  //   3) /free/localhost 以外なら LIFF をバックグラウンド初期化し、
  //      ログイン済みなら本物のプロファイルにアップグレード
  function startApp() {
    initLoginEvents();
    hideLoginGate();

    const qs = new URLSearchParams(location.search);
    const overridePlan = qs.get('plan');
    const overrideTags = (qs.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean);

    if (isLocalDev() || isOpenAccessRoute()) {
      const source = isOpenAccessRoute() ? 'open-access' : 'local-dev';
      const defaultPlan = isOpenAccessRoute() ? 'free' : 'pro';
      window.__USER_PROFILE__ = {
        lineUserId:    isOpenAccessRoute() ? 'Uopen-access' : 'Ulocal-dev',
        product:       PRODUCT_CODE,
        plan:          overridePlan || defaultPlan,
        status:        'active',
        planExpiresAt: null,
        tags:          overrideTags.length ? overrideTags : [source],
        updatedAt:     null,
        source:        source
      };
      init();
      applyHeaderForProfile();
      return;
    }

    // 通常ルート: 匿名フリーで即起動、LIFF はバックグラウンドで初期化
    window.__USER_PROFILE__ = {
      lineUserId:    null,
      product:       PRODUCT_CODE,
      plan:          overridePlan || 'free',
      status:        'active',
      planExpiresAt: null,
      tags:          overrideTags,
      updatedAt:     null,
      source:        'anonymous'
    };
    init();
    applyHeaderForProfile();

    // ログイン済みなら本物のプロファイルに昇格 (失敗しても匿名のまま続行)
    initLiff();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }

})();
