import os
import json
import io
from typing import List, Dict, Any

# PDF extraction
try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

# LLM clients
import google.generativeai as genai
from groq import Groq

# ====================== Config ======================
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

# ====================== Prompt ======================
SYSTEM_PROMPT = """You are an expert English vocabulary extractor for school textbooks.

Your job:
1. Extract ONLY important vocabulary words that the textbook intends students to learn.
   - Look for: Key Words, Vocabulary lists, Words to learn, highlighted words, words with definitions.
   - IGNORE common simple words, grammar words, and ordinary text.

2. For each word extract:
   - word (the English word)
   - meaning (ONE primary Arabic meaning - clear and short)
   - pos (part of speech: noun, verb, adjective, adverb...)
   - definition (English definition if available in the book, otherwise a short clear one)
   - example (example sentence from the book if exists)
   - synonyms (ONLY if they appear in the book related to this word)
   - antonyms (ONLY if they appear in the book related to this word)
   - importance: "key" or "additional"

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

Rules for synonyms & antonyms:
- ONLY take them from the book text itself.
- If the book does not mention any synonym/antonym for the word → return empty list.
- Do NOT invent synonyms or antonyms.
- Return synonyms/antonyms as objects: [{"word": "leave"}, {"word": "desert"}]

Return ONLY a valid JSON array of objects. No markdown, no explanation.
Example format:
[
  {
    "word": "bow",
    "meaning": "قوس",
    "pos": "noun",
    "senses": [
      {"pos": "noun", "meaning": "قوس"},
      {"pos": "verb", "meaning": "ينحني"}
    ],
    "definition": "a curved weapon; or to bend the body in respect",
    "example": "He bowed to the audience.",
    "synonyms": [{"word": "bend"}],
    "antonyms": [],
    "importance": "key"
  },
  {
    "word": "bank",
    "meaning": "بنك",
    "pos": "noun",
    "senses": [
      {"pos": "noun", "meaning": "بنك"},
      {"pos": "noun", "meaning": "ضفة"}
    ],
    "definition": "a financial institution; or the side of a river",
    "synonyms": [],
    "antonyms": [],
    "importance": "key"
  }
]
"""

def _call_gemini(text: str) -> str:
    model = genai.GenerativeModel("gemini-2.0-flash")
    response = model.generate_content(
        [SYSTEM_PROMPT, f"\n\nText from the book:\n{text[:12000]}"]
    )
    return response.text


def _call_groq(text: str) -> str:
    completion = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Text from the book:\n{text[:12000]}"}
        ],
        temperature=0.2,
        max_tokens=4000,
    )
    return completion.choices[0].message.content


def _clean_json(raw: str) -> List[Dict]:
    """Extract JSON array from LLM response"""
    raw = raw.strip()
    # Remove markdown code blocks if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "entries" in data:
            return data["entries"]
        return []
    except Exception:
        # Try to find the array
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start != -1 and end > start:
            try:
                return json.loads(raw[start:end])
            except:
                pass
        return []


def extract_vocabulary_from_text(text: str) -> List[Dict[str, Any]]:
    if not text or len(text.strip()) < 30:
        return []

    provider = LLM_PROVIDER
    raw_response = ""

    try:
        if provider == "groq" and groq_client:
            raw_response = _call_groq(text)
        elif GEMINI_API_KEY:
            raw_response = _call_gemini(text)
        else:
            raise Exception("No LLM provider configured")
    except Exception as e:
        # fallback
        if provider == "groq" and GEMINI_API_KEY:
            raw_response = _call_gemini(text)
        elif groq_client:
            raw_response = _call_groq(text)
        else:
            raise e

    entries = _clean_json(raw_response)
    
    # basic cleaning
    cleaned = []
    for e in entries:
        if not e.get("word"):
            continue
        cleaned.append(e)
    
    return cleaned


def _ocr_pages_with_gemini(doc, max_pages: int = 20) -> str:
    """Render PDF pages to images and extract text via Gemini Vision (scanned books)."""
    if not GEMINI_API_KEY:
        raise Exception(
            "This PDF looks scanned (image-only). OCR needs GEMINI_API_KEY to be configured."
        )

    model = genai.GenerativeModel("gemini-2.0-flash")
    ocr_prompt = (
        "Extract ALL readable text from this textbook page image. "
        "Preserve vocabulary lists, definitions, synonyms, antonyms, and examples. "
        "Output plain text only, no markdown."
    )

    parts_text = []
    n = min(len(doc), max_pages)
    for i in range(n):
        page = doc[i]
        mat = fitz.Matrix(1.5, 1.5)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")

        try:
            response = model.generate_content(
                [
                    ocr_prompt,
                    {"mime_type": "image/png", "data": png_bytes},
                ]
            )
            page_text = (response.text or "").strip()
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
        if not GEMINI_API_KEY:
            doc.close()
            raise Exception(
                "This PDF looks scanned (image-only). OCR needs GEMINI_API_KEY."
            )

        model = genai.GenerativeModel("gemini-2.0-flash")
        ocr_prompt = (
            "Extract ALL readable text from this textbook page image. "
            "Preserve vocabulary lists, definitions, synonyms, antonyms, and examples. "
            "Output plain text only, no markdown."
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
            mat = fitz.Matrix(1.5, 1.5)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            png_bytes = pix.tobytes("png")
            try:
                response = model.generate_content(
                    [
                        ocr_prompt,
                        {"mime_type": "image/png", "data": png_bytes},
                    ]
                )
                page_text = (response.text or "").strip()
                if page_text:
                    parts.append("--- Page %d ---\n%s" % (i + 1, page_text))
            except Exception as ex:
                parts.append("--- Page %d (OCR failed: %s) ---" % (i + 1, ex))
            ocr_count += 1

        full_text = "\n\n".join(parts)
        used_ocr = True

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
