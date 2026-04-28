# Matching Fairness — Design & Implementation

**Date:** April 2026  
**Status:** Phase 1 + 2 shipped. Phase 3 (shadow pricing) designed, not yet built.

---

## Problem Statement

The original matching engine computed `TOP_N = 20` matches per user and returned all of them via the API with no cap. Two problems:

1. **Choice overload** — showing 20 matches overwhelms users and creates a rejection mindset. Research (Pronk & Denissen 2020, Lenton & Francesconi 2010) shows acceptance rates *decrease* as more options are presented.
2. **Unequal exposure** — users with high compatibility scores monopolise other users' pools. Some users never appear in anyone's top-N and are permanently invisible.

---

## Research Basis

### Choice Overload
- **Pronk & Denissen (2020)** — 27% decrease in acceptance rate from first to last option. Users become more rejecting as options increase.
- **Lenton & Francesconi (2010)** — with abundant choice, humans shift from evaluating depth (values, character) to surface features. Cognitive bandwidth is finite.
- **Iyengar & Lepper (2000)** — the jam study: 6 options → 40% conversion; 24 options → 3%. Directly applicable to dating.

**Conclusion:** 5 is the right number. Not a guess — backed by literature.

### The Invisibility Problem
- **Yang et al. (SSRN)** — rejection-sensitive people use dating apps *more* to combat loneliness, but apps don't help them find partners. Zero matches creates a compounding spiral.
- **Stevic & Lee (2025)** — what predicts user wellbeing is *perceived* success, not actual match quality. Being invisible is the worst outcome.

### Fairness Perception
- **Leventhal's Procedural Justice** — people accept unequal outcomes if they trust the *process*. Transparency matters more than perfect equality.
- **Singh & Joachims KDD 2018** — "Fairness of Exposure in Rankings" — shadow pricing as the principled solution to exposure inequality in ranked lists.

### What Doesn't Work
- **Finkel et al. (2012)** — algorithmic matching claims "lack scientific validity." What matters is perceived success, not optimised compatibility scores.
- **ELO/popularity-based systems** — create rich-get-richer dynamics where popular users monopolise pools. Our system avoids this by using merit (vector similarity), not popularity (swipe counts).

---

## Failure Modes Identified

Three distinct failure modes, each requiring a different fix:

### Failure A — Choice Overload (user-facing)
Too many matches shown. Fixed by `MAX_VISIBLE_MATCHES = 5`.

### Failure B — Stranded Inbound (algorithm-level)
User V exists with a complete profile but their adjusted score never beats the cutoff to enter anyone's `TOP_N × 2` SQL fetch. They are invisible system-wide.

Fixed by: **Rescue Pass** (Phase 1.5 in nightly batch).

### Failure C — Stranded Outbound (user data)
User V's own hard filters are so strict that `get_matches(V)` returns 0 candidates. Their preferences eliminate everyone in the system.

Fixed by: **Hard filter feasibility check** + `rescue_flagged` flag. The algorithm cannot solve this — it requires user notification or human review.

---

## Solutions Considered

### Option A — Exposure-Weighted Scoring (Shadow Pricing)
Add a fairness bonus `λ_v` to underexposed users' scores at compute time.

```
S_adjusted(u, v) = S_base(u, v) + λ_v
λ_v^(t+1) = clip(λ_v^(t) + η × (Target - Actual), -λ_penalty_max, λ_max)
```

**Breaks circular dependency** by using yesterday's λ to shape today's pools. Singh & Joachims KDD 2018.

**Parameters designed (not yet built):**
```
λ_max           = +0.25   # boost ceiling (underexposed)
λ_penalty_max   = -0.20   # penalty floor (overexposed)
η_boost         =  0.02   # ~4 days to reach λ_max from zero exposure
η_penalty       =  0.02   # ~10 days to reach λ_penalty_max
TARGET_EXPOSURE =  3      # appear in at least 3 pools per epoch
OVEREXPOSURE_THRESHOLD = 1.5  # penalty only above 1.5× target
DECAY_FACTOR    =  0.95   # λ drifts toward 0 in the dead zone (near target)
```

**λ_max is also an infeasibility detector.** In a feasible market, λ converges naturally. If λ stays at `λ_max` for K consecutive nights, the market cannot satisfy the constraint — trigger the hard filter check.

**The SQL ORDER BY must carry the boost:**
```python
.order_by(text("semantic_sim + COALESCE(psychometric_profiles.shadow_price, 0) DESC"))
```
Without this, a boosted user with low raw `semantic_sim` never makes it into the `TOP_N × 2` SQL fetch. The boost fires in Python over candidates that were already excluded.

**Status:** Designed. Deferred to Phase 3 — needs exposure distribution data first.

### Option B — Rescue Pass (Two-Pass Algorithm)
After all pools are computed, run a global pass to identify and inject stranded users.

**Status:** Shipped in Phase 1.

### Option C — Discovery Slot (Display Layer)
Reserve 1 of the 5 visible slots for the match that has waited longest without visibility (oldest `first_matched_at` from pool positions `remaining_slots` to 20).

**Status:** Shipped in Phase 2.

### Option D — Penalty on Overexposed Users
Symmetric dual gradient — allow λ to go negative, suppressing overexposed users' scores at the margin.

**PM review decision:** Removed from scope. Our system uses merit-based exposure (vector similarity), not popularity-based (ELO). Penalising users who score high with many people because they're genuinely compatible is the wrong call. Revisit only if data shows monopolisation.

---

## What Was Built

### Phase 1: 5-Match Cap + Rescue Pass

**`MAX_VISIBLE_MATCHES = 5`** — hard cap. Prevents choice overload.

**`_build_preference_conditions(user)`** — extracted from `get_matches()`. All SQL hard-filter conditions (gender, age, wants_children, religion, drinking, smoking, food) in one place, reusable without vector/operational logic.

**`count_hard_filter_candidates(user, db)`** — runs a pure `COUNT(*)` against preference conditions only (no vectors, no cooldown). Used by the rescue pass to distinguish:
- `count == 0` → Failure C (infeasible preferences) → flag for human review
- `count > 0` → Failure B (scoring/density) → inject, don't flag

**`_run_rescue_pass(Session)`** — runs as Phase 1.5 of the nightly batch, after all individual pools are computed:

```
1. Find all users with 0 appearances as matched_user_id in the matches table
2. For each stranded user V:
   a. count_hard_filter_candidates(V)
      → 0: set rescue_flagged=True, rescue_flagged_at=now, skip
      → >0: continue
   b. get_matches(V) — bidirectionally filter-verified hosts
   c. For each host U (best compatibility first):
      - Skip if V already in U's cache
      - If U's cache has room (< TOP_N): inject directly
      - Elif U's lowest match scores below V's score: evict it, inject V
      - Else: skip this host
      - Stop after RESCUE_MIN_FLOOR = 2 injections
```

Constants:
```python
RESCUE_MIN_FLOOR  = 2     # minimum pool appearances before rescue stops
RESCUE_SCORE_FLOOR = 0.25  # minimum score to qualify for rescue injection
```

**Migration `0007`** adds `rescue_flagged` (bool) and `rescue_flagged_at` (timestamp) to the `users` table.

> **Note on `rescue_flagged`:** Currently written but not read. Intended to drive a user nudge ("your preferences are very specific — review your must-haves") and admin dashboard visibility. Build the read path when notification infrastructure exists.

---

### Phase 2: Discovery Slot + Meeting Cap

**Connection cap** (`list_matches` API):

Active meetings (`proposed` + `confirmed`) consume slots from the same `MAX_VISIBLE_MATCHES = 5` cap. When a meeting is proposed, match rows are already deleted from both users' caches (`schedule.py:117-128`). The missing piece was subtracting the meeting count before slicing the match list.

```
remaining_slots = max(0, MAX_VISIBLE_MATCHES - active_meeting_count)
```

Invariant: `matches_shown + active_meetings ≤ 5`, always.

**Discovery slot:**

From the full TOP_N cached pool, show `remaining_slots` connections total:
- `remaining_slots == 0`: return empty
- `remaining_slots == 1`: show top 1 by score, no discovery
- `remaining_slots ≥ 2`: show top `(remaining_slots - 1)` by score + 1 discovery

Discovery selection: from pool positions `remaining_slots` to `TOP_N`, pick whoever has the oldest `first_matched_at` — the person who has been in the pool longest without being surfaced as a visible match.

**Why not tell users which match is the "discovery"?**  
Labelling one match creates a two-tier perception before users even look at the profile. Netflix doesn't tell you why a title is being recommended. The fairness work happens silently; users see 5 matches and nothing else.

---

## Architecture: The Three Layers

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 1: Compute (nightly batch)                       │
│  Shadow pricing — λ_v in SQL ORDER BY                   │
│  Ensures underexposed users enter pools in the first    │
│  place. (Phase 3 — not yet built)                       │
├─────────────────────────────────────────────────────────┤
│  LAYER 2: Rescue Pass (nightly batch, Phase 1.5)        │
│  For users with 0 inbound appearances:                  │
│  • 0 hard-filter candidates → flag, stop                │
│  • >0 candidates → inject into best hosts               │
│  Guarantees every feasible user appears in ≥ 2 pools    │
├─────────────────────────────────────────────────────────┤
│  LAYER 3: Display (GET /matches API)                    │
│  • Cap: remaining_slots = 5 − active_meetings           │
│  • Split: (remaining_slots − 1) core + 1 discovery      │
│  • Discovery = oldest first_matched_at in positions     │
│    remaining_slots…TOP_N                                │
└─────────────────────────────────────────────────────────┘
```

Layer 1 (not built) prevents casual underexposure.  
Layer 2 eliminates zero-exposure.  
Layer 3 amplifies visibility at the display layer and enforces the human connection cap.

---

## Files Changed

| File | Change |
|---|---|
| `app/api/v1/matches.py` | Meeting cap, discovery slot split |
| `app/models/user.py` | `rescue_flagged`, `rescue_flagged_at` fields |
| `app/schemas/matches.py` | `MAX_VISIBLE_MATCHES = 5` applied |
| `app/services/matching_service.py` | `_build_preference_conditions`, `count_hard_filter_candidates`, rescue constants |
| `app/workers/tasks.py` | `_run_rescue_pass` added, called after nightly batch |
| `alembic/versions/0007_rescue_flag.py` | Migration: rescue flag columns |

---

## Phase 3: Shadow Pricing (Next)

When to build: after measuring exposure Gini coefficient on real data. If distribution looks healthy (most users appearing in 2–5 pools), the rescue pass is sufficient. If a long tail of near-stranded users persists despite the rescue pass, add shadow pricing.

The implementation requires:
1. Add `shadow_price: Float` to `psychometric_profiles` (new migration)
2. Modify SQL `ORDER BY` in `get_matches()` to include `COALESCE(shadow_price, 0)`
3. Add Python-side score adjustment: `score = min(1.0, score + candidate_profile.shadow_price)`
4. Add Phase 2 (exposure count) and Phase 3 (λ update) to nightly batch after rescue pass
5. Use `λ = λ_max / 2 = 0.125` as warm-start for newly onboarded users

Key metric to watch: if `rescue_flagged` users cluster around certain filter combinations, that's a signal the user base composition itself needs attention, not just the algorithm.

---

## Key Design Decisions (with Reasoning)

| Decision | Rationale |
|---|---|
| Cap at 5, not 3 or 10 | Literature (Pronk & Denissen, Iyengar & Lepper) converges on ~6 as the choice overload threshold. 5 leaves a small buffer. |
| Meetings count against the cap | Juggling 5 matches + 3 meetings = 8 active people. The cap should be holistic — total emotional bandwidth, not just "new" connections. |
| Discovery uses `first_matched_at`, not λ | λ doesn't exist yet (Phase 3). `first_matched_at` is available now, requires no new columns, and correctly identifies who has been waiting longest. |
| Don't label the discovery match | Avoids two-tier perception before users engage with the profile. Fairness happens in the background. |
| Rescue injects using V's perspective score | The score from `get_matches(V)` (V's aspiration vs U's identity) is used as the injection score. Not perfectly calibrated from U's perspective, but this is a rescue — visibility matters more than score precision. |
| Hard filter flag only, not soft filter | If `count > 0` but scores are too low, that's the algorithm's problem to solve (boost λ). Only flag when the user's *stated preferences* make compatibility impossible. Flagging someone for low vector scores would be cruel and wrong. |
| No penalty on overexposed users (yet) | Our overexposure is merit-based (high compatibility with many people), not popularity-based (ELO). Penalising genuine compatibility is the wrong call. |
