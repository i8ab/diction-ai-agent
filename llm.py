"""
LLM helpers for vocabulary extraction.
Supports Gemini (primary) and Groq (backup).
"""

import os
import json
import re
from typing import List, Dict, Any

from dotenv import load_dotenv
load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


SYSTEM_PROMPT = """You are an expert English teacher and lexicographer helping Egyptian students.

Your job: From the given English textbook excerpt, extract ONLY the important vocabulary words that students are expected to learn.

Rules:
1. Extract only KEY / important words (words that appear in vocabulary lists, are highlighted, defined, or are clearly the focus of the lesson). Do NOT extract every word.
2. For each word provide:
   - word (English)
   - meaning (Arabic translation suitable for the context)
   - pos (part of speech if clear: noun, verb, adjective, adverb...)
   - definition (short English definition if available in the text)
   - example (one good example sentence from the text if available)
   - synonyms: ONLY if a synonym is explicitly mentioned or clearly presented in the text for this word. Otherwise empty list.
   - antonyms: ONLY if an antonym is explicitly mentioned or clearly presented in the text for this word. Otherwise empty list.
   - section (e.g. "Vocabulary", "Key Words", "Additional Words", "Reading"...)
   - importance: "key" or "additional"
   - unit / page if mentioned in the text

3. Arabic meanings must be natural and suitable for school students.
4. Never invent synonyms or antonyms that are not supported by the text.
5. Return ONLY a valid JSON array. No extra text, no markdown.

Output format example:
[
  {
    "word": "abandon",
    "meaning": "يتخلى عن / يهجر",
    "pos": "verb",
    "definition": "to leave a place, thing, or person forever",
    "example": "They had to abandon the car.",
    "examples": [],
    "synonyms": [{"word": "leave"}, {"word": "desert"}],
    "antonyms": [{"word": "keep"}],
    "section": "Vocabulary",
    "importance": "key",
    "unit": "Unit 3",
    "page": null
  }
]
"""


async def extract_vocabulary(text: str) -> List[Dict[str, Any]]:
    """Main entry point – uses the configured provider."""
    if LLM_PROVIDER == "groq":
        return await _extract_with_groq(text)
    return await _extract_with_gemini(text)


async def _extract_with_gemini(text: str) -> List[Dict[str, Any]]:
    import google.generativeai as genai

    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is not set")

    genai.configure(api_key=GEMINI_API_KEY)

    model = genai.GenerativeModel(
        model_name="gemini-flash-latest",
        system_instruction=SYSTEM_PROMPT,
    )

    # Limit text length to stay safe
    truncated = text[:12000] if len(text) > 12000 else text

    prompt = f"""Extract the important vocabulary from this English textbook excerpt:

---
{truncated}
---

Return only the JSON array."""

    response = model.generate_content(
        prompt,
        generation_config={
            "temperature": 0.2,
            "response_mime_type": "application/json",
        },
    )

    return _parse_json_response(response.text)


async def _extract_with_groq(text: str) -> List[Dict[str, Any]]:
    from groq import Groq

    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is not set")

    client = Groq(api_key=GROQ_API_KEY)

    truncated = text[:12000] if len(text) > 12000 else text

    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Extract the important vocabulary from this English textbook excerpt:\n\n---\n{truncated}\n---\n\nReturn only the JSON array.",
            },
        ],
        temperature=0.2,
        max_tokens=4096,
        response_format={"type": "json_object"},
    )

    content = completion.choices[0].message.content
    return _parse_json_response(content)


def _parse_json_response(text: str) -> List[Dict[str, Any]]:
    """Robustly parse JSON from LLM response."""
    if not text:
        return []

    text = text.strip()

    # Remove markdown code fences if present
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Try to find the array inside the text
        match = re.search(r"\[[\s\S]*\]", text)
        if match:
            data = json.loads(match.group(0))
        else:
            raise ValueError(f"Could not parse LLM response as JSON: {text[:300]}")

    # Normalize: sometimes the model returns {"entries": [...]} 
    if isinstance(data, dict):
        for key in ("entries", "words", "vocabulary", "data"):
            if key in data and isinstance(data[key], list):
                data = data[key]
                break
        else:
            data = [data]

    if not isinstance(data, list):
        raise ValueError("Expected a list of entries")

    return data
