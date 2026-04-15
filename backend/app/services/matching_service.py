"""
Matching engine:
1. Hard filter: SQL WHERE clause (deal-breakers)
2. Vector similarity: pgvector cosine distance (aspiration_A vs identity_B)
3. Conflict penalty: reduce score for high-neuroticism pairs
4. Return top N matches with dimension breakdown
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, and_, or_
from app.models.user import User
from app.models.psychometric import PsychometricProfile, AnalysisStatus
from app.schemas.matches import MatchSummary, MatchDetail, DimensionScore

NEUROTICISM_PENALTY_THRESHOLD = 0.75  # Both users above this → penalize
NEUROTICISM_PENALTY = 0.15
TOP_N = 20


async def get_matches(user: User, db: AsyncSession) -> list[MatchSummary]:
    # Fetch current user's profile
    result = await db.execute(
        select(PsychometricProfile).where(PsychometricProfile.user_id == user.id)
    )
    my_profile = result.scalar_one_or_none()

    if not my_profile or my_profile.aspiration_vector is None:
        return []

    hard_filters = user.hard_filters or {}
    seeking_genders = hard_filters.get("seeking_gender", [])
    max_age_diff = hard_filters.get("max_age_diff")

    # Build hard filter conditions
    conditions = [
        PsychometricProfile.user_id != user.id,
        PsychometricProfile.analysis_status == AnalysisStatus.complete,
        PsychometricProfile.identity_vector.is_not(None),
    ]

    # Gender filter
    if seeking_genders:
        conditions.append(User.gender.in_(seeking_genders))

    # Age filter
    if max_age_diff and user.age:
        conditions.append(User.age.between(user.age - max_age_diff, user.age + max_age_diff))

    # wants_children hard filter
    my_wants_children = hard_filters.get("wants_children")
    if my_wants_children is not None:
        # Only match with people who share the same preference (or haven't set it)
        conditions.append(
            or_(
                User.hard_filters["wants_children"].as_boolean() == my_wants_children,
                User.hard_filters["wants_children"].is_(None),
            )
        )

    # pgvector cosine similarity query
    # aspiration_vector of current user vs identity_vector of candidates
    aspiration_vec = str(my_profile.aspiration_vector)

    query = (
        select(
            User,
            PsychometricProfile,
            text(f"1 - (psychometric_profiles.identity_vector <=> '{aspiration_vec}'::vector) AS similarity"),
        )
        .join(PsychometricProfile, PsychometricProfile.user_id == User.id)
        .where(and_(*conditions))
        .order_by(text("similarity DESC"))
        .limit(TOP_N * 2)  # Over-fetch to allow for penalty filtering
    )

    rows = (await db.execute(query)).all()

    matches = []
    for row in rows:
        candidate_user, candidate_profile, similarity = row

        score = float(similarity)

        # Neuroticism conflict penalty
        my_n = (my_profile.ocean_scores or {}).get("neuroticism", 0)
        their_n = (candidate_profile.ocean_scores or {}).get("neuroticism", 0)
        if my_n > NEUROTICISM_PENALTY_THRESHOLD and their_n > NEUROTICISM_PENALTY_THRESHOLD:
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


async def get_match_detail(user: User, match_user_id: str, db: AsyncSession) -> MatchDetail | None:
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

    if not my_profile or my_profile.aspiration_vector is None or match_profile.identity_vector is None:
        return None

    # Compute overall score
    similarity_result = await db.execute(
        text(
            "SELECT 1 - (a.aspiration_vector <=> b.identity_vector) AS sim "
            "FROM psychometric_profiles a, psychometric_profiles b "
            "WHERE a.user_id = :uid_a AND b.user_id = :uid_b"
        ).bindparams(uid_a=user.id, uid_b=match_user_id)
    )
    sim_row = similarity_result.first()
    base_score = float(sim_row[0]) if sim_row else 0.0

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
            DimensionScore(label=label, score=similarity, description=ocean_descriptions[key])
        )

    dimensions.sort(key=lambda d: d.score, reverse=True)
    return dimensions
