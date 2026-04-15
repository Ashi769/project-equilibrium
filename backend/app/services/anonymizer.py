"""
Strip PII (names, locations) from text before sending to external AI APIs.
Uses spaCy NER. Falls back to regex if model not loaded.
"""
import re

_nlp = None


def _get_nlp():
    global _nlp
    if _nlp is None:
        try:
            import spacy
            _nlp = spacy.load("en_core_web_sm")
        except Exception:
            _nlp = False  # spaCy not available, use regex fallback
    return _nlp if _nlp is not False else None


def anonymize(text: str) -> str:
    nlp = _get_nlp()
    if nlp:
        doc = nlp(text)
        redacted = text
        # Replace named entities in reverse order to preserve offsets
        for ent in sorted(doc.ents, key=lambda e: e.start_char, reverse=True):
            if ent.label_ in {"PERSON", "GPE", "LOC", "FAC", "ORG"}:
                placeholder = f"[{ent.label_}]"
                redacted = redacted[: ent.start_char] + placeholder + redacted[ent.end_char :]
        return redacted
    else:
        # Regex fallback: strip capitalized sequences of 2+ words (rough PERSON heuristic)
        return re.sub(r"\b([A-Z][a-z]+ ){1,3}[A-Z][a-z]+\b", "[NAME]", text)
