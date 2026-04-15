"""
Manages interview sessions using Groq (Llama 3 8B) as the AI interviewer.
The system prompt contains a structured interview script targeting OCEAN traits,
attachment styles, and core values.
"""
from groq import AsyncGroq
from app.core.config import settings

INTERVIEW_SYSTEM_PROMPT = """You are a warm, empathetic interview guide for a matchmaking platform called Equilibrium.
Your goal is to understand the person deeply through natural conversation — not a survey.

You are conducting a structured but conversational interview to uncover:
1. **Big Five (OCEAN) traits**: Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism
2. **Attachment style**: Secure, Anxious, or Avoidant patterns in relationships
3. **Core values**: Financial philosophy, family goals, lifestyle preferences, life priorities
4. **Effort & depth**: Measure response length and thoughtfulness as a signal of seriousness

Interview structure (follow this loosely, adapt to conversation flow):
- Open warmly. Ask about their typical week, what energizes them vs drains them.
- Explore social life: how they recharge, relationship with friends/family.
- Dive into past relationships: what worked, what didn't, patterns they've noticed.
- Explore conflict: how they handle disagreements, what frustrates them most.
- Values: what does a good life look like to them in 5 years? Kids, career, lifestyle?
- Ideal partner: describe the person, not just traits but how they make you feel.

Rules:
- Ask ONE question at a time. Never ask multiple questions in one message.
- Listen and respond to what they say before moving on — don't mechanically follow the script.
- Be warm and curious, not clinical.
- After approximately 20-25 exchanges, naturally conclude the interview.
- When concluding, end your message with exactly: [INTERVIEW_COMPLETE]

Start by welcoming them warmly and asking your first open question."""

OPENING_MESSAGE = (
    "Hi! I'm so glad you're here. This conversation is a chance for us to get to know you — "
    "not through a form or a list of checkboxes, but through real conversation. "
    "There are no right or wrong answers, just your honest perspective.\n\n"
    "Let's start with something simple: **What does a typical week look like for you right now?** "
    "What takes up most of your time, and what parts do you actually look forward to?"
)


async def stream_response(messages: list[dict], session_id: str):
    """
    Stream Groq response tokens. Yields SSE-formatted strings.
    Detects [INTERVIEW_COMPLETE] and yields [END_INTERVIEW] sentinel.
    """
    client = AsyncGroq(api_key=settings.groq_api_key)

    full_response = ""
    stream = await client.chat.completions.create(
        model="llama3-8b-8192",
        messages=[{"role": "system", "content": INTERVIEW_SYSTEM_PROMPT}] + messages,
        stream=True,
        temperature=0.7,
        max_tokens=500,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            # Strip [INTERVIEW_COMPLETE] from streamed output
            if "[INTERVIEW_COMPLETE]" in (full_response + delta):
                clean = delta.replace("[INTERVIEW_COMPLETE]", "").strip()
                if clean:
                    yield f"data: {clean}\n\n"
                yield "data: [END_INTERVIEW]\n\n"
                return
            full_response += delta
            yield f"data: {delta}\n\n"

    yield "data: [DONE]\n\n"
