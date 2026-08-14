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


def extract_vocabulary_from_pdf(pdf_bytes: bytes, filename: str = "book.pdf") -> List[Dict[str, Any]]:
    if fitz is None:
        raise Exception("PyMuPDF (fitz) is not installed")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    full_text = ""
    
    for page in doc:
        full_text += page.get_text() + "\n\n"
    
    doc.close()

    if len(full_text.strip()) < 50:
        raise Exception("Could not extract enough text from the PDF. It might be a scanned image.")

    entries = extract_vocabulary_from_text(full_text)
    
    # add source info
    for e in entries:
        e["source_book"] = filename.replace(".pdf", "")
        e["page"] = 1  # can be improved later
    
    return entries
