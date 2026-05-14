'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  level: 'balanced',
  aiMode: false,
  apiKey: '',
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const inputArea    = document.getElementById('inputArea');
const outputArea   = document.getElementById('outputArea');
const inTokens     = document.getElementById('inTokens');
const outTokens    = document.getElementById('outTokens');
const compressBtn  = document.getElementById('compressBtn');
const copyBtn      = document.getElementById('copyBtn');
const clearBtn     = document.getElementById('clearBtn');
const errorMsg     = document.getElementById('errorMsg');
const savingsBar   = document.getElementById('savingsBar');
const savePct      = document.getElementById('savePct');
const saveTokens   = document.getElementById('saveTokens');
const saveCost     = document.getElementById('saveCost');
const apiToggle    = document.getElementById('apiToggle');
const apiKeyWrap   = document.getElementById('apiKeyWrap');
const apiKeyInput  = document.getElementById('apiKeyInput');
const copySuccess  = document.getElementById('copySuccess');

// ─── Token estimation (1 token ≈ 4 chars for English) ─────────────────────────
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

function updateInTokens() {
  const n = estimateTokens(inputArea.value || ' ');
  inTokens.textContent = `${n.toLocaleString()} tokens`;
}

function updateOutTokens() {
  const text = outputArea.value;
  if (!text) { outTokens.textContent = '0 tokens'; return; }
  const n = estimateTokens(text);
  outTokens.textContent = `${n.toLocaleString()} tokens`;
  outTokens.classList.add('improved');
}

// ─── Level buttons ────────────────────────────────────────────────────────────
document.querySelectorAll('.level-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.level = btn.dataset.level;
  });
});

// ─── API toggle ───────────────────────────────────────────────────────────────
apiToggle.addEventListener('change', () => {
  state.aiMode = apiToggle.checked;
  apiKeyWrap.classList.toggle('visible', state.aiMode);
  if (state.aiMode) {
    const saved = localStorage.getItem('prompttrim_apikey');
    if (saved) apiKeyInput.value = saved;
    apiKeyInput.focus();
  }
});

apiKeyInput.addEventListener('input', () => {
  state.apiKey = apiKeyInput.value.trim();
  if (state.apiKey.startsWith('sk-ant-')) {
    localStorage.setItem('prompttrim_apikey', state.apiKey);
  }
});

// Load saved key
window.addEventListener('load', () => {
  const saved = localStorage.getItem('prompttrim_apikey');
  if (saved) { apiKeyInput.value = saved; state.apiKey = saved; }
});

// ─── Input listener ───────────────────────────────────────────────────────────
inputArea.addEventListener('input', () => {
  updateInTokens();
  hideError();
  hideSavings();
});

// ─── Fast (rule-based) compression ────────────────────────────────────────────
const FILLERS = [
  // Opening fluff
  /\b(please|kindly|i would like you to|i want you to|could you please|can you please|i need you to|feel free to)\b/gi,
  // Meta-instructions
  /\b(your task is to|your job is to|your role is to|as an? (ai|assistant|language model|llm),?)\b/gi,
  // Padding adverbs/adjectives
  /\b(very|really|extremely|quite|rather|fairly|somewhat|totally|absolutely|definitely|certainly|essentially|basically|generally|typically|usually|normally|always|often)\b/gi,
  // Verbose connectors
  /\b(in order to|so as to|for the purpose of|with the aim of|with the goal of)\b/gi,
  // Redundant phrases
  /\b(it is important to note that|it should be noted that|note that|please note that|keep in mind that|bear in mind that|as (you|we) know)\b/gi,
  // End padding
  /\b(make sure to|ensure that|be sure to)\b/gi,
  // Verbose structures
  /\b(in a (clear|concise|detailed|comprehensive|thorough|structured) (manner|way|format))\b/gi,
  /\b(provide (a |an )?(comprehensive|detailed|thorough|complete|extensive) (explanation|analysis|overview|description|summary|breakdown))\b/gi,
];

const VERBOSE_PATTERNS = [
  // "Write me a" → "Write a"
  [/write me a\b/gi, 'Write a'],
  [/write me an\b/gi, 'Write an'],
  // "I would like" → ""
  [/i would like\b/gi, ''],
  // "Could you" → ""
  [/could you\b/gi, ''],
  // Double spaces
  [/ {2,}/g, ' '],
  // Multiple newlines
  [/\n{3,}/g, '\n\n'],
];

function ruleCompress(text, level) {
  let out = text.trim();

  if (level === 'light') {
    // Only remove obvious fillers
    out = out.replace(FILLERS[0], '');
    out = out.replace(FILLERS[1], '');
  } else if (level === 'balanced') {
    FILLERS.forEach(r => { out = out.replace(r, ''); });
  } else {
    // Aggressive: fillers + verbose patterns + trim sentences
    FILLERS.forEach(r => { out = out.replace(r, ''); });
    VERBOSE_PATTERNS.forEach(([pat, rep]) => { out = out.replace(pat, rep); });
    // Remove repeated sentences
    const sentences = out.split(/(?<=[.!?])\s+/);
    const seen = new Set();
    const unique = sentences.filter(s => {
      const key = s.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    out = unique.join(' ');
  }

  // Always clean up extra whitespace
  out = out.replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

// ─── AI compression via Claude API ────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  light: 'Rewrite this AI prompt more concisely. Remove filler words and minor redundancies. Keep all details and examples. Output only the rewritten prompt.',
  balanced: 'Compress this AI prompt to save tokens. Remove filler words, redundant phrasing, and verbose language. Preserve all key requirements, constraints, and context. Output only the compressed prompt.',
  aggressive: 'Aggressively compress this AI prompt. Remove everything non-essential. Keep only the core intent, key constraints, and critical context. Output only the compressed prompt, no preamble.',
};

async function aiCompress(text, level, apiKey) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-allow-browser': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPTS[level],
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${resp.status}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

// ─── Show/hide savings ────────────────────────────────────────────────────────
function showSavings(inTok, outTok) {
  const saved = inTok - outTok;
  const pct = Math.round((saved / inTok) * 100);
  // GPT-4o input: ~$2.50 / 1M tokens
  const costSaved = ((saved / 1_000_000) * 2.50).toFixed(4);

  savePct.textContent = `${pct}%`;
  saveTokens.textContent = saved.toLocaleString();
  saveCost.textContent = `$${costSaved}`;
  savingsBar.classList.add('visible');
}

function hideSavings() {
  savingsBar.classList.remove('visible');
}

// ─── Error helpers ────────────────────────────────────────────────────────────
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.add('visible');
}

function hideError() {
  errorMsg.classList.remove('visible');
}

// ─── Main compress action ─────────────────────────────────────────────────────
compressBtn.addEventListener('click', async () => {
  const input = inputArea.value.trim();
  if (!input) { showError('Paste a prompt first.'); return; }

  hideError();
  hideSavings();
  outputArea.value = '';
  updateOutTokens();

  if (state.aiMode && !state.apiKey) {
    showError('Enter your Claude API key above, or uncheck "AI-powered" to use fast mode.');
    return;
  }

  // Loading state
  compressBtn.disabled = true;
  compressBtn.innerHTML = '<span class="spinner"></span> Compressing…';

  try {
    let result;
    if (state.aiMode) {
      result = await aiCompress(input, state.level, state.apiKey);
    } else {
      result = ruleCompress(input, state.level);
    }

    outputArea.value = result;
    updateOutTokens();

    const inTok = estimateTokens(input);
    const outTok = estimateTokens(result);
    if (outTok < inTok) showSavings(inTok, outTok);

  } catch (e) {
    showError(`Error: ${e.message}`);
  } finally {
    compressBtn.disabled = false;
    compressBtn.innerHTML = '<span>✂️</span> Compress Prompt';
  }
});

// ─── Copy ─────────────────────────────────────────────────────────────────────
copyBtn.addEventListener('click', async () => {
  const text = outputArea.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copySuccess.classList.add('show');
    setTimeout(() => copySuccess.classList.remove('show'), 2000);
  } catch {
    outputArea.select();
    document.execCommand('copy');
  }
});

// ─── Clear ────────────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  inputArea.value = '';
  outputArea.value = '';
  updateInTokens();
  updateOutTokens();
  hideError();
  hideSavings();
  outTokens.classList.remove('improved');
});

// ─── Init ─────────────────────────────────────────────────────────────────────
updateInTokens();
