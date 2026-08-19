from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


PROJECT_REF = "kcfjnpngnouyvcuvfleu"
SUPABASE_URL = f"https://{PROJECT_REF}.supabase.co"

# These four website records were manually corroborated against the live CRM:
# the email is identical and the name difference is only a documented nickname
# or obvious spelling error. Keep this explicit so unrelated fuzzy names can
# never become an automatic match.
TRUSTED_NAME_ALIASES_BY_EMAIL = {
    "mike.clare.bellamy@gmail.com": ("michael bellamy", "michael mike bellamy"),
    "toolys1@bigpond.com": ("pat o toole", "patrick o toole"),
    "phil.candy@fonterra.com": ("phlip candy", "philip candy"),
    "hamishhamdog8@gmail.com": ("hamish johnston", "hamish johnson"),
}


def clean(value: Any) -> str:
    return str(value or "").strip()


def normalise_email(value: Any) -> str:
    return clean(value).lower()


def normalise_name(value: Any) -> str:
    folded = unicodedata.normalize("NFKD", clean(value))
    ascii_name = "".join(character for character in folded if not unicodedata.combining(character))
    return " ".join(re.findall(r"[a-z0-9]+", ascii_name.lower()))


def is_trusted_name_alias(email: str, contact_normalised_name: str, portal_normalised_name: str) -> bool:
    return TRUSTED_NAME_ALIASES_BY_EMAIL.get(email) == (
        contact_normalised_name,
        portal_normalised_name,
    )


def normalise_phone(value: Any) -> str:
    digits = re.sub(r"\D", "", clean(value).lstrip("'"))
    if digits.startswith("0061"):
        digits = digits[2:]
    if digits.startswith("61") and len(digits) >= 11:
        digits = "0" + digits[2:]
    return digits


def display_phone(value: Any) -> str:
    digits = normalise_phone(value)
    if len(digits) == 10 and digits.startswith("04"):
        return f"+61 {digits[1:4]} {digits[4:7]} {digits[7:]}"
    if len(digits) == 10 and digits.startswith("0"):
        return f"{digits[:2]} {digits[2:6]} {digits[6:]}"
    return clean(value).lstrip("'")


def is_australian_phone(value: Any) -> bool:
    digits = normalise_phone(value)
    return len(digits) == 10 and digits[:2] in {"02", "03", "04", "07", "08"}


def is_mobile_phone(value: Any) -> bool:
    digits = normalise_phone(value)
    return len(digits) == 10 and digits.startswith("04")


def normalise_date(value: Any) -> str:
    text = clean(value)
    if not text:
        return ""
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text[:10], date_format).date().isoformat()
        except ValueError:
            continue
    return ""


def contact_name(row: dict[str, str]) -> str:
    return " ".join(part for part in (clean(row.get("First Name")), clean(row.get("Last Name"))) if part)


def contact_emails(row: dict[str, str]) -> set[str]:
    return {
        email
        for index in range(1, 6)
        if (email := normalise_email(row.get(f"Email {index}")))
    }


def contact_phones(row: dict[str, str]) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for index in range(1, 4):
        value = clean(row.get(f"Phone {index}"))
        normalised = normalise_phone(value)
        # Do not guess the country or missing area code. The CRM is Australian,
        # so only import complete Australian mobile/geographic numbers.
        if not is_australian_phone(value) or normalised in seen:
            continue
        seen.add(normalised)
        values.append(value)
    return values


def address_candidate(row: dict[str, str], index: int) -> tuple[str, int] | None:
    address_type = clean(row.get(f"Address {index} - Type")).lower()
    if address_type and address_type not in {"home", "residential", "personal", "other"}:
        return None

    street = clean(row.get(f"Address {index} - Street"))
    city = clean(row.get(f"Address {index} - City"))
    state = clean(row.get(f"Address {index} - State/Region"))
    postcode = clean(row.get(f"Address {index} - Zip"))
    country = clean(row.get(f"Address {index} - Country"))
    if not street and not (city and state and postcode):
        return None

    locality = " ".join(part for part in (state, postcode) if part)
    parts = [part for part in (street, city, locality, country) if part]
    score = sum(bool(part) for part in (street, city, state, postcode, country))
    if address_type in {"home", "residential"}:
        score += 3
    return ", ".join(parts), score


def best_contact_address(row: dict[str, str]) -> str:
    candidates = [candidate for index in range(1, 7) if (candidate := address_candidate(row, index))]
    if not candidates:
        return ""
    return max(candidates, key=lambda candidate: candidate[1])[0]


def get_service_key() -> str:
    environment_key = clean(os.environ.get("CONTACT_IMPORT_SUPABASE_SERVICE_KEY"))
    if environment_key:
        return environment_key

    process = subprocess.run(
        [
            "supabase",
            "projects",
            "api-keys",
            "--project-ref",
            PROJECT_REF,
            "-o",
            "json",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    keys = json.loads(process.stdout)
    for key in keys:
        if key.get("name") == "service_role" and key.get("api_key"):
            return str(key["api_key"])
    raise RuntimeError("The service-role key was not available")


class SupabaseRest:
    def __init__(self, service_key: str):
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def request(self, table: str, query: str, method: str = "GET", body: Any = None) -> Any:
        url = f"{SUPABASE_URL}/rest/v1/{table}?{query}"
        headers = dict(self.headers)
        if method == "PATCH":
            headers["Prefer"] = "return=representation"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content = response.read().decode("utf-8")
                return json.loads(content) if content else None
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {table} failed ({error.code}): {details}") from error


def unique_nonempty(values: Iterable[str], normaliser=clean) -> dict[str, str]:
    unique: dict[str, str] = {}
    for value in values:
        display = clean(value)
        key = normaliser(display)
        if display and key:
            unique.setdefault(key, display)
    return unique


def blank(value: Any) -> bool:
    return not clean(value)


def main() -> int:
    parser = argparse.ArgumentParser(description="Safely enrich existing portal profiles from a Wix contacts CSV")
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()

    with arguments.csv.open("r", encoding="utf-8-sig", newline="") as source:
        contacts = list(csv.DictReader(source))

    client = SupabaseRest(get_service_key())
    users = client.request(
        "users",
        urllib.parse.urlencode({
            "select": "id,email,name,phone,mobile_phone,home_phone,work_phone,address,date_of_birth,is_active,portal_access_scope",
            "limit": "1000",
        }),
    )
    students = client.request(
        "students",
        urllib.parse.urlencode({
            "select": "id,raaus_id,date_of_birth,alternate_phone",
            "limit": "1000",
        }),
    )
    student_by_id = {student["id"]: student for student in students}
    portal_users = [
        user for user in users
        if clean(user.get("portal_access_scope") or "full") == "full"
    ]

    users_by_email: dict[str, list[dict[str, Any]]] = defaultdict(list)
    users_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for user in portal_users:
        if email := normalise_email(user.get("email")):
            users_by_email[email].append(user)
        if name := normalise_name(user.get("name")):
            users_by_name[name].append(user)

    rows_by_name: dict[str, list[int]] = defaultdict(list)
    website_names_by_email: dict[str, set[str]] = defaultdict(set)
    for index, row in enumerate(contacts):
        if name := normalise_name(contact_name(row)):
            rows_by_name[name].append(index)
            for email in contact_emails(row):
                website_names_by_email[email].add(name)

    direct_rows: dict[str, set[int]] = defaultdict(set)
    verified_alias_users: set[str] = set()
    skipped: list[dict[str, Any]] = []
    for index, row in enumerate(contacts):
        matched_users: dict[str, dict[str, Any]] = {}
        for email in contact_emails(row):
            for user in users_by_email.get(email, []):
                matched_users[user["id"]] = user
        if len(matched_users) != 1:
            if len(matched_users) > 1:
                skipped.append({"row": index + 2, "reason": "contact emails match multiple portal profiles"})
            continue
        user = next(iter(matched_users.values()))
        row_name = normalise_name(contact_name(row))
        user_name = normalise_name(user.get("name"))
        matching_emails = contact_emails(row) & {
            normalise_email(user.get("email")),
        }
        trusted_alias = any(
            is_trusted_name_alias(email, row_name, user_name)
            for email in matching_emails
        )
        if row_name and row_name != user_name and not trusted_alias:
            skipped.append({
                "row": index + 2,
                "reason": "email matches but contact name differs",
                "contact_name": contact_name(row),
                "portal_name": user.get("name"),
            })
            continue
        if trusted_alias:
            verified_alias_users.add(user["id"])
        portal_email = normalise_email(user.get("email"))
        email_names = website_names_by_email.get(portal_email, set())
        if any(
            name != user_name and not is_trusted_name_alias(portal_email, name, user_name)
            for name in email_names
        ):
            skipped.append({
                "row": index + 2,
                "reason": "portal email is also used by a differently named website contact",
                "contact_name": contact_name(row),
                "portal_name": user.get("name"),
            })
            continue
        direct_rows[user["id"]].add(index)

    trusted_rows: dict[str, set[int]] = {user_id: set(indices) for user_id, indices in direct_rows.items()}
    match_basis: dict[str, set[str]] = defaultdict(set)
    for user_id in direct_rows:
        match_basis[user_id].add("exact_email")
        if user_id in verified_alias_users:
            match_basis[user_id].add("manually_verified_name_alias")

    # Once an exact-email row anchors a unique portal identity, merge duplicate
    # website contacts with the same exact full name. This recovers older phone
    # and address records without trusting name-only matches globally.
    for user in portal_users:
        user_id = user["id"]
        if user_id not in direct_rows:
            continue
        name = normalise_name(user.get("name"))
        if not name or len(users_by_name.get(name, [])) != 1:
            continue
        duplicates: set[int] = set()
        for index in rows_by_name.get(name, []):
            other_portal_ids = {
                matched_user["id"]
                for email in contact_emails(contacts[index])
                for matched_user in users_by_email.get(email, [])
            }
            if other_portal_ids - {user_id}:
                skipped.append({
                    "row": index + 2,
                    "reason": "same-name duplicate carries another portal profile's email",
                    "contact_name": contact_name(contacts[index]),
                    "portal_name": user.get("name"),
                })
                continue
            duplicates.add(index)
        if duplicates - trusted_rows[user_id]:
            trusted_rows[user_id].update(duplicates)
            match_basis[user_id].add("email_anchored_name_duplicates")

    proposals: list[dict[str, Any]] = []
    ambiguity_count = 0
    for user in portal_users:
        indices = sorted(trusted_rows.get(user["id"], set()))
        if not indices:
            continue
        rows = [contacts[index] for index in indices]
        student = student_by_id.get(user["id"])
        user_patch: dict[str, str] = {}
        student_patch: dict[str, str] = {}
        field_skips: list[str] = []

        phones = [phone for row in rows for phone in contact_phones(row)]
        mobile_values = unique_nonempty((phone for phone in phones if is_mobile_phone(phone)), normalise_phone)
        landline_values = unique_nonempty((phone for phone in phones if not is_mobile_phone(phone)), normalise_phone)
        all_phones = {**landline_values, **mobile_values}
        if len(mobile_values) == 1 and blank(user.get("mobile_phone")):
            user_patch["mobile_phone"] = display_phone(next(iter(mobile_values.values())))
        elif len(mobile_values) > 1 and blank(user.get("mobile_phone")):
            field_skips.append("mobile_phone: conflicting website values")
        # Wix does not identify phone types in this export. A geographic number
        # may be home or work, so retain it only in the generic phone field.
        if len(all_phones) == 1 and blank(user.get("phone")):
            user_patch["phone"] = display_phone(next(iter(all_phones.values())))

        addresses = unique_nonempty((best_contact_address(row) for row in rows), lambda value: re.sub(r"\W", "", value).lower())
        if len(addresses) == 1 and blank(user.get("address")):
            user_patch["address"] = next(iter(addresses.values()))
        elif len(addresses) > 1 and blank(user.get("address")):
            field_skips.append("address: conflicting website values")

        dates = unique_nonempty(
            (
                date
                for row in rows
                for field in ("Birthdate", "Date of Birth")
                if (date := normalise_date(row.get(field)))
            ),
            normalise_date,
        )
        if len(dates) == 1:
            date_value = next(iter(dates.values()))
            if blank(user.get("date_of_birth")):
                user_patch["date_of_birth"] = date_value
            if student is not None and blank(student.get("date_of_birth")):
                student_patch["date_of_birth"] = date_value
        elif len(dates) > 1:
            field_skips.append("date_of_birth: conflicting website values")

        raaus_values = unique_nonempty((row.get("Ra-Aus Number", "") for row in rows), lambda value: clean(value).lower())
        if student is not None and len(raaus_values) == 1 and blank(student.get("raaus_id")):
            student_patch["raaus_id"] = next(iter(raaus_values.values()))
        elif student is not None and len(raaus_values) > 1 and blank(student.get("raaus_id")):
            field_skips.append("raaus_id: conflicting website values")

        if field_skips:
            ambiguity_count += len(field_skips)
        if user_patch or student_patch:
            proposals.append({
                "id": user["id"],
                "name": user.get("name"),
                "email": user.get("email"),
                "match_basis": sorted(match_basis[user["id"]]),
                "source_rows": [index + 2 for index in indices],
                "user_patch": user_patch,
                "student_patch": student_patch,
                "skipped_fields": field_skips,
            })

    applied: list[dict[str, Any]] = []
    if arguments.apply:
        for proposal in proposals:
            user_patch = dict(proposal["user_patch"])
            student_patch = dict(proposal["student_patch"])
            # Re-read immediately before each update. If an administrator has
            # filled a field since this run began, leave their value untouched.
            current_users = client.request(
                "users",
                urllib.parse.urlencode({
                    "select": "phone,mobile_phone,home_phone,address,date_of_birth",
                    "id": f"eq.{proposal['id']}",
                    "limit": "1",
                }),
            )
            if len(current_users or []) != 1:
                raise RuntimeError(f"Expected one current user row for {proposal['name']}")
            user_patch = {
                field: value
                for field, value in user_patch.items()
                if blank(current_users[0].get(field))
            }
            if student_patch:
                current_students = client.request(
                    "students",
                    urllib.parse.urlencode({
                        "select": "raaus_id,date_of_birth",
                        "id": f"eq.{proposal['id']}",
                        "limit": "1",
                    }),
                )
                if len(current_students or []) != 1:
                    raise RuntimeError(f"Expected one current student row for {proposal['name']}")
                student_patch = {
                    field: value
                    for field, value in student_patch.items()
                    if blank(current_students[0].get(field))
                }
            if user_patch:
                changed = client.request(
                    "users",
                    urllib.parse.urlencode({"id": f"eq.{proposal['id']}"}),
                    method="PATCH",
                    body=user_patch,
                )
                if len(changed or []) != 1:
                    raise RuntimeError(f"Expected one updated user row for {proposal['name']}")
            if student_patch:
                changed = client.request(
                    "students",
                    urllib.parse.urlencode({"id": f"eq.{proposal['id']}"}),
                    method="PATCH",
                    body=student_patch,
                )
                if len(changed or []) != 1:
                    raise RuntimeError(f"Expected one updated student row for {proposal['name']}")
            applied.append({
                "id": proposal["id"],
                "name": proposal["name"],
                "user_fields": sorted(user_patch),
                "student_fields": sorted(student_patch),
            })

    field_counts: dict[str, int] = defaultdict(int)
    for proposal in proposals:
        for field in proposal["user_patch"]:
            field_counts[f"users.{field}"] += 1
        for field in proposal["student_patch"]:
            field_counts[f"students.{field}"] += 1

    result = {
        "mode": "apply" if arguments.apply else "dry-run",
        "contact_rows": len(contacts),
        "portal_profiles_considered": len(portal_users),
        "exact_email_matched_profiles": len(direct_rows),
        "trusted_matched_profiles": len(trusted_rows),
        "profiles_with_missing_data": len(proposals),
        "proposed_field_counts": dict(sorted(field_counts.items())),
        "ambiguous_fields_skipped": ambiguity_count,
        "identity_conflicts_skipped": skipped,
        "proposals": proposals,
        "applied": applied,
    }
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
