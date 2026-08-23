import os
import json
import io
import time
import logging
from typing import List, Dict, Any

logger = logging.getLogger("diction.llm")
logging.basicConfig(level=logging.INFO)

# PDF extraction
try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

# LLM clients — using the current (non-deprecated) Google Gen AI SDK
from google import genai
from google.genai import types
from groq import Groq

# ====================== Config ======================
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

gemini_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


def _gemini_generate_with_retry(max_retries: int = 4, base_delay: float = 2.0, **kwargs):
    """Call gemini_client.models.generate_content with retry on transient errors
    (503 UNAVAILABLE / 429 rate limit / 500 internal) using exponential backoff."""
    last_err = None
    for attempt in range(max_retries):
        try:
            return gemini_client.models.generate_content(**kwargs)
        except Exception as e:
            status = getattr(e, "code", None) or getattr(e, "status_code", None)
            msg = str(e)
            transient = (
                status in (429, 500, 503)
                or "UNAVAILABLE" in msg
                or "RESOURCE_EXHAUSTED" in msg
                or "overloaded" in msg.lower()
                or "high demand" in msg.lower()
            )
            last_err = e
            if not transient or attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            logger.warning(
                "Gemini call failed (attempt %d/%d, transient=%s): %s — retrying in %.1fs",
                attempt + 1, max_retries, transient, msg, delay,
            )
            time.sleep(delay)
    raise last_err


def _extract_text(response) -> str:
    """Safely pull the final text out of a Gemini response, ignoring thinking parts."""
    text = (getattr(response, "text", None) or "").strip()
    if text:
        return text
    try:
        chunks = []
        for cand in response.candidates or []:
            for part in cand.content.parts or []:
                t = getattr(part, "text", None)
                if t and not getattr(part, "thought", False):
                    chunks.append(t)
        return "\n".join(chunks).strip()
    except Exception:
        return ""

# ====================== Prompt ======================
SYSTEM_PROMPT = """You are an expert English vocabulary extractor for school textbooks.

Your job:
1. Extract ONLY important vocabulary words that the textbook intends students to learn.
   - Look for: Key Words, Vocabulary lists, Words to learn, highlighted words, words with definitions,
     and simple "english = meaning" or "english - meaning" pair lists (very common in Egyptian revision
     books — these are ALL important and must ALL be extracted, one entry per pair, even with no
     definition/example/synonym available).
   - IGNORE common simple words, grammar words, and ordinary text.
   - It is fine, and expected, for "definition", "example", "synonyms", and "antonyms" to be empty
     when the source is just a word=meaning list — never skip a word just because those fields are missing.

2. For each word extract:
   - word (the English word)
   - meaning (ONE primary Arabic meaning - clear and short)
   - pos (part of speech — be extremely precise):
     Allowed values ONLY: noun, verb, adjective, adverb, preposition, conjunction,
     pronoun, interjection, phrase, other, unclassified.
     • Use the standard grammatical category when it is clear from context.
     • If the word is a multi-word expression or fixed collocation → "phrase".
     • If the word is foreign, a neologism, proper-name-like, ambiguous, or has no
       clear part of speech in the source → use "other" or "unclassified".
       NEVER force a false category. Prefer "unclassified" over guessing.
   - definition: include this field ONLY if the book text you were given literally contains an
     English definition/explanation for that word. Copy or lightly rephrase it from the book.
     If the source is just a simple "english = meaning" pair with no definition written anywhere
     near it, DO NOT include the "definition" field at all — never invent or guess one.
   - example (ONLY if an example sentence literally appears in the book; otherwise omit the field)
   - synonyms (ONLY if they appear in the book related to this word; otherwise omit the field)
   - antonyms (ONLY if they appear in the book related to this word; otherwise omit the field)
   - importance: "key" or "additional"

IMPORTANT — keep the JSON compact:
- Omit any field you don't have real content for instead of writing empty strings/arrays,
  EXCEPT "word" and "meaning" which are always required.
- Do not add "senses" unless the word genuinely has more than one distinct meaning/pos in the book.

IMPORTANT - One entry per English word spelling:
- Always create ONE object per English word (e.g. one object for "bow", one for "bank").
- If the word has multiple meanings or multiple parts of speech, put them ALL in "senses":
  "senses": [
    {"pos": "noun", "meaning": "قوس"},
    {"pos": "verb", "meaning": "ينحني"}
  ]
- Set "meaning" to the first sense meaning and "pos" to the first sense pos.
- Never write multiple Arabic meanings in one string with " / " or " | ".
- ONLY use information present in the book text. Do not invent synonyms/antonyms not written in the book.
- Arabic meaning: if not written in the book, provide a careful short translation; do not add extra encyclopedia facts.
- Continuously infer context: adapt analysis to the surrounding unit, section headings,
  and glossary style. Prefer high-precision extraction over volume.

Rules for synonyms & antonyms:
- ONLY take them from the book text itself.
- If the book does not mention any synonym/antonym for the word → return empty list.
- Do NOT invent synonyms or antonyms.
- Return synonyms/antonyms as objects: [{"word": "leave"}, {"word": "desert"}]

Return ONLY a valid JSON array of objects. No markdown, no explanation.
Example format — "bow" has no definition in the source (omit the field), "bank" does (include it):
[
  {
    "word": "bow",
    "meaning": "قوس",
    "pos": "noun",
    "senses": [
      {"pos": "noun", "meaning": "قوس"},
      {"pos": "verb", "meaning": "ينحني"}
    ],
    "importance": "key"
  },
  {
    "word": "bank",
    "meaning": "بنك",
    "pos": "noun",
    "definition": "a financial institution that accepts deposits and lends money",
    "importance": "key"
  },
  {
    "word": "COVID-19",
    "meaning": "كوفيد-19",
    "pos": "unclassified",
    "importance": "additional"
  }
]
"""

MAX_INPUT_CHARS = 28000  # room for ~400-word glossary tables without truncation


def _call_gemini(text: str) -> str:
    if not gemini_client:
        raise Exception("GEMINI_API_KEY not configured")
    response = _gemini_generate_with_retry(
        model=GEMINI_MODEL,
        contents=f"Text from the book:\n{text[:MAX_INPUT_CHARS]}",
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_PROMPT,
            max_output_tokens=16000,
        ),
    )
    return _extract_text(response)


def _call_groq(text: str) -> str:
    completion = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Text from the book:\n{text[:MAX_INPUT_CHARS]}"}
        ],
        temperature=0.2,
        max_tokens=8000,
    )
    return completion.choices[0].message.content


def _clean_json(raw: str) -> List[Dict]:
    """Extract JSON array from LLM response, repairing truncated output if needed."""
    raw = raw.strip()
    # Remove markdown code blocks if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    def _try_parse(s: str):
        try:
            data = json.loads(s)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "entries" in data:
                return data["entries"]
        except Exception:
            return None
        return None

    result = _try_parse(raw)
    if result is not None:
        return result

    start = raw.find("[")
    end = raw.rfind("]") + 1
    if start != -1 and end > start:
        result = _try_parse(raw[start:end])
        if result is not None:
            return result

    # Response likely got truncated mid-array (hit max_output_tokens).
    # Salvage every complete top-level object we can find and drop the
    # trailing incomplete one instead of losing everything.
    if start != -1:
        body = raw[start + 1:]
        objects = []
        depth = 0
        obj_start = None
        in_string = False
        escape = False
        for idx, ch in enumerate(body):
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == "{":
                if depth == 0:
                    obj_start = idx
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0 and obj_start is not None:
                    objects.append(body[obj_start:idx + 1])
                    obj_start = None
        salvaged = []
        for obj_str in objects:
            parsed = _try_parse("[" + obj_str + "]")
            if parsed:
                salvaged.extend(parsed)
        if salvaged:
            logger.warning(
                "_clean_json: response was truncated/malformed — salvaged %d of the "
                "complete objects found instead of failing entirely", len(salvaged)
            )
            return salvaged

    logger.error("_clean_json: could not parse or salvage any entries from LLM response")
    return []


def _extract_vocabulary_single_batch(text: str) -> List[Dict[str, Any]]:
    """Run one LLM call over a chunk of text small enough to avoid output truncation."""
    provider = LLM_PROVIDER
    raw_response = ""

    try:
        if provider == "groq" and groq_client:
            raw_response = _call_groq(text)
        elif gemini_client:
            raw_response = _call_gemini(text)
        else:
            raise Exception("No LLM provider configured")
    except Exception as e:
        logger.warning("_extract_vocabulary_single_batch: primary provider failed: %s", e)
        # fallback
        if provider == "groq" and gemini_client:
            raw_response = _call_gemini(text)
        elif groq_client:
            raw_response = _call_groq(text)
        else:
            raise e

    logger.info("_extract_vocabulary_single_batch: raw LLM response length=%d, preview=%r",
                len(raw_response or ""), (raw_response or "")[:500])

    entries = _clean_json(raw_response)
    logger.info("_extract_vocabulary_single_batch: parsed %d raw entries from JSON", len(entries))

    cleaned = []
    for e in entries:
        if not e.get("word"):
            continue
        cleaned.append(e)

    return cleaned


# Each batch sent to the LLM is kept small so the model's JSON response never
# has to describe more than a couple dozen words at once — this is what
# prevents the response getting cut off mid-array and silently losing words.
BATCH_CHAR_LIMIT = 3500


def _split_into_batches(text: str, batch_char_limit: int = BATCH_CHAR_LIMIT) -> List[str]:
    """Split text into batches on line boundaries, never breaking a line in half."""
    lines = text.split("\n")
    batches = []
    current: List[str] = []
    current_len = 0

    for line in lines:
        # +1 accounts for the newline that will join this line back in
        line_len = len(line) + 1
        if current and current_len + line_len > batch_char_limit:
            batches.append("\n".join(current))
            current = []
            current_len = 0
        current.append(line)
        current_len += line_len

    if current:
        batches.append("\n".join(current))

    return [b for b in batches if b.strip()]


def extract_vocabulary_from_text(text: str) -> List[Dict[str, Any]]:
    if not text or len(text.strip()) < 30:
        logger.warning("extract_vocabulary_from_text: input text too short (%d chars)", len(text or ""))
        return []

    logger.info("extract_vocabulary_from_text: input length=%d chars, preview=%r",
                len(text), text[:300])

    batches = _split_into_batches(text)
    logger.info("extract_vocabulary_from_text: split input into %d batch(es) of <=%d chars",
                len(batches), BATCH_CHAR_LIMIT)

    all_entries: List[Dict[str, Any]] = []
    seen_words = set()
    last_err = None
    failed_batches = 0

    for i, batch in enumerate(batches):
        logger.info("extract_vocabulary_from_text: processing batch %d/%d (%d chars)",
                    i + 1, len(batches), len(batch))
        try:
            batch_entries = _extract_vocabulary_single_batch(batch)
        except Exception as ex:
            logger.exception("extract_vocabulary_from_text: batch %d/%d failed: %s",
                              i + 1, len(batches), ex)
            last_err = ex
            failed_batches += 1
            continue

        for e in batch_entries:
            key = e.get("word", "").strip().lower()
            if not key or key in seen_words:
                continue
            seen_words.add(key)
            all_entries.append(e)

    logger.info("extract_vocabulary_from_text: %d total entries after merging %d batch(es) (%d failed)",
                len(all_entries), len(batches), failed_batches)

    # If every single batch failed, this isn't "no vocabulary found" — it's a real
    # error (bad API key, model down, etc). Surface it instead of silently returning
    # an empty list, which used to look like "0 words extracted" with no explanation.
    if failed_batches == len(batches) and last_err is not None:
        raise last_err

    return all_entries


OCR_PROMPT = (
    "This image is a bilingual English-Arabic vocabulary table from a school textbook. "
    "It may have MULTIPLE side-by-side column blocks per row (e.g. several word/translation "
    "pairs across the same row, under section headers like 'Part 1', 'Part 2'). "
    "Extract EVERY word pair you see, reading each column block fully top-to-bottom before "
    "moving to the next block to the right. For EACH pair output exactly one line:\n"
    "english_word = الترجمة العربية\n"
    "Rules:\n"
    "- One pair per line, nothing else on the line.\n"
    "- Keep the English word/phrase exactly as written (including phrasal verbs like 'seek to').\n"
    "- Keep the Arabic translation exactly as written, including any '/' alternatives.\n"
    "- Do NOT merge two different rows together and do NOT skip any row.\n"
    "- If a 'Part' or section title appears, output a line: ## Part N\n"
    "- Output plain text only, no markdown table, no extra commentary."
)


def _ocr_page_with_gemini(png_bytes: bytes) -> str:
    response = _gemini_generate_with_retry(
        model=GEMINI_MODEL,
        contents=[
            types.Part.from_text(text=OCR_PROMPT),
            types.Part.from_bytes(data=png_bytes, mime_type="image/png"),
        ],
        config=types.GenerateContentConfig(
            max_output_tokens=4000,
        ),
    )
    return _extract_text(response)


def _ocr_pages_with_gemini(doc, max_pages: int = 20) -> str:
    """Render PDF pages to images and extract text via Gemini Vision (scanned books)."""
    if not gemini_client:
        raise Exception(
            "This PDF looks scanned (image-only). OCR needs GEMINI_API_KEY to be configured."
        )

    parts_text = []
    n = min(len(doc), max_pages)
    for i in range(n):
        page = doc[i]
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")

        try:
            page_text = _ocr_page_with_gemini(png_bytes)
            if page_text:
                parts_text.append(f"--- Page {i + 1} ---\n{page_text}")
        except Exception as ex:
            parts_text.append(f"--- Page {i + 1} (OCR failed: {ex}) ---")

    if len(doc) > max_pages:
        parts_text.append(
            f"\n[Note: only first {max_pages} of {len(doc)} pages were OCR'd]"
        )

    return "\n\n".join(parts_text)


def extract_vocabulary_from_pdf(
    pdf_bytes: bytes,
    filename: str = "book.pdf",
    page_from: int = 1,
    page_to: int = None,
    max_ocr_pages: int = 50,
) -> List[Dict[str, Any]]:
    """
    Extract vocabulary from a PDF.
    page_from / page_to are 1-based inclusive page numbers.
    For scanned PDFs, OCR is limited to max_ocr_pages within that range.
    """
    if fitz is None:
        raise Exception("PyMuPDF (fitz) is not installed")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total = len(doc)

    start = max(1, int(page_from or 1))
    end = int(page_to) if page_to else total
    end = min(max(start, end), total)
    start_idx = start - 1

    if start > total:
        doc.close()
        raise Exception(f"page_from ({start}) is beyond PDF length ({total} pages)")

    full_text = ""
    for i in range(start_idx, end):
        full_text += doc[i].get_text() + "\n\n"

    text_len = len(full_text.strip())
    used_ocr = False

    if text_len < 80:
        if not gemini_client:
            doc.close()
            raise Exception(
                "This PDF looks scanned (image-only). OCR needs GEMINI_API_KEY."
            )

        parts = []
        ocr_count = 0
        for i in range(start_idx, end):
            if ocr_count >= max_ocr_pages:
                parts.append(
                    f"[Stopped OCR at {max_ocr_pages} pages within selected range]"
                )
                break
            page = doc[i]
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            png_bytes = pix.tobytes("png")
            try:
                page_text = _ocr_page_with_gemini(png_bytes)
                logger.info("OCR page %d: %d chars extracted, preview=%r",
                            i + 1, len(page_text), page_text[:200])
                if page_text:
                    parts.append("--- Page %d ---\n%s" % (i + 1, page_text))
            except Exception as ex:
                logger.exception("OCR failed on page %d", i + 1)
                parts.append("--- Page %d (OCR failed: %s) ---" % (i + 1, ex))
            ocr_count += 1

        full_text = "\n\n".join(parts)
        used_ocr = True
        logger.info("extract_vocabulary_from_pdf: OCR total full_text length=%d", len(full_text))

        if parts and all("(OCR failed" in p for p in parts):
            doc.close()
            raise Exception(
                "OCR failed on every page — check that GEMINI_API_KEY is valid and the "
                "model name is not deprecated. Raw error: " + full_text
            )

    doc.close()

    if len(full_text.strip()) < 50:
        raise Exception(
            "Could not extract text from this PDF (even with OCR). "
            "Try a clearer scan, a smaller page range, or a text-based PDF."
        )

    entries = extract_vocabulary_from_text(full_text)

    book_name = filename.replace(".pdf", "").replace(".PDF", "")
    for e in entries:
        e["source_book"] = book_name
        e["page"] = start
        e["page_range"] = "%d-%d" % (start, end)
        if used_ocr:
            e["ocr"] = True

    return entries
