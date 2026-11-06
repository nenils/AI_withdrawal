"""Prolific wave configuration; condition labels never appear in entry URLs."""

import os
import re
import urllib.parse


COHORTS = {"a": "control", "b": "advisor", "c": "judge"}


def validate_identifier(value, name):
    if not re.fullmatch(r"[A-Za-z0-9]{24}", value or ""):
        raise ValueError(f"Missing or invalid {name}. Please open this session from Prolific.")


def wave_config(cohort, part):
    if cohort not in COHORTS or part not in range(1, 5):
        raise ValueError("Unknown study session")
    prefix = f"PROLIFIC_{cohort.upper()}_PART_{part}"
    study_id = os.getenv(f"{prefix}_STUDY_ID", "").strip()
    url = os.getenv(f"{prefix}_COMPLETION_URL", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9]{24}", study_id):
        raise RuntimeError(f"{prefix}_STUDY_ID is not configured")
    parsed = urllib.parse.urlsplit(url)
    codes = urllib.parse.parse_qs(parsed.query).get("cc", [])
    if (parsed.scheme != "https" or parsed.netloc not in {"app.prolific.com", "app.prolific.co"}
            or parsed.path != "/submissions/complete" or len(codes) != 1
            or not re.fullmatch(r"[A-Za-z0-9_-]+", codes[0]) or parsed.fragment):
        raise RuntimeError(f"{prefix}_COMPLETION_URL must be the completion URL supplied by Prolific")
    return study_id, url


def completion_details(record, part, submitted, *, redirect=False):
    recruitment = (record or {}).get("recruitment") or {}
    if recruitment.get("platform") != "prolific":
        return {}
    result = {"platform": "prolific", "completionUrl": None}
    if submitted:
        if not redirect:
            query = urllib.parse.urlencode({"participantId": record["participant_id"], "partNumber": part})
            result["completionUrl"] = f"/api/prolific/complete?{query}"
            return result
        cohort = recruitment["cohort"]
        study_id, url = wave_config(cohort, part)
        registered = recruitment.get("parts", {}).get(str(part), {})
        if record["condition"] != COHORTS[cohort] or registered.get("studyId") != study_id:
            raise ValueError("This participant is not registered for this Prolific wave")
        result["completionUrl"] = url
    return result
