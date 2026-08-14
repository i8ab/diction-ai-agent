"""
AI Agent for Dictionary Project
- Receives English textbook PDFs
- Extracts important vocabulary words
- Gets Arabic meanings (from book or lookup)
- Extracts synonyms/antonyms ONLY if present in the book
- Returns structured entries ready for the dictionary
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Dictionary AI Agent",
    description="Extracts vocabulary from English textbooks for the dictionary project",
    version="0.1.0",
)

# Allow requests from your frontend (Vercel / localhost)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Config ----------
API_SECRET = os.getenv("API_SECRET", "dev-secret-change-me")
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


def verify_secret(x_api_secret: str = Header(None)):
    """Simple protection so random people can't call the agent."""
    if x_api_secret != API_SECRET:
        raise HTTPException(status_code=401, detail="Invalid or missing API secret")
    return True


# ---------- Data Models (match your existing EntryCard structure) ----------
class SynAntPair(BaseModel):
    word: str
    meaning: Optional[str] = None


class DictionaryEntry(BaseModel):
    word: str
    meaning: str                          # Arabic meaning
    pos: Optional[str] = None             # part of speech
    definition: Optional[str] = None      # English definition if available
    example: Optional[str] = None
    examples: List[str] = Field(default_factory=list)
    synonyms: List[SynAntPair] = Field(default_factory=list)
    antonyms: List[SynAntPair] = Field(default_factory=list)

    # New fields for book source
    source_book: Optional[str] = None
    unit: Optional[str] = None
    page: Optional[int] = None
    section: Optional[str] = None         # e.g. "Vocabulary", "Key Words"
    from_ai: bool = True
    importance: Optional[str] = None      # "key" | "additional"


class ExtractRequest(BaseModel):
    """Request when sending plain text instead of PDF"""
    text: str
    source_book: Optional[str] = None
    unit: Optional[str] = None
    language_hint: str = "en"             # book language


class ExtractResponse(BaseModel):
    success: bool
    entries: List[DictionaryEntry]
    message: str = ""
    provider_used: str = ""


# ---------- Health ----------
@app.get("/")
def root():
    return {
        "service": "Dictionary AI Agent",
        "status": "running",
        "version": "0.1.0",
        "llm_provider": LLM_PROVIDER,
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "gemini_configured": bool(GEMINI_API_KEY),
        "groq_configured": bool(GROQ_API_KEY),
        "active_provider": LLM_PROVIDER,
    }


# ---------- Main extraction endpoint (text for now) ----------
@app.post("/extract", response_model=ExtractResponse, dependencies=[Depends(verify_secret)])
async def extract_from_text(req: ExtractRequest):
    """
    Extract important vocabulary from English textbook text.
    - Only important/key words (not every word)
    - Arabic meaning (from context or lookup)
    - Synonyms / Antonyms ONLY if they appear in the provided text
    """
    if not req.text or len(req.text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Text is too short")

    try:
        entries = await run_extraction(
            text=req.text,
            source_book=req.source_book,
            unit=req.unit,
        )
        return ExtractResponse(
            success=True,
            entries=entries,
            message=f"Extracted {len(entries)} entries",
            provider_used=LLM_PROVIDER,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- PDF helpers ----------
def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract plain text from a PDF using PyMuPDF."""
    import pymupdf

    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    pages_text = []
    for page_num, page in enumerate(doc, start=1):
        text = page.get_text("text")
        if text and text.strip():
            pages_text.append(f"--- Page {page_num} ---\n{text.strip()}")
    doc.close()
    return "\n\n".join(pages_text)


# ---------- PDF endpoint ----------
@app.post("/extract-pdf", response_model=ExtractResponse, dependencies=[Depends(verify_secret)])
async def extract_from_pdf(
    file: UploadFile = File(...),
    source_book: Optional[str] = None,
    unit: Optional[str] = None,
):
    """
    Accept a PDF textbook, extract its text, then run vocabulary extraction.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    content = await file.read()
    if len(content) > 25 * 1024 * 1024:  # 25 MB limit
        raise HTTPException(status_code=400, detail="PDF is too large (max 25 MB)")

    try:
        text = extract_text_from_pdf(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read PDF: {str(e)}")

    if not text or len(text.strip()) < 50:
        raise HTTPException(
            status_code=400,
            detail="Could not extract enough text from the PDF. It may be scanned images only (needs OCR).",
        )

    # Use filename as book name if not provided
    book_name = source_book or file.filename.replace(".pdf", "").replace(".PDF", "")

    try:
        entries = await run_extraction(
            text=text,
            source_book=book_name,
            unit=unit,
        )
        return ExtractResponse(
            success=True,
            entries=entries,
            message=f"Extracted {len(entries)} entries from PDF ({file.filename})",
            provider_used=LLM_PROVIDER,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Core extraction logic ----------
async def run_extraction(
    text: str,
    source_book: Optional[str] = None,
    unit: Optional[str] = None,
) -> List[DictionaryEntry]:
    """
    Calls the LLM with a careful prompt and returns structured entries.
    """
    from llm import extract_vocabulary

    raw_entries = await extract_vocabulary(text)

    def _normalize_pairs(raw_list):
        """Accept both ['leave'] and [{'word': 'leave'}] formats from the LLM."""
        pairs = []
        for item in raw_list or []:
            if isinstance(item, str) and item.strip():
                pairs.append(SynAntPair(word=item.strip()))
            elif isinstance(item, dict) and item.get("word"):
                pairs.append(
                    SynAntPair(
                        word=str(item["word"]).strip(),
                        meaning=item.get("meaning"),
                    )
                )
        return pairs

    results = []
    for item in raw_entries:
        entry = DictionaryEntry(
            word=item.get("word", "").strip(),
            meaning=item.get("meaning", "").strip(),
            pos=item.get("pos"),
            definition=item.get("definition"),
            example=item.get("example"),
            examples=item.get("examples") or [],
            synonyms=_normalize_pairs(item.get("synonyms")),
            antonyms=_normalize_pairs(item.get("antonyms")),
            source_book=source_book,
            unit=unit or item.get("unit"),
            page=item.get("page"),
            section=item.get("section"),
            from_ai=True,
            importance=item.get("importance", "key"),
        )
        if entry.word and entry.meaning:
            results.append(entry)

    return results


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
