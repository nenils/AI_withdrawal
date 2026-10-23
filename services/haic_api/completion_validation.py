import json
import math
from pathlib import Path


def validate_session_code(data, record, part):
    expected = next((
        session.get("confirmationCode")
        for session in record.get("completed_sessions") or []
        if session.get("session") == part
    ), None)
    submitted = next((
        stored.get("answer", {}).get("played-game")
        for stored in (data or {}).get("answers", {}).values()
        if stored.get("endTime", -1) > 0 and "played-game" in (stored.get("answer") or {})
    ), None)
    if not expected or not isinstance(submitted, str) or submitted.strip() != expected:
        raise ValueError("The session confirmation code does not match your completed games. Please use the code displayed at the end of your own game session.")


def validate_questionnaires(data, part, condition, requirements=None):
    if requirements is None:
        requirements = json.loads(Path(__file__).with_name("study_requirements.json").read_text())
    if not data or not isinstance(data.get("answers"), dict):
        raise ValueError("Questionnaire data has not finished uploading. Please retry.")
    completed_answers = {}
    for stored in data["answers"].values():
        if stored.get("endTime", -1) > 0:
            completed_answers.update(stored.get("answer") or {})
    missing = []
    for field in requirements[str(part)]:
        if field.get("supportedOnly") and condition == "control":
            continue
        value = completed_answers.get(field["id"])
        if value is None or value == "" or value == [] or (isinstance(value, str) and not value.strip()):
            missing.append(field["id"])
            continue
        if field["type"] == "slider" and (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100):
            missing.append(field["id"])
        if field["type"] == "likert" and str(value) not in {str(i) for i in range(1, 8)}:
            missing.append(field["id"])
    if missing:
        raise ValueError("Required questionnaire answers are missing or invalid. Please complete the questionnaires and retry submission.")
