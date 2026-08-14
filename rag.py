"""
Simple RAG system for textbook Q&A.
- Extract full text from PDF
- Chunk it
- Store on disk (JSON)
- Retrieve with BM25
- Answer with LLM using only retrieved context
"""

import os
import json
import uuid
import re
import time
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

import fitz  # PyMuPDF
from rank_bm25 import BM25Okapi


def _gemini_generate_with_retry(client, max_retries: int = 4, base_delay: float = 2.0, **kwargs):
    """Call client.models.generate_content with retry on transient errors
    (503 UNAVAILABLE / 429 rate limit / 500 internal) using exponential backoff."""
    last_err = None
    for attempt in range(max_retries):
        try:
            return client.models.generate_content(**kwargs)
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

# ====================== Paths ======================
DATA_DIR = Path(os.getenv("DATA_DIR", "data"))
BOOKS_DIR = DATA_DIR / "books"
BOOKS_DIR.mkdir(parents=True, exist_ok=True)

# ====================== Chunking ======================
def chunk_text(text: str, chunk_size: int = 900, overlap: int = 150) -> List[str]:
    """Split text into overlapping chunks (by characters, respecting paragraphs)."""
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text:
        return []

    # Prefer splitting on double newlines (paragraphs)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) + 2 <= chunk_size:
            current = (current + "\n\n" + para).strip()
        else:
            if current:
                chunks.append(current)
            # If a single paragraph is too long, hard-split it
            if len(para) > chunk_size:
                start = 0
                while start < len(para):
                    end = start + chunk_size
                    chunks.append(para[start:end].strip())
                    start = end - overlap
            else:
                current = para
    if current:
        chunks.append(current)

    # Add slight overlap between consecutive chunks for better context
    if overlap > 0 and len(chunks) > 1:
        final = [chunks[0]]
        for i in range(1, len(chunks)):
            prev_tail = chunks[i - 1][-overlap:] if len(chunks[i - 1]) > overlap else chunks[i - 1]
            final.append((prev_tail + "\n" + chunks[i]).strip())
        return final

    return chunks


def tokenize(text: str) -> List[str]:
    """Simple tokenizer for BM25 (works for English + Arabic)."""
    text = text.lower()
    # Keep Arabic, English letters, numbers
    tokens = re.findall(r"[\u0600-\u06FFa-z0-9]+", text)
    return tokens


# ====================== PDF → Text ======================
def extract_full_text_from_pdf(
    pdf_bytes: bytes,
    max_ocr_pages: int = 30,
    use_ocr_fallback: bool = True,
) -> Tuple[str, int, bool]:
    """
    Extract all text from a PDF.
    Returns: (full_text, page_count, used_ocr)
    """
    if fitz is None:
        raise Exception("PyMuPDF is not installed")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)
    pages_text = []
    used_ocr = False

    for i in range(total_pages):
        page = doc[i]
        text = page.get_text().strip()
        pages_text.append(text)

    full_text = "\n\n".join(
        f"--- Page {i+1} ---\n{t}" for i, t in enumerate(pages_text) if t
    )

    # If almost no text → probably scanned → try OCR with Gemini (limited pages)
    if len(full_text.strip()) < 100 and use_ocr_fallback:
        gemini_key = os.getenv("GEMINI_API_KEY")
        if not gemini_key:
            doc.close()
            raise Exception(
                "This PDF looks scanned (image-only). OCR needs GEMINI_API_KEY."
            )

        from google import genai
        from google.genai import types
        client = genai.Client(api_key=gemini_key)
        gemini_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

        ocr_prompt = (
            "Extract ALL readable text from this textbook page image. "
            "Preserve headings, explanations, grammar rules, examples, and exercises. "
            "If you see a bilingual English-Arabic vocabulary table (possibly with several "
            "side-by-side column blocks per row), read each block fully top-to-bottom before "
            "moving to the next block, and output every pair as its own line: "
            "'english_word = الترجمة العربية'. Do not merge unrelated rows. "
            "Output plain text only, no markdown."
        )
        parts = []
        ocr_count = 0
        for i in range(min(total_pages, max_ocr_pages)):
            page = doc[i]
            mat = fitz.Matrix(2.0, 2.0)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            png_bytes = pix.tobytes("png")
            try:
                response = _gemini_generate_with_retry(
                    client,
                    model=gemini_model,
                    contents=[
                        types.Part.from_text(text=ocr_prompt),
                        types.Part.from_bytes(data=png_bytes, mime_type="image/png"),
                    ],
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        max_output_tokens=4000,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                page_text = _extract_text(response)
                if page_text:
                    parts.append(f"--- Page {i+1} ---\n{page_text}")
            except Exception as ex:
                parts.append(f"--- Page {i+1} (OCR failed: {ex}) ---")
            ocr_count += 1

        full_text = "\n\n".join(parts)
        used_ocr = True

        if parts and all("(OCR failed" in p for p in parts):
            doc.close()
            raise Exception(
                "OCR failed on every page — check that GEMINI_API_KEY is valid and the "
                "model name is not deprecated. Raw error: " + full_text
            )

    doc.close()

    if len(full_text.strip()) < 50:
        raise Exception("Could not extract enough text from this PDF.")

    return full_text, total_pages, used_ocr


# ====================== Book Storage ======================
def _book_path(book_id: str) -> Path:
    return BOOKS_DIR / f"{book_id}.json"


def save_book(
    title: str,
    full_text: str,
    filename: str = "",
    page_count: int = 0,
    used_ocr: bool = False,
    extra: Optional[Dict] = None,
) -> Dict[str, Any]:
    book_id = uuid.uuid4().hex[:12]
    chunks = chunk_text(full_text)

    # Pre-tokenize for BM25
    tokenized_chunks = [tokenize(c) for c in chunks]

    meta = {
        "id": book_id,
        "title": title or filename or "Untitled Book",
        "filename": filename,
        "page_count": page_count,
        "chunk_count": len(chunks),
        "used_ocr": used_ocr,
        "created_at": int(time.time()),
        "extra": extra or {},
        "chunks": chunks,
        "tokenized": tokenized_chunks,
    }

    path = _book_path(book_id)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    # Don't return the heavy fields to the caller
    return {
        "id": book_id,
        "title": meta["title"],
        "filename": filename,
        "page_count": page_count,
        "chunk_count": len(chunks),
        "used_ocr": used_ocr,
        "created_at": meta["created_at"],
    }


def load_book(book_id: str) -> Optional[Dict[str, Any]]:
    path = _book_path(book_id)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_books() -> List[Dict[str, Any]]:
    books = []
    for p in BOOKS_DIR.glob("*.json"):
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            books.append({
                "id": data["id"],
                "title": data.get("title"),
                "filename": data.get("filename"),
                "page_count": data.get("page_count"),
                "chunk_count": data.get("chunk_count"),
                "used_ocr": data.get("used_ocr", False),
                "created_at": data.get("created_at"),
            })
        except Exception:
            continue
    books.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return books


def delete_book(book_id: str) -> bool:
    path = _book_path(book_id)
    if path.exists():
        path.unlink()
        return True
    return False


# ====================== Retrieval ======================
def retrieve_relevant_chunks(
    book: Dict[str, Any],
    query: str,
    top_k: int = 6,
) -> List[Dict[str, Any]]:
    chunks = book.get("chunks") or []
    tokenized = book.get("tokenized")

    if not chunks:
        return []

    if not tokenized or len(tokenized) != len(chunks):
        tokenized = [tokenize(c) for c in chunks]

    query_tokens = tokenize(query)
    if not query_tokens:
        # fallback: return first chunks
        return [{"text": c, "score": 0.0, "index": i} for i, c in enumerate(chunks[:top_k])]

    bm25 = BM25Okapi(tokenized)
    scores = bm25.get_scores(query_tokens)

    ranked = sorted(
        [{"text": chunks[i], "score": float(scores[i]), "index": i} for i in range(len(chunks))],
        key=lambda x: x["score"],
        reverse=True,
    )
    return ranked[:top_k]


# ====================== Answer Generation ======================
def build_chat_prompt(query: str, contexts: List[str], language_hint: str = "auto") -> str:
    context_block = "\n\n---\n\n".join(contexts)

    system = """أنت مساعد تعليمي ذكي متخصص في المناهج والكتب المدرسية.

قواعد صارمة:
1. جاوب فقط من المعلومات الموجودة في "محتوى الكتاب" أدناه.
2. لو المعلومة مش موجودة في الكتاب، قول بصراحة: "المعلومة دي مش موجودة في الكتاب المرفوع".
3. لو السؤال عن ترجمة كلمة أو جملة موجودة في الكتاب، ترجمها بوضوح.
4. لو السؤال عن قاعدة grammar أو شرح، اشرحه بطريقة بسيطة ومناسبة للطالب.
5. جاوب بنفس لغة السؤال (عربي أو إنجليزي). لو السؤال بالعربي جاوب بالعربي.
6. كن واضح ومنظم، واستخدم نقاط لو الإجابة طويلة.
7. لا تخترع أمثلة أو قواعد غير موجودة في السياق المعطى إلا لو كانت ضرورية للتوضيح البسيط.

محتوى الكتاب (الأجزاء الأكثر صلة بالسؤال):
"""
    return f"""{system}
{context_block}

---
سؤال الطالب: {query}

الإجابة:"""


def generate_answer(prompt: str, system_message: str = None) -> str:
    """
    Call LLMs in a configurable fallback chain.
    Env:
      LLM_FALLBACK_CHAIN=groq,gemini,openrouter
      GROQ_API_KEY / GROQ_MODEL / GROQ_FALLBACK_MODEL
      GEMINI_API_KEY / GEMINI_MODEL
      OPENROUTER_API_KEY / OPENROUTER_MODEL
      LLM_PROVIDER=groq|gemini|openrouter  (used if chain not set)
    """
    groq_key = os.getenv("GROQ_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    sys_msg = system_message or (
        "You are a helpful educational assistant. Answer only from the provided book context."
    )
    groq_model = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
    groq_fallback_model = os.getenv("GROQ_FALLBACK_MODEL", "llama-3.3-70b-versatile")
    gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    openrouter_model = os.getenv("OPENROUTER_MODEL", "google/gemini-2.0-flash-001")

    def _is_rate_limit(err: Exception) -> bool:
        msg = str(err).lower()
        return (
            "429" in msg
            or "rate_limit" in msg
            or "rate limit" in msg
            or "tokens per day" in msg
            or "tpm" in msg
            or "tpd" in msg
            or "resource_exhausted" in msg
            or "quota" in msg
        )

    def _call_groq(model: str) -> str:
        from groq import Groq
        client = Groq(api_key=groq_key)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1200,
        )
        return (response.choices[0].message.content or "").strip()

    def _call_gemini() -> str:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=gemini_key)
        full_prompt = prompt if not system_message else f"{system_message}\n\n{prompt}"
        response = _gemini_generate_with_retry(
            client,
            model=gemini_model,
            contents=full_prompt,
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=2000,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        return _extract_text(response)

    def _call_openrouter() -> str:
        """OpenAI-compatible API — one key, many models."""
        import urllib.request
        import json as _json
        body = _json.dumps({
            "model": openrouter_model,
            "messages": [
                {"role": "system", "content": sys_msg},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens": 1200,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {openrouter_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": os.getenv("OPENROUTER_REFERER", "https://test-diction.vercel.app"),
                "X-Title": os.getenv("OPENROUTER_TITLE", "Bacaloria Study Coach"),
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = _json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            # urllib errors often wrap HTTPError with body
            body_txt = ""
            if hasattr(e, "read"):
                try:
                    body_txt = e.read().decode("utf-8", errors="replace")
                except Exception:
                    pass
            raise Exception(f"OpenRouter error: {e} {body_txt}") from e
        choices = data.get("choices") or []
        if not choices:
            raise Exception(f"OpenRouter empty response: {data}")
        return (choices[0].get("message", {}).get("content") or "").strip()

    # Build ordered chain from env
    chain_raw = (os.getenv("LLM_FALLBACK_CHAIN") or "").strip()
    if chain_raw:
        chain = [p.strip().lower() for p in chain_raw.split(",") if p.strip()]
    else:
        primary = (os.getenv("LLM_PROVIDER") or "groq").lower()
        defaults = ["groq", "gemini", "openrouter"]
        chain = [primary] + [p for p in defaults if p != primary]

    # Expand "groq" into fast then strong model steps
    steps = []  # list of (name, callable)
    for p in chain:
        if p == "groq" and groq_key:
            steps.append((f"groq:{groq_model}", lambda m=groq_model: _call_groq(m)))
            if groq_fallback_model and groq_fallback_model != groq_model:
                steps.append((f"groq:{groq_fallback_model}", lambda m=groq_fallback_model: _call_groq(m)))
        elif p == "gemini" and gemini_key:
            steps.append(("gemini", _call_gemini))
        elif p in ("openrouter", "or") and openrouter_key:
            steps.append(("openrouter", _call_openrouter))

    if not steps:
        raise Exception(
            "No LLM provider configured. Set GROQ_API_KEY and/or GEMINI_API_KEY "
            "and/or OPENROUTER_API_KEY."
        )

    errors = []
    for name, fn in steps:
        try:
            answer = fn()
            if answer:
                return answer
            errors.append(f"{name}: empty answer")
        except Exception as e:
            errors.append(f"{name}: {e}")
            continue

    joined = " | ".join(errors)
    if errors and all(_is_rate_limit(Exception(e)) or "429" in e for e in errors):
        raise Exception(
            "تم استهلاك الحد اليومي لكل محركات الذكاء الاصطناعي المتاحة مؤقتًا. "
            "جرّب بعد شوية أو أضف مفتاح محرك إضافي (Gemini / OpenRouter)."
        )
    raise Exception(joined)



# ====================== Personal Tutor (user progress, no storage) ======================

# Hard caps so the payload stays small (bandwidth-friendly)
MAX_WEAK_WORDS = 20
MAX_RECENT_WORDS = 10
MAX_HISTORY_TURNS = 6


def _cap_list(items, limit: int) -> list:
    if not items:
        return []
    if not isinstance(items, list):
        return []
    return [str(x).strip() for x in items if str(x).strip()][:limit]


def sanitize_user_context(raw: dict | None) -> dict:
    """
    Keep only a small, useful summary of the user (all sections).
    Nothing is stored — this is used for the current request only.
    """
    if not raw or not isinstance(raw, dict):
        return {}

    weak = _cap_list(raw.get("weak_words") or raw.get("weakWords") or [], MAX_WEAK_WORDS)
    recent = _cap_list(
        raw.get("recent_words") or raw.get("recent_studied") or raw.get("recentWords") or [],
        MAX_RECENT_WORDS,
    )

    def _num(src, key_variants, default=0):
        for k in key_variants:
            if k in src and src[k] is not None:
                try:
                    return int(src[k])
                except (TypeError, ValueError):
                    try:
                        return int(float(src[k]))
                    except (TypeError, ValueError):
                        pass
        return default

    sections_out = {}
    raw_sections = raw.get("sections") if isinstance(raw.get("sections"), dict) else {}
    for sk, sv in raw_sections.items():
        if not isinstance(sv, dict):
            continue
        sec_weak = _cap_list(sv.get("weak_words") or [], 8)
        sec = {
            "label": str(sv.get("label") or sk),
            "in_dictionary": _num(sv, ["in_dictionary", "total", "count"]),
            "studied": _num(sv, ["studied", "studied_count"]),
            "not_studied": _num(sv, ["not_studied", "unstudied"]),
            "mastered": _num(sv, ["mastered"]),
            "weak": _num(sv, ["weak", "weak_count"], len(sec_weak)),
            "weak_words": sec_weak,
        }
        if sec["in_dictionary"] or sec["studied"] or sec["not_studied"]:
            sections_out[str(sk)] = sec

    ctx = {
        "name": str(raw.get("name") or raw.get("user_name") or "").strip() or None,
        "total_in_dictionary": _num(raw, ["total_in_dictionary", "dictionary_total"]),
        "total_words": _num(raw, ["total_words", "totalWords", "total"]),
        "not_studied": _num(raw, ["not_studied", "unstudied", "remaining"]),
        "mastered": _num(raw, ["mastered", "mastered_count", "masteredCount"]),
        "learning": _num(raw, ["learning", "learning_count", "learningCount"]),
        "weak_count": _num(raw, ["weak", "weak_count", "weakCount"], len(weak)),
        "today_studied": _num(raw, ["today_studied", "todayStudied", "today_count"]),
        "streak": _num(raw, ["streak", "current_streak"]),
        "level": _num(raw, ["level", "xp_level", "xpLevel"]),
        "weak_words": weak,
        "recent_words": recent,
        "last_activity": str(raw.get("last_activity") or raw.get("lastActivity") or "").strip() or None,
        "sections": sections_out or None,
    }
    return {k: v for k, v in ctx.items() if v not in (None, "", [], 0)}



def build_tutor_prompt(
    question: str,
    user_context: dict,
    history: list | None = None,
) -> str:
    """
    Build a prompt for the personal study tutor.
    Uses only the small summary sent with this request (no server-side storage).
    """
    ctx = sanitize_user_context(user_context)

    lines = []
    if ctx.get("name"):
        lines.append(f"- الاسم: {ctx['name']}")
    if "total_in_dictionary" in ctx:
        lines.append(f"- إجمالي الكلمات في القاموس (كل الأقسام): {ctx['total_in_dictionary']}")
    if "total_words" in ctx:
        lines.append(f"- مُذاكرة (studied) إجمالي: {ctx['total_words']}")
    if "not_studied" in ctx:
        lines.append(f"- لسه متذاكرتش (not studied): {ctx['not_studied']}")
    if "mastered" in ctx:
        lines.append(f"- متقنة (mastered): {ctx['mastered']}")
    if "learning" in ctx:
        lines.append(f"- قيد التعلم: {ctx['learning']}")
    if "weak_count" in ctx:
        lines.append(f"- عدد الكلمات الضعيفة: {ctx['weak_count']}")
    if "today_studied" in ctx:
        lines.append(f"- ذاكر النهاردة: {ctx['today_studied']} كلمة")
    if "streak" in ctx:
        lines.append(f"- سلسلة الأيام (streak): {ctx['streak']}")
    if "level" in ctx:
        lines.append(f"- المستوى: {ctx['level']}")
    if ctx.get("last_activity"):
        lines.append(f"- آخر نشاط: {ctx['last_activity']}")
    if ctx.get("weak_words"):
        lines.append("- عينة كلمات ضعيفة (كل الأقسام): " + ", ".join(ctx["weak_words"]))
    if ctx.get("recent_words"):
        lines.append("- كلمات حديثة: " + ", ".join(ctx["recent_words"]))

    # Per-section breakdown
    sections = ctx.get("sections") or {}
    if isinstance(sections, dict) and sections:
        lines.append("- تفصيل حسب القسم:")
        for sk, sv in sections.items():
            if not isinstance(sv, dict):
                continue
            label = sv.get("label") or sk
            part = (
                f"  • {label}: في القاموس={sv.get('in_dictionary', 0)}, "
                f"مذاكر={sv.get('studied', 0)}, "
                f"مش مذاكر={sv.get('not_studied', 0)}, "
                f"متقن={sv.get('mastered', 0)}, "
                f"ضعيف={sv.get('weak', 0)}"
            )
            ww = sv.get("weak_words") or []
            if ww:
                part += " | ضعيف منها: " + ", ".join(ww)
            lines.append(part)

    context_block = "\n".join(lines) if lines else "(لا توجد بيانات تقدم مرسلة مع هذا الطلب)"

    history_block = ""
    if history and isinstance(history, list):
        turns = []
        for h in history[-MAX_HISTORY_TURNS:]:
            if not isinstance(h, dict):
                continue
            role = str(h.get("role") or "").lower()
            content = str(h.get("content") or h.get("text") or "").strip()
            if not content:
                continue
            label = "الطالب" if role in ("user", "student", "human") else "المساعد"
            turns.append(f"{label}: {content[:400]}")
        if turns:
            history_block = "\n\nمحادثة سابقة (مختصرة):\n" + "\n".join(turns)

    system_rules = """أنت صاحبي في المذاكرة على تطبيق قاموس (Bacaloria). مش روبوت رسمي.

طريقة الكلام:
- اتكلم بالعامية المصرية الطبيعية والمرنة، زي ما الناس بتتكلم في الشات: «إيه»، «لسه»، «خلاص»، «يلا»، «ماشي»، «طب»، «تمام»، «شوية»، «أوي».
- متتكلمش فصحى متكلفة ولا أسلوب كتب مدرسية، ومتستخدمش ترجمة حرفية من الإنجليزي.
- لو المستخدم كتب بالإنجليزي، جاوب بالإنجليزي البسيط. لو خلّط عربي وإنجليزي، رد بمرونة بنفس الروح.
- خلي الرد قصير ومباشر: جملتين لتلاتة غالبًا، من غير حشو.
- كون مشجّع وخفيف دم من غير مبالغة ولا تنظير.

المرونة:
- افهم قصده حتى لو السؤال ناقص أو بالعامية أو فيه أخطاء إملائية.
- لو سأل سؤال عام عن حاله، لخّصله الوضع بسرعة وبعدين اقترح حاجة عملية لو مناسبة.
- متكرر الجملة اللي هو قالها، ومتعملش قوائم طويلة إلا لو هو طلب تفاصيل.

الأرقام والبيانات:
1) اعتمد فقط على «ملخص حالة المستخدم» تحت. متخترعش أرقام.
2) الأقسام: Academic، EN→AR، AR→AR. لو سأل عن قسم معيّن استخدم أرقام القسم ده.
3) «مذاكر» = studied، «مش مذاكر / لسه» = not_studied. لو سأل كام لسه، قوله الرقم بوضوح.
4) لو المعلومة مش موجودة في الملخص: «والله مش عندي المعلومة دي دلوقتي» وخلاص.
5) متقولش إن الداتا دي «قاموس الإنجليزي بس» لو عندك تفصيل أقسام.

الأدوات:
- لو طلب كويز أو فلاش كارد بصراحة: انصحه بجملة قصيرة، وفي آخر سطر فقط:
  → ACTION: quiz_weak | quiz_all | flashcards_weak | flashcards_all | flashcards_recent
- متقولش إنك فتحت حاجة. الزر عند المستخدم وهو يختار.
- لو مجرد بيسأل عن الضعيف من غير طلب فتح أداة: متضيفش ACTION.

كل طلب مستقل؛ متعتمدش إلا على الملخص + «محادثة سابقة» لو موجودة."""

    return f"""{system_rules}

ملخص حالة المستخدم (لحظي — كل الأقسام):
{context_block}
{history_block}

---
سؤال المستخدم: {question}

الإجابة:"""



TUTOR_SYSTEM_MESSAGE = (
    "You are a friendly Egyptian study buddy for a vocabulary app — not a formal robot. "
    "When the user writes Arabic (especially Egyptian dialect), reply in natural Egyptian colloquial Arabic: short, flexible, warm, everyday words (إيه، لسه، طب، ماشي، يلا). "
    "No stiff Modern Standard Arabic, no textbook tone, no awkward literal translation from English. "
    "If they write English, reply in simple English. "
    "Answer ONLY from the progress summary (all sections). Distinguish studied vs not-studied. "
    "If data is missing, say so simply in dialect. "
    "Only if they clearly ask to open quiz/flashcards, end with one line: → ACTION: quiz_weak (or similar). Never claim you opened anything."
)


def generate_tutor_answer(prompt: str) -> str:
    """Generate answer for the personal tutor (slightly warmer temperature)."""
    return generate_answer(prompt, system_message=TUTOR_SYSTEM_MESSAGE)
