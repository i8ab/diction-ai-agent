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
    build_tutor_prompt,
    generate_tutor_answer,
    sanitize_user_context,
)

app = FastAPI(
    title="AI Agent UHD — Dictionary AI Agent + Book Chat + Personal Tutor",
    description=(
        "State-of-the-art vocabulary extraction (any textbook PDF) with precise POS tagging "
        "(including other/unclassified), RAG book chatbot, and personal study tutor. "
        "All responses prefer Arabic when the user writes in Arabic."
    ),
    version="2.0.0-UHD",
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
    category: Optional[str] = None
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


# ====================== Models (Personal Tutor) ======================
class TutorHistoryItem(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class TutorChatRequest(BaseModel):
    """
    Personal study tutor — no server-side storage of user data.
    Send a small live summary with every request.
    """
    question: str
    # Small live snapshot from the app (numbers + short word samples only)
    user_context: Optional[dict] = None
    # Optional last few turns (client keeps history; server does not)
    history: Optional[List[TutorHistoryItem]] = None


class TutorChatResponse(BaseModel):
    success: bool
    answer: str
    # Detected action hint if the model suggested opening a tool (quiz / flashcards)
    action: Optional[str] = None
    context_used: Optional[dict] = None
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
    unit_section: str = None,
    lesson: str = None,
) -> dict:
    """Convert AI Agent raw output to the format used in the dictionary frontend.

    Multi-sense words keep a rich `senses` array so the frontend can show
    POS tabs (Noun / Verb / …) and load definition / example / synonyms /
    antonyms for the selected sense only.
    """

    def normalize_list(items):
        if not items:
            return []
        result = []
        for item in items:
            if isinstance(item, dict) and item.get("word"):
                result.append({"word": str(item["word"]).strip()})
            elif isinstance(item, str) and item.strip():
                result.append({"word": item.strip()})
        return result

    def normalize_sense(s, idx):
        # type: (Any, int) -> Optional[dict]
        if not isinstance(s, dict):
            return None
        meaning = str(s.get("meaning") or "").strip()
        if not meaning:
            return None
        sense = {
            "id": s.get("id") or f"s{idx}",
            "pos": s.get("pos") or "",
            "meaning": meaning,
        }
        definition = str(s.get("definition") or "").strip()
        if definition:
            sense["definition"] = definition
        example = s.get("example")
        examples = s.get("examples")
        if isinstance(examples, list) and examples:
            cleaned = [str(e).strip() for e in examples if e]
            if cleaned:
                sense["examples"] = cleaned
                sense["example"] = cleaned[0]
        elif example:
            sense["example"] = str(example).strip()
            sense["examples"] = [sense["example"]]
        syns = normalize_list(s.get("synonyms"))
        if syns:
            sense["synonyms"] = syns
        ants = normalize_list(s.get("antonyms"))
        if ants:
            sense["antonyms"] = ants
        return sense

    raw_senses = raw.get("senses") or []
    senses = []
    for i, s in enumerate(raw_senses):
        normalized = normalize_sense(s, i)
        if normalized:
            senses.append(normalized)

    primary_meaning = str(raw.get("meaning") or "").strip()
    primary_pos = raw.get("pos")
    if senses:
        if not primary_meaning:
            primary_meaning = senses[0]["meaning"]
        if not primary_pos:
            primary_pos = senses[0].get("pos")

    # Resolve the Unit-Section / Lesson placement for this word:
    # a manual choice from the admin (unit_section / lesson params, used when
    # auto-detect is off, or as a fallback for words the AI couldn't place)
    # always wins over what was auto-detected from the book's own headings.
    resolved_unit_section = (
        unit_section if unit_section not in (None, "") else raw.get("detected_section")
    )
    resolved_lesson = (
        lesson if lesson not in (None, "") else raw.get("detected_lesson")
    )

    now = int(time.time() * 1000)
    out = {
        "id": generate_id(),
        "word": (raw.get("word") or "").strip(),
        "meaning": primary_meaning,
        "pos": primary_pos,
        "definition": raw.get("definition"),
        "example": raw.get("example") or (raw.get("examples") or [None])[0],
        "examples": raw.get("examples") or [],
        "synonyms": normalize_list(raw.get("synonyms")),
        "antonyms": normalize_list(raw.get("antonyms")),
        "section": section or "en-ar",
        "addedAt": now,
        "addedBy": added_by or "ai-agent",
        "source_book": source_book or raw.get("source_book"),
        "unit": unit or raw.get("unit") or raw.get("detected_unit"),
        "unitSection": resolved_unit_section,
        "lesson": resolved_lesson,
        "category": raw.get("category"),
        "detectedUnit": raw.get("detected_unit"),
        "detectedSection": raw.get("detected_section"),
        "detectedLesson": raw.get("detected_lesson"),
        "page": raw.get("page"),
        "from_ai": True,
        "importance": raw.get("importance", "key"),
    }

    # Only attach senses when there is more than one distinct meaning/POS.
    # Single-sense words stay flat (legacy-compatible) using top-level fields.
    if len(senses) > 1:
        out["senses"] = senses
        # Mirror first sense onto top-level for list/card previews
        first = senses[0]
        out["meaning"] = first["meaning"]
        out["pos"] = first.get("pos") or out.get("pos")
        if first.get("definition") and not out.get("definition"):
            out["definition"] = first["definition"]
        if first.get("example") and not out.get("example"):
            out["example"] = first["example"]
            out["examples"] = first.get("examples") or [first["example"]]
        if first.get("synonyms") and not out.get("synonyms"):
            out["synonyms"] = first["synonyms"]
        if first.get("antonyms") and not out.get("antonyms"):
            out["antonyms"] = first["antonyms"]

    return out


# ====================== Basic Endpoints ======================
@app.get("/")
def root():
    return {
        "service": "Dictionary AI Agent + Book Chat + Personal Tutor",
        "status": "running",
        "version": "1.1.0",
        "llm_provider": os.getenv("LLM_PROVIDER", "gemini"),
        "features": [
            "vocabulary extraction from text/PDF",
            "upload full book + RAG chat (answers only from the book)",
            "personal study tutor (live user progress, no storage on server)",
        ],
        "endpoints": {
            "tutor": "POST /tutor-chat",
            "book_chat": "POST /chat",
            "extract_pdf": "POST /extract-pdf",
        },
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
        "groq_configured": bool(os.getenv("GROQ_API_KEY")),
        "openrouter_configured": bool(os.getenv("OPENROUTER_API_KEY")),
        "active_provider": os.getenv("LLM_PROVIDER", "groq"),
        "fallback_chain": os.getenv("LLM_FALLBACK_CHAIN") or "groq,gemini,openrouter",
        "books_count": len(list_books()),
        "tutor_enabled": True,
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
    # Unit → Section → Lesson placement.
    # auto_detect_structure=True (default): the book's own "Unit/Section/Lesson"
    #   headings (English or Arabic) decide where each word belongs; unit_section /
    #   lesson below are only used as a fallback for words with no heading above them.
    # auto_detect_structure=False: every extracted word is placed directly into the
    #   single unit_section / lesson the admin chose, ignoring any headings found.
    auto_detect_structure: Optional[bool] = True,
    unit_section: Optional[str] = None,
    lesson: Optional[str] = None,
    x_api_secret: Optional[str] = Header(None),
):
    if x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing API secret")

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    try:
        content = await file.read()
        pdf_result = extract_vocabulary_from_pdf(
            content,
            filename=file.filename,
            page_from=page_from or 1,
            page_to=page_to,
            max_ocr_pages=50,
        )
        raw_entries = pdf_result["entries"]
        structure_detected = pdf_result["structure_detected"]

        # auto_detect_structure=True  → placement comes purely from headings found in
        #   the book (adapt_entry falls back to detected_section/detected_lesson);
        #   words under no heading stay unplaced (general/unit-level), as expected.
        # auto_detect_structure=False → every word is forced into the admin's chosen
        #   unit_section/lesson, ignoring any headings.
        manual_section = unit_section if not auto_detect_structure else None
        manual_lesson = lesson if not auto_detect_structure else None

        book_name = source_book or file.filename.replace(".pdf", "")
        adapted = [
            adapt_entry(
                e,
                source_book=book_name,
                unit=unit,
                section=section,
                added_by=added_by,
                unit_section=manual_section,
                lesson=manual_lesson,
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
            "structure_detected": structure_detected,
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


# ====================== Personal Tutor (live context, no storage) ======================
def _extract_action_from_answer(answer: str, question: str = "") -> Optional[str]:
    """
    Parse optional machine hint from the model, or infer from the user question.
      → ACTION: quiz_weak
    """
    import re
    allowed = {
        "quiz_weak",
        "quiz_all",
        "flashcards_weak",
        "flashcards_all",
        "flashcards_recent",
    }
    if answer:
        m = re.search(r"(?:→\s*)?ACTION:\s*([a-z0-9_]+)", answer, re.IGNORECASE)
        if m:
            action = m.group(1).lower().strip()
            if action in allowed:
                return action

    blob = f"{question or ''}\n{answer or ''}".lower()
    wants_quiz = bool(re.search(r"كويز|اختبار|\bquiz\b|\btest\b", blob))
    wants_flash = bool(re.search(r"فلاش\s*كارد|بطاقات|flash\s*cards?|flashcards", blob))
    wants_weak = bool(re.search(r"ضعيف|الضعف|\bweak\b", blob))
    wants_recent = bool(re.search(r"حديث|أخيرة|\brecent\b", blob))
    if wants_quiz:
        return "quiz_weak" if wants_weak else "quiz_all"
    if wants_flash:
        if wants_recent:
            return "flashcards_recent"
        return "flashcards_weak" if wants_weak else "flashcards_all"
    return None


@app.post("/tutor-chat", dependencies=[Depends(verify_secret)])
async def tutor_chat(req: TutorChatRequest):
    """
    Personal study tutor.

    - Does NOT store any user data on the server.
    - Expects a small live summary in `user_context` with each request.
    - Answers questions about progress, weak words, study advice.
    - Can suggest opening quiz / flashcards via an `action` field.
    """
    question = (req.question or "").strip()
    if not question or len(question) < 1:
        raise HTTPException(status_code=400, detail="Question is required")

    # Sanitize + cap size (bandwidth protection)
    safe_ctx = sanitize_user_context(req.user_context)

    history_dicts = None
    if req.history:
        history_dicts = [
            {"role": h.role, "content": h.content}
            for h in req.history
            if h and (h.content or "").strip()
        ]

    prompt = build_tutor_prompt(question, safe_ctx, history=history_dicts)

    try:
        answer = generate_tutor_answer(prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")

    action = _extract_action_from_answer(answer, question)

    return {
        "success": True,
        "answer": answer,
        "action": action,
        "context_used": safe_ctx,  # echo what was actually used (for debugging / UI)
        "message": "Answer generated from live user summary only (nothing stored on server)",
    }


# ====================== Run locally ======================
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
