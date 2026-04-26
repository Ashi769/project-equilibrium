"""
Analyzes an anonymized interview transcript using Gemini 2.0 Flash.
Extracts OCEAN scores, attachment style, values profile, and effort score.
"""

import asyncio
import json
from google import genai
from google.genai import types
from app.core.config import settings
from app.core.metrics import track_external_call

ANALYSIS_PROMPT = """You are a psychologist analyzing an interview transcript for a matchmaking platform.

Analyze the following anonymized interview transcript and extract personality data as JSON with this exact structure:
- ocean_scores: {openness, conscientiousness, extraversion, agreeableness, neuroticism} all floats 0.0-1.0
- attachment_style: one of secure, anxious, avoidant, disorganized
- values_profile: {wants_children, financial_mindset, lifestyle, family_orientation, career_ambition, core_values}
- effort_score: float 0.0-1.0
- identity_summary: 2-3 sentence summary of who this person IS
- aspiration_summary: 2-3 sentence summary of what this person WANTS in a partner
- communication_style_summary: 2-3 sentence summary of communication style

TRANSCRIPT:
{transcript}"""


RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "ocean_scores": {
            "type": "object",
            "properties": {
                "openness": {"type": "number"},
                "conscientiousness": {"type": "number"},
                "extraversion": {"type": "number"},
                "agreeableness": {"type": "number"},
                "neuroticism": {"type": "number"},
            },
            "required": [
                "openness",
                "conscientiousness",
                "extraversion",
                "agreeableness",
                "neuroticism",
            ],
        },
        "attachment_style": {"type": "string"},
        "values_profile": {
            "type": "object",
            "properties": {
                "wants_children": {"type": ["boolean", "null"]},
                "financial_mindset": {"type": "string"},
                "lifestyle": {"type": "string"},
                "family_orientation": {"type": "string"},
                "career_ambition": {"type": "string"},
                "core_values": {"type": "array", "items": {"type": "string"}},
            },
        },
        "effort_score": {"type": "number"},
        "identity_summary": {"type": "string"},
        "aspiration_summary": {"type": "string"},
        "communication_style_summary": {"type": "string"},
    },
    "required": [
        "ocean_scores",
        "attachment_style",
        "values_profile",
        "effort_score",
        "identity_summary",
        "aspiration_summary",
        "communication_style_summary",
    ],
}


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
            with track_external_call("gemini"):
                response = await client.aio.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.2,
                        max_output_tokens=2048,
                        response_mime_type="application/json",
                        response_json_schema=RESPONSE_SCHEMA,
                    ),
                )
            return json.loads(response.text)
        except Exception as e:
            last_err = e
            err_str = str(e)
            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "404" in err_str:
                if i < len(models) - 1:
                    await asyncio.sleep(2)
                continue
            raise

    raise last_err
