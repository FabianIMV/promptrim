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
  if (state.aiMode) apiKeyInput.focus();
});

apiKeyInput.addEventListener('input', () => {
  state.apiKey = apiKeyInput.value.trim();
});

// ─── Input listener ───────────────────────────────────────────────────────────
inputArea.addEventListener('input', () => {
  updateInTokens();
  hideError();
  hideSavings();
});

// ─── Rule-based compression patterns ──────────────────────────────────────────

// Filler phrases to remove entirely (applied at all levels)
const FILLERS_BASIC = [
  /\b(please|kindly)\b\s*/gi,
  /\b(i would like you to|i want you to|could you please|can you please|i need you to)\b\s*/gi,
  /\b(feel free to)\b\s*/gi,
  /\b(your task is to|your job is to|your role is to)\b\s*/gi,
  /\b(as an? (ai|assistant|language model|llm),?)\b\s*/gi,
];

const FILLERS_EXTENDED = [
  /\b(very|really|extremely|quite|rather|fairly|somewhat|totally|absolutely|definitely|certainly)\b\s*/gi,
  /\b(essentially|basically|generally|typically|usually|normally|always|often)\b\s*/gi,
  /\b(in order to)\b/gi,
  /\b(so as to)\b/gi,
  /\b(for the purpose of)\b/gi,
  /\b(with the aim of|with the goal of)\b/gi,
  /\b(it is important to note that|it should be noted that|please note that)\b\s*/gi,
  /\b(note that|keep in mind that|bear in mind that)\b\s*/gi,
  /\b(as (you|we) (both )?know,?)\b\s*/gi,
  /\b(make sure to|ensure that|be sure to)\b\s*/gi,
  /\b(in a (clear|concise|detailed|comprehensive|thorough|structured) (manner|way|format))\b/gi,
];

// Verbose → concise word substitutions
const WORD_SUBS = [
  [/\butilize\b/gi, 'use'],
  [/\butilization\b/gi, 'use'],
  [/\bdemonstrate\b/gi, 'show'],
  [/\bcommence\b/gi, 'start'],
  [/\binitiate\b/gi, 'start'],
  [/\bsubsequently\b/gi, 'then'],
  [/\bpreviously\b/gi, 'before'],
  [/\bcurrently\b/gi, 'now'],
  [/\bprovide assistance\b/gi, 'help'],
  [/\bin the event that\b/gi, 'if'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bfor the reason that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat the present time\b/gi, 'now'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bwith respect to\b/gi, 'about'],
  [/\bin regard to\b/gi, 'about'],
  [/\bpertaining to\b/gi, 'about'],
  [/\bin addition to\b/gi, 'besides'],
  [/\ba large number of\b/gi, 'many'],
  [/\ba significant number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bdespite the fact that\b/gi, 'although'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bis able to\b/gi, 'can'],
  [/\bwill be able to\b/gi, 'can'],
  [/\bmake use of\b/gi, 'use'],
  [/\btake into consideration\b/gi, 'consider'],
  [/\btake into account\b/gi, 'consider'],
  [/\bgive consideration to\b/gi, 'consider'],
];

// Structural phrase rewrites
const STRUCTURAL = [
  [/write me an?\b/gi, 'Write'],
  [/i would like\b/gi, ''],
  [/could you\b/gi, ''],
  [/\bi need you? to\b/gi, ''],
  [/\bplease help me (to )?\b/gi, ''],
  [/\byour (task|job|goal) is to\b\s*/gi, ''],
  [/\bcan you\b/gi, ''],
  [/\bwould you\b/gi, ''],
  // Verbose opening patterns
  [/^(In this task,?\s*)/gim, ''],
  [/^(For this (task|request|assignment),?\s*)/gim, ''],
  [/^(As an (AI|assistant|language model),?\s*)/gim, ''],
  // "The following is" → nothing
  [/\bthe following is (a |an )?\b/gi, ''],
  [/\bthe following are\b/gi, ''],
  // "You are tasked with" → ""
  [/\byou are (tasked|asked|requested|required) (to |with )/gi, ''],
  // Double spaces / newlines
  [/ {2,}/g, ' '],
  [/\n{3,}/g, '\n\n'],
];

// Aggressive-only patterns
const AGGRESSIVE_EXTRA = [
  // Remove hedging
  [/\b(I think|I believe|I feel|I suppose|in my opinion|from my perspective),?\s*/gi, ''],
  [/\b(if possible|if you can|if you are able to),?\s*/gi, ''],
  [/\b(at your (earliest )?convenience)\b,?\s*/gi, ''],
  // Shorten verbose adjective chains
  [/\b(comprehensive|thorough|complete|extensive|detailed|in-depth)\s+(and\s+(thorough|complete|detailed|comprehensive))?\s+/gi, ''],
  // "step by step" → ""  (instruction redundancy)
  [/\bstep[- ]by[- ]step\s*/gi, ''],
  // Remove trailing "Thank you" / "Thanks"
  [/\n?(Thanks?\.?|Thank you\.?)\s*$/gi, ''],
];

function applyPatterns(text, patterns) {
  let out = text;
  for (const p of patterns) {
    if (Array.isArray(p)) {
      out = out.replace(p[0], p[1]);
    } else {
      out = out.replace(p, '');
    }
  }
  return out;
}

function ruleCompress(text, level) {
  let out = text.trim();

  if (level === 'light') {
    out = applyPatterns(out, FILLERS_BASIC);
  } else if (level === 'balanced') {
    out = applyPatterns(out, FILLERS_BASIC);
    out = applyPatterns(out, FILLERS_EXTENDED);
    out = applyPatterns(out, WORD_SUBS);
    out = applyPatterns(out, STRUCTURAL);
  } else {
    // Aggressive
    out = applyPatterns(out, FILLERS_BASIC);
    out = applyPatterns(out, FILLERS_EXTENDED);
    out = applyPatterns(out, WORD_SUBS);
    out = applyPatterns(out, STRUCTURAL);
    out = applyPatterns(out, AGGRESSIVE_EXTRA);

    // Remove duplicate sentences
    const sentences = out.split(/(?<=[.!?])\s+/);
    const seen = new Set();
    out = sentences.filter(s => {
      const key = s.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(' ');
  }

  // Always clean trailing/leading whitespace and normalize spaces
  out = out.replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  // Capitalize first letter if it got lowercased by a removal
  if (out.length > 0) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }

  return out;
}

// ─── AI compression via Gemini API ────────────────────────────────────────────
const SYSTEM_PROMPTS = {
  light: 'Rewrite this AI prompt more concisely. Remove filler words and minor redundancies. Keep all details and examples. Output only the rewritten prompt, nothing else.',
  balanced: 'Compress this AI prompt to save tokens. Remove filler words, redundant phrasing, and verbose language. Preserve all key requirements, constraints, and context. Output only the compressed prompt, nothing else.',
  aggressive: 'Aggressively compress this AI prompt to the minimum tokens needed. Remove everything non-essential: pleasantries, filler words, verbose phrasing, redundant context. Keep only the core task, key constraints, and critical context. Output only the compressed prompt, nothing else — no preamble, no explanation.',
};

async function aiCompress(text, level, apiKey) {
  const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPTS[level] }] },
      generationConfig: { maxOutputTokens: 2048 },
      contents: [{ role: 'user', parts: [{ text }] }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${resp.status}`);
  }

  const data = await resp.json();
  const blockedReason = data?.promptFeedback?.blockReason;
  if (blockedReason) {
    const blockedMsg = data?.promptFeedback?.blockReasonMessage;
    throw new Error(blockedMsg || `Gemini blocked the request (${blockedReason}).`);
  }
  const firstCandidate = data.candidates?.[0];
  const output = firstCandidate?.content?.parts?.map(p => p?.text || '').join('').trim();
  if (!output) {
    const finishReason = firstCandidate?.finishReason;
    if (finishReason) throw new Error(`Gemini did not return text (finish reason: ${finishReason}).`);
    throw new Error('Gemini returned no text. Check your key, prompt content, and model availability.');
  }
  return output;
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
  outTokens.classList.remove('improved');
  updateOutTokens();

  if (state.aiMode && !state.apiKey) {
    showError('Enter your Gemini API key above, or uncheck "AI-powered" to use fast mode.');
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

    if (outTok < inTok) {
      showSavings(inTok, outTok);
    } else {
      // Prompt was already concise — still show the result but inform user
      showError('This prompt is already concise — minimal savings in Fast mode. Try AI mode or Aggressive level for more compression.');
    }

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
