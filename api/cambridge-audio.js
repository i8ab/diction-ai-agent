// /api/cambridge-audio — proxy Cambridge Dictionary US / UK pronunciation MP3s.
//
// GET /api/cambridge-audio?word=hello&accent=us|uk

import { beginApi, handleOptions, applyRateLimitHeaders } from "../lib/apiBootstrap.js";
import { rateLimit, clientIp } from "../lib/rateLimit.js";

function normalizeWord(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s'\-]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSlug(word) {
  return word
    .replace(/'/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function extractAudioUrl(html, accent) {
  if (!html) return null;
  const needle = accent === "uk" ? "uk_pron" : "us_pron";
  const reData = new RegExp(
    `data-src-mp3="(https://dictionary\\.cambridge\\.org/media/english/${needle}[^"]+\\.mp3)"`,
    "i"
  );
  let m = html.match(reData);
  if (m) return m[1];

  const reSrc = new RegExp(
    `src="(https://dictionary\\.cambridge\\.org/media/english/${needle}[^"]+\\.mp3)"`,
    "i"
  );
  m = html.match(reSrc);
  if (m) return m[1];

  const reRel = new RegExp(
    `(?:data-src-mp3|src)="(/media/english/${needle}[^"]+\\.mp3)"`,
    "i"
  );
  m = html.match(reRel);
  if (m) return `https://dictionary.cambridge.org${m[1]}`;

  return null;
}

export default async function handler(req, res) {
  const { rid } = beginApi(req, res);
  if (handleOptions(req, res)) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "method_not_allowed", requestId: rid });
  }

  const ip = clientIp(req);
  const rl = await rateLimit(`cambridge:${ip}`, { limit: 90, windowMs: 60_000 });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({ ok: false, error: "rate_limited", requestId: rid });
  }

  const word = normalizeWord(req.query.word);
  const accentRaw = String(req.query.accent || "us").toLowerCase();
  const accent = accentRaw === "uk" || accentRaw === "gb" || accentRaw === "br" ? "uk" : "us";

  if (!word) {
    return res.status(400).json({ ok: false, error: "Missing word", requestId: rid });
  }

  // Full phrase first (spaces → hyphens). Fall back to first token if needed.
  // Fixes multi-word ("ice cream") and hyphenated ("ice-cream", "look-up") terms
  // that previously only requested the first word.
  const fullSlug = toSlug(word).slice(0, 80);
  const firstSlug = toSlug(word.split(/\s+/)[0] || "").slice(0, 64);
  if (!fullSlug) {
    return res.status(400).json({ ok: false, error: "Invalid word", requestId: rid });
  }

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  async function fetchCambridgePage(slug) {
    const pageUrl = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(slug)}`;
    const pageRes = await fetch(pageUrl, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://dictionary.cambridge.org/",
      },
      redirect: "follow",
    });
    if (!pageRes.ok) return { ok: false, status: pageRes.status, html: null, pageUrl };
    const html = await pageRes.text();
    return { ok: true, status: pageRes.status, html, pageUrl };
  }

  try {
    let page = await fetchCambridgePage(fullSlug);
    if ((!page.ok || !page.html) && firstSlug && firstSlug !== fullSlug) {
      page = await fetchCambridgePage(firstSlug);
    }

    if (!page.ok || !page.html) {
      return res.status(404).json({
        ok: false,
        error: "Word not found on Cambridge",
        status: page.status || 404,
        requestId: rid,
      });
    }

    const html = page.html;
    const pageUrl = page.pageUrl;
    let audioUrl = extractAudioUrl(html, accent);
    if (!audioUrl) {
      audioUrl = extractAudioUrl(html, accent === "us" ? "uk" : "us");
    }
    // Last resort: headword-only audio for compounds
    if (!audioUrl && firstSlug && firstSlug !== fullSlug) {
      const fallback = await fetchCambridgePage(firstSlug);
      if (fallback.ok && fallback.html) {
        audioUrl =
          extractAudioUrl(fallback.html, accent) ||
          extractAudioUrl(fallback.html, accent === "us" ? "uk" : "us");
      }
    }
    if (!audioUrl) {
      return res.status(404).json({
        ok: false,
        error: "No pronunciation audio for this word",
        requestId: rid,
      });
    }

    const audioRes = await fetch(audioUrl, {
      headers: {
        "User-Agent": ua,
        Referer: pageUrl,
        Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.5",
      },
    });

    if (!audioRes.ok) {
      return res.status(502).json({
        ok: false,
        error: "Failed to fetch Cambridge audio",
        status: audioRes.status,
        requestId: rid,
      });
    }

    const buf = Buffer.from(await audioRes.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    res.setHeader("X-Cambridge-Accent", accent);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "Cambridge audio proxy error",
      message: String((e && e.message) || e),
      requestId: rid,
    });
  }
}
