"""
Analyzes user photos to compute a hidden presentation/grooming score.
Uses Gemini Vision. Score is stored on the psychometric profile and
never surfaced to the user — used only for same-bracket matching.
"""
import base64
import json
import re
from google import genai
from google.genai import types
from app.core.config import settings

SMV_PROMPT = """You are evaluating a set of photos for a dating platform's internal vetting system.
Analyze these photos and score the person's overall presentation quality on a scale of 1.0 to 10.0.

Criteria (equal weight):
1. Grooming & hygiene (hair, skin, cleanliness)
2. Fitness & physical health (visible energy, posture, body language)
3. Photo quality & effort (lighting, framing, variety of contexts shown)
4. Confidence & expressiveness (smile, eye contact, naturalness)

Return ONLY valid JSON — no markdown, no explanation:
{"score": 7.4, "bracket": "high"}

bracket values: "low" (1-4), "mid" (4-7), "high" (7-10)"""


async def score_photos(photo_data: list[bytes], content_types: list[str] | None = None) -> dict:
    """Returns {"score": float, "bracket": str} or safe default on failure."""
    try:
        client = genai.Client(api_key=settings.gemini_api_key)

        parts: list = [SMV_PROMPT]
        for i, data in enumerate(photo_data[:5]):
            mime = (content_types[i] if content_types and i < len(content_types) else None) or "image/jpeg"
            parts.append(types.Part.from_bytes(data=data, mime_type=mime))

        response = await client.aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=parts,
        )

        text = response.text or "{}"
        match = re.search(r"\{[\s\S]+?\}", text)
        if match:
            result = json.loads(match.group())
            score = float(result.get("score", 5.0))
            bracket = result.get("bracket", "mid")
            return {"score": max(1.0, min(10.0, score)), "bracket": bracket}
    except Exception:
        pass

    return {"score": 5.0, "bracket": "mid"}
