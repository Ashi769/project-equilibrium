"""
Manages interview sessions using Groq as the AI interviewer.

Ending strategy:
- The backend tracks which topics have been covered using a separate non-streaming
  Groq call after each user message (cheap, ~50 tokens).
- Once all required topics are covered, the backend appends a closing message
  and sends [END_INTERVIEW] — no sentinel parsing needed.
"""
from groq import AsyncGroq
from app.core.config import settings

ALL_TOPICS = [
    "lifestyle",          # daily life, hobbies, how they spend time
    "social",             # relationships with friends/family, how they recharge
    "past_relationships", # what worked, what didn't
    "conflict",           # how they handle disagreements
    "values",             # life goals, career, family, finances
    "ideal_partner",      # what they want in a partner
]

# In dev, set INTERVIEW_MIN_TOPICS=2 in .env to end after 2 topics (~3 min test)
_min = getattr(settings, "interview_min_topics", len(ALL_TOPICS))
REQUIRED_TOPICS = ALL_TOPICS[:_min]

INTERVIEW_SYSTEM_PROMPT = """You are a warm, empathetic interviewer for a matchmaking platform called Equilibrium.
Your job is to understand the person through natural conversation — not a survey.

Cover these areas naturally through the conversation:
- Daily life and lifestyle (hobbies, how they spend their time)
- Social life (friendships, family, how they recharge)
- Past relationships (what worked, what didn't, patterns they notice)
- Conflict and communication style
- Life values and goals (career, family, finances, where they see themselves in 5 years)
- What they want in a partner (not just traits, but how that person makes them feel)

CRITICAL RULES — never break these:
- Ask EXACTLY ONE question per response. One. Never two, never a follow-up.
- If you want to ask about multiple things, pick the single most interesting one and save the rest.
- A response ending with two question marks is always wrong.
- Be warm, curious, and conversational — not clinical.
- Build on what they say before moving to the next area.
- Keep responses concise — 2-3 sentences plus one question.
- Never mention psychology, personality tests, or frameworks by name."""

TOPIC_CHECK_PROMPT = """You are tracking which topics have been covered in an interview transcript.

Topics to track: lifestyle, social, past_relationships, conflict, values, ideal_partner

Given this transcript, return ONLY a JSON array of topics that have been meaningfully covered.
Example: ["lifestyle", "social", "past_relationships"]

Transcript:
{transcript}

Return ONLY the JSON array, nothing else."""

OPENING_MESSAGE = (
    "Hi! I'm so glad you're here. This conversation is a chance for us to get to know you — "
    "not through a form or a list of checkboxes, but through real conversation. "
    "There are no right or wrong answers, just your honest perspective.\n\n"
    "Let's start with something simple: what does a typical week look like for you right now? "
    "What takes up most of your time, and what parts do you actually look forward to?"
)

CLOSING_MESSAGE = (
    "Thank you so much for sharing all of this with me — I really enjoyed getting to know you. "
    "Your answers give us a genuinely rich picture of who you are and what you're looking for. "
    "We'll now build your profile and start finding your most compatible matches. Good luck! 🌟"
)


def _format_transcript(messages: list[dict]) -> str:
    return "\n".join(
        f"{'Interviewer' if m['role'] == 'assistant' else 'User'}: {m['content']}"
        for m in messages
    )


async def check_covered_topics(messages: list[dict]) -> list[str]:
    """Non-streaming call to check which topics have been covered so far."""
    client = AsyncGroq(api_key=settings.groq_api_key)
    transcript = _format_transcript(messages)

    try:
        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "user", "content": TOPIC_CHECK_PROMPT.format(transcript=transcript)}
            ],
            stream=False,
            temperature=0,
            max_tokens=100,
        )
        import json, re
        text = response.choices[0].message.content or "[]"
        match = re.search(r"\[.*?\]", text, re.DOTALL)
        return json.loads(match.group()) if match else []
    except Exception:
        return []


def all_topics_covered(covered: list[str]) -> bool:
    return all(t in covered for t in REQUIRED_TOPICS)


async def stream_response(messages: list[dict]):
    """
    Stream the AI interviewer response as SSE.
    Returns (async generator, is_last_message).
    Caller decides whether to append [END_INTERVIEW] after streaming.
    """
    client = AsyncGroq(api_key=settings.groq_api_key)

    stream = await client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[{"role": "system", "content": INTERVIEW_SYSTEM_PROMPT}] + messages,
        stream=True,
        temperature=0.7,
        max_tokens=180,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield f"data: {delta}\n\n"

    yield "data: [DONE]\n\n"
