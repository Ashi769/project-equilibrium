"""
Analyzes an anonymized interview transcript using Gemini 1.5 Flash.
Extracts OCEAN scores, attachment style, values profile, and effort score.
"""
import json
import re
import google.generativeai as genai
from app.core.config import settings

ANALYSIS_PROMPT = """You are a psychologist analyzing an interview transcript for a matchmaking platform.

Analyze the following anonymized interview transcript and extract personality data.

Return ONLY valid JSON with this exact structure:
{
  "ocean_scores": {
    "openness": 0.0-1.0,
    "conscientiousness": 0.0-1.0,
    "extraversion": 0.0-1.0,
    "agreeableness": 0.0-1.0,
    "neuroticism": 0.0-1.0
  },
  "attachment_style": "secure" | "anxious" | "avoidant" | "disorganized",
  "values_profile": {
    "wants_children": true | false | null,
    "financial_mindset": "saver" | "spender" | "balanced",
    "lifestyle": "homebody" | "adventurer" | "balanced",
    "family_orientation": "high" | "medium" | "low",
    "career_ambition": "high" | "medium" | "low",
    "core_values": ["list", "of", "top", "3-5", "values"]
  },
  "effort_score": 0.0-1.0,
  "identity_summary": "2-3 sentence plain text summary of who this person IS",
  "aspiration_summary": "2-3 sentence plain text summary of what this person WANTS in a partner"
}

Scoring guidelines:
- OCEAN scores: based on demonstrated behavior in responses, not self-reports
- effort_score: ratio of detailed, reflective answers vs brief/deflecting ones
- identity_summary: for generating identity_vector (who they are)
- aspiration_summary: for generating aspiration_vector (who they want)

TRANSCRIPT:
{transcript}"""


async def analyze_transcript(transcript: list[dict]) -> dict:
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")

    # Format transcript as readable text
    transcript_text = "\n".join(
        f"{'Interviewer' if m['role'] == 'assistant' else 'Interviewee'}: {m['content']}"
        for m in transcript
    )

    prompt = ANALYSIS_PROMPT.format(transcript=transcript_text)
    response = await model.generate_content_async(prompt)

    # Extract JSON from response
    text = response.text
    # Handle markdown code blocks
    json_match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text)
    if json_match:
        text = json_match.group(1)

    return json.loads(text)
