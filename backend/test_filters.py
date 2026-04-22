"""
Test all bidirectional hard filters
"""

FOOD_COMPATIBILITY = {
    "vegan": ["vegan"],
    "veg": ["vegan", "veg"],
    "egg": ["veg", "egg", "non-veg"],
    "non-veg": ["egg", "non-veg"],
}


def check_food(my_food, my_seeking, their_food, their_seeking):
    if not my_food or not their_food:
        return True

    my_compatible = FOOD_COMPATIBILITY.get(my_food, [my_food])
    their_compatible = FOOD_COMPATIBILITY.get(their_food, [their_food])

    if my_seeking and my_seeking != "doesn't matter":
        if their_food not in my_compatible:
            return False
    if their_seeking and their_seeking != "doesn't matter":
        if my_food not in their_compatible:
            return False
    return True


# Test food filter
food_tests = [
    # (my_food, my_seeking, their_food, their_seeking, expected, desc)
    (
        "non-veg",
        "doesn't matter",
        "egg",
        "doesn't matter",
        True,
        "non-veg + egg, both flexible",
    ),
    (
        "non-veg",
        "vegan",
        "egg",
        "doesn't matter",
        True,  # non-veg CAN eat eggs (egg is in non-veg compatible list)
        "A wants vegan, B is egg",
    ),
    (
        "egg",
        "doesn't matter",
        "vegan",
        "doesn't matter",
        True,
        "egg + vegan, both flexible",
    ),
    (
        "veg",
        "doesn't matter",
        "non-veg",
        "doesn't matter",
        True,
        "veg + non-veg, both flexible",
    ),
    (
        "vegan",
        "doesn't matter",
        "non-veg",
        "doesn't matter",
        True,
        "vegan + non-veg, both flexible",
    ),
]

print("=== FOOD FILTER TESTS ===")
for my_f, my_seek, their_f, their_seek, exp, desc in food_tests:
    result = check_food(my_f, my_seek, their_f, their_seek)
    status = "PASS" if result == exp else "FAIL"
    print(f"[{status}] {desc}")
    if result != exp:
        print(f"       Expected: {exp}, Got: {result}")


def check_drinking(my_drinking, my_seeking, their_drinking, their_seeking):
    if not my_drinking or not their_drinking:
        return True

    if my_seeking and my_seeking != "doesn't matter":
        if their_drinking != my_seeking:
            return False
    if their_seeking and their_seeking != "doesn't matter":
        if my_drinking != their_seeking:
            return False
    return True


# Test drinking filter
drinking_tests = [
    ("never", "doesn't matter", "sometimes", "doesn't matter", True, "both flexible"),
    (
        "never",
        "never",
        "sometimes",
        "doesn't matter",
        False,
        "A wants never, B is sometimes",
    ),
    ("never", "doesn't matter", "never", "never", True, "A flexible, B wants never"),
    (
        "never",
        "doesn't matter",
        "never",
        "doesn't matter",
        True,  # both flexible or matching
        "A wants never, B is never",
    ),
]

print("\n=== DRINKING FILTER TESTS ===")
for my_d, my_seek, their_d, their_seek, exp, desc in drinking_tests:
    result = check_drinking(my_d, my_seek, their_d, their_seek)
    status = "PASS" if result == exp else "FAIL"
    print(f"[{status}] {desc}")
    if result != exp:
        print(f"       Expected: {exp}, Got: {result}")


def check_gender(my_gender, my_seeking, their_gender, their_seeking):
    if not my_gender or not their_gender:
        return True

    if their_seeking and their_gender not in their_seeking:
        return False
    if my_seeking and my_gender not in my_seeking:
        return False
    return True


# Test gender filter
gender_tests = [
    ("man", None, "woman", None, True, "both flexible"),
    (
        "man",
        ["man"],
        "woman",
        None,
        True,
        "A wants men, B is woman",
    ),  # B is flexible → pass
    ("man", None, "woman", ["man"], False, "A is man, B wants men"),
    ("man", ["woman"], "woman", ["man"], False, "cross mismatch"),
    (
        "man",
        ["man"],
        "woman",
        ["woman"],
        True,
        "A wants men, B wants women",
    ),  # A wants men but is man, B wants women but is woman
    ("man", ["man"], "man", None, True, "A wants men, B flexible"),
]

print("\n=== GENDER FILTER TESTS ===")
for my_g, my_seek, their_g, their_seek, exp, desc in gender_tests:
    result = check_gender(my_g, my_seek, their_g, their_seek)
    status = "PASS" if result == exp else "FAIL"
    print(f"[{status}] {desc}")
    if result != exp:
        print(f"       Expected: {exp}, Got: {result}")


def check_religion(my_religion, my_seeking, their_religion, their_seeking):
    if not my_religion or not their_religion:
        return True

    if my_seeking and my_seeking != "doesn't matter":
        if their_religion != my_seeking:
            return False
    if their_seeking and their_seeking != "doesn't matter":
        if my_religion != their_seeking:
            return False
    return True


# Test religion filter
religion_tests = [
    ("Hindu", "doesn't matter", "Muslim", "doesn't matter", True, "both flexible"),
    ("Hindu", "Hindu", "Hindu", "doesn't matter", True, "A wants Hindu, B is Hindu"),
    ("Hindu", "Hindu", "Muslim", "doesn't matter", False, "A wants Hindu, B is Muslim"),
    ("Hindu", "doesn't matter", "Muslim", "Hindu", True, "A flexible, B wants Hindu"),
    (
        "Hindu",
        "doesn't matter",
        "Muslim",
        "Muslim",
        False,
        "A flexible, B wants Muslim, A is Hindu",
    ),
]

print("\n=== RELIGION FILTER TESTS ===")
for my_r, my_seek, their_r, their_seek, exp, desc in religion_tests:
    result = check_religion(my_r, my_seek, their_r, their_seek)
    status = "PASS" if result == exp else "FAIL"
    print(f"[{status}] {desc}")
    if result != exp:
        print(f"       Expected: {exp}, Got: {result}")
