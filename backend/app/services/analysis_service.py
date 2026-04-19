"""
Analyzes an anonymized interview transcript using Gemini 2.0 Flash.
Extracts OCEAN scores, attachment style, values profile, and effort score.
"""
import asyncio
import json
import re
from google import genai
from google.genai import types
from app.core.config import settings

ANALYSIS_PROMPT = """You are a psychologist analyzing an interview transcript for a matchmaking platform.

Analyze the following anonymized interview transcript and extract personality data.

Return ONLY valid JSON — no markdown, no code blocks, no explanation — with this exact structure:
{
  "ocean_scores": {
    "openness": 0.0,
    "conscientiousness": 0.0,
    "extraversion": 0.0,
    "agreeableness": 0.0,
    "neuroticism": 0.0
  },
  "attachment_style": "secure",
  "values_profile": {
    "wants_children": null,
    "financial_mindset": "balanced",
    "lifestyle": "balanced",
    "family_orientation": "medium",
    "career_ambition": "medium",
    "core_values": ["value1", "value2", "value3"]
  },
  "effort_score": 0.0,
  "identity_summary": "2-3 sentence plain text summary of who this person IS",
  "aspiration_summary": "2-3 sentence plain text summary of what this person WANTS in a partner",
  "communication_style_summary": "2-3 sentence summary of this person's communication style — tone, vocabulary level, directness, humor, emotional expressiveness, and conversational rhythm"
}

All float values are between 0.0 and 1.0.
attachment_style must be one of: secure, anxious, avoidant, disorganized
financial_mindset: saver | spender | balanced
lifestyle: homebody | adventurer | balanced
family_orientation / career_ambition: high | medium | low

TRANSCRIPT:
{transcript}"""


def _extract_json(text: str) -> dict:
    """Try several strategies to extract JSON from a model response."""
    # 1. Direct parse
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # 2. Strip markdown code block
    code_block = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if code_block:
        try:
            return json.loads(code_block.group(1).strip())
        except json.JSONDecodeError:
            pass

    # 3. Find first {...} blob
    brace_match = re.search(r"\{[\s\S]+\}", text)
    if brace_match:
        try:
            return json.loads(brace_match.group())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not extract JSON from Gemini response:\n{text[:500]}")


async def analyze_transcript(transcript: list[dict]) -> dict:
    client = genai.Client(api_key=settings.gemini_api_key)

    transcript_text = "\n".join(
        f"{'Interviewer' if m['role'] == 'assistant' else 'Interviewee'}: {m['content']}"
        for m in transcript
    )

    prompt = ANALYSIS_PROMPT.replace("{transcript}", transcript_text)

    models = ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash"]
    last_err = None
    for i, model in enumerate(models):
        try:
            response = await client.aio.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    max_output_tokens=1024,
                ),
            )
            return _extract_json(response.text)
        except Exception as e:
            last_err = e
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "404" in err_str:
                if i < len(models) - 1:
                    await asyncio.sleep(2)
                continue
            raise

    raise last_err
