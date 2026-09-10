import os
import json
import io
import time
import logging
from typing import List, Dict, Any, Optional

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

   Egyptian revision books (like "المعاصر") very commonly split one word's information across
   SEVERAL separate tables instead of putting it all next to the word. You MUST merge these back
   together into ONE entry per word:
     • A "Vocabulary" table (word ↔ Arabic meaning), then later
     • A separate "Definitions" table (word ↔ English definition), then
     • A separate "Synonyms" table (word ↔ synonym list), then
     • A separate "Antonyms" table (word ↔ antonym list), then
     • A "Vocabulary Study" section with "Verbal Collocations" (verb + word, e.g. "create
       unrealistic expectations"), "Expressions & Idioms", "Verb + Preposition" pairs, and a
       "Word Family" box (related forms of the same root with one example sentence each, and a
       "✗ Don't mix" note contrasting two easily-confused words).
   When you see the SAME English word appear again in a later table/box in the same input, treat
   it as more data for the SAME entry, not a new/duplicate word:
     - meaning: keep the first Arabic meaning already found (or set it if this is the first time).
     - definition: fill from the Definitions table if present.
     - synonyms / antonyms: fill from the Synonyms / Antonyms tables if present.
     - example: if no example sentence was given elsewhere, you may use ONE short example
       sentence from that word's "Word Family" box if the book gives one (e.g. "'Always' is an
       absolute word."), or a collocation from "Verbal Collocations" (e.g. "create unrealistic
       expectations") turned into a natural sentence fragment. Never invent a sentence that isn't
       built from words actually printed in the book.
   Do not create a separate low-value entry just because a word also appears inside a collocation,
   idiom, or "Don't mix" note — that supporting text enriches the existing entry for that word,
   it does not create a new one (unless the collocation/idiom itself is the vocabulary item being
   taught, e.g. "play a major role" as its own phrase entry).

   OCR SHORTHAND: when the input text was produced by our own OCR step (scanned page → text),
   it may contain lines in these exact machine-generated formats instead of a real printed table:
     DEF: english_word :: the English definition sentence
     SYN: english_word :: synonym1, synonym2
     ANT: english_word :: antonym1, antonym2
   Treat each of these exactly like a row from a real "Definitions"/"Synonyms"/"Antonyms" table for
   that word — extract the content after "::" into the matching field (definition / synonyms /
   antonyms) and merge it into that word's single entry, using the same merge rules as above.
   These lines are never vocabulary items in their own right and must never become a separate entry
   (there is no word called "DEF" or "SYN").

2. For each word extract:
   - word (the English word)
   - meaning (ONE primary Arabic meaning - clear and short)
   - category (which book section this word's PRIMARY listing belongs to — REQUIRED,
     always include this field). Choose EXACTLY one of these labels (use the English
     label even if the book's heading was Arabic):
       "Key Vocabulary"        — a general word=meaning glossary list, OR any list with
                                   no distinguishing heading at all (this is the default
                                   — use it whenever nothing more specific applies).
       "Important Vocabulary"  — heading literally says "Important Vocabulary" /
                                   "مفردات هامة" / "كلمات مهمة" or similar emphasis wording.
       "Definitions"           — the word's ONLY listing is a word ↔ definition table
                                   (no separate word=meaning glossary entry for it elsewhere).
       "Synonyms"              — the word's ONLY listing is inside a Synonyms table/glossary.
       "Antonyms"              — the word's ONLY listing is inside an Antonyms table/glossary.
       "Verbal Collocations"   — the item IS a verb+noun collocation phrase being taught
                                   as its own vocabulary item (e.g. "create unrealistic
                                   expectations", "play a major role").
       "Expressions & Idioms"  — the item is an idiom/fixed expression being taught as its
                                   own vocabulary item.
       "Verb + Preposition"    — the item is a verb+preposition / phrasal-verb pattern being
                                   taught as its own vocabulary item (e.g. "seek to", "look
                                   forward to").
       "Language Notes"        — a grammar/usage note about the word (e.g. a "✗ Don't mix"
                                   contrast, a Word Family note) that isn't really a
                                   standalone vocabulary word.
     IMPORTANT: category describes where the word's MAIN listing (its meaning) came from.
     If a word is first found in a plain vocabulary list and LATER also appears in a
     Definitions/Synonyms/Antonyms table just to enrich it (per the merge rules below),
     it still keeps its original category (e.g. "Key Vocabulary") — a supplementary table
     never changes a word's category once it already has a meaning from a real glossary.
     Only use "Definitions" / "Synonyms" / "Antonyms" / "Verbal Collocations" /
     "Expressions & Idioms" / "Verb + Preposition" as the category when that table/list IS
     the word's only source (nothing else about it appears in a plain glossary).
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
  EXCEPT "word", "meaning", and "category" which are always required.
- Do not add "senses" unless the word genuinely has more than one distinct meaning/pos in the book.

IMPORTANT - One entry per English word spelling:
- Always create ONE object per English word (e.g. one object for "bow", one for "bank").
- If the word has multiple meanings or multiple parts of speech, put them ALL in "senses".
  Each sense object MAY include its own definition / example / synonyms / antonyms
  when the book provides them for that specific sense:
  "senses": [
    {
      "pos": "noun",
      "meaning": "قوس",
      "definition": "a weapon for shooting arrows",
      "example": "He drew his bow.",
      "synonyms": [{"word": "arch"}]
    },
    {
      "pos": "verb",
      "meaning": "ينحني",
      "example": "The actors bow to the audience."
    }
  ]
- Set top-level "meaning" to the first sense meaning and top-level "pos" to the first sense pos.
- Never write multiple Arabic meanings in one string with " / " or " | ".
- ONLY use information present in the book text. Do not invent synonyms/antonyms not written in the book.
- Arabic meaning: if not written in the book, provide a careful short translation; do not add extra encyclopedia facts.
- Continuously infer context: adapt analysis to the surrounding unit, section headings,
  and glossary style. Prefer high-precision extraction over volume.

Rules for synonyms & antonyms:
- ONLY take them from the book text itself.
- If the book does not mention any synonym/antonym for the word → omit the field (do not return empty list).
- Do NOT invent synonyms or antonyms.
- Return synonyms/antonyms as objects: [{"word": "leave"}, {"word": "desert"}]
- Prefer attaching synonyms/antonyms/example/definition to the matching sense when the word has senses.

Return ONLY a valid JSON array of objects. No markdown, no explanation.
Example format — "bow" has two senses (include per-sense fields when available), "bank" is single-sense:
[
  {
    "word": "bow",
    "meaning": "قوس",
    "category": "Key Vocabulary",
    "pos": "noun",
    "senses": [
      {
        "pos": "noun",
        "meaning": "قوس",
        "definition": "a weapon for shooting arrows",
        "example": "He drew his bow."
      },
      {
        "pos": "verb",
        "meaning": "ينحني",
        "example": "The actors bow to the audience."
      }
    ],
    "importance": "key"
  },
  {
    "word": "bank",
    "meaning": "بنك",
    "category": "Important Vocabulary",
    "pos": "noun",
    "definition": "a financial institution that accepts deposits and lends money",
    "importance": "key"
  },
  {
    "word": "seek to",
    "meaning": "يسعى إلى",
    "category": "Verb + Preposition",
    "pos": "phrase",
    "importance": "key"
  },
  {
    "word": "COVID-19",
    "meaning": "كوفيد-19",
    "category": "Key Vocabulary",
    "pos": "unclassified",
    "importance": "additional"
  }
]
"""

MAX_INPUT_CHARS = 28000  # room for ~400-word glossary tables without truncation

# ====================== Structure detection (Unit / Section / Lesson) ======================
# Many Egyptian textbooks / revision books lay vocabulary out under headings like
# "Unit 3", "Section A", "Lesson 2" (English) or "الوحدة 3", "القسم أ", "الدرس 2" (Arabic).
# We scan the raw text for these headings BEFORE batching so every extracted word can be
# tagged with the unit/section/lesson it was found under. This lets the frontend either
# auto-place words into the matching Unit → Section → Lesson, or show the admin exactly
# where each word came from so they can confirm/override.
import re as _re

_AR_LETTER_TO_EN = {
    "أ": "A", "ا": "A", "ب": "B", "ت": "C", "ث": "D", "ج": "E", "ح": "F",
    "خ": "G", "د": "H", "ذ": "I", "ر": "J",
}

# Arabic-Indic digits → Latin, so "الدرس ٣" is recognized the same as "الدرس 3".
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

# Spelled-out ordinal/cardinal numbers, English and Arabic, up to 20 — covers the very
# common "Lesson One" / "Unit Two" / "الدرس الأول" / "الوحدة الثالثة" style headings that
# the old digit-only regex silently missed (and so put those words in "no lesson").
_EN_WORD_NUMS = {
    "one": 1, "first": 1, "two": 2, "second": 2, "three": 3, "third": 3,
    "four": 4, "fourth": 4, "five": 5, "fifth": 5, "six": 6, "sixth": 6,
    "seven": 7, "seventh": 7, "eight": 8, "eighth": 8, "nine": 9, "ninth": 9,
    "ten": 10, "tenth": 10, "eleven": 11, "eleventh": 11, "twelve": 12, "twelfth": 12,
    "thirteen": 13, "thirteenth": 13, "fourteen": 14, "fourteenth": 14,
    "fifteen": 15, "fifteenth": 15, "sixteen": 16, "sixteenth": 16,
    "seventeen": 17, "seventeenth": 17, "eighteen": 18, "eighteenth": 18,
    "nineteen": 19, "nineteenth": 19, "twenty": 20, "twentieth": 20,
}
_AR_WORD_NUMS = {
    "الأول": 1, "الاول": 1, "الأولى": 1, "الاولى": 1,
    "الثاني": 2, "الثانية": 2, "الثالث": 3, "الثالثة": 3,
    "الرابع": 4, "الرابعة": 4, "الخامس": 5, "الخامسة": 5,
    "السادس": 6, "السادسة": 6, "السابع": 7, "السابعة": 7,
    "الثامن": 8, "الثامنة": 8, "التاسع": 9, "التاسعة": 9,
    "العاشر": 10, "العاشرة": 10,
    "الحادي عشر": 11, "الثاني عشر": 12, "الثالث عشر": 13,
}
_EN_WORD_NUM_RE = "|".join(sorted(_EN_WORD_NUMS, key=len, reverse=True))
_AR_WORD_NUM_RE = "|".join(sorted(_AR_WORD_NUMS, key=len, reverse=True))

# Number part shared by unit/section/lesson: a plain digit run, OR a spelled-out
# English/Arabic ordinal word, OR "(3)" / "no. 3" / "#3" style wrappers.
_NUM_PART = rf"(?:\(?\s*(?:no\.?|#)?\s*(\d+)\s*\)?|({_EN_WORD_NUM_RE})|({_AR_WORD_NUM_RE}))"

_UNIT_RE = _re.compile(
    rf"(?:^|\n)\s*(?:unit|module|chapter|الوحدة|وحدة)\s*[:\-–]?\s*{_NUM_PART}",
    _re.IGNORECASE,
)
_SECTION_RE = _re.compile(
    r"(?:^|\n)\s*(?:section|القسم|قسم)\s*[:\-–]?\s*([A-Za-z]|[أ-ي])\b",
    _re.IGNORECASE,
)
_LESSON_RE = _re.compile(
    rf"(?:^|\n)\s*(?:lesson|الدرس|درس)\s*[:\-–]?\s*{_NUM_PART}",
    _re.IGNORECASE,
)


def _resolve_num_part(m: "_re.Match", group_offset: int) -> Optional[str]:
    """Pull whichever alternative of _NUM_PART matched (digit / EN word / AR word)
    and normalize it to a plain digit string."""
    digit, en_word, ar_word = (
        m.group(group_offset), m.group(group_offset + 1), m.group(group_offset + 2)
    )
    if digit:
        return digit.translate(_ARABIC_DIGITS).strip()
    if en_word:
        return str(_EN_WORD_NUMS.get(en_word.lower()))
    if ar_word:
        return str(_AR_WORD_NUMS.get(ar_word))
    return None


def _normalize_section_label(raw: str) -> str:
    """Map a detected section marker to a stable letter id ('A', 'B', ...)."""
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw in _AR_LETTER_TO_EN:
        return _AR_LETTER_TO_EN[raw]
    return raw.upper()


def detect_structure_segments(text: str) -> List[Dict[str, Any]]:
    """
    Split `text` into segments, each tagged with the last-seen unit/section/lesson
    heading before it. A segment always has non-empty 'text'. If no heading is ever
    found, a single segment with unit=section=lesson=None is returned (structure not
    detected — caller should treat the whole file as one flat lesson-less list).
    """
    # Collect every heading match (any kind) with its position, in document order.
    markers = []
    for m in _UNIT_RE.finditer(text):
        val = _resolve_num_part(m, 1)
        if val:
            markers.append((m.start(), "unit", val))
    for m in _SECTION_RE.finditer(text):
        markers.append((m.start(), "section", _normalize_section_label(m.group(1))))
    for m in _LESSON_RE.finditer(text):
        val = _resolve_num_part(m, 1)
        if val:
            markers.append((m.start(), "lesson", val))
    markers.sort(key=lambda x: x[0])

    if not markers:
        return [{"unit": None, "section": None, "lesson": None, "text": text}]

    segments = []
    cur_unit, cur_section, cur_lesson = None, None, None
    cursor = 0
    boundaries = [pos for pos, _, _ in markers] + [len(text)]

    # Text before the first heading (if any) is "unstructured" — still worth keeping.
    if markers[0][0] > 0:
        pre = text[0:markers[0][0]].strip()
        if pre:
            segments.append({"unit": None, "section": None, "lesson": None, "text": pre})

    for i, (pos, kind, value) in enumerate(markers):
        if kind == "unit":
            cur_unit, cur_section, cur_lesson = value, None, None
        elif kind == "section":
            cur_section, cur_lesson = value, None
        elif kind == "lesson":
            cur_lesson = value
        chunk_end = boundaries[i + 1]
        chunk = text[pos:chunk_end]
        if chunk.strip():
            segments.append({
                "unit": cur_unit, "section": cur_section, "lesson": cur_lesson,
                "text": chunk,
            })

    # Merge tiny/empty segments away and keep only ones with real body text.
    return [s for s in segments if len(s["text"].strip()) >= 10] or [
        {"unit": None, "section": None, "lesson": None, "text": text}
    ]


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


def _groq_generate_with_retry(max_retries: int = 3, base_delay: float = 1.5, **kwargs):
    """Call groq_client.chat.completions.create with retry on transient errors
    (rate limit / 5xx / connection issues) using exponential backoff — mirrors the
    Gemini retry helper so a single flaky API call doesn't fail the whole extraction."""
    last_err = None
    for attempt in range(max_retries):
        try:
            return groq_client.chat.completions.create(**kwargs)
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(e, "code", None)
            msg = str(e)
            transient = (
                status in (429, 500, 502, 503, 504)
                or "rate limit" in msg.lower()
                or "timeout" in msg.lower()
                or "overloaded" in msg.lower()
                or "internal server error" in msg.lower()
                or "connection" in msg.lower()
            )
            last_err = e
            if not transient or attempt == max_retries - 1:
                raise
            delay = base_delay * (2 ** attempt)
            logger.warning(
                "Groq call failed (attempt %d/%d, transient=%s): %s — retrying in %.1fs",
                attempt + 1, max_retries, transient, msg, delay,
            )
            time.sleep(delay)
    raise last_err


def _call_groq(text: str) -> str:
    completion = _groq_generate_with_retry(
        model=os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-120b"),
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


_ALLOWED_CATEGORIES = {
    "key vocabulary", "important vocabulary", "definitions", "synonyms",
    "antonyms", "verbal collocations", "expressions & idioms",
    "verb + preposition", "language notes",
}
_CATEGORY_CANONICAL = {
    "key vocabulary": "Key Vocabulary",
    "important vocabulary": "Important Vocabulary",
    "definitions": "Definitions",
    "synonyms": "Synonyms",
    "antonyms": "Antonyms",
    "verbal collocations": "Verbal Collocations",
    "expressions & idioms": "Expressions & Idioms",
    "expressions and idioms": "Expressions & Idioms",
    "idioms": "Expressions & Idioms",
    "verb + preposition": "Verb + Preposition",
    "verb+preposition": "Verb + Preposition",
    "language notes": "Language Notes",
}


def _normalize_category(raw: Any) -> str:
    """Coerce whatever the model returned for `category` onto one of the fixed
    labels the frontend understands, defaulting to "Key Vocabulary" — this way a
    word NEVER ends up with a missing/unrecognized category just because the
    model phrased it slightly differently or forgot the field."""
    text = str(raw or "").strip().lower()
    if text in _CATEGORY_CANONICAL:
        return _CATEGORY_CANONICAL[text]
    return "Key Vocabulary"


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
        e["category"] = _normalize_category(e.get("category"))
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


def _merge_entry(existing: Dict[str, Any], incoming: Dict[str, Any]) -> None:
    """Fill missing fields on `existing` (in place) from a later occurrence of the
    same word found in a different batch. This is what lets a word whose meaning
    was found in a "Vocabulary" table get its definition/synonyms/antonyms filled
    in later from separate "Definitions"/"Synonyms"/"Antonyms" tables that landed
    in a different batch (common in Egyptian revision books). We never overwrite
    a field that already has content — only fill in what's missing.
    `category` is included here on purpose: once a word has a category from its
    first (usually main-glossary) occurrence, a later supplementary-table sighting
    must never override it — see the "category" rules in SYSTEM_PROMPT."""
    for field in ("meaning", "category", "pos", "definition", "example", "importance"):
        if not existing.get(field) and incoming.get(field):
            existing[field] = incoming[field]
    for field in ("synonyms", "antonyms"):
        if not existing.get(field) and incoming.get(field):
            existing[field] = incoming[field]
    if not existing.get("senses") and incoming.get("senses"):
        existing["senses"] = incoming["senses"]


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
    by_word: Dict[str, Dict[str, Any]] = {}
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
            if not key:
                continue
            if key in by_word:
                # Same word seen again in a later batch — merge in whatever new
                # info it brings (definition/synonyms/antonyms/example) instead
                # of silently discarding it.
                _merge_entry(by_word[key], e)
            else:
                by_word[key] = e
                all_entries.append(e)

    logger.info("extract_vocabulary_from_text: %d total entries after merging %d batch(es) (%d failed)",
                len(all_entries), len(batches), failed_batches)

    # If every single batch failed, this isn't "no vocabulary found" — it's a real
    # error (bad API key, model down, etc). Surface it instead of silently returning
    # an empty list, which used to look like "0 words extracted" with no explanation.
    if failed_batches == len(batches) and last_err is not None:
        raise last_err

    return all_entries


def extract_vocabulary_from_text_with_structure(text: str) -> Dict[str, Any]:
    """
    Structure-aware extraction: detects Unit/Section/Lesson headings first, runs
    extraction per-segment (so batches never straddle two lessons), and tags every
    entry with 'detected_unit' / 'detected_section' / 'detected_lesson' (all None
    when the source file has no such headings — that's a normal, expected case).

    Returns {"entries": [...], "structure_detected": bool}.
    """
    if not text or len(text.strip()) < 30:
        logger.warning("extract_vocabulary_from_text_with_structure: input too short")
        return {"entries": [], "structure_detected": False}

    segments = detect_structure_segments(text)
    structure_detected = any(
        s["unit"] or s["section"] or s["lesson"] for s in segments
    )
    logger.info(
        "extract_vocabulary_from_text_with_structure: %d segment(s), structure_detected=%s",
        len(segments), structure_detected,
    )

    all_entries: List[Dict[str, Any]] = []
    last_err = None
    failed_batches = 0
    total_batches = 0

    for seg_idx, seg in enumerate(segments):
        # `by_word` is scoped to THIS segment only. Merging must never cross a lesson
        # boundary — if the same word legitimately appears again in a later lesson,
        # it needs its own entry tagged with that lesson, not to be silently folded
        # into the first lesson's entry (which used to make the second lesson's word
        # list look incomplete / not matching the book's own division).
        by_word: Dict[str, Dict[str, Any]] = {}
        batches = _split_into_batches(seg["text"])
        total_batches += len(batches)
        for i, batch in enumerate(batches):
            logger.info(
                "extract_vocabulary_from_text_with_structure: segment %d/%d batch %d/%d "
                "(unit=%s section=%s lesson=%s, %d chars)",
                seg_idx + 1, len(segments), i + 1, len(batches),
                seg["unit"], seg["section"], seg["lesson"], len(batch),
            )
            try:
                batch_entries = _extract_vocabulary_single_batch(batch)
            except Exception as ex:
                logger.exception(
                    "extract_vocabulary_from_text_with_structure: segment %d batch %d failed: %s",
                    seg_idx + 1, i + 1, ex,
                )
                last_err = ex
                failed_batches += 1
                continue

            for e in batch_entries:
                key = e.get("word", "").strip().lower()
                if not key:
                    continue
                if key in by_word:
                    # Same word seen again within the SAME lesson — merge new fields
                    # in (e.g. a Definitions/Synonyms/Antonyms table found later in
                    # the same lesson) instead of dropping them.
                    _merge_entry(by_word[key], e)
                else:
                    e["detected_unit"] = seg["unit"]
                    e["detected_section"] = seg["section"]
                    e["detected_lesson"] = seg["lesson"]
                    by_word[key] = e
                    all_entries.append(e)

    if total_batches and failed_batches == total_batches and last_err is not None:
        raise last_err

    return {"entries": all_entries, "structure_detected": structure_detected}


OCR_PROMPT = (
    "This image is a page from a bilingual English-Arabic school textbook or revision book. "
    "It may contain ANY of the following block types, sometimes several on the same page:\n"
    "  (a) A vocabulary table with MULTIPLE side-by-side column blocks per row (several "
    "word/translation pairs across the same row, under headers like 'Part 1', 'Part 2').\n"
    "  (b) A 'Definitions' table: word ↔ an English definition/explanation sentence.\n"
    "  (c) A 'Synonyms' table: word ↔ one or more synonym words/phrases.\n"
    "  (d) An 'Antonyms' table: word ↔ one or more antonym words/phrases.\n"
    "Transcribe EVERYTHING relevant on the page — do not limit yourself to simple word=meaning "
    "pairs. Read each block fully top-to-bottom before moving to the next block to the right. "
    "Output plain text using EXACTLY these line formats, one entry per line, and nothing else "
    "on the line:\n"
    "  - Vocabulary pair:      english_word = الترجمة العربية\n"
    "  - Definition entry:     DEF: english_word :: the English definition sentence\n"
    "  - Synonym entry:        SYN: english_word :: synonym1, synonym2\n"
    "  - Antonym entry:        ANT: english_word :: antonym1, antonym2\n"
    "  - Section/table title:  ## <the heading text, e.g. Part 1 / Definitions / Synonyms / Antonyms>\n"
    "Rules:\n"
    "- One entry per line, nothing else on the line.\n"
    "- Keep the English word/phrase exactly as written (including phrasal verbs like 'seek to').\n"
    "- Keep Arabic text exactly as written, including any '/' alternatives.\n"
    "- Do NOT merge two different rows together and do NOT skip any row, in ANY of the block types.\n"
    "- If a word appears in a Definitions/Synonyms/Antonyms table, still emit it using the DEF:/SYN:/ANT: "
    "format above, even if that same word also appears in the plain vocabulary table elsewhere on the page.\n"
    "- Never invent a definition, synonym, or antonym — only transcribe what is visibly printed.\n"
    "- Output plain text only, no markdown table formatting, no extra commentary."
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

    result = extract_vocabulary_from_text_with_structure(full_text)
    entries = result["entries"]

    book_name = filename.replace(".pdf", "").replace(".PDF", "")
    for e in entries:
        e["source_book"] = book_name
        e["page"] = start
        e["page_range"] = "%d-%d" % (start, end)
        if used_ocr:
            e["ocr"] = True

    return {"entries": entries, "structure_detected": result["structure_detected"]}
