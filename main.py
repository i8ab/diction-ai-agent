from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any
import os
import time
import uuid
from llm import extract_vocabulary_from_text, extract_vocabulary_from_pdf

app = FastAPI(
    title="Dictionary AI Agent",
    description="Extract vocabulary from English textbooks",
    version="0.2.0"
)

# ====================== CORS ======================
origins = [
    "https://test-diction.vercel.app",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
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

# ====================== Models ======================
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
    # extra fields (optional, for future use)
    source_book: Optional[str] = None
    unit: Optional[str] = None
    page: Optional[int] = None
    from_ai: bool = True
    importance: Optional[str] = None

# ====================== Helpers ======================
def generate_id() -> str:
    return uuid.uuid4().hex[:16]

def adapt_entry(raw: dict, source_book: str = None, unit: str = None, section: str = "en-ar", added_by: str = "ai-agent") -> dict:
    """Convert AI Agent raw output to the exact format used in Supabase entries table"""
    
    # synonyms / antonyms as {word} objects so frontend chips render correctly
    def normalize_list(items):
        if not items:
            return []
        result = []
        for item in items:
            if isinstance(item, dict):
                w = (item.get("word") or item.get("text") or "").strip()
            else:
                w = str(item).strip()
            if w:
                result.append({"word": w})
        return result

    now = int(time.time() * 1000)

    # senses: multiple Arabic meanings
    senses_raw = raw.get("senses") or []
    senses = []
    if isinstance(senses_raw, list):
        for s in senses_raw:
            if not isinstance(s, dict):
                continue
            m = str(s.get("meaning") or "").strip()
            if not m:
                continue
            senses.append({
                "pos": str(s.get("pos") or raw.get("pos") or "").strip(),
                "meaning": m,
            })

    meaning = raw.get("meaning", "").strip()
    pos = raw.get("pos")
    if senses:
        meaning = meaning or senses[0]["meaning"]
        pos = pos or senses[0].get("pos")

    out = {
        "id": generate_id(),
        "word": raw.get("word", "").strip(),
        "meaning": meaning,
        "pos": pos,
        "definition": raw.get("definition"),
        "example": raw.get("example"),
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

# ====================== Endpoints ======================
@app.get("/")
def root():
    return {
        "service": "Dictionary AI Agent",
        "status": "running",
        "version": "0.3.0",
        "llm_provider": os.getenv("LLM_PROVIDER", "gemini")
    }

@app.get("/health")
def health():
    return {
        "ok": True,
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
        "groq_configured": bool(os.getenv("GROQ_API_KEY")),
        "active_provider": os.getenv("LLM_PROVIDER", "gemini")
    }

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
                added_by=req.added_by
            )
            for e in raw_entries
        ]

        return {
            "success": True,
            "entries": adapted,
            "count": len(adapted),
            "message": f"Extracted {len(adapted)} entries",
            "provider_used": os.getenv("LLM_PROVIDER", "gemini")
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
    x_api_secret: Optional[str] = Header(None)
):
    # Manual secret check because File upload makes Depends a bit tricky sometimes
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
                added_by=added_by
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
