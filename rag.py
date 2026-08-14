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

        import google.generativeai as genai
        genai.configure(api_key=gemini_key)
        model = genai.GenerativeModel("gemini-2.0-flash")

        ocr_prompt = (
            "Extract ALL readable text from this textbook page image. "
            "Preserve headings, explanations, grammar rules, examples, "
            "vocabulary lists, and exercises. Output plain text only."
        )
        parts = []
        ocr_count = 0
        for i in range(min(total_pages, max_ocr_pages)):
            page = doc[i]
            mat = fitz.Matrix(1.5, 1.5)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            png_bytes = pix.tobytes("png")
            try:
                response = model.generate_content(
                    [ocr_prompt, {"mime_type": "image/png", "data": png_bytes}]
                )
                page_text = (response.text or "").strip()
                if page_text:
                    parts.append(f"--- Page {i+1} ---\n{page_text}")
            except Exception as ex:
                parts.append(f"--- Page {i+1} (OCR failed: {ex}) ---")
            ocr_count += 1

        full_text = "\n\n".join(parts)
        used_ocr = True

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


def generate_answer(prompt: str) -> str:
    """Call the configured LLM (Groq preferred for speed/cost)."""
    provider = os.getenv("LLM_PROVIDER", "groq").lower()
    groq_key = os.getenv("GROQ_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")

    if provider == "groq" and groq_key:
        from groq import Groq
        client = Groq(api_key=groq_key)
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a helpful educational assistant. Answer only from the provided book context."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=1500,
        )
        return response.choices[0].message.content.strip()

    if gemini_key:
        import google.generativeai as genai
        genai.configure(api_key=gemini_key)
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content(
            prompt,
            generation_config={"temperature": 0.2, "max_output_tokens": 1500},
        )
        return (response.text or "").strip()

    raise Exception("No LLM provider configured. Set GROQ_API_KEY or GEMINI_API_KEY.")
