"""
Matching engine:
1. Hard filter: SQL WHERE clause (deal-breakers)
2. Vector similarity: pgvector cosine distance (aspiration_A vs identity_B)
3. Conflict penalty: reduce score for high-neuroticism pairs
4. Return top N matches with dimension breakdown
"""

from datetime import datetime, timezone, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, and_, or_, exists
from app.models.user import User
from app.models.match import Match
from app.models.psychometric import PsychometricProfile, AnalysisStatus
from app.models.schedule import Meeting, MeetingStatus
from app.schemas.matches import MatchSummary, MatchDetail, DimensionScore

NEUROTICISM_PENALTY_THRESHOLD = 0.75  # Both users above this → penalize
NEUROTICISM_PENALTY = 0.15
TOP_N = 20

# Matching weight distribution
WEIGHT_SEMANTIC = 0.55  # aspiration_A vs identity_B
WEIGHT_LINGUISTIC = 0.25  # communication style similarity
WEIGHT_OCEAN = 0.20  # OCEAN dimension similarity


FOOD_COMPATIBILITY = {
    "vegan": ["vegan"],
    "veg": ["vegan", "veg"],
    "egg": ["veg", "egg", "non-veg"],
    "non-veg": ["egg", "non-veg"],
}


def _meets_bidirectional_filters(user: User, candidate: User) -> bool:
    """Check if candidate meets user's preferences AND user meets candidate's preferences."""
    my_filters = user.hard_filters or {}
    their_filters = candidate.hard_filters or {}

    my_gender = user.gender
    their_gender = candidate.gender

    # Gender check: both must want each other's gender
    if my_gender and their_gender:
        my_seeking = my_filters.get("seeking_gender")
        their_seeking = their_filters.get("seeking_gender")

        if their_seeking and my_gender not in their_seeking:
            return False
        if my_seeking and their_gender not in my_seeking:
            return False

    # Religion: both must have matching preferences
    my_religion = user.religion
    their_religion = candidate.religion
    my_seeking_religion = my_filters.get("seeking_religion")
    their_seeking_religion = their_filters.get("seeking_religion")

    if (
        my_religion
        and their_religion
        and my_seeking_religion
        and my_seeking_religion != "doesn't matter"
    ):
        if their_religion != my_seeking_religion:
            return False
    if (
        my_religion
        and their_religion
        and their_seeking_religion
        and their_seeking_religion != "doesn't matter"
    ):
        if my_religion != their_seeking_religion:
            return False

    # Food preference: compatible diets
    my_food = user.food_preference
    their_food = candidate.food_preference
    my_seeking_food = my_filters.get("seeking_food")
    their_seeking_food = their_filters.get("seeking_food")

    if my_food and their_food:
        my_compatible = FOOD_COMPATIBILITY.get(my_food, [my_food])
        their_compatible = FOOD_COMPATIBILITY.get(their_food, [their_food])

        if my_seeking_food and my_seeking_food != "doesn't matter":
            if their_food not in my_compatible:
                return False
        if their_seeking_food and their_seeking_food != "doesn't matter":
            if my_food not in their_compatible:
                return False

    # Drinking: both must have matching preferences
    my_drinking = user.drinking
    their_drinking = candidate.drinking
    my_seeking_drinking = my_filters.get("seeking_drinking")
    their_seeking_drinking = their_filters.get("seeking_drinking")

    if (
        my_drinking
        and their_drinking
        and my_seeking_drinking
        and my_seeking_drinking != "doesn't matter"
    ):
        if their_drinking != my_seeking_drinking:
            return False
    if (
        my_drinking
        and their_drinking
        and their_seeking_drinking
        and their_seeking_drinking != "doesn't matter"
    ):
        if my_drinking != their_seeking_drinking:
            return False

    # Smoking: both must have matching preferences
    my_smoking = user.smoking
    their_smoking = candidate.smoking
    my_seeking_smoking = my_filters.get("seeking_smoking")
    their_seeking_smoking = their_filters.get("seeking_smoking")

    if (
        my_smoking
        and their_smoking
        and my_seeking_smoking
        and my_seeking_smoking != "doesn't matter"
    ):
        if their_smoking != my_seeking_smoking:
            return False
    if (
        my_smoking
        and their_smoking
        and their_seeking_smoking
        and their_seeking_smoking != "doesn't matter"
    ):
        if my_smoking != their_seeking_smoking:
            return False

    return True


async def get_matches(user: User, db: AsyncSession) -> list[MatchSummary]:
    # Fetch current user's profile
    result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
    )
    my_profile = result.scalar_one_or_none()

    if not my_profile or my_profile.aspiration_vector is None:
        return []

    import json as _json

    hard_filters = user.hard_filters or {}
    seeking_genders = hard_filters.get("seeking_gender", [])
    max_age_diff = hard_filters.get("max_age_diff")

    # Build hard filter conditions
    conditions = [
        PsychometricProfile.user_id != user.id,
        PsychometricProfile.analysis_status == AnalysisStatus.complete,
        PsychometricProfile.identity_vector.is_not(None),
    ]

    # Gender filter — SQL level, bidirectional
    # A: candidate's gender must be one I'm seeking
    if seeking_genders:
        conditions.append(User.gender.in_(seeking_genders))
    # B: candidate must want my gender (or have no preference set / empty list)
    if user.gender:
        conditions.append(
            text(
                "(coalesce(jsonb_array_length((users.hard_filters->'seeking_gender')::jsonb), 0) = 0"
                " OR (users.hard_filters->'seeking_gender')::jsonb @> :my_gender_json::jsonb)"
            ).bindparams(my_gender_json=_json.dumps([user.gender]))
        )

    # Age filter
    if max_age_diff and user.age:
        conditions.append(
            User.age.between(user.age - max_age_diff, user.age + max_age_diff)
        )

    # Exclude users who have any meeting history with current user
    meeting_exists = exists().where(
        or_(
            and_(Meeting.proposer_id == user.id, Meeting.match_id == User.id),
            and_(Meeting.proposer_id == User.id, Meeting.match_id == user.id),
        ),
    )
    conditions.append(~meeting_exists)

    # Cooldown: exclude candidates matched within the last MATCH_COOLDOWN_DAYS
    cooldown_cutoff = datetime.now(timezone.utc) - timedelta(days=MATCH_COOLDOWN_DAYS)
    recently_matched = exists().where(
        and_(
            Match.user_id == user.id,
            Match.matched_user_id == User.id,
            Match.first_matched_at > cooldown_cutoff,
        )
    )
    conditions.append(~recently_matched)

    # wants_children hard filter
    my_wants_children = hard_filters.get("wants_children")
    if my_wants_children is not None:
        conditions.append(
            or_(
                User.hard_filters["wants_children"].as_boolean() == my_wants_children,
                User.hard_filters["wants_children"].is_(None),
            )
        )

    # Religion filter — SQL level, bidirectional
    # A: candidate's religion must match what I'm seeking
    my_seeking_religion = hard_filters.get("seeking_religion")
    if user.religion and my_seeking_religion and my_seeking_religion != "doesn't matter":
        conditions.append(User.religion == my_seeking_religion)
    # B: candidate either has no religion preference or wants my religion
    if user.religion:
        conditions.append(
            or_(
                User.hard_filters["seeking_religion"].is_(None),
                User.hard_filters["seeking_religion"].as_string() == "doesn't matter",
                User.hard_filters["seeking_religion"].as_string() == user.religion,
            )
        )

    # Drinking filter — SQL level, bidirectional
    my_seeking_drinking = hard_filters.get("seeking_drinking")
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

    # Smoking filter — SQL level, bidirectional
    my_seeking_smoking = hard_filters.get("seeking_smoking")
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

    # Food filter — SQL level, bidirectional with compatibility matrix
    my_seeking_food = hard_filters.get("seeking_food")
    my_food = user.food_preference
    # A: candidate's food must be compatible with what I eat
    if my_food and my_seeking_food and my_seeking_food != "doesn't matter":
        my_compatible = FOOD_COMPATIBILITY.get(my_food, [my_food])
        conditions.append(User.food_preference.in_(my_compatible))
    # B: candidate either has no food preference or their compatible list accepts my food
    #    Reverse-map: which food types have a compatible list that includes my_food?
    if my_food:
        reverse_compatible = [f for f, compat in FOOD_COMPATIBILITY.items() if my_food in compat]
        conditions.append(
            or_(
                User.hard_filters["seeking_food"].is_(None),
                User.hard_filters["seeking_food"].as_string() == "doesn't matter",
                User.food_preference.in_(reverse_compatible),
            )
        )

    raw_vec = my_profile.aspiration_vector
    if hasattr(raw_vec, "tolist"):
        raw_vec = raw_vec.tolist()
    aspiration_vec = "[" + ",".join(str(float(v)) for v in raw_vec) + "]"

    has_comm_vec = my_profile.communication_vector is not None
    comm_vec_str = ""
    if has_comm_vec:
        raw_comm = my_profile.communication_vector
        if hasattr(raw_comm, "tolist"):
            raw_comm = raw_comm.tolist()
        comm_vec_str = "[" + ",".join(str(float(v)) for v in raw_comm) + "]"

    similarity_cols = [
        text(
            f"1 - (psychometric_profiles.identity_vector <=> '{aspiration_vec}'::vector) AS semantic_sim"
        ),
    ]
    if has_comm_vec:
        similarity_cols.append(
            text(
                f"COALESCE(1 - (psychometric_profiles.communication_vector <=> '{comm_vec_str}'::vector), NULL) AS comm_sim"
            ),
        )

    query = (
        select(User, PsychometricProfile, *similarity_cols)
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(and_(*conditions))
        .order_by(text("semantic_sim DESC"))
        .limit(TOP_N * 2)
    )

    rows = (await db.execute(query)).all()

    matches = []
    for row in rows:
        if has_comm_vec:
            candidate_user, candidate_profile, semantic_sim, comm_sim = row
        else:
            candidate_user, candidate_profile, semantic_sim = row
            comm_sim = None

        # Bidirectional filter check
        if not _meets_bidirectional_filters(user, candidate_user):
            continue

        semantic_score = float(semantic_sim)
        linguistic_score = float(comm_sim) if comm_sim is not None else semantic_score

        score = (
            (WEIGHT_SEMANTIC * semantic_score)
            + (WEIGHT_LINGUISTIC * linguistic_score)
            + (WEIGHT_OCEAN * _ocean_similarity(my_profile, candidate_profile))
        )

        # Neuroticism conflict penalty
        my_n = (my_profile.ocean_scores or {}).get("neuroticism", 0)
        their_n = (candidate_profile.ocean_scores or {}).get("neuroticism", 0)
        if (
            my_n > NEUROTICISM_PENALTY_THRESHOLD
            and their_n > NEUROTICISM_PENALTY_THRESHOLD
        ):
            score -= NEUROTICISM_PENALTY

        score = max(0.0, min(1.0, score))

        top_dimensions = _compute_top_dimensions(my_profile, candidate_profile)

        matches.append(
            MatchSummary(
                id=candidate_user.id,
                name=candidate_user.name,
                age=candidate_user.age,
                compatibility_score=score,
                top_dimensions=top_dimensions[:3],
            )
        )

    # Sort by final score after penalties
    matches.sort(key=lambda m: m.compatibility_score, reverse=True)
    return matches[:TOP_N]


MATCH_COOLDOWN_DAYS = 180  # 6 months — don't re-show the same pair until profiles meaningfully change


async def compute_and_cache_matches(user: User, db: AsyncSession) -> list[MatchSummary]:
    """Compute matches for a user and store in Match.

    Uses upsert so first_matched_at is preserved across daily refreshes.
    Candidates within MATCH_COOLDOWN_DAYS of their first appearance are excluded
    by get_matches — this function only cleans up expired rows outside that window.
    """
    from sqlalchemy import delete
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    matches = await get_matches(user, db)
    now = datetime.now(timezone.utc)

    if matches:
        rows = [
            {
                "user_id": user.id,
                "matched_user_id": m.id,
                "compatibility_score": m.compatibility_score,
                "dimension_scores": [d.model_dump() for d in m.top_dimensions],
                "computed_at": now,
                "first_matched_at": now,
            }
            for m in matches
        ]
        stmt = pg_insert(Match).values(rows).on_conflict_do_update(
            index_elements=["user_id", "matched_user_id"],
            set_={
                "compatibility_score": pg_insert(Match).excluded.compatibility_score,
                "dimension_scores": pg_insert(Match).excluded.dimension_scores,
                "computed_at": pg_insert(Match).excluded.computed_at,
                # first_matched_at intentionally excluded — preserved from original insert
            },
        )
        await db.execute(stmt)

    # Clean up rows that are both outside the cooldown window AND not in the current top-N
    # (rows inside the cooldown stay so get_matches can exclude them next cycle)
    current_ids = {m.id for m in matches}
    cutoff = now - timedelta(days=MATCH_COOLDOWN_DAYS)
    await db.execute(
        delete(Match).where(
            Match.user_id == user.id,
            Match.matched_user_id.not_in(current_ids) if current_ids else text("true"),
            Match.first_matched_at < cutoff,
        )
    )

    await db.commit()
    return matches


async def get_match_detail(
    user: User, match_user_id: str, db: AsyncSession
) -> MatchDetail | None:
    # Fetch both profiles
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
    similarity_result = await db.execute(
        text(
            f"SELECT 1 - (a.aspiration_vector <=> b.identity_vector) AS sem_sim{comm_clause} "
            "FROM psychometric_profiles a, psychometric_profiles b "
            "WHERE a.user_id = :uid_a AND b.user_id = :uid_b"
        ).bindparams(uid_a=user.id, uid_b=match_user_id)
    )
    sim_row = similarity_result.first()
    semantic_score = float(sim_row[0]) if sim_row else 0.0
    linguistic_score = float(sim_row[1]) if (sim_row and has_comm) else semantic_score
    ocean_sim = _ocean_similarity(my_profile, match_profile)

    base_score = (
        (WEIGHT_SEMANTIC * semantic_score)
        + (WEIGHT_LINGUISTIC * linguistic_score)
        + (WEIGHT_OCEAN * ocean_sim)
    )

    my_n = (my_profile.ocean_scores or {}).get("neuroticism", 0)
    their_n = (match_profile.ocean_scores or {}).get("neuroticism", 0)
    if my_n > NEUROTICISM_PENALTY_THRESHOLD and their_n > NEUROTICISM_PENALTY_THRESHOLD:
        base_score -= NEUROTICISM_PENALTY
    base_score = max(0.0, min(1.0, base_score))

    all_dimensions = _compute_top_dimensions(my_profile, match_profile)

    # Shared values
    my_values = set((my_profile.values_profile or {}).get("core_values", []))
    their_values = set((match_profile.values_profile or {}).get("core_values", []))
    shared_values = list(my_values & their_values)

    return MatchDetail(
        id=match_user.id,
        name=match_user.name,
        age=match_user.age,
        compatibility_score=base_score,
        dimension_scores=all_dimensions,
        attachment_style=match_profile.attachment_style,
        shared_values=shared_values,
    )


def _ocean_similarity(
    my_profile: PsychometricProfile,
    their_profile: PsychometricProfile,
) -> float:
    my_ocean = my_profile.ocean_scores or {}
    their_ocean = their_profile.ocean_scores or {}
    keys = [
        "openness",
        "conscientiousness",
        "extraversion",
        "agreeableness",
        "neuroticism",
    ]
    diffs = [abs(my_ocean.get(k, 0.5) - their_ocean.get(k, 0.5)) for k in keys]
    return 1.0 - (sum(diffs) / len(diffs))


def _compute_top_dimensions(
    my_profile: PsychometricProfile,
    their_profile: PsychometricProfile,
) -> list[DimensionScore]:
    my_ocean = my_profile.ocean_scores or {}
    their_ocean = their_profile.ocean_scores or {}

    dimensions = []
    ocean_labels = {
        "openness": "Openness",
        "conscientiousness": "Conscientiousness",
        "extraversion": "Extraversion",
        "agreeableness": "Agreeableness",
        "neuroticism": "Emotional Stability",
    }
    ocean_descriptions = {
        "openness": "Both enjoy new experiences and ideas",
        "conscientiousness": "Aligned on reliability and organization",
        "extraversion": "Similar social energy levels",
        "agreeableness": "Both tend to be cooperative and warm",
        "neuroticism": "Complementary emotional regulation",
    }

    for key, label in ocean_labels.items():
        my_score = my_ocean.get(key, 0.5)
        their_score = their_ocean.get(key, 0.5)
        # Similarity: 1 - abs difference (higher = more similar)
        similarity = 1.0 - abs(my_score - their_score)
        # For neuroticism, invert (low neuroticism pair = good)
        if key == "neuroticism":
            combined_n = (my_score + their_score) / 2
            similarity = 1.0 - combined_n
        dimensions.append(
            DimensionScore(
                label=label, score=similarity, description=ocean_descriptions[key]
            )
        )

    dimensions.sort(key=lambda d: d.score, reverse=True)
    return dimensions
