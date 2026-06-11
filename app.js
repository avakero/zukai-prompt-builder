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
  // 内蔵キーはサーバー側 (/api/straico, STRAICO_API_KEY env var) に移動した。
  // ユーザーが独自キー未設定のときは getEffectiveApiKey がこのセンチネルを返し、
  // callStraicoApi がサーバープロキシ経由で呼び出す (キーをブラウザに配信しない)。
  const STRAICO_SERVER_PROXY = '__straico_server_proxy__';
  const STRAICO_PROXY_ENDPOINT = '/api/straico';
  const STRAICO_MODELS = [
    { id: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview（推奨・高速）' },
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite（最速・最安）' },
    { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview（高品質）' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini（JSON出力安定）' },
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 mini（バランス）' },
    { id: 'openai/gpt-5-mini', label: 'GPT-5 mini（新世代）' },
    { id: 'claude-haiku-4-5-5', label: 'Claude Haiku 4.5（軽量Claude）' }
  ];

  // OpenAI 直接（BYOK）。ユーザーが自分のキーを入れると JSON生成・画像生成の両方に使われ、
  // 有料プラン未加入でも AI機能が解放される（キー＝課金の代替）。
  // JSON生成はブラウザから OpenAI を直接呼ぶ。画像生成はサーバー(/api/openai-image)経由で
  // このキーを X-OpenAI-Key ヘッダに載せて使う（保存・ログなし）。
  const OPENAI_CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
  const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';
  const OPENAI_CHAT_MODELS = [
    { id: 'gpt-4o-mini',  label: 'GPT-4o mini（推奨・低コスト・JSON安定）' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini（バランス）' },
    { id: 'gpt-4o',       label: 'GPT-4o（高品質）' },
    { id: 'gpt-5-mini',   label: 'GPT-5 mini（新世代）' }
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
    },
    openai: {
      label: 'OpenAI 直接',
      models: OPENAI_CHAT_MODELS,
      defaultModel: OPENAI_DEFAULT_MODEL,
      keyPlaceholder: 'sk-...',
      helpUrl: 'https://platform.openai.com/api-keys',
      helpLabel: 'OpenAI でAPIキーを取得する',
      desc: 'OpenAI の API キー（sk-...）を入力してください。<b>JSON生成と画像生成の両方</b>にこのキーが使われ、有料プラン未加入でも AI機能が解放されます。<br>キーはお使いのブラウザ内（localStorage）に保存され、画像生成時のみ HTTPS でサーバー経由で OpenAI に送られます（保存・ログなし）。'
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
      label: '手書き風',
      desc: '色鉛筆や水彩のタッチ。温かみのあるパステル調。線画はラフに、塗りはムラを残す。デジタル感を排除する。'
    },
    B: {
      label: 'ビジネス風',
      desc: '直線的で整ったベクター調。信頼感のある寒色系やモノトーン。無駄な装飾を省き、情報の視認性を最優先する。'
    },
    C: {
      label: 'ポップ',
      desc: '太い主線、鮮やかな原色使い。アメコミや元気な印象。'
    },
    D: {
      label: 'ミニマル',
      desc: '線画のみ、または最低限の色数。洗練された印象。'
    }
  };

  function buildStyleDefinitionText() {
    return Object.entries(STYLE_DEFS)
      .map(([key, def]) => `* **${key}：${def.label}** — ${def.desc}`)
      .join('\n');
  }

  // ① ユーザー固有「スタイル署名」定義
  // 同じ画風プリセットを選んでも全ユーザーが完全に同一のプロンプトになり、
  // 出力画像が被ってしまう。それを避けるための「あなたの個性」レイヤー。
  // 選択した画風・配色を壊さない範囲で、色温度・フォルム・あしらいの傾向だけを
  // 上乗せする。ユーザーが選んで state に保存 → 次回以降も同じ個性で一貫する。
  const SIGNATURE_DEFS = {
    none:   { label: '標準',     desc: '個性の上乗せなし', prompt: '' },
    warm:   { label: '温かみ',   desc: '暖色寄り・丸み',   prompt: '全体の色温度をやや暖色寄りにし、角に丸みを持たせて、親しみやすく柔らかい印象に仕上げる。' },
    cool:   { label: 'クール',   desc: '寒色寄り・シャープ', prompt: '全体の色温度をやや寒色寄りにし、直線的でシャープなフォルムを基調に、洗練された静かな印象に仕上げる。' },
    lively: { label: 'にぎやか', desc: '装飾を散らす',       prompt: '小さな星・ドット・吹き出し・手書き矢印などの装飾モチーフをアクセントとして程よく散らし、楽しく賑やかな雰囲気を添える。' },
    calm:   { label: '落ち着き', desc: '余白広め・上品',     prompt: '装飾を控えめにし、余白を広めに取り、要素を絞った静かで上品な構成にする。' },
    bold:   { label: '力強い',   desc: 'コントラスト強',     prompt: 'コントラストを強めにし、主役の要素を大きく太く扱って視線を一点に引きつける、メリハリのある力強い構成にする。' },
    craft:  { label: '手作り感', desc: '囲み・付箋風',       prompt: '手描きの囲み線・付箋・マスキングテープ風のあしらいを少し添え、人の手で作ったような温度感を出す。' }
  };

  function buildSignatureText() {
    const sig = SIGNATURE_DEFS[state.styleSignature];
    return (sig && sig.prompt) ? sig.prompt : '';
  }

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
    'アースカラー': 'アースカラー',
    'スレート＆シアン': 'スレート＆シアン',
    'フォレスト＆クリーム': 'フォレスト＆クリーム',
    'ワイン＆ローズ': 'ワイン＆ローズ',
    'インディゴ＆ミント': 'インディゴ＆ミント',
    'コーラル＆チャコール': 'コーラル＆チャコール',
    '和モダン（藍＆朱）': '和モダン（藍＆朱）',
    'レモン＆ネイビー': 'レモン＆ネイビー',
    'セージ＆テラコッタ': 'セージ＆テラコッタ'
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
    styleSignature: 'none', // ① あなたのスタイル署名（個性）。SIGNATURE_DEFS のキー
    theme: 'light',
    mode: 'single', // 'single' | 'carousel'
    carouselPageNumbers: true,
    // カルーセル(AI構成)入力。単体の text と同様にリロード後も復元する。
    aiTheme: '',
    aiSlideCount: '5',
    aiTone: 'friendly'
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
  let pasteQueueDrag = null;

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
    pasteQueueHeader: $('#pasteQueueHeader'),
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
    carouselPageNumberToggle: $('#carouselPageNumberToggle'),
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
    aiGenExamples: $$('.ai-gen-example'),
    aiProvider: $('#aiProvider'),
    aiSlideCount: $('#aiSlideCount'),
    aiTone: $('#aiTone'),
    aiGenerateBtn: $('#aiGenerateBtn'),
    aiGenerateBtnLabel: $('#aiGenerateBtnLabel'),
    aiSettingsBtn: $('#aiSettingsBtn'),
    aiGenBadge: $('#aiGenBadge'),
    carouselFlowGenerated: $('#carouselFlowGenerated'),
    carouselFlowExpanded: $('#carouselFlowExpanded'),
    carouselJsonStatus: $('#carouselJsonStatus'),
    carouselJsonStatusTitle: $('#carouselJsonStatusTitle'),
    carouselJsonEditor: $('#carouselJsonEditor'),
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
  // テーマ（ライト＝ネイビー / ダーク の2モード）
  // ============================================================

  const THEMES = ['light', 'dark'];

  // ============================================================
  // プラン → 機能マッピング (Phase 2)
  // ============================================================

  const PRODUCT_CODE = 'zukai-builder';
  window.__PRODUCT_CODE__ = PRODUCT_CODE;

  // 上位プランは下位プランの機能を全て継承する
  // ai.json / ai.imagegen は API コストが運営負担になるため pro 以上に限定。
  // standard ユーザーは BYOK (自分の OpenAI キーを設定) すれば両方使えるようになる。
  const PLAN_FEATURES = {
    free: ['core.single'],
    standard: ['core.single', 'mode.carousel'],
    pro: ['core.single', 'mode.carousel', 'ai.json', 'ai.imagegen'],
    lifetime: ['core.single', 'mode.carousel', 'ai.json', 'ai.imagegen']
  };

  // タグによる個別解放 (プランより強い、上書き専用)
  // 'provider.pickaxe': Pickaxe (個人サブスク利用) を選べるかどうか。7月末のサブスク
  //   終了とともに使わなくなる予定。タグ持ちユーザー (=オーナー本人) のみ表示。
  const TAG_FEATURE_GRANTS = {
    beta: ['ai.json', 'ai.imagegen'],
    internal: ['ai.json', 'ai.imagegen', 'mode.carousel'],
    vip: ['ai.json', 'ai.imagegen', 'mode.carousel'],
    pickaxe_internal: ['provider.pickaxe', 'provider.straico']
  };

  // feature key → ユーザー向けに案内する必要プラン
  const FEATURE_REQUIRED_PLAN = {
    'mode.carousel': 'STANDARD',
    'ai.json': 'PRO',
    'ai.imagegen': 'PRO'
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

    saveState();
  }

  function setTheme(theme) {
    if (!THEMES.includes(theme)) return;
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
      els.styleBadge.textContent = `${state.style}: ${styleDef.label}`;
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

    // ① スタイル署名（あなたの個性）。画風・配色を最優先しつつ個性を上乗せ。
    const signaturePrompt = buildSignatureText();
    const signatureBlock = signaturePrompt
      ? `\n\n### あなたのスタイル署名（個性）\n※選択した画風・配色を最優先し、それを損なわない範囲で次の個性を加えてください。\n${signaturePrompt}`
      : '';

    // === 統一プロンプト（命令書 + 依頼内容を一体化） ===
    const prompt = `# 命令書：万能・図解デザイナーAI
あなたは、ユーザーの意図を汲み取り、最適なビジュアルを設計するプロの図解デザイナーです。

## ■基本方針
* ユーザー専属デザイナーとして、丁寧かつ親しみやすく振る舞う。
* ユーザーの指定した「スタイル」に合わせて画風を完全に切り替える。
* 不明点があれば確認の質問をする。

## ■スタイル定義
${buildStyleDefinitionText()}

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
* 既存のアニメ・漫画・ゲーム・映画・企業マスコットなど、著作権や商標で保護されたキャラクターの描写
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

### 配色: ${colorInstruction}${signatureBlock}${imageNote}`;

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
    }, 5000);
  }

  // 機能ゲート: hasFeature が true なら true を返し処理続行可、false ならトースト表示して false
  // 同一キーの連打は 1.5 秒スロットルでトースト 1 回に抑制
  // 未ログイン (匿名 / open-access / fallback) と ログイン済み低プランで文言を分ける
  const _lastGateToast = {};
  function gateOrToast(featureKey, displayName) {
    if (window.hasFeature(featureKey)) return true;
    // BYOK: OpenAI または Gemini キーを設定済みなら AI機能（JSON生成・画像生成）をプラン不問で解放する
    if ((featureKey === 'ai.json' || featureKey === 'ai.imagegen') && hasOwnAiKey()) return true;
    const now = Date.now();
    if (now - (_lastGateToast[featureKey] || 0) < 1500) return false;
    _lastGateToast[featureKey] = now;
    const profile = window.__USER_PROFILE__ || {};
    if (typeof isProfileAuthenticated === 'function' && !isProfileAuthenticated(profile)) {
      showToast(`🔒 ${displayName}は LINE公式の友だち追加 + ログインで利用できます`);
    } else if (featureKey === 'ai.json' || featureKey === 'ai.imagegen') {
      // AI機能はBYOK (APIキー設定) で解放できるため、プラン名ではなくBYOK導線を案内する
      showToast(`🔒 ${displayName}は APIキー設定 (歯車アイコン) で利用できます`);
    } else {
      const plan = FEATURE_REQUIRED_PLAN[featureKey] || 'STANDARD';
      if (plan === 'STANDARD') {
        // STANDARD は LINEログイン済みなら自動付与される建付けなので、
        // ここに来るのは entitlement.status が非アクティブになった
        // (サブスク失効など) エッジケースに限られる。
        // STANDARD という名称はユーザーに公開していないので露出させない。
        showToast(`🔒 ${displayName}は現在ご利用いただけません。再ログインをお試しください`);
      } else {
        showToast(`🔒 ${displayName}は ${plan} プラン以上で利用できます`);
      }
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
      styleSignature: state.styleSignature || 'none', // 署名は個人設定なのでリセットしない
      theme: state.theme, // テーマはリセットしない
      mode: 'single',
      carouselPageNumbers: true,
      aiTheme: '',
      aiSlideCount: '5',
      aiTone: 'friendly'
    };

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
      els.carouselBadge.textContent = '未作成';
      els.carouselBadge.classList.remove('section__badge--active', 'section__badge--success');
    }
    setCarouselJsonGuide('empty');
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
    if (els.carouselPageNumberToggle) els.carouselPageNumberToggle.checked = true;

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
        <img src="${img.dataUrl}" alt="${escapeHtml(String(img.name || ''))}">
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

    const token = _getLiffToken();
    if (!token && !isTemporaryProMaxRoute()) throw new Error('LINE認証トークンが取得できません');

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
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        ...temporaryProMaxHeaders()
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
        <span>${escapeHtml(String(item.label || ''))}</span>
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
      els.pasteQueueHint.textContent = '画像生成AIに貼り付けて図解を生成してください';
    } else {
      const currentItem = pasteQueue[pasteQueueIndex];
      const typeIcon = currentItem.type === 'image'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      els.pasteQueueCta.className = 'paste-queue__cta';
      els.pasteQueueCta.innerHTML = `
        ${typeIcon}
        コピー: ${escapeHtml(String(currentItem.label || ''))}
      `;
      if (pasteQueueIndex === 0) {
        els.pasteQueueHint.textContent = '💡 ボタンを押して画像生成AIにCtrl+Vで貼り付けてください';
      } else {
        els.pasteQueueHint.textContent = '💡 画像生成AIに貼り付けたら次をコピーしてください';
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

  function clampPasteQueuePosition(left, top) {
    const queue = els.pasteQueue;
    if (!queue) return { left, top };

    const rect = queue.getBoundingClientRect();
    const margin = 8;
    return {
      left: Math.min(Math.max(margin, left), window.innerWidth - rect.width - margin),
      top: Math.min(Math.max(margin, top), window.innerHeight - rect.height - margin)
    };
  }

  function movePasteQueue(left, top) {
    const queue = els.pasteQueue;
    if (!queue) return;

    const pos = clampPasteQueuePosition(left, top);
    queue.style.left = `${pos.left}px`;
    queue.style.top = `${pos.top}px`;
  }

  function startPasteQueueDrag(e) {
    if (!els.pasteQueue || e.button !== 0 || e.target.closest('button')) return;

    const rect = els.pasteQueue.getBoundingClientRect();
    pasteQueueDrag = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    };

    els.pasteQueue.classList.add('is-positioned', 'is-dragging');
    els.pasteQueue.setPointerCapture(e.pointerId);
    movePasteQueue(rect.left, rect.top);
    e.preventDefault();
  }

  function dragPasteQueue(e) {
    if (!pasteQueueDrag || !els.pasteQueue || e.pointerId !== pasteQueueDrag.pointerId) return;
    movePasteQueue(e.clientX - pasteQueueDrag.offsetX, e.clientY - pasteQueueDrag.offsetY);
  }

  function endPasteQueueDrag(e) {
    if (!pasteQueueDrag || !els.pasteQueue || e.pointerId !== pasteQueueDrag.pointerId) return;

    els.pasteQueue.classList.remove('is-dragging');
    if (els.pasteQueue.hasPointerCapture(e.pointerId)) {
      els.pasteQueue.releasePointerCapture(e.pointerId);
    }
    pasteQueueDrag = null;
  }

  function keepPasteQueueInView() {
    if (!els.pasteQueue || !els.pasteQueue.classList.contains('is-positioned')) return;
    const rect = els.pasteQueue.getBoundingClientRect();
    movePasteQueue(rect.left, rect.top);
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

    // カルーセル(AI構成)入力の復元
    if (els.aiThemeInput && state.aiTheme) {
      els.aiThemeInput.value = state.aiTheme;
    }
    if (els.aiSlideCount && state.aiSlideCount) {
      els.aiSlideCount.value = state.aiSlideCount;
    }
    if (els.aiTone && state.aiTone) {
      els.aiTone.value = state.aiTone;
    }

    // 選択カード
    activateCard('style', state.style);
    activateCard('layout', state.layout);
    activateCard('format', state.format);
    activateCard('signature', state.styleSignature || 'none');

    // 配色
    clearColorSelections();
    if (state.colorMode === 'auto') {
      els.colorAutoBtn.classList.add('active');
    } else if (state.colorMode === 'preset') {
      const swatch = $(`.color-swatch[data-color="${state.colorValue}"]`);
      if (swatch) {
        swatch.classList.add('active');
        swatch.setAttribute('aria-checked', 'true');
      } else {
        state.colorMode = 'auto';
        state.colorValue = '';
        els.colorAutoBtn.classList.add('active');
      }
    } else if (state.colorMode === 'custom') {
      els.customColorPicker.classList.add('active');
      els.customColorPicker.value = state.customColor;
    }

    // バッジ更新
    updateBadges();
    updateCharCount();

    if (els.carouselPageNumberToggle) {
      els.carouselPageNumberToggle.checked = state.carouselPageNumbers !== false;
    }

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

    // カルーセル(AI構成)入力も単体と同様に保存／復元する
    if (els.aiThemeInput) {
      els.aiThemeInput.addEventListener('input', () => {
        state.aiTheme = els.aiThemeInput.value;
      });
      els.aiThemeInput.addEventListener('blur', () => {
        state.aiTheme = els.aiThemeInput.value;
        saveState();
      });
    }
    if (els.aiSlideCount) {
      els.aiSlideCount.addEventListener('change', () => {
        state.aiSlideCount = els.aiSlideCount.value;
        saveState();
      });
    }
    if (els.aiTone) {
      els.aiTone.addEventListener('change', () => {
        state.aiTone = els.aiTone.value;
        saveState();
      });
    }

    // 選択カードクリック
    $$('.selection-card').forEach(card => {
      card.addEventListener('click', () => {
        const group = card.dataset.group;
        const value = card.dataset.value;

        if (group === 'style') state.style = value;
        else if (group === 'layout') state.layout = value;
        else if (group === 'format') state.format = value;
        else if (group === 'signature') state.styleSignature = value;
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

    if (els.pasteQueueHeader) {
      els.pasteQueueHeader.addEventListener('pointerdown', startPasteQueueDrag);
      els.pasteQueue.addEventListener('pointermove', dragPasteQueue);
      els.pasteQueue.addEventListener('pointerup', endPasteQueueDrag);
      els.pasteQueue.addEventListener('pointercancel', endPasteQueueDrag);
      window.addEventListener('resize', keepPasteQueueInView);
    }

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
    if (els.carouselPageNumberToggle) {
      els.carouselPageNumberToggle.addEventListener('change', () => {
        state.carouselPageNumbers = els.carouselPageNumberToggle.checked;
        saveState();
      });
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
        if (hasValue) {
          els.carouselBadge.textContent = '入力中';
          els.carouselBadge.classList.remove('section__badge--success');
          els.carouselBadge.classList.add('section__badge--active');
          setCarouselJsonGuide('editing');
        } else {
          els.carouselBadge.textContent = '未作成';
          els.carouselBadge.classList.remove('section__badge--active', 'section__badge--success');
          setCarouselJsonGuide('empty');
        }
      });
    }

    // ===== AI生成（Gemini） =====
    if (els.aiGenExamples && els.aiGenExamples.forEach) {
      els.aiGenExamples.forEach(btn => {
        btn.addEventListener('click', () => {
          if (!els.aiThemeInput) return;
          els.aiThemeInput.value = btn.dataset.example || btn.textContent.trim();
          els.aiThemeInput.focus();
        });
      });
    }
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
    // ChatGPT貼り付けプロンプト用の旧スタイル/レイアウトセクションは隠す
    // （混乱を避けるため）。フォーマットは両方の生成で共通利用するので残す。
    // 配色 (sectionColor) は getCurrentStylePrompt() 経由で画像生成にも反映される
    // ため、署名と同様に両モードで表示する（全スライドの色調統一に使う）。
    // キャラクター画像 (sectionImages) はカルーセルモードでも参考画像として
    // Pickaxe API に渡せるようになったため、両モードで表示する。
    const carouselOnlyHidden = ['sectionStyle', 'sectionLayout'];
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

  function buildCarouselTemplateForCopy() {
    const theme = els.aiThemeInput && els.aiThemeInput.value.trim()
      ? els.aiThemeInput.value.trim()
      : '【ここにテーマを記入】';
    const slideCount = els.aiSlideCount ? els.aiSlideCount.value : 'auto';
    const slideCountLabel = slideCount === 'auto' ? 'おまかせ' : `${slideCount}枚`;
    const toneSelect = els.aiTone;
    const toneLabel = toneSelect && toneSelect.selectedOptions && toneSelect.selectedOptions[0]
      ? toneSelect.selectedOptions[0].textContent.trim()
      : '親しみやすい';

    // 1枚指定は単体図解として専用テンプレートを返す
    if (String(slideCount) === '1') {
      return `以下のJSON形式で、1枚で完結する「単体図解」のデータを生成してください。
そのままコピーして使えるよう、余計な説明は不要で、JSONだけを出力してください。

## 作成条件
- これは複数枚のカルーセルではなく「1枚で完結する単体図解」です。表紙(cover)や締め(cta)は作らず、本文(body)スライドを1枚だけ作成してください
- slides 配列の要素は必ず1つだけにしてください
- 1枚の中に「短い見出し」と「要点（図解として伝わる情報）」を両方収め、それ単体で意味が通るよう完結させてください
- トーン: ${toneLabel}

## JSON仕様
\`\`\`json
{
  "title": "図解のタイトル",
  "style": "A",
  "format": "1:1",
  "color": "auto",
  "slides": [
    {
      "page": 1,
      "role": "body",
      "layout": "A",
      "content": "見出し＋図解本文"
    }
  ]
}
\`\`\`

## フィールド説明
- **style**: A(手書き風), B(ビジネス風), C(ポップ), D(ミニマル)
- **format**: "1:1"(正方形), "3:4"(縦長), "16:9"(横長)
- **color**: "auto" or プリセット名(例:"パステルピンク＆水色") or 色コード(例:"#3b82f6")
- **slides[].layout**: A(並列リスト), B(比較図), C(ステップ), D(4象限), E(サイクル), F(ピラミッド), G(お任せ)

## 依頼内容
以下のテーマで1枚完結の図解を作成してください：

${theme}`;
    }

    return `以下のJSON形式で、カルーセル投稿用のデータを生成してください。
そのままコピーして使えるよう、余計な説明は不要で、JSONだけを出力してください。

## 作成条件
- スライド枚数: ${slideCountLabel}
- トーン: ${toneLabel}

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

${theme}`;
  }

  async function copyCarouselTemplate() {
    const template = buildCarouselTemplateForCopy();
    try {
      await navigator.clipboard.writeText(template);
      showToast('📋 手動作成用テンプレートをコピーしました。他のAIに貼り付けてください');
    } catch (err) {
      const textarea = document.createElement('textarea');
      textarea.value = template;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('📋 手動作成用テンプレートをコピーしました。他のAIに貼り付けてください');
    }
  }

  // ============================================================
  // AI（マルチプロバイダ）: 設定管理
  // ============================================================

  function defaultAiConfig() {
    return {
      provider: 'gemini',
      straico: { apiKey: '', model: STRAICO_DEFAULT_MODEL },
      gemini: { apiKey: '', model: GEMINI_DEFAULT_MODEL },
      openai: { apiKey: '', model: OPENAI_DEFAULT_MODEL }
    };
  }

  function loadAiConfig() {
    const cfg = defaultAiConfig();
    try {
      const saved = localStorage.getItem(AI_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.provider === 'gemini' || parsed.provider === 'straico' || parsed.provider === 'openai') {
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
        if (parsed.openai) {
          cfg.openai.apiKey = parsed.openai.apiKey || '';
          cfg.openai.model = parsed.openai.model || OPENAI_DEFAULT_MODEL;
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
      return cfg.straico.apiKey || STRAICO_SERVER_PROXY;
    }
    if (provider === 'openai') {
      return cfg.openai.apiKey;
    }
    return cfg.gemini.apiKey;
  }

  // ユーザーが自分のキーを設定しているか（内蔵デフォルトは除く＝BYOK判定用）
  // OpenAI または Gemini キーがあれば画像生成BYOK＋AI機能のプラン解除が有効になる。
  function hasOwnOpenAiKey() {
    try {
      const cfg = loadAiConfig();
      return !!(cfg.openai && cfg.openai.apiKey && cfg.openai.apiKey.trim());
    } catch (_) { return false; }
  }

  function hasOwnGeminiKey() {
    try {
      const cfg = loadAiConfig();
      return !!(cfg.gemini && cfg.gemini.apiKey && cfg.gemini.apiKey.trim());
    } catch (_) { return false; }
  }

  // AI機能 (JSON生成・画像生成) を BYOK で解放できるか。
  // OpenAI / Gemini いずれかのキーを自分で設定していれば true。
  function hasOwnAiKey() {
    return hasOwnOpenAiKey() || hasOwnGeminiKey();
  }

  function setCarouselJsonGuide(stateName, meta = {}) {
    const status = els.carouselJsonStatus;
    if (!status || !els.carouselJsonStatusTitle) return;

    status.classList.toggle('carousel-json-status--ready', stateName === 'ready' || stateName === 'expanded');

    if (els.carouselFlowGenerated) {
      els.carouselFlowGenerated.classList.toggle('carousel-flow__step--done', stateName === 'ready' || stateName === 'expanded');
      els.carouselFlowGenerated.classList.toggle('carousel-flow__step--active', stateName === 'editing');
    }
    if (els.carouselFlowExpanded) {
      els.carouselFlowExpanded.classList.toggle('carousel-flow__step--done', stateName === 'expanded');
      els.carouselFlowExpanded.classList.toggle('carousel-flow__step--active', stateName === 'ready');
    }

    if (stateName === 'expanded') {
      const slides = meta.slides || 0;
      els.carouselJsonStatusTitle.textContent = `${slides}枚のスライドに展開しました`;
      return;
    }

    if (stateName === 'ready') {
      const slides = meta.slides || 0;
      els.carouselJsonStatusTitle.textContent = `${slides}枚の構成ができました`;
      return;
    }

    if (stateName === 'editing') {
      els.carouselJsonStatusTitle.textContent = '構成データを入力中です';
      return;
    }

    els.carouselJsonStatusTitle.textContent = 'まだ構成がありません';
  }

  function canUseStraicoProvider() {
    return !!(window.hasFeature && window.hasFeature('provider.straico'));
  }

  function getFallbackAiProvider() {
    return 'gemini';
  }

  function normalizeAiProvider(provider) {
    if (provider === 'straico' && !canUseStraicoProvider()) {
      return getFallbackAiProvider();
    }
    return (provider === 'straico' || provider === 'gemini' || provider === 'openai')
      ? provider
      : getFallbackAiProvider();
  }

  // ============================================================
  // APIキー設定モーダル
  // ============================================================

  let apiKeyModalActiveProvider = 'gemini'; // モーダル内で現在編集中のプロバイダ

  function openApiKeyModal() {
    const cfg = loadAiConfig();
    apiKeyModalActiveProvider = normalizeAiProvider(cfg.provider);
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
    const cur = (provider === 'straico') ? cfg.straico
              : (provider === 'openai') ? cfg.openai
              : cfg.gemini;

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
    const hasBuiltin = provider === 'straico'; // 内蔵キーはサーバープロキシで常時利用可
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
    if (provider !== 'straico' && provider !== 'gemini' && provider !== 'openai') return;
    if (provider === 'straico' && !canUseStraicoProvider()) return;
    apiKeyModalActiveProvider = provider;
    renderApiKeyModalForProvider(provider, loadAiConfig());
  }

  function saveApiKeyFromModal() {
    if (apiKeyModalActiveProvider === 'straico' && !canUseStraicoProvider()) return;

    const apiKey = els.apiKeyInput.value.trim();
    const model = els.apiModelSelect.value || PROVIDER_META[apiKeyModalActiveProvider].defaultModel;

    // Straicoは内蔵キーがあればAPIキー空でも保存可
    const hasBuiltin = apiKeyModalActiveProvider === 'straico'; // 内蔵キーはサーバープロキシで常時利用可
    if (!apiKey && !hasBuiltin) {
      showToast('⚠️ APIキーを入力してください');
      els.apiKeyInput.focus();
      return;
    }

    const cfg = loadAiConfig();
    if (apiKeyModalActiveProvider === 'straico') {
      cfg.straico = { apiKey, model };
    } else if (apiKeyModalActiveProvider === 'openai') {
      cfg.openai = { apiKey, model };
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
    } else if (provider === 'openai') {
      cfg.openai = { apiKey: '', model: OPENAI_DEFAULT_MODEL };
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
    const provider = normalizeAiProvider(cfg.provider);
    const apiKey = getEffectiveApiKey(provider, cfg);
    const meta = PROVIDER_META[provider];
    if (!apiKey) {
      els.aiGenBadge.textContent = `${meta.label} (キー未設定)`;
      return;
    }
    const model = provider === 'straico' ? cfg.straico.model
                : provider === 'openai' ? cfg.openai.model
                : cfg.gemini.model;
    const shortModel = model.replace(/^google\//, '').replace(/^openai\//, '').replace(/^anthropic\//, '').replace(/^gemini-/, '');
    els.aiGenBadge.textContent = `${meta.label} • ${shortModel}`;
  }

  /**
   * メイン画面のプロバイダ選択変更時
   */
  function onAiProviderChange() {
    const newProvider = normalizeAiProvider(els.aiProvider.value);
    const cfg = loadAiConfig();
    cfg.provider = newProvider;
    saveAiConfig(cfg);
    els.aiProvider.value = newProvider;
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
    // 1枚指定は「カルーセル」ではなく単体図解として専用プロンプトに切り替える
    if (String(slideCount) === '1') {
      return buildSingleFigurePrompt(theme, tone);
    }
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

  // 1枚指定時の専用プロンプト：複数枚カルーセルではなく、1枚で完結する単体図解を作る
  function buildSingleFigurePrompt(theme, tone) {
    const toneDesc = TONE_DESC[tone] || TONE_DESC.friendly;

    return `あなたはInstagram向けの「1枚完結の図解」制作専門家です。以下のテーマや元文章から、1枚で内容が完結する図解スライド用のJSONを生成してください。

# 出力ルール
- 必ず指定のJSON形式のみを出力し、説明文やマークダウンのコードブロック記号(\`\`\`)は一切付けないでください
- これは複数枚のカルーセルではなく「1枚で完結する単体図解」です。表紙(cover)や締め(cta)のスライドは作らず、本文(body)スライドを1枚だけ作成してください
- slides 配列の要素は必ず1つだけにしてください
- その1枚の中に「短い見出し」と「要点（図解として伝わる情報）」を両方収め、それ単体で意味が通るよう完結させてください
- content は画像内に表示するテキストとして読みやすい量に整え、冒頭に見出しを置き、続けて図解の中身（箇条書き・対比・手順など）を書いてください
- 情報を詰め込みすぎず、1枚で一目で理解できる密度にしてください
- レイアウト(layout)はテーマの構造に最も合うものを選んでください：A(並列リスト), B(比較図), C(ステップ), D(4象限), E(サイクル), F(ピラミッド)。迷う場合は G(お任せ)
- 投稿キャプション(caption)はInstagramの本文として使用します。冒頭1〜2行で引きを作り、図解の内容を補足・深掘りする本文を続け、最後に読後感を残してください（保存やフォローを直接促す表現は禁止）。改行は \\n を使い、絵文字も自然に活用して構いません。200〜500文字を目安にしてください。
- ハッシュタグ(hashtags)はテーマと関連性の高いものを10〜15個、日本語・英語を織り交ぜて配列で返してください。"#" を必ず含め、半角スペースや句読点は含めないでください。

# トーン
${toneDesc}

# JSON仕様
{
  "title": "図解を一言で表す短い見出し（30文字以内目安）",
  "caption": "Instagram投稿のキャプション本文（改行は \\n、複数段落OK）",
  "hashtags": ["#タグ1", "#タグ2", "..."],
  "style": "A" | "B" | "C" | "D",
  "format": "1:1" | "3:4" | "16:9",
  "color": "auto" or プリセット名,
  "slides": [
    { "page": 1, "role": "body", "layout": "A"|"B"|"C"|"D"|"E"|"F"|"G", "content": "見出し＋図解本文" }
  ]
}

# フィールド説明
- title: 図解を一言で表す短い見出し（30文字以内目安）
- caption: Instagramの投稿本文。フック → 本編 → 締めの3部構成。図解本文と同じことを繰り返さず、補足や具体例・体験談を交えて深掘りする
- hashtags: 投稿で使うハッシュタグの配列。10〜15個、重複なし、"#" 必須
- style: A(手書き風), B(ビジネス風), C(ポップ), D(ミニマル) — テーマに最適なものを選択
- format: "1:1"(正方形), "3:4"(縦長), "16:9"(横長) — 通常はInstagram向けに"1:1"推奨
- color: "auto"(おまかせ) 推奨
- slides[].layout: A(並列リスト), B(比較図), C(ステップ), D(4象限), E(サイクル), F(ピラミッド), G(お任せ) — 図解の内容に最適なものを選択

# テーマ／元文章
${theme}

---
上記を踏まえ、1枚完結の図解JSONのみを出力してください。`;
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
    // 独自キー未設定 (センチネル) のときはサーバープロキシ経由。
    // プロキシは LINE 認証 (または /pro-max の一時アクセスヘッダ) を要求する。
    const useProxy = !apiKey || apiKey === STRAICO_SERVER_PROXY;
    const token = useProxy ? _getLiffToken() : null;
    // プロキシ経由には LINE 認証 (または /pro-max 一時アクセス) が必要。
    // 未ログインのまま投げると無意味な 401 になるため、先に分かりやすく案内する。
    if (useProxy && !token && !isTemporaryProMaxRoute()) {
      throw new Error('内蔵Straicoキーの利用にはLINEログインが必要です。LINEでログインするか、APIキー設定からご自身のStraicoキーを登録してください');
    }
    const res = await fetch(useProxy ? STRAICO_PROXY_ENDPOINT : STRAICO_ENDPOINT, {
      method: 'POST',
      headers: useProxy
        ? {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
            ...temporaryProMaxHeaders()
          }
        : {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
      body: JSON.stringify(useProxy
        ? { model, prompt }
        : { models: [model], message: prompt })
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

  // OpenAI Chat Completions: カルーセルJSON生成（ブラウザから直接呼び出し / BYOK）
  // response_format json_object で JSON 出力を強制。temperature は gpt-5 系の
  // reasoning モデルが既定値以外を拒否するケースがあるため送らない。
  async function callOpenAiChatApi(apiKey, model, prompt) {
    const res = await fetch(OPENAI_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error && errJson.error.message) errMsg = errJson.error.message;
      } catch (e) { }
      throw new Error(errMsg);
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) {
      throw new Error('APIから空のレスポンスが返されました');
    }
    return text;
  }

  async function generateCarouselJsonWithAi() {
    if (!gateOrToast('ai.json', 'AIで投稿構成を作成')) return;
    const theme = els.aiThemeInput.value.trim();
    if (!theme) {
      showToast('⚠️ テーマや元文章を入力してください');
      els.aiThemeInput.focus();
      return;
    }

    const cfg = loadAiConfig();
    const provider = normalizeAiProvider(cfg.provider);
    if (cfg.provider !== provider) {
      cfg.provider = provider;
      saveAiConfig(cfg);
      if (els.aiProvider) els.aiProvider.value = provider;
    }
    const apiKey = getEffectiveApiKey(provider, cfg);
    if (!apiKey) {
      showToast('🔑 まずAPIキーを設定してください');
      openApiKeyModal();
      return;
    }

    const model = provider === 'straico' ? cfg.straico.model
                : provider === 'openai' ? cfg.openai.model
                : cfg.gemini.model;
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
      } else if (provider === 'openai') {
        text = await callOpenAiChatApi(apiKey, model, prompt);
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
      els.carouselBadge.textContent = `${extracted.parsed.slides.length}枚`;
      els.carouselBadge.classList.remove('section__badge--active');
      els.carouselBadge.classList.add('section__badge--success');
      setCarouselJsonGuide('ready', { slides: extracted.parsed.slides.length });

      const hasCaption = typeof extracted.parsed.caption === 'string' && extracted.parsed.caption.trim();
      const tagCount = Array.isArray(extracted.parsed.hashtags) ? extracted.parsed.hashtags.length : 0;
      const extras = [];
      if (hasCaption) extras.push('キャプション');
      if (tagCount) extras.push(`#タグ${tagCount}`);
      const extraLabel = extras.length ? ` + ${extras.join(' / ')}` : '';
      showToast(`✨ 投稿構成を作成しました（${extracted.parsed.slides.length}枚${extraLabel}）`);

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
    setCarouselJsonGuide('expanded', { slides: data.slides.length });

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
        const swatch = $(`.color-swatch[data-color="${data.color}"]`);
        if (swatch) {
          state.colorMode = 'preset';
          state.colorValue = data.color;
          swatch.classList.add('active');
          swatch.setAttribute('aria-checked', 'true');
        } else {
          state.colorMode = 'auto';
          state.colorValue = '';
          els.colorAutoBtn.classList.add('active');
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
    // role/page/layout は AI 生成 JSON・貼り付け JSON 由来なのでエスケープ必須。
    // CSS クラス名に使う role は英数とハイフンのみ許可する。
    const roleClass = String(role).replace(/[^a-zA-Z0-9_-]/g, '') || 'body';

    const card = document.createElement('div');
    card.className = 'carousel-slide-card';
    card.style.animationDelay = `${i * 0.05}s`;
    if (slide._edited) card.classList.add('carousel-slide-card--edited');

    card.innerHTML = `
      <div class="carousel-slide-card__page">${escapeHtml(String(slide.page || i + 1))}</div>
      <div class="carousel-slide-card__body">
        <div class="carousel-slide-card__meta">
          <span class="carousel-slide-card__role carousel-slide-card__role--${roleClass}">${escapeHtml(String(roleLabel))}</span>
          ${layoutDef ? `<span class="carousel-slide-card__layout-badge">${escapeHtml(String(layout))}: ${escapeHtml(String(layoutDef.label))}</span>` : ''}
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
    // 属性値コンテキスト (alt="..." 等) でも安全なように引用符もエスケープする。
    // (旧実装の div.textContent → innerHTML トリックは " と ' を素通しするため不採用)
    return String(text == null ? '' : text).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  function getCarouselPromptStyle() {
    const presetId = imageGenState.selectedPreset || 'handdrawn';
    const preset = IMAGE_GEN_STYLE_PRESETS[presetId] || IMAGE_GEN_STYLE_PRESETS.handdrawn;
    const customPrompt = els.imageGenCustomStyle ? els.imageGenCustomStyle.value.trim() : '';
    return {
      id: presetId,
      label: preset.label,
      desc: presetId === 'custom'
        ? (customPrompt || 'ユーザーが入力したカスタムスタイル指示に従う。')
        : preset.prompt
    };
  }

  // ============================================================
  // カルーセル：スライドプロンプト構築
  // ============================================================

  function buildSlidePrompt(slide, index) {
    if (!carouselData) return '';

    // カルーセルでは「画像生成スタイル」プリセットをスタイル指定として使う。
    const carouselStyle = getCarouselPromptStyle();
    const globalStyle = carouselStyle.id;
    const globalFormat = state.format;
    const totalSlides = carouselData.slides.length;

    const styleDef = {
      label: carouselStyle.label,
      desc: carouselStyle.desc
    };
    const role = slide.role || 'body';
    const roleLabel = ROLE_LABELS[role] || role;
    const layout = slide.layout || (role === 'body' ? state.layout : 'G');
    const layoutDef = LAYOUT_DEFS[layout] || LAYOUT_DEFS['G'];
    const content = slide.content || '';
    const page = slide.page || index + 1;
    const pageNumberInstruction = state.carouselPageNumbers === false
      ? '* ページ番号や「1/5」のような枚数表記は入れないでください'
      : `* ページ番号「${page}/${totalSlides}」を右下に小さく入れてください`;

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
添付したキャラクター画像を主役または案内役として図解内に必ず配置してください。
* キャラクターの外見（輪郭・顔・目・口・色・服装・体型・特徴的な小物）は変更せず、参照画像と同一キャラクターとして認識できるように描くこと。
* 新しい別キャラクターに置き換えないこと。人間化・リアル化・別マスコット化・抽象アイコン化もしないこと。
* 図解の内容とマッチしたポーズや表情は付けてよいが、デザイン上の特徴は維持すること。
* キャラクターは小さな飾りではなく、画面内で視認できるサイズ（画像幅の15〜30%程度）で配置すること。
* 添付画像${characterImages.length}枚`;
    }

    return `# 命令書：万能・図解デザイナーAI
あなたは、ユーザーの意図を汲み取り、最適なビジュアルを設計するプロの図解デザイナーです。

## ■基本方針
* ユーザー専属デザイナーとして、丁寧かつ親しみやすく振る舞う。
* ユーザーの指定した「スタイル」に合わせて画風を完全に切り替える。
* 不明点があれば確認の質問をする。

## ■指定スタイル
* **${globalStyle}：${styleDef.label}** — ${styleDef.desc}

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
* 既存のアニメ・漫画・ゲーム・映画・企業マスコットなど、著作権や商標で保護されたキャラクターの描写
* 意味のない英語の羅列
* 実在ブランドのロゴ描写

## ■カルーセル投稿の注意事項
* これはカルーセル投稿の **${page}枚目 / 全${totalSlides}枚** です
* 全スライドで統一感のあるデザインにしてください
${pageNumberInstruction}
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

  function buildImageSlideContent(slide, index, totalSlides) {
    const page = slide.page || index + 1;
    const baseContent = slide.content || '';
    const pageNumberInstruction = state.carouselPageNumbers === false
      ? 'ページ番号や「1/5」のような枚数表記は入れない。'
      : `右下にページ番号「${page}/${totalSlides}」を小さく入れる。`;
    const characterInstruction = characterImages.length > 0
      ? [
          '- 添付された参照キャラクター画像を、このスライド内に必ず登場させる。',
          '- 参照キャラクターの輪郭・顔・目・口・色・服装・体型・特徴的な小物を維持し、別キャラクター化しない。',
          '- キャラクターは情報を案内する役として、画像幅の15〜30%程度の視認できるサイズで配置する。'
        ]
      : [];

    return [
      baseContent,
      '',
      '## スライド条件',
      `- これはカルーセル投稿の ${page}枚目 / 全${totalSlides}枚。`,
      `- ${pageNumberInstruction}`,
      ...characterInstruction,
      '- 既存のアニメ・漫画・ゲーム・映画・企業マスコットなど、著作権や商標で保護されたキャラクターは描写しない。'
    ].join('\n');
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
    let base;
    if (presetId === 'custom') {
      base = (els.imageGenCustomStyle ? els.imageGenCustomStyle.value : '') || '';
    } else {
      const preset = IMAGE_GEN_STYLE_PRESETS[presetId];
      base = preset ? preset.prompt : '';
    }
    // ① スタイル署名（あなたの個性）を上乗せ。base が空（custom 未入力）の場合は
    // 既存の必須チェックを壊さないよう付与しない。
    const sig = buildSignatureText();
    if (sig && base.trim()) {
      base += `\n\n【スタイル署名（あなたの個性）】上記の画風を最優先し、それを損なわない範囲で次の個性を加える：${sig}`;
    }
    // ② 配色（UIの設定）を上乗せ。カルーセル全スライドで色調を統一するため、
    // お任せ以外（プリセット / カスタム）を指定したときだけ明示的に指示する。
    if (base.trim()) {
      let colorInstruction = '';
      if (state.colorMode === 'preset' && state.colorValue) {
        colorInstruction = state.colorValue;
      } else if (state.colorMode === 'custom') {
        colorInstruction = `テーマカラー: ${state.customColor}`;
      }
      if (colorInstruction) {
        base += `\n\n【配色】全スライドで次の配色に統一する：${colorInstruction}`;
      }
    }
    return base;
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
  async function _postImageGenProxy(endpoint, body, timeoutMs, extraHeaders) {
    const token = _getLiffToken();
    if (!token && !isTemporaryProMaxRoute()) throw new Error('LINE認証トークンが取得できません');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
          ...temporaryProMaxHeaders(),
          ...(extraHeaders || {})
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
      let errorCode = '';
      try {
        const j = await res.json();
        errorCode = j && j.error ? String(j.error) : '';
        detail = j && j.detail ? `: ${typeof j.detail === 'string' ? j.detail.substring(0, 200) : JSON.stringify(j.detail).substring(0, 200)}` : '';
        if (errorCode) detail = `${errorCode}${detail}`;
      } catch (_) {}
      // BYOK 必須エラー: 自分のキーを設定する導線を案内する
      if (res.status === 403 && errorCode === 'byok_required') {
        const e = new Error('画像生成には自分のAPIキーが必要です。APIキー設定（歯車アイコン）から OpenAI または Gemini のキーを登録してください');
        e.status = 403;
        e.byokRequired = true;
        throw e;
      }
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
    // BYOK: ユーザーが OpenAI キーを設定していれば、それをサーバーに渡して使う。
    // 未設定ならヘッダを付けず、サーバー側の OPENAI_API_KEY にフォールバックする。
    let extraHeaders;
    try {
      const userKey = loadAiConfig().openai.apiKey;
      if (userKey && userKey.trim()) extraHeaders = { 'X-OpenAI-Key': userKey.trim() };
    } catch (_) {}
    return _postImageGenProxy('/api/openai-image', payload, OPENAI_REQUEST_TIMEOUT_MS, extraHeaders);
  }

  // Gemini 1試行 (Imagen 3 / Gemini 2.5 Flash Image)
  // OpenAI と同じく Vercel 180s + proxy 170s + browser 200s で揃える
  const GEMINI_REQUEST_TIMEOUT_MS = 200_000;
  async function callGeminiImageOnce(prompt, model, aspectRatio, refImageUrls) {
    const payload = { prompt, model, aspectRatio };
    if (Array.isArray(refImageUrls) && refImageUrls.length > 0) {
      payload.imageUrls = refImageUrls;
    }
    // BYOK: ユーザーが Gemini キーを設定していれば、それをサーバーに渡して使う。
    // 未設定なら開発者タグ保有者のみ内蔵キーで実行される (それ以外は 403)。
    let extraHeaders;
    try {
      const userKey = loadAiConfig().gemini.apiKey;
      if (userKey && userKey.trim()) extraHeaders = { 'X-Gemini-Key': userKey.trim() };
    } catch (_) {}
    return _postImageGenProxy('/api/gemini-image', payload, GEMINI_REQUEST_TIMEOUT_MS, extraHeaders);
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
    const characterReferenceBlock = characterImages.length > 0
      ? [
          `## 最重要: 添付キャラクター参照画像の扱い`,
          `- 添付された${characterImages.length}枚の参照画像は、生成画像に登場させるキャラクターの正本です。`,
          `- 参照キャラクターの輪郭、顔、目、口、色、服装、体型、特徴的な小物を維持してください。`,
          `- 新しい別キャラクターに置き換えないでください。人間化、リアル化、別マスコット化、抽象アイコン化は禁止です。`,
          `- ポーズや表情はスライド内容に合わせて調整してよいですが、同一キャラクターと分かる外見を保ってください。`,
          `- キャラクターは小さな飾りではなく、画面内で視認できる案内役として配置してください。`
        ].join('\n')
      : '';

    // OpenAI gpt-image-2 / Gemini は明示的かつ簡潔な指示が効きやすい。
    // 一方 Pickaxe ワークスペースは独自バイアスがあるため、スタイル指示を
    // 冒頭・末尾の両方で強調する従来フォーマットの方が安定する。
    // providerHint で経路ごとに最適化する。
    if (providerHint === 'openai' || providerHint === 'gemini') {
      return [
        characterReferenceBlock,
        characterReferenceBlock ? `` : null,
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
        `- 既存のアニメ・漫画・ゲーム・映画・企業マスコットなど、著作権や商標で保護されたキャラクターは描写しない`,
        `- 背景は上記の画風スタイルに合うシンプルなものに`,
        `- 上記スタイルから外れず、忠実に従うこと`
      ].filter(line => line !== null).join('\n');
    }
    // Pickaxe (歴史的フォーマット、後方互換維持)
    const styleHeader = presetLabel
      ? `【最優先：画風スタイル＝「${presetLabel}」】\n${stylePrompt}`
      : `【最優先：画風スタイル】\n${stylePrompt}`;
    return `${characterReferenceBlock ? characterReferenceBlock + '\n\n' : ''}` +
      `${styleHeader}\n\n` +
      `上記の画風スタイルを必ず厳守してください。他のスタイルに勝手に変えないこと。\n\n` +
      `## コンテンツ\n以下の内容を図解画像として生成してください:\n${slideContent}\n\n` +
      `## 注意事項\n- 図解内のテキストは日本語で記載すること\n- ページ全体を1枚の画像として完成させること\n- 装飾的な枠線やロゴは不要\n- 既存のアニメ・漫画・ゲーム・映画・企業マスコットなど、著作権や商標で保護されたキャラクターは描写しない\n\n` +
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

  // ID Token (JWT) を優先取得する。サーバーは JWKS でオフライン検証するため
  // LINE API への往復が消える。ID Token が無ければ旧 access token にフォールバック
  // (移行期間中、_lib/line.js が両方を受け付けるのでどちらでも動く)。
  function _getLiffToken() {
    if (typeof liff === 'undefined') return null;
    try {
      if (typeof liff.getIDToken === 'function') {
        const idt = liff.getIDToken();
        if (idt) return idt;
      }
    } catch (_) { /* fallthrough */ }
    return _getLiffAccessToken();
  }

  // Access Token を明示的に取得する。
  // ID Token は exp が固定で LIFF が自動更新しないため、expired_token を
  // 踏んだら LIFF が自動更新する Access Token にフォールバックする。
  // サーバ側 (api/_lib/line.js) は不透明トークンを path B で検証できる。
  function _getLiffAccessToken() {
    if (typeof liff === 'undefined') return null;
    try {
      return (liff.getAccessToken ? liff.getAccessToken() : null);
    } catch (_) { return null; }
  }

  // ID Token の exp が近い (or 切れている) ときに黙って再ログインしてリフレッシュする。
  // LIFF SDK は ID Token を自動更新しないため、401 (expired_token) を踏んだら
  // この関数で liff.login() を呼んでフルリフレッシュする。
  // sessionStorage で再試行回数を管理し、無限ループを防ぐ。
  function _trySilentLineReLogin(reason) {
    const KEY = 'zukai-relogin-attempts';
    let attempts = 0;
    try { attempts = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0; } catch (_) {}
    if (attempts >= 1) {
      console.warn('[LIFF] silent re-login already attempted, giving up. reason=', reason);
      return false;
    }
    if (typeof liff === 'undefined' || typeof liff.login !== 'function') return false;
    if (!liff.isLoggedIn || !liff.isLoggedIn()) return false;
    try { sessionStorage.setItem(KEY, String(attempts + 1)); } catch (_) {}
    console.log('[LIFF] silent re-login triggered. reason=', reason);
    try {
      // 重要: liff.login() は「ログイン済み」状態だと no-op になり、
      // 期限切れの ID Token を更新できない (401 が無限に続く原因)。
      // 先に logout() でセッションを破棄し、強制的にフルログインさせる。
      if (typeof liff.logout === 'function') liff.logout();
      liff.login();
    } catch (e) {
      console.warn('[LIFF] silent re-login failed:', e && e.message);
      return false;
    }
    return true;
  }
  function _clearReLoginAttempts() {
    try { sessionStorage.removeItem('zukai-relogin-attempts'); } catch (_) {}
  }

  async function logGenerationStart(jobId, payload) {
    const token = _getLiffToken();
    if (!token && !isTemporaryProMaxRoute()) return false;
    try {
      const res = await fetch('/api/log-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
          ...temporaryProMaxHeaders()
        },
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
    if (!token && !isTemporaryProMaxRoute()) return;
    try {
      fetch('/api/log-slide', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
          ...temporaryProMaxHeaders()
        },
        body: JSON.stringify({ job_id: jobId, slide_idx: slideIdx, ...result }),
        keepalive: true
      }).catch(e => console.warn('[ImageGen] log-slide failed (non-fatal):', e && e.message));
    } catch (e) {
      console.warn('[ImageGen] log-slide setup failed:', e && e.message);
    }
  }

  async function generateAllImages() {
    if (!gateOrToast('ai.imagegen', '画像一括生成')) return;
    // 二重クリックガード: 実行中 (disabled) なら何もしない
    if (els.imageGenBtn && els.imageGenBtn.disabled) return;
    if (!carouselData || !carouselData.slides || carouselData.slides.length === 0) {
      showToast('先にJSONを展開してください');
      return;
    }

    const stylePrompt = getCurrentStylePrompt();
    if (!stylePrompt) {
      showToast('スタイルプロンプトを入力してください');
      return;
    }

    // 最初の await (キャラ画像アップロード) より前に同期的に無効化する。
    // 例外が出てもボタンが固まらないよう、復元は下の finally で必ず行う。
    els.imageGenBtn.disabled = true;
    try {

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
      contentPrompt: buildImageSlideContent(slide, i, total),
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
    let _byokRequiredHit = false;  // BYOK未設定で403を踏んだら最後に専用案内を出す
    await runWithConcurrency(slides, _activeConcurrency, async (slide, i) => {
      // スタガリング: 各リクエストの開始を i * STAGGER_DELAY_MS だけ遅らせる
      const initialDelay = (i < _activeConcurrency) ? i * STAGGER_DELAY_MS : 0;
      if (initialDelay > 0) await sleep(initialDelay);

      const content = buildImageSlideContent(slide, i, total);
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
        if (err && err.byokRequired) _byokRequiredHit = true;
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

    } finally {
      // 途中で例外が発生してもボタン・プログレス表示を必ず復元する
      stopProgressTicker();
      updateProgressUI(total);
      els.imageGenBtn.disabled = false;
      els.imageGenBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
        画像を一括生成する
      `;
    }

    const successCount = imageGenState.generatedImages.filter(g => g.status === 'success').length;
    // 全滅かつ BYOK 未設定が原因なら、件数ではなくキー設定への導線を出す
    if (successCount === 0 && _byokRequiredHit) {
      showToast('🔑 画像生成には自分のAPIキーが必要です。APIキー設定（歯車アイコン）から OpenAI または Gemini のキーを登録してください');
    } else {
      showToast(`✨ ${successCount}/${slides.length}枚の画像を生成しました`);
    }
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
          <img class="image-grid-item__img" src="${escapeHtml(img.imageUrl)}" alt="スライド ${i + 1}" loading="lazy">
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
        els.regenModalPreview.innerHTML = `<img src="${escapeHtml(imgData.imageUrl)}" alt="現在の画像">`;
      } else {
        els.regenModalPreview.innerHTML = '<span style="color:var(--text-tertiary);padding:var(--space-8)">画像なし</span>';
      }
    }

    // プロンプト入力欄
    // スタイルプロンプトは常に現在のUI設定（スタイル・署名・配色）から再計算し、
    // 一括生成後に色や署名を変更した場合も個別再生成へ反映されるようにする。
    // 現在値が空（custom 未入力など）の場合のみ、前回固定値にフォールバック。
    if (els.regenStylePrompt) {
      els.regenStylePrompt.value = getCurrentStylePrompt() || imgData.stylePrompt || '';
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
      if (err && err.byokRequired) {
        showToast('🔑 画像生成には自分のAPIキーが必要です。APIキー設定（歯車アイコン）から OpenAI または Gemini のキーを登録してください');
      } else {
        showToast(`⚠️ ${selectedModel} での再生成に失敗しました（別モデルでお試しください）`);
      }
    }
  }

  // ============================================================
  // 初期化
  // ============================================================

  function init() {
    loadState();

    // 旧バージョンの季節テーマ等が保存されていればライトにフォールバック
    if (state.theme !== 'light' && state.theme !== 'dark') {
      state.theme = 'light';
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
    const showStraico = canUseStraicoProvider();

    document.querySelectorAll('[data-internal="straico"]').forEach(el => {
      el.classList.toggle('is-visible', showStraico);
      el.hidden = !showStraico;
    });

    const cfg = loadAiConfig();
    if (!showStraico && cfg.provider === 'straico') {
      cfg.provider = getFallbackAiProvider();
      saveAiConfig(cfg);
    }
    if (els.aiProvider) {
      els.aiProvider.value = normalizeAiProvider(cfg.provider);
    }
    if (apiKeyModalActiveProvider === 'straico' && !showStraico) {
      apiKeyModalActiveProvider = getFallbackAiProvider();
    }

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
    updateAiBadge();
    console.log('[applyProviderGate] showPickaxe =', showPickaxe, '/ showStraico =', showStraico, '/ active model =', imageGenState.model);
  }

  // 全ページ共通の単一LIFFアプリ (B案: ログインを1度で全ページ共有)
  // ※ このLIFFアプリのエンドポイントURLを ルート https://zukai-builder.vercel.app/ に
  //   設定することで、配下の全サブパス (/pro-max, /line-menu 等) を1つのLIFFアプリでカバーする。
  //   LIFFはトークンを LIFF IDごと に保存するため、IDを1本化することで
  //   1度のLINEログインで全ページがログイン済みになる。
  //   line-menu.html の LINE_MENU_LIFF_ID も同じIDに揃えること。
  const LIFF_ID = '2009850086-K3TrYsDF';

  // LINE公式アカウントのID（友だち追加URLに使用）
  // ※ LINE Official Account Manager で確認できるベーシックID（@xxx）またはプレミアムID
  const LINE_OA_ID = '@922tidzy';

  // ログインゲートを非表示にする (デフォルトで .hidden だが念のため)
  function hideLoginGate() {
    const gate = document.getElementById('lineLoginGate');
    if (gate) gate.classList.add('hidden');
  }

  // ログインゲートの内部状態 (loading/login/nonfriend/error) と DOM の対応
  const LOGIN_GATE_STATES = {
    loading:   'lineStateLoading',
    login:     'lineStateLogin',
    nonfriend: 'lineStateNonFriend',
    error:     'lineStateError'
  };
  // ゲート内の表示状態を切替える
  function setLoginGateState(state) {
    Object.values(LOGIN_GATE_STATES).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });
    const active = document.getElementById(LOGIN_GATE_STATES[state] || LOGIN_GATE_STATES.loading);
    if (active) active.classList.add('active');
  }
  // ログインゲートを表示し、指定状態に切替える
  function showLoginGate(state) {
    const gate = document.getElementById('lineLoginGate');
    if (gate) gate.classList.remove('hidden');
    setLoginGateState(state || 'loading');
  }

  // プロファイルが「LIFF ログイン済み相当」かどうか
  // (local-dev もテスト目的で認証済み扱い、 anonymous / open-access / fallback は未認証扱い)
  function isProfileAuthenticated(profile) {
    if (!profile) return false;
    return profile.source === 'api'
        || profile.source === 'api-cache'
        || profile.source === 'local-dev'
        || profile.source === 'temporary-pro-max';
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

  // liff.init() の進行状態。ログインボタンの挙動を分岐するために使う。
  //   'pending' … init がまだ完了していない (押されても待たせる)
  //   'ready'   … init 完了。即 liff.login() してよい
  //   'failed'  … init 失敗 or LIFF 利用不可。友だち追加 URL にフォールバック
  let _liffReadyState = 'pending';
  // init 未完了中にログインを押された場合、その意図を記憶して init 完了時に自動実行する。
  // これがないと「押したのに無反応」に見え、ユーザーが連打してしまう。
  let _pendingLoginIntent = false;
  let _pendingLoginBtn = null;

  // ログインボタンを「認証の準備中…」表示にする (押下直後の無反応感を消す)。
  // SVG アイコンを含む innerHTML を退避し、リダイレクトされない場合は復元できるようにする。
  function _setLoginBtnPending(btn) {
    if (!btn || btn.dataset.loginPending === '1') return;
    btn.dataset.loginPending = '1';
    btn.dataset.loginPrevHtml = btn.innerHTML;
    btn.setAttribute('aria-busy', 'true');
    btn.style.pointerEvents = 'none';
    btn.style.opacity = '0.75';
    btn.innerHTML = '<span class="spinner"></span>認証の準備中…';
  }
  function _resetLoginBtn(btn) {
    if (!btn || btn.dataset.loginPending !== '1') return;
    btn.innerHTML = btn.dataset.loginPrevHtml || btn.innerHTML;
    delete btn.dataset.loginPending;
    delete btn.dataset.loginPrevHtml;
    btn.removeAttribute('aria-busy');
    btn.style.pointerEvents = '';
    btn.style.opacity = '';
  }

  function _goFriendAddUrl() {
    window.location.href = 'https://line.me/R/ti/p/' + encodeURIComponent(LINE_OA_ID);
  }

  // liff.init() の完了 (成功 or 失敗) を通知する。
  // 待たせていたログインクリックがあれば、ここで自動的に実行する。
  function _markLiffReady(state) {
    _liffReadyState = (state === 'ready') ? 'ready' : 'failed';
    if (!_pendingLoginIntent) return;
    _pendingLoginIntent = false;
    console.log('[LIFF] flushing queued login intent. state=', _liffReadyState);
    if (_liffReadyState === 'ready' && typeof liff !== 'undefined' && typeof liff.login === 'function') {
      try { liff.login(); return; } catch (e) {
        console.warn('[LIFF] queued liff.login() failed; falling back to friend-add URL', e);
      }
    }
    _goFriendAddUrl();
  }

  // CTA クリック時の挙動。init の進行状態で分岐する:
  //   ready  → 即 liff.login()
  //   failed → 友だち追加 URL にフォールバック
  //   pending→ 意図を記憶し「準備中…」を表示。init 完了時に _markLiffReady が自動実行する。
  function triggerLineLogin(btn) {
    if (_liffReadyState === 'ready' && typeof liff !== 'undefined' && typeof liff.login === 'function') {
      try {
        _setLoginBtnPending(btn);
        liff.login();
        return;
      } catch (e) {
        console.warn('[LIFF] liff.login() failed; falling back to friend-add URL', e);
        _resetLoginBtn(btn);
        _goFriendAddUrl();
        return;
      }
    }

    if (_liffReadyState === 'failed') {
      _goFriendAddUrl();
      return;
    }

    // init 進行中。連打を防ぎつつ「動いている」ことを見せ、完了したら自動でログインへ。
    console.log('[LIFF] login clicked before init finished → queueing until ready');
    _pendingLoginIntent = true;
    _pendingLoginBtn = btn || null;
    _setLoginBtnPending(btn);
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

  // ----------------------------------------------------------------
  // /api/me のクライアントキャッシュ (stale-while-revalidate)
  // ----------------------------------------------------------------
  // - 成功時にプロファイルを localStorage に保存する。
  // - 起動時は new fetch を待たずに即座にキャッシュを適用し、裏で再取得する。
  // - 5分以内ならゲートが瞬時に解除される (リピート訪問の体感が劇的に変わる)。
  // - 401 を踏んだとき (関連アカウント変更, plan 失効, expired_token) は破棄される。
  const PROFILE_CACHE_KEY = 'zukai-profile-v1';
  const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000; // 5分

  function _saveProfileCache(profile) {
    if (!profile || profile.source !== 'api') return;
    try {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        profile
      }));
    } catch (_) { /* localStorage 不可 (Safari Private 等) → 無視 */ }
  }

  function _readProfileCache() {
    try {
      const raw = localStorage.getItem(PROFILE_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.profile || typeof data.savedAt !== 'number') return null;
      if (Date.now() - data.savedAt > PROFILE_CACHE_TTL_MS) {
        // TTL 切れ。古すぎるので破棄。次回ログイン時に新規取得。
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
        return null;
      }
      // source は 'api' で保存しているが、キャッシュから復元したものは別ソースとして識別
      return Object.assign({}, data.profile, { source: 'api-cache' });
    } catch (_) {
      return null;
    }
  }

  // LIFF コールバック直後 (URL に code/state が付いている) はキャッシュを使わない。
  // 別アカウントへ切り替えた場合に古いプランで一瞬起動するのを防ぐ。
  function _isLiffCallbackUrl() {
    try {
      const qs = new URLSearchParams(location.search);
      return qs.has('code') && qs.has('state');
    } catch (_) { return false; }
  }

  // 起動時に呼ぶ: キャッシュがあれば即 __USER_PROFILE__ に注入し UI を解除する。
  // 裏で fetchUserProfile が走って差分が出ればもう一度 applyProviderGate / applyHeaderForProfile が呼ばれる。
  function _hydrateFromProfileCache() {
    if (_isLiffCallbackUrl()) {
      console.log('[api/me] LIFF callback in URL → skip cache hydration (force fresh fetch)');
      return false;
    }
    const cached = _readProfileCache();
    if (!cached) return false;
    window.__USER_PROFILE__ = cached;
    console.log('[api/me] hydrated from cache:', { plan: cached.plan, tags: cached.tags });
    try { applyProviderGate(); } catch (_) {}
    try { applyHeaderForProfile(); } catch (_) {}
    return true;
  }

  // isProfileAuthenticated は 'api-cache' も認証済み扱いにする (下で hook するため
  // ここでは fn を上書きできるよう、ローカルに同等の判定を持つ)
  // ※ isProfileAuthenticated 本体は次の Edit で 'api-cache' を含めるよう拡張する。

  // /api/me を叩いてプラン情報を取得する (失敗しても非ブロッキング)
  // 戻り値: true=成功 / false=フォールバック / 'reauth'=再ログインへ遷移済み
  async function fetchUserProfile() {
    try {
      const token = _getLiffToken();
      if (!token) {
        console.warn('[api/me] no auth token available; skipping');
        window.__USER_PROFILE__ = buildFallbackProfile('fallback');
        return false;
      }
      const url = '/api/me?product=' + encodeURIComponent(PRODUCT_CODE);
      const callMe = (tok) => withTimeout(
        fetch(url, { headers: { Authorization: 'Bearer ' + tok } }),
        8000,
        '/api/me'
      );

      let res = await callMe(token);

      // 認証復旧戦略:
      //   1) expired_token/invalid_token なら、まず Access Token で1回リトライ。
      //      (Access Token がまだ生きていればフルページ再ログインを避けて静かに復帰)
      //   2) それでも認証できない (401 残り / Access Token パスが 502 等で失敗) なら
      //      logout()+login() による強制再ログインに落とす。
      let authExpired = false;
      if (res.status === 401) {
        let errCode = null;
        try { const errBody = await res.clone().json(); errCode = errBody && errBody.error; } catch (_) {}
        console.warn('[api/me] 401, errCode=', errCode);

        if (errCode === 'expired_token' || errCode === 'invalid_token') {
          authExpired = true;
          const accessToken = _getLiffAccessToken();
          if (accessToken && accessToken !== token) {
            console.log('[api/me] retrying with access token after', errCode);
            try { res = await callMe(accessToken); } catch (_) { /* keep prev res */ }
          }
        }
      }

      // 401 が残った、または認証期限切れなのにリトライでも復帰できなかった (502 等) 場合は
      // 強制再ログインへ。これを通さないと expired セッションから抜け出せない。
      if (res.status === 401 || (authExpired && !res.ok)) {
        console.warn('[api/me] auth recovery needed, status=', res.status);
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
        if (_trySilentLineReLogin('api/me auth expired')) {
          return 'reauth';
        }
        window.__USER_PROFILE__ = buildFallbackProfile('fallback');
        return false;
      }
      if (!res.ok) {
        console.warn('[api/me] non-200 response:', res.status);
        window.__USER_PROFILE__ = buildFallbackProfile('fallback');
        return false;
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
      _clearReLoginAttempts();
      _saveProfileCache(window.__USER_PROFILE__);
      console.log('[api/me] loaded profile:', { plan: ent.plan, tags: data.tags });
      applyProviderGate();
      return true;
    } catch (e) {
      console.warn('[api/me] failed:', e && e.message);
      window.__USER_PROFILE__ = buildFallbackProfile('fallback');
      return false;
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

    const token = _getLiffToken();
    if (!token) {
      console.log('[restoreLastJob] no auth token, skip');
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

      // init 完了。待たせていたログインクリックがあればここで即発火させる。
      _markLiffReady('ready');

      if (liff.isLoggedIn()) {
        console.log('[LIFF] logged in → fetchUserProfile()');
        const result = await fetchUserProfile();
        if (result === 'reauth') return; // silent re-login へリダイレクト中
        applyHeaderForProfile();
        // 前回の画像生成結果が 24時間以内にあれば自動復元する (失敗時は黙って続行)
        restoreLastJob().catch(e => console.warn('[restoreLastJob] swallowed error:', e && e.message));
      } else {
        console.log('[LIFF] not logged in → staying anonymous');
        // ログアウト状態 → キャッシュが残っていれば破棄 (古い情報が次回も使われないように)
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
      }
    } catch (e) {
      console.warn('[LIFF] background init failed; staying anonymous:', e && e.message);
      // init 失敗 → 待たせていたクリックは友だち追加 URL にフォールバックさせる。
      _markLiffReady('failed');
    }
  }

  // ヘッダおよびログインゲート系のイベントリスナー
  function initLoginEvents() {
    // ヘッダの「友だち追加/ログイン」CTA (匿名ユーザー向け)
    const ctaBtn = document.getElementById('lineLoginCtaBtn');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerLineLogin(ctaBtn);
      });
    }

    // ログインゲート内の「LINEでログイン」ボタン (ログイン必須ルート用)
    const gateLoginBtn = document.getElementById('lineLoginBtn');
    if (gateLoginBtn) {
      gateLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        triggerLineLogin(gateLoginBtn);
      });
    }
    // ゲート内エラー時の再試行
    const gateErrorRetryBtn = document.getElementById('lineErrorRetryBtn');
    if (gateErrorRetryBtn) {
      gateErrorRetryBtn.addEventListener('click', () => location.reload());
    }
    // 「友だち追加済みの方はこちら（再確認）」→ 再読み込みして再判定
    const gateRetryFriendBtn = document.getElementById('lineRetryFriendBtn');
    if (gateRetryFriendBtn) {
      gateRetryFriendBtn.addEventListener('click', () => location.reload());
    }

    // ログアウトボタン
    const logoutBtn = document.getElementById('lineLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        try {
          if (typeof liff !== 'undefined' && liff.isLoggedIn && liff.isLoggedIn()) {
            liff.logout();
          }
        } catch (_) { /* noop */ }
        // プロファイルキャッシュも破棄 (次回は匿名状態で起動)
        try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
        _clearReLoginAttempts();
        location.reload();
      });
    }
  }

  // ローカル開発時は LIFF をスキップしてアプリ本体を直接起動
  function isLocalDev() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '' || h === '0.0.0.0';
  }

  // LINE認証不要の公開ページ (/free のみ) かどうか
  // ※ /pro-max はログイン必須化したため、ここからは除外している
  function isOpenAccessRoute() {
    const path = location.pathname || '';
    return path === '/free' || path === '/free/' || path.indexOf('/free') === 0;
  }

  // ログイン必須ルートか (現在は /pro-max のみ。/ と /free は公開)
  // ※ localhost は開発用にゲートをスキップする
  function isLoginRequiredRoute() {
    if (isLocalDev()) return false;
    const path = location.pathname || '';
    return path === '/pro-max' || path === '/pro-max/' || path.indexOf('/pro-max') === 0;
  }

  function isTemporaryProMaxRoute() {
    const path = location.pathname || '';
    return path === '/pro-max' || path === '/pro-max/' || path.indexOf('/pro-max') === 0;
  }

  function temporaryProMaxHeaders() {
    return isTemporaryProMaxRoute() ? { 'X-Temporary-Pro-Max-Access': '1' } : {};
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

    const qs = new URLSearchParams(location.search);
    const overridePlan = qs.get('plan');
    const overrideTags = (qs.get('tags') || '').split(',').map(s => s.trim()).filter(Boolean);

    // ① ログイン必須ルート (/pro-max): ゲートを表示し、ログイン済みのときだけ本体を起動
    if (isLoginRequiredRoute()) {
      requireLoginThenStart();
      return;
    }

    // ② 公開ルート (/free) と localhost: 固定プロファイルで即起動
    if (isLocalDev() || isOpenAccessRoute()) {
      hideLoginGate();
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
      applyProviderGate();
      applyHeaderForProfile();
      return;
    }

    // ③ 通常ルート (/): ログイン不要。匿名フリーで即起動し、
    //    既にLINEログイン済みなら裏で本物のプランに昇格 (ログインは強制しない)
    hideLoginGate();
    // キャッシュがあれば PRO/STANDARD バッジを最初から出すために先に hydrate を試みる。
    // 失敗 (未ログイン or TTL 切れ) なら匿名フリーで起動する。
    if (!_hydrateFromProfileCache()) {
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
    }
    init();
    applyProviderGate();
    applyHeaderForProfile();
    initLiff();
  }

  // ログイン必須ルートのブートストラップ
  //   1) キャッシュがあれば即起動 (LIFF init を待たない)。裏で /api/me を更新。
  //   2) キャッシュが無ければ従来通り: ゲート表示 → LIFF init → /api/me → 起動
  async function requireLoginThenStart() {
    // ─── 高速パス: 直近5分以内に /api/me 成功していれば即起動 ─────────────────
    if (_hydrateFromProfileCache()) {
      console.log('[startup] fast path via profile cache');
      hideLoginGate();
      init();
      // 裏で LIFF init + /api/me を回し、差分があれば applyProviderGate が再走する。
      // ここで失敗してもキャッシュで起動済みなので体験はブロックしない。
      (async () => {
        try {
          await waitForLiffSdk(8000);
          await withTimeout(liff.init({ liffId: LIFF_ID }), 10000, 'LIFF init');
          if (!liff.isLoggedIn()) {
            // キャッシュは残っていたが LIFF はログアウト状態 → 次回起動で再ログインを要求
            try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch (_) {}
            return;
          }
          const result = await fetchUserProfile();
          if (result === 'reauth') return;
          applyHeaderForProfile();
        } catch (e) {
          console.warn('[startup] background refresh failed; staying on cache:', e && e.message);
        }
      })();
      restoreLastJob().catch(e => console.warn('[restoreLastJob] swallowed error:', e && e.message));
      return;
    }

    // ─── 通常パス: キャッシュなし。従来通りゲート→LIFF init→/api/me ──────────
    showLoginGate('loading');
    try {
      await waitForLiffSdk(8000);
      await withTimeout(liff.init({ liffId: LIFF_ID }), 10000, 'LIFF init');
    } catch (e) {
      console.error('[LIFF] init failed on login-required route:', e && e.message);
      setLoginGateState('error');
      return;
    }

    if (!liff.isLoggedIn()) {
      console.log('[LIFF] not logged in → showing login gate');
      setLoginGateState('login');
      return;
    }

    // ログイン済み: 本物のプロファイルを取得してからアプリ起動 (失敗時は fallback で続行)
    let result;
    try {
      result = await fetchUserProfile();
    } catch (e) {
      console.warn('[LIFF] fetchUserProfile failed; continuing with fallback:', e && e.message);
      if (!window.__USER_PROFILE__) window.__USER_PROFILE__ = buildFallbackProfile('fallback');
    }
    if (result === 'reauth') return; // silent re-login へリダイレクト中
    hideLoginGate();
    init();
    applyHeaderForProfile();
    restoreLastJob().catch(e => console.warn('[restoreLastJob] swallowed error:', e && e.message));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
  } else {
    startApp();
  }

})();
