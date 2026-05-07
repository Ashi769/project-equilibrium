"""
Matching engine — 2-pass mutual matching algorithm.

Pass 1  (raw scoring):
  hard-filter SQL → vector similarity → top-K stored in match_candidates

Pass 2  (mutual filter):
  JOIN match_candidates in both directions → apply operational exclusions
  → mutual top-N stored in Match (display layer)

Rescue:
  Users with < RESCUE_MUTUAL_THRESHOLD active mutual matches get injected into
  compatible users' match_candidates at the start of the next cycle.
  Rescue rows survive the Pass 1 truncation (is_rescue=True).
"""

from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, and_, or_, exists, func, update
from sqlalchemy.orm import aliased
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.user import User
from app.models.match import Match, MatchStatus
from app.models.match_candidate import MatchCandidate
from app.models.psychometric import PsychometricProfile, AnalysisStatus
from app.models.schedule import Meeting
from app.models.invitation import Invitation
from app.schemas.matches import MatchSummary, MatchDetail, DimensionScore

# ── Scoring weights ───────────────────────────────────────────────────────────
WEIGHT_SEMANTIC   = 0.55
WEIGHT_LINGUISTIC = 0.25
WEIGHT_OCEAN      = 0.20

NEUROTICISM_PENALTY_THRESHOLD = 0.75
NEUROTICISM_PENALTY           = 0.15

# ── Tunable constants ─────────────────────────────────────────────────────────
PASS1_TOP_K               = 50   # candidates per user stored in Pass 1
MAX_VISIBLE_MATCHES       = 5    # mutual matches shown to each user
MATCH_COOLDOWN_DAYS       = 180  # same pair not re-shown within this window
RESCUE_MUTUAL_THRESHOLD   = 2    # min active matches before rescue triggers
RESCUE_INJECTION_LIMIT    = 10   # max target users injected per rescue user
RESCUE_CANDIDATES_PER_TARGET = 1 # max rescue injections per target user

# Legacy aliases kept for callers that import these names
TOP_N              = MAX_VISIBLE_MATCHES
RESCUE_MIN_FLOOR   = RESCUE_MUTUAL_THRESHOLD
RESCUE_SCORE_FLOOR = 0.25

FOOD_COMPATIBILITY = {
    "vegan":   ["vegan"],
    "veg":     ["vegan", "veg"],
    "egg":     ["veg", "egg", "non-veg"],
    "non-veg": ["egg", "non-veg"],
}


# ── Low-level helpers ─────────────────────────────────────────────────────────

def _vec_str(vec) -> str:
    if hasattr(vec, "tolist"):
        vec = vec.tolist()
    return "[" + ",".join(str(float(v)) for v in vec) + "]"


def _ocean_similarity(p1: PsychometricProfile, p2: PsychometricProfile) -> float:
    o1 = p1.ocean_scores or {}
    o2 = p2.ocean_scores or {}
    keys = ["openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"]
    diffs = [abs(o1.get(k, 0.5) - o2.get(k, 0.5)) for k in keys]
    return 1.0 - (sum(diffs) / len(diffs))


def _compute_composite_score(
    my_profile: PsychometricProfile,
    their_profile: PsychometricProfile,
    semantic_sim: float,
    comm_sim: float | None,
) -> float:
    linguistic = comm_sim if comm_sim is not None else semantic_sim
    score = (
        WEIGHT_SEMANTIC   * semantic_sim
        + WEIGHT_LINGUISTIC * linguistic
        + WEIGHT_OCEAN    * _ocean_similarity(my_profile, their_profile)
    )
    my_n    = (my_profile.ocean_scores  or {}).get("neuroticism", 0)
    their_n = (their_profile.ocean_scores or {}).get("neuroticism", 0)
    if my_n > NEUROTICISM_PENALTY_THRESHOLD and their_n > NEUROTICISM_PENALTY_THRESHOLD:
        score -= NEUROTICISM_PENALTY
    return max(0.0, min(1.0, score))


def _compute_top_dimensions(
    p1: PsychometricProfile, p2: PsychometricProfile
) -> list[DimensionScore]:
    o1 = p1.ocean_scores or {}
    o2 = p2.ocean_scores or {}
    labels = {
        "openness":          "Openness",
        "conscientiousness": "Conscientiousness",
        "extraversion":      "Extraversion",
        "agreeableness":     "Agreeableness",
        "neuroticism":       "Emotional Stability",
    }
    descriptions = {
        "openness":          "Both enjoy new experiences and ideas",
        "conscientiousness": "Aligned on reliability and organization",
        "extraversion":      "Similar social energy levels",
        "agreeableness":     "Both tend to be cooperative and warm",
        "neuroticism":       "Complementary emotional regulation",
    }
    dims = []
    for k, label in labels.items():
        sim = 1.0 - abs(o1.get(k, 0.5) - o2.get(k, 0.5))
        if k == "neuroticism":
            sim = 1.0 - (o1.get(k, 0.5) + o2.get(k, 0.5)) / 2
        dims.append(DimensionScore(label=label, score=sim, description=descriptions[k]))
    dims.sort(key=lambda d: d.score, reverse=True)
    return dims


def _build_preference_conditions(user: User) -> list:
    """SQL WHERE conditions for hard preference filters (bidirectional).

    Safe to reuse for both Pass 1 candidate selection and rescue injection
    target selection — excludes operational filters (cooldown, meetings).
    """
    import json as _json

    hf = user.hard_filters or {}
    seeking_genders = hf.get("seeking_gender", [])
    max_age_diff    = hf.get("max_age_diff")

    conditions = [
        PsychometricProfile.user_id != user.id,
        PsychometricProfile.analysis_status == AnalysisStatus.complete,
        PsychometricProfile.identity_vector.is_not(None),
    ]

    if seeking_genders:
        conditions.append(User.gender.in_(seeking_genders))
    if user.gender:
        conditions.append(
            text(
                "(coalesce(jsonb_array_length((users.hard_filters->'seeking_gender')::jsonb), 0) = 0"
                " OR (users.hard_filters->'seeking_gender')::jsonb @> :my_gender_json::jsonb)"
            ).bindparams(my_gender_json=_json.dumps([user.gender]))
        )

    if max_age_diff and user.age:
        conditions.append(
            User.age.between(user.age - max_age_diff, user.age + max_age_diff)
        )

    my_wants_children = hf.get("wants_children")
    if my_wants_children is not None:
        conditions.append(
            or_(
                User.hard_filters["wants_children"].as_boolean() == my_wants_children,
                User.hard_filters["wants_children"].is_(None),
            )
        )

    my_seeking_religion = hf.get("seeking_religion")
    if user.religion and my_seeking_religion and my_seeking_religion != "doesn't matter":
        conditions.append(User.religion == my_seeking_religion)
    if user.religion:
        conditions.append(
            or_(
                User.hard_filters["seeking_religion"].is_(None),
                User.hard_filters["seeking_religion"].as_string() == "doesn't matter",
                User.hard_filters["seeking_religion"].as_string() == user.religion,
            )
        )

    my_seeking_drinking = hf.get("seeking_drinking")
    if user.drinking and my_seeking_drinking and my_seeking_drinking != "doesn't matter":
        conditions.append(User.drinking == my_seeking_drinking)
    if user.drinking:
        conditions.append(
            or_(
                User.hard_filters["seeking_drinking"].is_(None),
                User.hard_filters["seeking_drinking"].as_string() == "doesn't matter",
                User.hard_filters["seeking_drinking"].as_string() == user.drinking,
            )
        )

    my_seeking_smoking = hf.get("seeking_smoking")
    if user.smoking and my_seeking_smoking and my_seeking_smoking != "doesn't matter":
        conditions.append(User.smoking == my_seeking_smoking)
    if user.smoking:
        conditions.append(
            or_(
                User.hard_filters["seeking_smoking"].is_(None),
                User.hard_filters["seeking_smoking"].as_string() == "doesn't matter",
                User.hard_filters["seeking_smoking"].as_string() == user.smoking,
            )
        )

    my_seeking_food = hf.get("seeking_food")
    my_food = user.food_preference
    if my_food and my_seeking_food and my_seeking_food != "doesn't matter":
        my_compat = FOOD_COMPATIBILITY.get(my_food, [my_food])
        conditions.append(User.food_preference.in_(my_compat))
    if my_food:
        rev_compat = [f for f, c in FOOD_COMPATIBILITY.items() if my_food in c]
        conditions.append(
            or_(
                User.hard_filters["seeking_food"].is_(None),
                User.hard_filters["seeking_food"].as_string() == "doesn't matter",
                User.food_preference.in_(rev_compat),
            )
        )

    return conditions


# ── Candidate count (rescue feasibility) ─────────────────────────────────────

async def count_hard_filter_candidates(user: User, db: AsyncSession) -> int:
    conditions = _build_preference_conditions(user)
    result = await db.execute(
        select(func.count())
        .select_from(User)
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(and_(*conditions))
    )
    return result.scalar() or 0


# ── Pass 1: raw scoring ───────────────────────────────────────────────────────

async def run_pass1_for_user(user: User, db: AsyncSession) -> None:
    """Compute top-K candidates and insert into match_candidates.

    Uses ON CONFLICT DO NOTHING so rescue-injected rows are never overwritten.
    """
    profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
    )
    my_profile = profile_result.scalar_one_or_none()
    if not my_profile or my_profile.aspiration_vector is None:
        return

    conditions = _build_preference_conditions(user)
    asp_vec = _vec_str(my_profile.aspiration_vector)

    has_comm = my_profile.communication_vector is not None
    comm_col = ""
    if has_comm:
        comm_vec = _vec_str(my_profile.communication_vector)
        comm_col = (
            f", COALESCE(1 - (psychometric_profiles.communication_vector"
            f" <=> '{comm_vec}'::vector), NULL) AS comm_sim"
        )

    query = (
        select(
            User,
            PsychometricProfile,
            text(
                f"1 - (psychometric_profiles.identity_vector <=> '{asp_vec}'::vector)"
                f" AS semantic_sim{comm_col}"
            ),
        )
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(and_(*conditions))
        .order_by(text("semantic_sim DESC"))
        .limit(PASS1_TOP_K)
    )

    rows = (await db.execute(query)).all()
    if not rows:
        return

    now = datetime.now(timezone.utc)
    values = []
    for row in rows:
        if has_comm:
            candidate_user, candidate_profile, semantic_sim, comm_sim = row
        else:
            candidate_user, candidate_profile, semantic_sim = row
            comm_sim = None

        score = _compute_composite_score(
            my_profile,
            candidate_profile,
            float(semantic_sim),
            float(comm_sim) if comm_sim is not None else None,
        )
        values.append({
            "user_id":      user.id,
            "candidate_id": candidate_user.id,
            "score":        score,
            "is_rescue":    False,
            "computed_at":  now,
        })

    await db.execute(
        pg_insert(MatchCandidate).values(values).on_conflict_do_nothing()
    )
    await db.commit()


# ── Pass 2: mutual matching ───────────────────────────────────────────────────

async def run_pass2_for_user(user: User, db: AsyncSession) -> list[MatchSummary]:
    """Find mutual matches and write to Match table (display layer).

    Mutual = A has B in match_candidates AND B has A in match_candidates.
    Applies cooldown, meeting history, and referral exclusions.
    """
    my_profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
    )
    my_profile = my_profile_result.scalar_one_or_none()
    if not my_profile:
        return []

    mc_a = aliased(MatchCandidate)
    mc_b = aliased(MatchCandidate)

    cooldown_cutoff = datetime.now(timezone.utc) - timedelta(days=MATCH_COOLDOWN_DAYS)

    meeting_exists = exists().where(
        or_(
            and_(Meeting.proposer_id == user.id, Meeting.match_id == User.id),
            and_(Meeting.proposer_id == User.id, Meeting.match_id == user.id),
        )
    )
    recently_matched = exists().where(
        and_(
            Match.user_id == user.id,
            Match.matched_user_id == User.id,
            Match.first_matched_at > cooldown_cutoff,
        )
    )
    referral_link = exists().where(
        or_(
            and_(Invitation.created_by == User.id, Invitation.used_by == user.id),
            and_(Invitation.created_by == user.id, Invitation.used_by == User.id),
        )
    )

    mutual_query = (
        select(User, PsychometricProfile, mc_a.score)
        .select_from(mc_a)
        .join(mc_b, and_(
            mc_b.user_id == mc_a.candidate_id,
            mc_b.candidate_id == user.id,
        ))
        .join(User, User.id == mc_a.candidate_id)
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(
            mc_a.user_id == user.id,
            ~meeting_exists,
            ~recently_matched,
            ~referral_link,
        )
        .order_by(mc_a.score.desc())
        .limit(MAX_VISIBLE_MATCHES)
    )

    rows = (await db.execute(mutual_query)).all()

    now = datetime.now(timezone.utc)
    matches: list[MatchSummary] = []
    upsert_rows = []

    for candidate_user, candidate_profile, score in rows:
        dims = _compute_top_dimensions(my_profile, candidate_profile)
        upsert_rows.append({
            "user_id":             user.id,
            "matched_user_id":     candidate_user.id,
            "compatibility_score": float(score),
            "dimension_scores":    [d.model_dump() for d in dims],
            "computed_at":         now,
            "first_matched_at":    now,
            "status":              MatchStatus.active,
            "status_changed_at":   None,
        })
        matches.append(MatchSummary(
            id=candidate_user.id,
            name=candidate_user.name,
            age=candidate_user.age,
            compatibility_score=float(score),
            top_dimensions=dims[:3],
        ))

    if upsert_rows:
        stmt = pg_insert(Match).values(upsert_rows).on_conflict_do_update(
            index_elements=["user_id", "matched_user_id"],
            set_={
                "compatibility_score": pg_insert(Match).excluded.compatibility_score,
                "dimension_scores":    pg_insert(Match).excluded.dimension_scores,
                "computed_at":         pg_insert(Match).excluded.computed_at,
                "status":              MatchStatus.active,
                "status_changed_at":   None,
                # first_matched_at intentionally excluded — preserved from original insert
            },
        )
        await db.execute(stmt)

    # Expire rows outside cooldown window that aren't in this cycle's mutual batch
    current_ids = {m.id for m in matches}
    await db.execute(
        update(Match)
        .where(
            Match.user_id == user.id,
            Match.matched_user_id.not_in(current_ids) if current_ids else text("true"),
            Match.first_matched_at < cooldown_cutoff,
            Match.status == MatchStatus.active,
        )
        .values(status=MatchStatus.expired, status_changed_at=now)
    )

    await db.commit()
    return matches


# ── Rescue: injection ─────────────────────────────────────────────────────────

async def run_rescue_injection(db: AsyncSession) -> None:
    """Inject rescue-flagged users into compatible users' match_candidates.

    For each rescue user B:
      - Run reverse vector query (B's identity vs everyone's aspiration)
      - Skip target users who already have a rescue entry (1 per target max)
      - Insert (target, B, score, is_rescue=True) with ON CONFLICT DO NOTHING
    """
    rescue_result = await db.execute(
        select(User)
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(
            User.rescue_flagged == True,  # noqa: E712
            PsychometricProfile.analysis_status == AnalysisStatus.complete,
            PsychometricProfile.identity_vector.is_not(None),
        )
    )
    rescue_users = rescue_result.scalars().all()

    for user_b in rescue_users:
        profile_result = await db.execute(
            select(PsychometricProfile).where(PsychometricProfile.user_id == user_b.id)
        )
        profile_b = profile_result.scalar_one_or_none()
        if not profile_b or profile_b.identity_vector is None:
            continue

        rev_vec = _vec_str(profile_b.identity_vector)
        conditions = _build_preference_conditions(user_b)

        target_query = (
            select(
                User.id,
                text(
                    f"1 - (psychometric_profiles.aspiration_vector <=> '{rev_vec}'::vector)"
                    " AS rev_sim"
                ),
            )
            .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
            .where(
                and_(*conditions),
                PsychometricProfile.aspiration_vector.is_not(None),
                ~exists().where(
                    and_(
                        MatchCandidate.user_id == User.id,
                        MatchCandidate.is_rescue == True,  # noqa: E712
                    )
                ),
            )
            .order_by(text("rev_sim DESC"))
            .limit(RESCUE_INJECTION_LIMIT)
        )

        targets = (await db.execute(target_query)).all()
        now = datetime.now(timezone.utc)

        for target_id, rev_sim in targets:
            await db.execute(
                pg_insert(MatchCandidate)
                .values(
                    user_id=target_id,
                    candidate_id=user_b.id,
                    score=float(rev_sim),
                    is_rescue=True,
                    computed_at=now,
                )
                .on_conflict_do_nothing()
            )

        await db.commit()


# ── Rescue: detection ─────────────────────────────────────────────────────────

async def run_rescue_detection(db: AsyncSession) -> None:
    """Flag users with fewer than RESCUE_MUTUAL_THRESHOLD active mutual matches."""
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(User.id, func.count(Match.id).label("match_count"))
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .outerjoin(
            Match,
            and_(Match.user_id == User.id, Match.status == MatchStatus.active),
        )
        .where(
            PsychometricProfile.analysis_status == AnalysisStatus.complete,
            PsychometricProfile.identity_vector.is_not(None),
        )
        .group_by(User.id)
    )

    rows = result.all()
    needs_rescue = [uid for uid, cnt in rows if cnt < RESCUE_MUTUAL_THRESHOLD]
    has_enough   = [uid for uid, cnt in rows if cnt >= RESCUE_MUTUAL_THRESHOLD]

    if needs_rescue:
        await db.execute(
            update(User)
            .where(User.id.in_(needs_rescue))
            .values(rescue_flagged=True, rescue_flagged_at=now)
        )
    if has_enough:
        await db.execute(
            update(User)
            .where(User.id.in_(has_enough))
            .values(rescue_flagged=False, rescue_flagged_at=None)
        )
    await db.commit()


# ── Single-user immediate compute (post-interview) ────────────────────────────

async def compute_and_cache_matches(user: User, db: AsyncSession) -> list[MatchSummary]:
    """Run Pass 1 + Pass 2 for a single user immediately after interview.

    Pass 2 requires other users' Pass 1 data to exist in match_candidates.
    On cold start (no mutual candidates found), falls back to one-directional
    matches so the user sees something immediately; the nightly batch will
    replace these with proper mutual matches.
    """
    await run_pass1_for_user(user, db)
    matches = await run_pass2_for_user(user, db)
    if matches:
        return matches
    return await _compute_onedirectional_fallback(user, db)


async def _compute_onedirectional_fallback(
    user: User, db: AsyncSession
) -> list[MatchSummary]:
    """Cold-start fallback: one-directional matches stored until nightly batch."""
    profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
    )
    my_profile = profile_result.scalar_one_or_none()
    if not my_profile or my_profile.aspiration_vector is None:
        return []

    conditions = _build_preference_conditions(user)
    cooldown_cutoff = datetime.now(timezone.utc) - timedelta(days=MATCH_COOLDOWN_DAYS)

    conditions.extend([
        ~exists().where(
            or_(
                and_(Meeting.proposer_id == user.id, Meeting.match_id == User.id),
                and_(Meeting.proposer_id == User.id, Meeting.match_id == user.id),
            )
        ),
        ~exists().where(
            and_(
                Match.user_id == user.id,
                Match.matched_user_id == User.id,
                Match.first_matched_at > cooldown_cutoff,
            )
        ),
        ~exists().where(
            or_(
                and_(Invitation.created_by == User.id, Invitation.used_by == user.id),
                and_(Invitation.created_by == user.id, Invitation.used_by == User.id),
            )
        ),
    ])

    asp_vec = _vec_str(my_profile.aspiration_vector)
    has_comm = my_profile.communication_vector is not None
    comm_col = ""
    if has_comm:
        comm_vec = _vec_str(my_profile.communication_vector)
        comm_col = (
            f", COALESCE(1 - (psychometric_profiles.communication_vector"
            f" <=> '{comm_vec}'::vector), NULL) AS comm_sim"
        )

    query = (
        select(
            User,
            PsychometricProfile,
            text(
                f"1 - (psychometric_profiles.identity_vector <=> '{asp_vec}'::vector)"
                f" AS semantic_sim{comm_col}"
            ),
        )
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(and_(*conditions))
        .order_by(text("semantic_sim DESC"))
        .limit(MAX_VISIBLE_MATCHES)
    )

    rows = (await db.execute(query)).all()
    now = datetime.now(timezone.utc)
    matches: list[MatchSummary] = []
    upsert_rows = []

    for row in rows:
        if has_comm:
            candidate_user, candidate_profile, semantic_sim, comm_sim = row
        else:
            candidate_user, candidate_profile, semantic_sim = row
            comm_sim = None

        score = _compute_composite_score(
            my_profile,
            candidate_profile,
            float(semantic_sim),
            float(comm_sim) if comm_sim is not None else None,
        )
        dims = _compute_top_dimensions(my_profile, candidate_profile)
        upsert_rows.append({
            "user_id":             user.id,
            "matched_user_id":     candidate_user.id,
            "compatibility_score": score,
            "dimension_scores":    [d.model_dump() for d in dims],
            "computed_at":         now,
            "first_matched_at":    now,
            "status":              MatchStatus.active,
            "status_changed_at":   None,
        })
        matches.append(MatchSummary(
            id=candidate_user.id,
            name=candidate_user.name,
            age=candidate_user.age,
            compatibility_score=score,
            top_dimensions=dims[:3],
        ))

    if upsert_rows:
        stmt = pg_insert(Match).values(upsert_rows).on_conflict_do_update(
            index_elements=["user_id", "matched_user_id"],
            set_={
                "compatibility_score": pg_insert(Match).excluded.compatibility_score,
                "dimension_scores":    pg_insert(Match).excluded.dimension_scores,
                "computed_at":         pg_insert(Match).excluded.computed_at,
                "status":              MatchStatus.active,
                "status_changed_at":   None,
            },
        )
        await db.execute(stmt)

    # Expire stale rows outside the cooldown window
    current_ids = {m.id for m in matches}
    await db.execute(
        update(Match)
        .where(
            Match.user_id == user.id,
            Match.matched_user_id.not_in(current_ids) if current_ids else text("true"),
            Match.first_matched_at < cooldown_cutoff,
            Match.status == MatchStatus.active,
        )
        .values(status=MatchStatus.expired, status_changed_at=now)
    )

    await db.commit()
    return matches


# ── Match detail (API helper) ─────────────────────────────────────────────────

async def get_match_detail(
    user: User, match_user_id: str, db: AsyncSession
) -> MatchDetail | None:
    result = await db.execute(
        select(User, PsychometricProfile)
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(User.id == match_user_id)
    )
    row = result.first()
    if not row:
        return None

    match_user, match_profile = row

    my_profile_result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
    )
    my_profile = my_profile_result.scalar_one_or_none()

    if (
        not my_profile
        or my_profile.aspiration_vector is None
        or match_profile.identity_vector is None
    ):
        return None

    has_comm = (
        my_profile.communication_vector is not None
        and match_profile.communication_vector is not None
    )
    comm_clause = (
        ", 1 - (a.communication_vector <=> b.communication_vector) AS comm_sim"
        if has_comm
        else ""
    )
    sim_result = await db.execute(
        text(
            f"SELECT 1 - (a.aspiration_vector <=> b.identity_vector) AS sem_sim{comm_clause} "
            "FROM psychometric_profiles a, psychometric_profiles b "
            "WHERE a.user_id = :uid_a AND b.user_id = :uid_b"
        ).bindparams(uid_a=user.id, uid_b=match_user_id)
    )
    sim_row = sim_result.first()
    semantic_score = float(sim_row[0]) if sim_row else 0.0
    comm_sim = float(sim_row[1]) if (sim_row and has_comm) else None

    score = _compute_composite_score(my_profile, match_profile, semantic_score, comm_sim)
    all_dims = _compute_top_dimensions(my_profile, match_profile)

    my_values    = set((my_profile.values_profile    or {}).get("core_values", []))
    their_values = set((match_profile.values_profile or {}).get("core_values", []))

    return MatchDetail(
        id=match_user.id,
        name=match_user.name,
        age=match_user.age,
        compatibility_score=score,
        dimension_scores=all_dims,
        attachment_style=match_profile.attachment_style,
        shared_values=list(my_values & their_values),
    )
