/* ================================================================
   USCPA Quiz App v12  —  app.js
   v12 変更点:
     ① 難易度フィルタ（easy / medium / hard）追加
        ・ホーム画面に「難易度」選択UIを追加
        ・複数選択可能（デフォルト全選択）
        ・選択した難易度の問題だけが出題対象になる
        ・論点フィルタと組み合わせて機能する
     ② Netlify対応: index.html + app.js + questions.js + style.css の
        4ファイル構成（相対パス）
================================================================ */


/* ──────────────────────────────────────────
   § 1  定数
────────────────────────────────────────── */
const KEY_PROGRESS = 'uscpa9_progress';
const KEY_REVIEW   = 'uscpa9_review';
const KEY_MASTERY  = 'uscpa9_mastery';

const TOPIC_LABEL = {
  'Bonds':                                          '債券 (Bonds)',
  'Equity Transactions and Earnings Per Share':     '株式・EPS (Equity)',
  'Intangible Assets':                              '無形資産 (Intangible Assets)',
  'Lease Accounting for Lessee':                    'リース会計 (Lease)',
  'Notes Receivable and Payable':                   '手形 (Notes)',
  'Revenue from Contracts with Customers':          '収益認識 (Revenue)',
  'Time Value of Money':                            '貨幣の時間価値 (TVM)',
};

const MODE_LABEL = {
  random:     'ランダム',
  sequential: '最初から',
  review:     '復習ボックス',
  master:     'マスターするまで',
};

const DIFFICULTY_OPTIONS = [
  { value: 'easy',   label: '⭐ easy',    color: 'green' },
  { value: 'medium', label: '⭐⭐ medium', color: 'amber' },
  { value: 'hard',   label: '⭐⭐⭐ hard',  color: 'red'   },
];


/* ──────────────────────────────────────────
   § 2  アプリ状態
────────────────────────────────────────── */
const state = {
  allQuestions:         [],
  allTopics:            [],
  activeQuestions:      [],
  sessionQuestions:     [],
  currentIndex:         0,
  correctCount:         0,
  skipCount:            0,
  answered:             false,
  selectedTopics:       [],
  selectedDifficulties: ['easy', 'medium', 'hard'],
  selectedMode:         'random',
  masterQueue:          [],
  masterDone:           new Set(),
  isSpeaking:           false,
  reviewIds:            new Set(),
  sessionWasAllDone:    false,
  masteryByTopic:       new Map(),
};


/* ──────────────────────────────────────────
   § 3  初期化
────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  state.allQuestions = QUIZ_DATA;

  const seen = new Set();
  for (const q of state.allQuestions) {
    if (q.topic && !seen.has(q.topic)) {
      seen.add(q.topic);
      state.allTopics.push(q.topic);
    }
  }

  state.selectedTopics = [...state.allTopics];

  loadReviewIds();
  loadMastery();

  buildTopicList();
  buildDifficultyFilter();
  buildModeButtons();

  checkResumable();
  updateReviewBanner();
  updateSelectedCount();
});


/* ──────────────────────────────────────────
   § 4  ホーム画面 — トピックリスト
────────────────────────────────────────── */
function buildTopicList() {
  const container = document.getElementById('topicList');
  container.innerHTML = '';

  const totalByTopic = {};
  for (const q of state.allQuestions) {
    totalByTopic[q.topic] = (totalByTopic[q.topic] || 0) + 1;
  }

  state.allTopics.forEach(topic => {
    const isChecked   = state.selectedTopics.includes(topic);
    const label       = TOPIC_LABEL[topic] || topic;
    const total       = totalByTopic[topic] || 0;
    const tData       = getTopicData(topic);
    const currentDone = tData.currentKeys.size;
    const laps        = tData.laps;

    const el = document.createElement('label');
    el.className = 'topic-item' + (isChecked ? ' checked' : '');

    el.innerHTML = `
      <input type="checkbox" class="topic-cb" value="${esc(topic)}" ${isChecked ? 'checked' : ''}>
      <span class="topic-name">${escHtml(label)}</span>
      <span class="topic-mastery" id="mastery-${esc(topic)}">
        <span class="mastery-correct">${currentDone}</span>
        <span class="mastery-sep">/</span>
        <span class="mastery-total">${total}</span>
      </span>
      <span class="topic-laps" id="laps-${esc(topic)}" title="${laps}周完了">
        🔄<span class="laps-count">${laps}</span>
      </span>
      <button class="btn-reset-topic" data-topic="${esc(topic)}"
              title="この論点の進捗をリセット" onclick="resetTopic(event, '${esc(topic)}')">↺</button>
    `;

    el.querySelector('input').addEventListener('change', e => {
      el.classList.toggle('checked', e.target.checked);
      syncTopics();
    });

    container.appendChild(el);
  });
}

function updateMasteryBadge(topic) {
  const tData       = getTopicData(topic);
  const currentDone = tData.currentKeys.size;
  const laps        = tData.laps;

  const masteryEl = document.getElementById(`mastery-${topic}`);
  if (masteryEl) {
    const correctEl = masteryEl.querySelector('.mastery-correct');
    if (correctEl) correctEl.textContent = currentDone;
  }

  const lapsEl = document.getElementById(`laps-${topic}`);
  if (lapsEl) {
    const countEl = lapsEl.querySelector('.laps-count');
    if (countEl) countEl.textContent = laps;
    lapsEl.title = `${laps}周完了`;
  }
}


/* ──────────────────────────────────────────
   § 4b  難易度フィルタ UI
────────────────────────────────────────── */
function buildDifficultyFilter() {
  const container = document.getElementById('difficultyFilter');
  if (!container) return;
  container.innerHTML = '';

  DIFFICULTY_OPTIONS.forEach(({ value, label, color }) => {
    const isChecked = state.selectedDifficulties.includes(value);

    const btn = document.createElement('button');
    btn.type      = 'button';
    btn.className = `diff-btn diff-${color}${isChecked ? ' active' : ''}`;
    btn.dataset.diff = value;
    btn.textContent  = label;

    btn.addEventListener('click', () => {
      const idx = state.selectedDifficulties.indexOf(value);
      if (idx >= 0) {
        if (state.selectedDifficulties.length === 1) return; // 最低1つ残す
        state.selectedDifficulties.splice(idx, 1);
        btn.classList.remove('active');
      } else {
        state.selectedDifficulties.push(value);
        btn.classList.add('active');
      }
      updateSelectedCount();
    });

    container.appendChild(btn);
  });
}

function matchesDifficulty(q) {
  if (state.selectedDifficulties.length === 0) return true;
  const tags = String(q.tag || '').split(',').map(t => t.trim());
  return state.selectedDifficulties.some(d => tags.includes(d));
}


/* ──────────────────────────────────────────
   § 5  論点データのヘルパー
────────────────────────────────────────── */
function getTopicData(topic) {
  if (!state.masteryByTopic.has(topic)) {
    state.masteryByTopic.set(topic, { laps: 0, currentKeys: new Set() });
  }
  return state.masteryByTopic.get(topic);
}

function buildPrioritizedPool(questions) {
  const masteredKeys = new Set();
  for (const [, data] of state.masteryByTopic.entries()) {
    for (const k of data.currentKeys) masteredKeys.add(k);
  }

  const unseen = [];
  const review = [];

  for (const q of questions) {
    const key        = reviewKey(q);
    const isMastered = masteredKeys.has(key);
    const inReview   = isReviewed(q);

    if (inReview) {
      review.push(q);
    } else if (!isMastered) {
      unseen.push(q);
    }
  }

  if (unseen.length > 0) return { pool: unseen, allDone: false };
  if (review.length > 0) return { pool: review, allDone: false };
  return { pool: questions, allDone: true };
}


/* ──────────────────────────────────────────
   § 6  localStorage — 論点進捗
────────────────────────────────────────── */
function loadMastery() {
  try {
    const raw = localStorage.getItem(KEY_MASTERY);
    const obj = raw ? JSON.parse(raw) : {};
    state.masteryByTopic = new Map();
    for (const [topic, data] of Object.entries(obj)) {
      state.masteryByTopic.set(topic, {
        laps:        data.laps || 0,
        currentKeys: new Set(data.currentKeys || []),
      });
    }
  } catch {
    state.masteryByTopic = new Map();
    localStorage.removeItem(KEY_MASTERY);
  }
}

function saveMastery() {
  const obj = {};
  for (const [topic, data] of state.masteryByTopic.entries()) {
    obj[topic] = {
      laps:        data.laps,
      currentKeys: [...data.currentKeys],
    };
  }
  localStorage.setItem(KEY_MASTERY, JSON.stringify(obj));
}

function markMastered(q) {
  const topic = q.topic;
  const key   = reviewKey(q);
  const tData = getTopicData(topic);

  tData.currentKeys.add(key);

  const totalInTopic = state.allQuestions.filter(x => x.topic === topic).length;
  if (tData.currentKeys.size >= totalInTopic) {
    tData.laps++;
    tData.currentKeys = new Set();
  }

  saveMastery();
  updateMasteryBadge(topic);

  if (isReviewed(q)) {
    removeReview(q);
    updateReviewBanner();
  }
}

function updateTopicProgressBadge(q) {
  const badge = document.getElementById('topicProgressBadge');
  if (!badge || !q) { if (badge) badge.textContent = ''; return; }

  const total    = state.allQuestions.filter(x => x.topic === q.topic).length;
  const tData    = getTopicData(q.topic);
  const currentN = tData.currentKeys.size;
  const laps     = tData.laps;

  badge.textContent = `${currentN} / ${total}  🔄${laps}`;
}


/* ──────────────────────────────────────────
   § 7  論点リセット
────────────────────────────────────────── */
function resetTopic(event, topic) {
  event.preventDefault();
  event.stopPropagation();

  const label = TOPIC_LABEL[topic] || topic;
  if (!confirm(`「${label}」の周回数・進捗・復習ボックスをすべてリセットしますか？`)) return;

  state.masteryByTopic.set(topic, { laps: 0, currentKeys: new Set() });
  saveMastery();

  const keysToDelete = [...state.reviewIds].filter(k => k.startsWith(`${topic}::`));
  keysToDelete.forEach(k => state.reviewIds.delete(k));
  saveReviewIds();

  updateMasteryBadge(topic);
  updateReviewBanner();
  buildTopicList();
  syncCheckboxesToState();
}


/* ──────────────────────────────────────────
   § 8  トピック選択 / アクティブ問題リスト
────────────────────────────────────────── */
function syncTopics() {
  state.selectedTopics = [];
  document.querySelectorAll('.topic-cb:checked').forEach(cb => {
    state.selectedTopics.push(cb.value);
  });
  updateSelectedCount();
  checkResumable();
}

function syncCheckboxesToState() {
  document.querySelectorAll('.topic-cb').forEach(cb => {
    const checked = state.selectedTopics.includes(cb.value);
    cb.checked = checked;
    cb.closest('.topic-item')?.classList.toggle('checked', checked);
  });
}

function checkAll(on) {
  state.selectedTopics = on ? [...state.allTopics] : [];
  syncCheckboxesToState();
  updateSelectedCount();
  checkResumable();
}

function buildActiveQuestions() {
  // 論点フィルタ + 難易度フィルタ 両方適用
  state.activeQuestions = state.allQuestions.filter(q =>
    (state.selectedTopics.length === 0 || state.selectedTopics.includes(q.topic)) &&
    matchesDifficulty(q)
  );
}

function updateSelectedCount() {
  buildActiveQuestions();
  const el  = document.getElementById('selectedCount');
  if (el) el.textContent = state.activeQuestions.length;
  const btn = document.getElementById('btnStart');
  if (btn) btn.disabled = (state.activeQuestions.length === 0 && state.selectedMode !== 'review');
}


/* ──────────────────────────────────────────
   § 9  モードボタン
────────────────────────────────────────── */
function buildModeButtons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setMode(btn.dataset.mode);
    });
  });
}

function setMode(mode) {
  state.selectedMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}


/* ──────────────────────────────────────────
   § 10  localStorage — セッション進捗
────────────────────────────────────────── */
function saveProgress() {
  const data = {
    sessionQuestions: state.sessionQuestions,
    currentIndex:     state.currentIndex,
    correctCount:     state.correctCount,
    skipCount:        state.skipCount,
    selectedTopics:   state.selectedTopics,
    selectedMode:     state.selectedMode,
    masterQueue:      state.masterQueue,
    masterDoneKeys:   [...state.masterDone],
  };
  localStorage.setItem(KEY_PROGRESS, JSON.stringify(data));
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY_PROGRESS);
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem(KEY_PROGRESS);
    return null;
  }
}

function clearProgress() {
  localStorage.removeItem(KEY_PROGRESS);
}

function checkResumable() {
  // 前回の続き機能は削除済み
}


/* ──────────────────────────────────────────
   § 11  localStorage — 復習ボックス
────────────────────────────────────────── */
function reviewKey(q) {
  return `${q.topic}::${q.id}`;
}

function loadReviewIds() {
  try {
    const raw = localStorage.getItem(KEY_REVIEW);
    state.reviewIds = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    state.reviewIds = new Set();
  }
}

function saveReviewIds() {
  localStorage.setItem(KEY_REVIEW, JSON.stringify([...state.reviewIds]));
}

function addReview(q) {
  state.reviewIds.add(reviewKey(q));
  saveReviewIds();
}

function removeReview(q) {
  state.reviewIds.delete(reviewKey(q));
  saveReviewIds();
}

function isReviewed(q) {
  return state.reviewIds.has(reviewKey(q));
}

function updateReviewBanner() {
  const count  = state.reviewIds.size;
  const btn    = document.getElementById('btnReview');
  const banner = document.getElementById('reviewBanner');
  const text   = document.getElementById('reviewText');

  if (text) text.textContent = `復習ボックスに ${count} 問あります`;

  if (count > 0) {
    if (btn) btn.disabled = false;
    banner?.classList.remove('hidden');
  } else {
    if (btn) btn.disabled = true;
    banner?.classList.add('hidden');
    if (state.selectedMode === 'review') setMode('random');
  }
}

function syncReviewCheckbox() {
  const q  = getCurrentQ();
  const cb = document.getElementById('reviewCb');
  if (cb && q) cb.checked = isReviewed(q);
}

function onReviewCbChange() {
  const cb = document.getElementById('reviewCb');
  const q  = getCurrentQ();
  if (!q) return;
  if (cb.checked) { addReview(q); } else { removeReview(q); }
  updateReviewBanner();
}


/* ──────────────────────────────────────────
   § 12  クイズ開始
────────────────────────────────────────── */
function startQuiz() {
  speechSynthesis.cancel();
  state.answered          = false;
  state.isSpeaking        = false;
  state.sessionWasAllDone = false;

  buildActiveQuestions();

  // 復習モード
  if (state.selectedMode === 'review') {
    const reviewQs = state.allQuestions.filter(q => isReviewed(q));
    if (reviewQs.length === 0) {
      alert('復習ボックスに問題がありません。\n問題の ⭐ をチェックするか、問題に間違えると自動追加されます。');
      return;
    }
    state.currentIndex     = 0;
    state.correctCount     = 0;
    state.skipCount        = 0;
    state.sessionQuestions = applyCountLimit(shuffle(reviewQs));
    startSession();
    return;
  }

  // マスターモード
  if (state.selectedMode === 'master') {
    if (state.activeQuestions.length === 0) return;
    state.currentIndex     = 0;
    state.correctCount     = 0;
    state.skipCount        = 0;
    state.masterQueue      = shuffle([...state.activeQuestions]);
    state.masterDone       = new Set();
    state.sessionQuestions = state.masterQueue;
    startSession();
    return;
  }

  // ランダム / 最初から（未正解優先フィルタ）
  if (state.activeQuestions.length === 0) return;

  const { pool, allDone } = buildPrioritizedPool(state.activeQuestions);
  state.sessionWasAllDone = allDone;

  state.currentIndex = 0;
  state.correctCount = 0;
  state.skipCount    = 0;

  const base = state.selectedMode === 'sequential'
    ? [...pool]
    : shuffle([...pool]);

  state.sessionQuestions = applyCountLimit(base);
  startSession();
}

function applyCountLimit(arr) {
  return arr.length > 5 ? arr.slice(0, 5) : arr;
}

function startSession() {
  updateModeTag();
  updateHeaderScore();
  showScreen('screenQuiz');
  showQuestion();
}


/* ──────────────────────────────────────────
   § 13  問題表示
────────────────────────────────────────── */
function showQuestion() {
  const q = getCurrentQ();
  if (!q) { showResult(); return; }

  state.answered = false;

  document.getElementById('qText').textContent = q.question;

  const catLabel = q.category === 'vocab'   ? '英単語' :
                   q.category === 'concept' ? '概念'   : q.category;
  document.getElementById('tagCat').textContent   = catLabel;
  document.getElementById('tagTopic').textContent = TOPIC_LABEL[q.topic] || q.topic;

  // 難易度タグ表示
  const diffTag = document.getElementById('tagDiff');
  if (diffTag) {
    const tags = String(q.tag || '').split(',').map(t => t.trim());
    const diff = ['easy', 'medium', 'hard'].find(d => tags.includes(d)) || '';
    const diffLabel = { easy: '⭐ easy', medium: '⭐⭐ medium', hard: '⭐⭐⭐ hard' };
    if (diff) {
      diffTag.textContent = diffLabel[diff];
      diffTag.className   = `tag tag-diff tag-diff-${diff}`;
      diffTag.style.display = '';
    } else {
      diffTag.style.display = 'none';
    }
  }

  updateTopicProgressBadge(q);
  updateProgress();

  document.getElementById('explanation').classList.add('hidden');
  document.getElementById('btnSkip').classList.remove('hidden');

  syncReviewCheckbox();

  renderChoices(shuffle([
    { text: q.correct, ok: true  },
    { text: q.wrong1,  ok: false },
    { text: q.wrong2,  ok: false },
    { text: q.wrong3,  ok: false },
  ]));

  const card = document.getElementById('qCard');
  card.classList.remove('slide-in');
  void card.offsetWidth;
  card.classList.add('slide-in');

  speechSynthesis.cancel();
  state.isSpeaking = false;
  document.getElementById('ttsBtn').classList.remove('speaking');

  saveProgress();
}

function getCurrentQ() {
  if (state.selectedMode === 'master') return state.masterQueue[0] ?? null;
  return state.sessionQuestions[state.currentIndex] ?? null;
}


/* ──────────────────────────────────────────
   § 14  選択肢の描画
────────────────────────────────────────── */
function renderChoices(choices) {
  const container = document.getElementById('choices');
  container.innerHTML = '';
  const labels = ['A', 'B', 'C', 'D'];

  choices.forEach((choice, i) => {
    const btn = document.createElement('button');
    btn.className  = 'choice-btn';
    btn.dataset.ok = choice.ok;
    btn.innerHTML  = `
      <span class="choice-label">${labels[i]}</span>
      <span class="choice-text">${escHtml(choice.text)}</span>
    `;
    btn.addEventListener('click', () => onAnswer(btn, choice.ok));
    container.appendChild(btn);
  });
}


/* ──────────────────────────────────────────
   § 15  回答処理
────────────────────────────────────────── */
function onAnswer(selectedBtn, isCorrect) {
  if (state.answered) return;
  state.answered = true;

  const q   = getCurrentQ();
  const key = reviewKey(q);

  document.getElementById('btnSkip').classList.add('hidden');

  if (isCorrect) {
    state.correctCount++;
    markMastered(q);
    if (state.selectedMode === 'master') {
      state.masterQueue.shift();
      state.masterDone.add(key);
    }
  } else {
    addReview(q);
    if (state.selectedMode === 'master') {
      const wrongQ = state.masterQueue.shift();
      state.masterQueue.push(wrongQ);
    }
  }

  updateTopicProgressBadge(q);
  syncReviewCheckbox();
  updateHeaderScore();
  updateReviewBanner();

  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.ok === 'true') btn.classList.add('correct');
    else if (btn === selectedBtn)  btn.classList.add('wrong');
  });

  showExplanation(isCorrect, q);
}


/* ──────────────────────────────────────────
   § 16  解説カード表示
────────────────────────────────────────── */
function showExplanation(isCorrect, q) {
  const card  = document.getElementById('explanation');
  const icon  = document.getElementById('resultIcon');
  const label = document.getElementById('resultLabel');
  const text  = document.getElementById('explText');
  const info  = document.getElementById('masterInfo');

  if (isCorrect) {
    icon.textContent  = '✓';
    icon.className    = 'result-icon correct-icon';
    label.textContent = '正解！';
    label.className   = 'result-label correct-label';
  } else {
    icon.textContent  = '✗';
    icon.className    = 'result-icon wrong-icon';
    label.textContent = '不正解（復習ボックスに追加）';
    label.className   = 'result-label wrong-label';
  }

  text.textContent = q.explanation || '解説なし';

  if (state.selectedMode === 'master') {
    const rem = state.masterQueue.length;
    info.textContent = rem > 0
      ? `残り ${rem} 問（間違えた問題は再出題されます）`
      : '🎉 全問正解！次で終了します';
    info.classList.remove('hidden');
  } else {
    info.classList.add('hidden');
  }

  card.classList.remove('hidden');
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
}


/* ──────────────────────────────────────────
   § 17  次の問題 / スキップ
────────────────────────────────────────── */
function nextQuestion() {
  if (state.selectedMode === 'master') {
    if (state.masterQueue.length === 0) {
      clearProgress(); updateReviewBanner(); showResult();
      return;
    }
    showQuestion();
    return;
  }
  state.currentIndex++;
  if (state.currentIndex >= state.sessionQuestions.length) {
    clearProgress(); updateReviewBanner(); showResult();
    return;
  }
  showQuestion();
}

function skipQuestion() {
  if (state.answered) return;
  const q = getCurrentQ();
  if (q) {
    state.skipCount++;
    addReview(q);
    syncReviewCheckbox();
    updateReviewBanner();
  }
  if (state.selectedMode === 'master') {
    if (state.masterQueue.length > 0) {
      state.masterQueue.push(state.masterQueue.shift());
    }
    showQuestion();
    return;
  }
  state.currentIndex++;
  if (state.currentIndex >= state.sessionQuestions.length) {
    clearProgress(); updateReviewBanner(); showResult();
    return;
  }
  showQuestion();
}


/* ──────────────────────────────────────────
   § 18  結果画面
────────────────────────────────────────── */
function showResult() {
  const isMaster = state.selectedMode === 'master';
  const isReview = state.selectedMode === 'review';
  const allDone  = state.sessionWasAllDone;

  const total   = isMaster ? state.masterDone.size : state.sessionQuestions.length;
  const correct = state.correctCount;
  const pct     = total > 0 ? Math.round((correct / total) * 100) : 100;

  document.getElementById('finalCorrect').textContent = correct;
  document.getElementById('finalTotal').textContent   = total;

  const titleEl = document.getElementById('resultTitle');
  if (allDone) {
    document.getElementById('resultPct').textContent = '選択中の論点は全問正解済み 🎊';
    if (titleEl) titleEl.textContent = '一周完了！';
  } else {
    document.getElementById('resultPct').textContent =
      isMaster ? '全問マスター達成！' : `正答率 ${pct}%`;
    if (titleEl) titleEl.textContent = isMaster ? '🎯 マスター完了！' : 'クイズ完了！';
  }

  let emoji, msg;
  if (allDone) {
    emoji = '🎊'; msg = 'すべての問題に一度は正解しました！復習ボックスの問題を引き続き練習しましょう。';
  } else if (isMaster) {
    emoji = '🏆'; msg = 'すべての問題に正解しました！';
  } else if (pct >= 90) {
    emoji = '🏆'; msg = '素晴らしい！完璧に近い出来です。';
  } else if (pct >= 70) {
    emoji = '🎉'; msg = 'よくできました！着実に力がついています。';
  } else if (pct >= 50) {
    emoji = '📖'; msg = 'もう少し！苦手な問題を復習しましょう。';
  } else {
    emoji = '💪'; msg = 'まだまだこれから！繰り返しが力になります。';
  }

  document.getElementById('resultEmoji').textContent  = emoji;
  document.getElementById('resultMsg').textContent    = msg;
  document.getElementById('scoreCorrect').textContent = correct;
  document.getElementById('scoreTotal').textContent   = total;

  const reviewInfo  = document.getElementById('resultReviewInfo');
  const reviewCount = document.getElementById('resultReviewCount');
  const cnt = state.reviewIds.size;
  if (cnt > 0) {
    let txt = `${cnt} 問が復習ボックスに入っています`;
    if (state.skipCount > 0) txt += `（スキップ ${state.skipCount} 問を含む）`;
    if (reviewCount) reviewCount.textContent = txt;
    reviewInfo?.classList.remove('hidden');
  } else {
    reviewInfo?.classList.add('hidden');
  }

  const btns = document.getElementById('resultBtns');
  btns.innerHTML = '';
  if (isReview) {
    btns.appendChild(makeBtn('primary',   '⭐ もう一度（復習）', () => startQuiz()));
    btns.appendChild(makeBtn('secondary', 'トップへ',            () => goHome()));
  } else if (allDone) {
    if (cnt > 0) {
      btns.appendChild(makeBtn('primary', '⭐ 復習ボックスを解く', () => { setMode('review'); startQuiz(); }));
    }
    btns.appendChild(makeBtn('secondary', 'トップへ', () => goHome()));
  } else {
    btns.appendChild(makeBtn('primary',   '同じ問題をもう一度', () => replaySession()));
    btns.appendChild(makeBtn('secondary', '続けて新しい問題',   () => startQuiz()));
    btns.appendChild(makeBtn('secondary', 'トップへ',           () => goHome()));
  }

  showScreen('screenResult');
}

function makeBtn(type, label, onClick) {
  const btn = document.createElement('button');
  btn.className = type === 'primary' ? 'btn-primary' : 'btn-secondary';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function replaySession() {
  speechSynthesis.cancel();
  state.answered   = false;
  state.isSpeaking = false;

  if (state.selectedMode === 'master') {
    buildActiveQuestions();
    state.currentIndex     = 0;
    state.correctCount     = 0;
    state.skipCount        = 0;
    state.masterQueue      = shuffle([...state.activeQuestions]);
    state.masterDone       = new Set();
    state.sessionQuestions = state.masterQueue;
  } else {
    state.currentIndex     = 0;
    state.correctCount     = 0;
    state.skipCount        = 0;
    state.sessionQuestions = shuffle([...state.sessionQuestions]);
  }

  updateModeTag();
  updateHeaderScore();
  showScreen('screenQuiz');
  showQuestion();
}


/* ──────────────────────────────────────────
   § 19  進捗バー・スコア・モードタグ
────────────────────────────────────────── */
function updateProgress() {
  let current, total;
  if (state.selectedMode === 'master') {
    const all  = state.activeQuestions.length;
    const done = all - state.masterQueue.length;
    current = done + 1;
    total   = all;
  } else {
    current = state.currentIndex + 1;
    total   = state.sessionQuestions.length;
  }
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('qNum').textContent         = `Q${current}`;
  document.getElementById('progressText').textContent = `${current} / ${total}`;
  document.getElementById('progressFill').style.width = pct + '%';
}

function updateHeaderScore() {
  const answered = state.selectedMode === 'master'
    ? state.masterDone.size
    : state.currentIndex + (state.answered ? 1 : 0);
  document.getElementById('scoreCorrect').textContent = state.correctCount;
  document.getElementById('scoreTotal').textContent   = answered;
}

function updateModeTag() {
  const tag = document.getElementById('modeTag');
  if (tag) tag.textContent = MODE_LABEL[state.selectedMode] || '';
}


/* ──────────────────────────────────────────
   § 20  画面管理・ホームボタン
────────────────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('hidden', s.id !== id);
  });
  document.getElementById('headerScore')
    ?.classList.toggle('hidden', id !== 'screenQuiz');
}

function goHome() {
  speechSynthesis.cancel();
  state.isSpeaking = false;
  checkResumable();
  updateReviewBanner();
  updateSelectedCount();
  buildTopicList();
  syncCheckboxesToState();
  showScreen('screenStart');
}


/* ──────────────────────────────────────────
   § 21  音声読み上げ
────────────────────────────────────────── */
function speak() {
  if (!('speechSynthesis' in window)) return;
  const btn = document.getElementById('ttsBtn');

  if (state.isSpeaking) {
    speechSynthesis.cancel();
    state.isSpeaking = false;
    btn.classList.remove('speaking');
    return;
  }

  const q = getCurrentQ();
  if (!q) return;

  const tokens = splitLang(q.question);
  if (!tokens.length) return;

  state.isSpeaking = true;
  btn.classList.add('speaking');

  tokens.forEach((tok, i) => {
    const utt  = new SpeechSynthesisUtterance(tok.text);
    utt.lang   = tok.isEn ? 'en-US' : 'ja-JP';
    utt.rate   = tok.isEn ? 0.85 : 0.9;
    if (i === tokens.length - 1) {
      utt.onend = utt.onerror = () => {
        state.isSpeaking = false;
        btn.classList.remove('speaking');
      };
    }
    speechSynthesis.speak(utt);
  });
}

function splitLang(text) {
  if (!text) return [];
  const tokens = [];
  const re = /([A-Za-z0-9\s\-'.,?!:;/()\[\]&~@#$%^*_+=<>]+|[^\x00-\x7F]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[0].trim();
    if (!t) continue;
    tokens.push({ text: t, isEn: /^[\x00-\x7F]+$/.test(t) });
  }
  return tokens;
}


/* ──────────────────────────────────────────
   § 22  ユーティリティ
────────────────────────────────────────── */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function esc(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

function arrEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort(), sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
