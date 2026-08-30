// TTS + Whisper (in-browser) speech recognition helpers.
// English TTS prefers Cambridge Dictionary audio (US / UK) via
// /api/cambridge-audio, with browser speechSynthesis as fallback.
// STT uses @huggingface/transformers Whisper-tiny — no Web Speech API.

const EN_ACCENT_KEY = "twoTongues.enAccent";

export const EN_ACCENTS = [
  { code: "us", en: "American (US)", ar: "أمريكي", lang: "en-US" },
  { code: "uk", en: "British (UK)", ar: "بريطاني", lang: "en-GB" },
];

export function loadEnAccent() {
  try {
    const v = localStorage.getItem(EN_ACCENT_KEY);
    if (v === "us" || v === "uk") return v;
  } catch (_) {}
  return "us";
}

export function saveEnAccent(code) {
  try {
    if (code === "us" || code === "uk") localStorage.setItem(EN_ACCENT_KEY, code);
  } catch (_) {}
}

export function enAccentLang(code) {
  return code === "uk" ? "en-GB" : "en-US";
}

let _currentAudio = null;

function stopAllSpeech() {
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch (_) {}
  try {
    if (_currentAudio) {
      _currentAudio.pause();
      _currentAudio.src = "";
      _currentAudio = null;
    }
  } catch (_) {}
}

/** Fetch + play one Cambridge MP3 URL. Returns true if playback started. */
async function playCambridgeUrl(url) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) return false;
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("json") || ctype.includes("text/")) return false;
  const blob = await res.blob();
  if (!blob || blob.size < 500) return false;
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);
  _currentAudio = audio;
  const cleanup = () => {
    try { URL.revokeObjectURL(objectUrl); } catch (_) {}
  };
  audio.addEventListener("ended", cleanup, { once: true });
  audio.addEventListener("error", cleanup, { once: true });
  await new Promise((resolve, reject) => {
    let settled = false;
    const ok = () => { if (!settled) { settled = true; resolve(); } };
    const fail = () => { if (!settled) { settled = true; reject(new Error("audio error")); } };
    audio.addEventListener("canplay", ok);
    audio.addEventListener("error", fail);
    if (audio.readyState >= 2) ok();
    else audio.load();
    setTimeout(() => { if (!settled) { settled = true; reject(new Error("timeout")); } }, 10000);
  });
  await audio.play();
  return true;
}

/** Play Cambridge MP3 for an English word/phrase. Returns true if playback started. */
export async function playCambridgeAudio(text, accent) {
  if (!text || typeof window === "undefined") return false;
  const word = String(text).trim();
  if (!word || /[\u0600-\u06FF]/.test(word)) return false;
  const acc = accent === "uk" ? "uk" : "us";
  // Full phrase first (API maps spaces → hyphens). Also try explicit hyphen form.
  const candidates = [word];
  const hyphenated = word.replace(/\s+/g, "-").replace(/-+/g, "-");
  if (hyphenated !== word) candidates.push(hyphenated);

  stopAllSpeech();
  for (const q of candidates) {
    const url =
      "/api/cambridge-audio?word=" +
      encodeURIComponent(q) +
      "&accent=" +
      encodeURIComponent(acc);
    try {
      if (await playCambridgeUrl(url)) return true;
    } catch (_) {
      /* try next candidate */
    }
  }
  return false;
}

function speakBrowser(text, lang) {
  if (!text || typeof window === "undefined" || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = lang || "en-US";
    u.rate = 0.95;
    try {
      const voices = window.speechSynthesis.getVoices() || [];
      const want = (lang || "").toLowerCase();
      const match =
        voices.find((v) => (v.lang || "").toLowerCase() === want) ||
        voices.find((v) => (v.lang || "").toLowerCase().startsWith(want.split("-")[0]));
      if (match) u.voice = match;
    } catch (_) {}
    window.speechSynthesis.speak(u);
  } catch (_) {}
}

/**
 * Speak a word.
 * @param {string} text
 * @param {"ltr"|"rtl"|string} dir
 * @param {{ accent?: "us"|"uk" }} [opts]  force US/UK for English (overrides saved preference)
 */
export function speakWord(text, dir, opts = {}) {
  if (!text) return;
  const isRtl = dir === "rtl" || /[\u0600-\u06FF]/.test(String(text));
  if (isRtl) {
    stopAllSpeech();
    speakBrowser(text, loadArDialect());
    return;
  }
  const accent = opts.accent === "uk" || opts.accent === "us" ? opts.accent : loadEnAccent();
  const lang = enAccentLang(accent);
  (async () => {
    const ok = await playCambridgeAudio(text, accent);
    if (!ok) speakBrowser(text, lang);
  })();
}

/**
 * Feature detection for speech input.
 * Prefer Web Speech API when available; otherwise mic + AudioContext (Whisper).
 * Name kept for call sites that check `!!getSpeechRecognitionCtor()`.
 */
export function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  const web = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  if (web) return web;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
      (window.AudioContext || window.webkitAudioContext)) {
    return true;
  }
  return null;
}

const DIALECT_KEY = "twoTongues.arDialect";

export const AR_DIALECTS = [
  { code: "ar-EG", en: "Egyptian", ar: "مصري" },
  { code: "ar-SA", en: "Saudi", ar: "سعودي" },
  { code: "ar-AE", en: "Emirati", ar: "إماراتي" },
  { code: "ar-MA", en: "Moroccan", ar: "مغربي" },
  { code: "ar-LB", en: "Lebanese", ar: "لبناني" },
  { code: "ar", en: "Modern Standard", ar: "فصحى" },
];

export function loadArDialect() {
  try {
    const v = localStorage.getItem(DIALECT_KEY);
    if (v && AR_DIALECTS.some((d) => d.code === v)) return v;
  } catch (_) {}
  return "ar-EG";
}

export function saveArDialect(code) {
  try {
    localStorage.setItem(DIALECT_KEY, code);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Hybrid STT: Web Speech API (primary, works immediately) + Whisper (fallback)
// ---------------------------------------------------------------------------

function webSpeechCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function applyWordGrammar(rec, hintWord) {
  try {
    const GrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
    if (!GrammarList || !hintWord) return;
    const word = String(hintWord).trim().replace(/[;<>|\\]/g, "");
    if (!word || word.length > 40) return;
    const list = new GrammarList();
    list.addFromString("#JSGF V1.0; grammar word; public <word> = " + word + " ;", 1);
    rec.grammars = list;
  } catch (_) {}
}

/** One Web Speech pass — returns transcript or "". */
function recognizeWebSpeechOnce(lang, { onStart, timeoutMs = 7000, hintWord = "" } = {}) {
  return new Promise((resolve) => {
    const Ctor = webSpeechCtor();
    if (!Ctor) {
      resolve("");
      return;
    }
    const rec = new Ctor();
    rec.lang = lang || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 10;
    applyWordGrammar(rec, hintWord);

    let settled = false;
    /** @type {{ text: string, conf: number }[]} */
    const candidates = [];
    let silenceTimer = null;
    let hardTimer = null;

    function addCandidate(text, conf) {
      const t = String(text || "").trim();
      if (!t) return;
      candidates.push({
        text: t,
        conf: typeof conf === "number" ? conf : 0.4,
      });
    }

    /** Prefer the alternative closest to the target word, not the engine's top guess. */
    function pickBest() {
      if (!candidates.length) return "";
      const hint = String(hintWord || "").trim();
      if (!hint) {
        // Highest confidence, then longest
        candidates.sort((a, b) => b.conf - a.conf || b.text.length - a.text.length);
        return candidates[0].text;
      }
      let bestText = candidates[0].text;
      let bestScore = -1;
      let bestConf = -1;
      for (const c of candidates) {
        // Score whole phrase and each token
        let s = similarityScore(hint, c.text);
        const tokens = normalizeSpoken(c.text).split(/\s+/).filter(Boolean);
        for (const tok of tokens) {
          s = Math.max(s, similarityScore(hint, tok));
        }
        if (s > bestScore || (s === bestScore && c.conf > bestConf)) {
          bestScore = s;
          bestConf = c.conf;
          // Prefer the single best token if it's a better match than the full phrase
          let chosen = c.text;
          if (tokens.length > 1) {
            let tokBest = tokens[0];
            let tokScore = similarityScore(hint, tokBest);
            for (const tok of tokens) {
              const ts = similarityScore(hint, tok);
              if (ts > tokScore) {
                tokScore = ts;
                tokBest = tok;
              }
            }
            if (tokScore >= s - 2) chosen = tokBest;
          }
          bestText = chosen;
        }
      }
      return bestText;
    }

    function finish() {
      if (settled) return;
      settled = true;
      try { clearTimeout(silenceTimer); } catch (_) {}
      try { clearTimeout(hardTimer); } catch (_) {}
      try { rec.onstart = rec.onresult = rec.onerror = rec.onend = null; } catch (_) {}
      try { rec.abort(); } catch (_) {
        try { rec.stop(); } catch (_) {}
      }
      resolve(pickBest());
    }

    rec.onstart = () => {
      if (onStart) onStart();
      hardTimer = setTimeout(finish, timeoutMs);
    };
    rec.onspeechend = () => {
      try { clearTimeout(silenceTimer); } catch (_) {}
      silenceTimer = setTimeout(finish, 700);
    };
    rec.onresult = (e) => {
      try {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (!result) continue;
          for (let j = 0; j < result.length; j++) {
            const alt = result[j];
            if (!alt) continue;
            addCandidate(alt.transcript, alt.confidence);
          }
          if (result.isFinal) {
            try { clearTimeout(silenceTimer); } catch (_) {}
            // Brief wait for any late alternatives
            silenceTimer = setTimeout(finish, 280);
            return;
          }
        }
        if (candidates.length) {
          try { clearTimeout(silenceTimer); } catch (_) {}
          silenceTimer = setTimeout(finish, 900);
        }
      } catch (_) {}
    };
    rec.onerror = () => finish();
    rec.onend = () => finish();
    try {
      rec.start();
    } catch (_) {
      resolve("");
    }
  });
}

async function recognizeWithWebSpeech(lang, { onStart, timeoutMs = 7000, hintWord = "", maxAttempts = 2 } = {}) {
  if (!webSpeechCtor()) return "";
  let notified = false;
  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 200));
    const text = await recognizeWebSpeechOnce(lang, {
      onStart: !notified
        ? () => {
            notified = true;
            if (onStart) onStart();
          }
        : undefined,
      timeoutMs,
      hintWord,
    });
    if (text) return text;
  }
  return "";
}

// --- Whisper (optional fallback) ---

let _whisperPipe = null;
let _whisperLoading = null;
let _whisperFailed = false;

function whisperLangFrom(lang) {
  const s = String(lang || "").toLowerCase();
  if (s.startsWith("ar")) return "arabic";
  if (s.startsWith("en")) return "english";
  return "english";
}

export async function loadWhisperPipeline(onProgress) {
  if (_whisperFailed) throw new Error("whisper unavailable");
  if (_whisperPipe) return _whisperPipe;
  if (_whisperLoading) return _whisperLoading;

  _whisperLoading = (async () => {
    const mod = await import("@huggingface/transformers");
    const { pipeline, env } = mod;
    try {
      env.allowLocalModels = false;
      env.useBrowserCache = true;
    } catch (_) {}
    const pipe = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      {
        dtype: "q8",
        progress_callback: typeof onProgress === "function" ? onProgress : undefined,
      }
    );
    _whisperPipe = pipe;
    return pipe;
  })();

  try {
    return await _whisperLoading;
  } catch (err) {
    _whisperLoading = null;
    _whisperFailed = true;
    throw err;
  }
}

/** Capture mono PCM and resample to 16 kHz (no MediaRecorder — more reliable). */
function capturePcm16k({ durationMs = 2800, onStart, onLevel } = {}) {
  return new Promise(async (resolve, reject) => {
    let stream = null;
    let ctx = null;
    let processor = null;
    let raf = null;
    const chunks = [];
    let settled = false;

    function cleanup() {
      try { if (raf) cancelAnimationFrame(raf); } catch (_) {}
      try {
        if (processor) {
          processor.onaudioprocess = null;
          processor.disconnect();
        }
      } catch (_) {}
      try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { if (ctx && ctx.state !== "closed") ctx.close(); } catch (_) {}
    }

    function done(audio) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(audio);
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      ctx = new Ctx();
      if (ctx.state === "suspended") {
        try { await ctx.resume(); } catch (_) {}
      }
      const src = ctx.createMediaStreamSource(stream);

      if (onLevel) {
        try {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            if (settled) return;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) sum += data[i];
            onLevel(Math.min(1, sum / (data.length * 128)));
            raf = requestAnimationFrame(tick);
          };
          tick();
        } catch (_) {}
      }

      const bufferSize = 4096;
      processor = ctx.createScriptProcessor(bufferSize, 1, 1);
      processor.onaudioprocess = (e) => {
        if (settled) return;
        const input = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
      };
      src.connect(processor);
      // Silent output so the processor actually runs without feedback
      const mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(ctx.destination);

      if (onStart) onStart();

      setTimeout(() => {
        try {
          // Merge
          let total = 0;
          for (const c of chunks) total += c.length;
          const merged = new Float32Array(total);
          let off = 0;
          for (const c of chunks) {
            merged.set(c, off);
            off += c.length;
          }
          // Resample to 16 kHz
          const srcRate = ctx.sampleRate || 44100;
          const targetRate = 16000;
          let out = merged;
          if (srcRate !== targetRate && total > 0) {
            const newLen = Math.max(1, Math.round(total * (targetRate / srcRate)));
            out = new Float32Array(newLen);
            const ratio = total / newLen;
            for (let i = 0; i < newLen; i++) {
              const x = i * ratio;
              const i0 = Math.floor(x);
              const i1 = Math.min(i0 + 1, total - 1);
              const t = x - i0;
              out[i] = merged[i0] * (1 - t) + merged[i1] * t;
            }
          }
          // Amplify quiet speech
          let peak = 0;
          for (let i = 0; i < out.length; i++) {
            const a = Math.abs(out[i]);
            if (a > peak) peak = a;
          }
          if (peak > 0.001 && peak < 0.2) {
            const gain = Math.min(5, 0.35 / peak);
            for (let i = 0; i < out.length; i++) {
              out[i] = Math.max(-1, Math.min(1, out[i] * gain));
            }
          }
          done(out);
        } catch (err) {
          fail(err);
        }
      }, Math.max(1200, durationMs));
    } catch (err) {
      fail(err);
    }
  });
}

function cleanWhisperText(raw) {
  let t = String(raw || "").trim();
  if (!t) return "";
  t = t
    .replace(/\[.*?\]/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/\{.*?\}/g, " ");
  t = t.replace(/\b(blank_audio|music|silence|applause|laughter|inaudible)\b/gi, " ");
  t = t.replace(/^[\s"'«»]+|[\s"'«»]+$/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return "";
  return t;
}

async function recognizeWithWhisper(lang, { onStart, onLevel, onProgress, durationMs = 2800 } = {}) {
  if (_whisperFailed) return "";
  let pipe;
  try {
    pipe = await loadWhisperPipeline(onProgress);
  } catch (_) {
    return "";
  }
  let audio;
  try {
    audio = await capturePcm16k({ durationMs, onStart, onLevel });
  } catch (_) {
    return "";
  }
  if (!audio || audio.length < 1600) return ""; // < ~0.1s at 16k
  try {
    const result = await pipe(audio, {
      language: whisperLangFrom(lang),
      task: "transcribe",
      return_timestamps: false,
    });
    const text = typeof result === "string"
      ? result
      : (result && (result.text || result.output || "")) || "";
    return cleanWhisperText(text);
  } catch (_) {
    return "";
  }
}

/**
 * Capture one spoken phrase.
 * Web Speech first (fast). If we know the target word and the match is weak,
 * also try Whisper and keep whichever is closer to the target.
 */
export async function recognizeSpeech(lang, {
  onStart,
  onLevel,
  onProgress,
  durationMs = 2800,
  hintWord = "",
} = {}) {
  if (!getSpeechRecognitionCtor()) {
    throw new Error("Speech recognition not supported");
  }

  let notified = false;
  const markStart = () => {
    if (!notified) {
      notified = true;
      if (onStart) onStart();
    }
  };

  let webText = "";
  try {
    webText = await recognizeWithWebSpeech(lang, {
      onStart: markStart,
      timeoutMs: Math.max(5000, durationMs),
      hintWord,
      maxAttempts: 2,
    });
  } catch (_) {}

  const hint = String(hintWord || "").trim();
  const webScore = hint && webText ? similarityScore(hint, webText) : (webText ? 50 : 0);

  // Strong match from Web Speech — no need for Whisper
  if (webText && webScore >= 80) return webText;

  // Weak/empty → try Whisper and pick the better match to the target
  let whisperText = "";
  try {
    whisperText = await recognizeWithWhisper(lang, {
      onStart: markStart,
      onLevel,
      onProgress,
      durationMs,
    });
  } catch (_) {}

  if (!webText && !whisperText) return "";
  if (!hint) return webText || whisperText;

  const wScore = whisperText ? similarityScore(hint, whisperText) : -1;
  if (wScore > webScore) return whisperText;
  if (webText) return webText;
  return whisperText || "";
}

function pickBestHeardToken(expected, heardRaw) {
  const target = normalizeSpoken(expected);
  const full = normalizeSpoken(heardRaw);
  if (!full) return { heard: "", score: 0, raw: heardRaw };

  const targetIsSingle = !target.includes(" ");
  if (targetIsSingle && full.includes(" ")) {
    const tokens = full.split(/\s+/).filter(Boolean);
    let bestTok = tokens[0] || full;
    let bestScore = similarityScore(target, bestTok);
    for (const tok of tokens) {
      const s = similarityScore(target, tok);
      if (s > bestScore) {
        bestScore = s;
        bestTok = tok;
      }
    }
    const fullScore = similarityScore(target, full);
    if (fullScore > bestScore) {
      return { heard: heardRaw.trim(), score: fullScore, raw: heardRaw };
    }
    return { heard: bestTok, score: bestScore, raw: heardRaw };
  }

  return {
    heard: heardRaw.trim(),
    score: similarityScore(target, full),
    raw: heardRaw,
  };
}

/**
 * Score spoken pronunciation against expected word.
 * Uses hybrid STT (Web Speech → Whisper).
 */
export async function scorePronunciation(expected, lang, onListening, onProgress, onLevel) {
  const target = String(expected || "").trim();
  const heardRaw = await recognizeSpeech(lang || "en-US", {
    onStart: onListening,
    onProgress,
    onLevel,
    durationMs: 2800,
    hintWord: target,
  });
  if (!heardRaw) {
    return {
      score: 0,
      heard: "",
      transcript: "",
      raw: "",
      passed: false,
      empty: true,
    };
  }
  const { heard, score, raw } = pickBestHeardToken(target, heardRaw);
  const passed = score >= 62;
  return {
    score,
    heard,
    transcript: heard,
    raw: raw || heardRaw,
    passed,
    empty: false,
  };
}

function normalizeSpoken(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    // Latin + Arabic combining marks
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, "")
    // Arabic letter variants
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/گ/g, "ك")
    .replace(/پ/g, "ب")
    // Common English ASR confusions / filler
    .replace(/\b(uh|um|ah|er|the|a|an)\b/g, " ")
    .replace(/[''`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapse doubled letters so "bookk" ≈ "book" for scoring softness */
function collapseDoubles(s) {
  return String(s || "").replace(/(.)\1+/g, "$1");
}

/** Lightweight phonetic fold for English (helps letter discrimination) */
function phoneticFold(s) {
  let t = collapseDoubles(s);
  t = t
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kw")
    .replace(/x/g, "ks")
    .replace(/tion/g, "shun")
    .replace(/sion/g, "zhun")
    .replace(/ough/g, "o")
    .replace(/igh/g, "i")
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/([aeiou])\1+/g, "$1");
  return t;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarityScore(expected, heard) {
  const a0 = normalizeSpoken(expected);
  const b0 = normalizeSpoken(heard);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 100;

  // Exact after collapse
  const a1 = collapseDoubles(a0);
  const b1 = collapseDoubles(b0);
  if (a1 === b1) return 98;

  // Phonetic fold
  const a2 = phoneticFold(a0);
  const b2 = phoneticFold(b0);
  if (a2 === b2) return 94;

  // Token containment (multi-word targets)
  if (a0.includes(b0) || b0.includes(a0)) {
    const ratio = Math.min(a0.length, b0.length) / Math.max(a0.length, b0.length);
    return Math.round(70 + ratio * 28);
  }

  const maxLen = Math.max(a0.length, b0.length);
  const dist = levenshtein(a0, b0);
  let score = Math.max(0, Math.round((1 - dist / maxLen) * 100));

  // Bonus if first/last letter match (letter discrimination feedback)
  if (a0[0] === b0[0]) score = Math.min(100, score + 4);
  if (a0[a0.length - 1] === b0[b0.length - 1]) score = Math.min(100, score + 3);

  // Phonetic distance as soft boost
  const pMax = Math.max(a2.length, b2.length) || 1;
  const pDist = levenshtein(a2, b2);
  const pScore = Math.max(0, Math.round((1 - pDist / pMax) * 100));
  score = Math.max(score, Math.round(score * 0.55 + pScore * 0.45));

  return Math.max(0, Math.min(100, score));
}

/** Mic level meter via getUserMedia + AnalyserNode. Returns stop function. */
export function startMicLevelMeter(onLevel) {
  let stopped = false;
  let stream = null;
  let ctx = null;
  let raf = null;

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Prefer pickup of quiet speech for the level meter visualization.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (stopped) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const level = Math.min(1, sum / (data.length * 128));
        if (onLevel) onLevel(level);
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (_) {
      if (onLevel) onLevel(0);
    }
  })();

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    try {
      if (stream) stream.getTracks().forEach((t) => t.stop());
    } catch (_) {}
    try {
      if (ctx) ctx.close();
    } catch (_) {}
  };
}

/** Record microphone audio with MediaRecorder. Returns { stop, promise }. */
export function startVoiceRecording() {
  let mediaRecorder = null;
  let stream = null;
  const chunks = [];
  let resolveFn = null;
  let rejectFn = null;
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const ready = (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch (_) {}
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        resolveFn({ blob, url, mimeType: blob.type });
      };
      mediaRecorder.onerror = (e) => rejectFn(e.error || new Error("record failed"));
      mediaRecorder.start();
    } catch (err) {
      rejectFn(err);
    }
  })();

  return {
    ready,
    stop: async () => {
      await ready;
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      } else {
        try {
          if (stream) stream.getTracks().forEach((t) => t.stop());
        } catch (_) {}
        rejectFn(new Error("not recording"));
      }
      return promise;
    },
    cancel: () => {
      try {
        if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      } catch (_) {}
      try {
        if (stream) stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    },
  };
}
