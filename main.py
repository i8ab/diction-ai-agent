from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Depends, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any
import os
import time
import uuid

from llm import extract_vocabulary_from_text, extract_vocabulary_from_pdf
from rag import (
    extract_full_text_from_pdf,
    save_book,
    load_book,
    list_books,
    delete_book,
    retrieve_relevant_chunks,
    build_chat_prompt,
    generate_answer,
)

app = FastAPI(
    title="Dictionary AI Agent + Book Chat",
    description="Extract vocabulary from textbooks + RAG chatbot that answers only from uploaded books",
    version="1.0.0",
)

# ====================== CORS ======================
origins = [
    "https://test-diction.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "*",  # allow testing; tighten later if needed
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====================== Security ======================
API_SECRET = os.getenv("API_SECRET", "bacaloria-secret-2026")


def verify_secret(x_api_secret: Optional[str] = Header(None)):
    if x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing API secret")
    return True


# ====================== Models (Vocabulary) ======================
class ExtractTextRequest(BaseModel):
    text: str
    source_book: Optional[str] = None
    unit: Optional[str] = None
    section: Optional[str] = "en-ar"
    added_by: Optional[str] = "ai-agent"


class EntryOut(BaseModel):
    id: str
    word: str
    meaning: str
    pos: Optional[str] = None
    definition: Optional[str] = None
    example: Optional[str] = None
    examples: List[str] = []
    synonyms: List[Any] = []
    antonyms: List[Any] = []
    section: str = "en-ar"
    addedAt: int
    addedBy: str
    source_book: Optional[str] = None
    unit: Optional[str] = None
    page: Optional[int] = None
    from_ai: bool = True
    importance: Optional[str] = None


# ====================== Models (Chat / Books) ======================
class ChatRequest(BaseModel):
    book_id: str
    question: str
    top_k: Optional[int] = 6


class ChatResponse(BaseModel):
    success: bool
    answer: str
    book_id: str
    book_title: Optional[str] = None
    sources_used: int = 0
    message: Optional[str] = None


# ====================== Helpers ======================
def generate_id() -> str:
    return uuid.uuid4().hex[:16]


def adapt_entry(
    raw: dict,
    source_book: str = None,
    unit: str = None,
    section: str = "en-ar",
    added_by: str = "ai-agent",
) -> dict:
    """Convert AI Agent raw output to the format used in the dictionary frontend."""

    def normalize_list(items):
        if not items:
            return []
        result = []
        for item in items:
            if isinstance(item, dict):
                result.append(item)
            elif isinstance(item, str) and item.strip():
                result.append({"word": item.strip()})
        return result

    senses = raw.get("senses") or []
    primary_meaning = raw.get("meaning") or ""
    if senses and not primary_meaning:
        primary_meaning = senses[0].get("meaning", "")

    now = int(time.time() * 1000)
    out = {
        "id": generate_id(),
        "word": (raw.get("word") or "").strip(),
        "meaning": primary_meaning,
        "pos": raw.get("pos"),
        "definition": raw.get("definition"),
        "example": raw.get("example") or (raw.get("examples") or [None])[0],
        "examples": raw.get("examples") or [],
        "synonyms": normalize_list(raw.get("synonyms")),
        "antonyms": normalize_list(raw.get("antonyms")),
        "section": section or "en-ar",
        "addedAt": now,
        "addedBy": added_by or "ai-agent",
        "source_book": source_book or raw.get("source_book"),
        "unit": unit or raw.get("unit"),
        "page": raw.get("page"),
        "from_ai": True,
        "importance": raw.get("importance", "key"),
    }
    if len(senses) > 1:
        out["senses"] = senses
    return out


# ====================== Basic Endpoints ======================
@app.get("/")
def root():
    return {
        "service": "Dictionary AI Agent + Book Chat",
        "status": "running",
        "version": "1.0.0",
        "llm_provider": os.getenv("LLM_PROVIDER", "gemini"),
        "features": [
            "vocabulary extraction from text/PDF",
            "upload full book + RAG chat (answers only from the book)",
        ],
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
        "groq_configured": bool(os.getenv("GROQ_API_KEY")),
        "active_provider": os.getenv("LLM_PROVIDER", "gemini"),
        "books_count": len(list_books()),
    }


# ====================== Vocabulary Endpoints (old) ======================
@app.post("/extract", dependencies=[Depends(verify_secret)])
async def extract_from_text(req: ExtractTextRequest):
    if not req.text or len(req.text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Text is too short")

    try:
        raw_entries = extract_vocabulary_from_text(req.text)
        adapted = [
            adapt_entry(
                e,
                source_book=req.source_book,
                unit=req.unit,
                section=req.section,
                added_by=req.added_by,
            )
            for e in raw_entries
        ]
        return {
            "success": True,
            "entries": adapted,
            "count": len(adapted),
            "message": f"Extracted {len(adapted)} entries",
            "provider_used": os.getenv("LLM_PROVIDER", "gemini"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-pdf", dependencies=[Depends(verify_secret)])
async def extract_from_pdf(
    file: UploadFile = File(...),
    source_book: Optional[str] = None,
    unit: Optional[str] = None,
    section: Optional[str] = "en-ar",
    added_by: Optional[str] = "ai-agent",
    page_from: Optional[int] = 1,
    page_to: Optional[int] = None,
    x_api_secret: Optional[str] = Header(None),
):
    if x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing API secret")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        content = await file.read()
        raw_entries = extract_vocabulary_from_pdf(
            content,
            filename=file.filename,
            page_from=page_from or 1,
            page_to=page_to,
            max_ocr_pages=50,
        )
        book_name = source_book or file.filename.replace(".pdf", "")
        adapted = [
            adapt_entry(
                e,
                source_book=book_name,
                unit=unit,
                section=section,
                added_by=added_by,
            )
            for e in raw_entries
        ]
        range_label = f"pages {page_from or 1}" + (f"-{page_to}" if page_to else "+")
        return {
            "success": True,
            "entries": adapted,
            "count": len(adapted),
            "message": f"Extracted {len(adapted)} entries from PDF ({file.filename}, {range_label})",
            "provider_used": os.getenv("LLM_PROVIDER", "gemini"),
            "page_from": page_from or 1,
            "page_to": page_to,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ====================== Book Upload + Chat (NEW) ======================
@app.post("/upload-book", dependencies=[Depends(verify_secret)])
async def upload_book(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    x_api_secret: Optional[str] = Header(None),
):
    """
    Upload a full PDF book → extract text → chunk → store for chat.
    After this you can call /chat with the returned book_id.
    """
    if x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing API secret")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # Size limit ~ 40 MB (free tier friendly)
    content = await file.read()
    if len(content) > 40 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 40 MB)")

    try:
        full_text, page_count, used_ocr = extract_full_text_from_pdf(
            content, max_ocr_pages=40
        )
        book_meta = save_book(
            title=title or file.filename.replace(".pdf", "").replace(".PDF", ""),
            full_text=full_text,
            filename=file.filename,
            page_count=page_count,
            used_ocr=used_ocr,
        )
        return {
            "success": True,
            "book": book_meta,
            "message": (
                f"Book uploaded successfully. "
                f"{book_meta['chunk_count']} chunks created from {page_count} pages."
                + (" (OCR used)" if used_ocr else "")
            ),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/books", dependencies=[Depends(verify_secret)])
def get_books():
    """List all uploaded books."""
    return {"success": True, "books": list_books()}


@app.get("/books/{book_id}", dependencies=[Depends(verify_secret)])
def get_book(book_id: str):
    book = load_book(book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")
    return {
        "success": True,
        "book": {
            "id": book["id"],
            "title": book.get("title"),
            "filename": book.get("filename"),
            "page_count": book.get("page_count"),
            "chunk_count": book.get("chunk_count"),
            "used_ocr": book.get("used_ocr", False),
            "created_at": book.get("created_at"),
        },
    }


@app.delete("/books/{book_id}", dependencies=[Depends(verify_secret)])
def remove_book(book_id: str):
    ok = delete_book(book_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Book not found")
    return {"success": True, "message": "Book deleted"}


@app.post("/chat", dependencies=[Depends(verify_secret)])
async def chat(req: ChatRequest):
    """
    Ask a question about an uploaded book.
    The answer is generated ONLY from the book content (RAG).
    """
    question = (req.question or "").strip()
    if not question or len(question) < 2:
        raise HTTPException(status_code=400, detail="Question is too short")

    book = load_book(req.book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found. Upload it first with /upload-book")

    top_k = max(1, min(req.top_k or 6, 12))
    hits = retrieve_relevant_chunks(book, question, top_k=top_k)

    # Filter very low relevance if possible
    contexts = [h["text"] for h in hits if h.get("score", 0) > 0 or True]

    if not contexts:
        return {
            "success": True,
            "answer": "مش لاقي أجزاء مناسبة في الكتاب للإجابة على السؤال ده. جرب تصيغ السؤال بطريقة تانية أو تأكد إن المعلومة موجودة في الكتاب.",
            "book_id": req.book_id,
            "book_title": book.get("title"),
            "sources_used": 0,
        }

    prompt = build_chat_prompt(question, contexts)

    try:
        answer = generate_answer(prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    return {
        "success": True,
        "answer": answer,
        "book_id": req.book_id,
        "book_title": book.get("title"),
        "sources_used": len(contexts),
        "message": "Answer generated from book content only",
    }


# ====================== Run locally ======================
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
