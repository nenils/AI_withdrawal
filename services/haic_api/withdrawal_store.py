import copy
import json
import os
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from typing import Any


COLORS = ["Blue", "Green", "Red", "Yellow", "Purple", "Orange"]
CONDITIONS = {"control", "advisor", "judge"}
ROUNDS_PER_SESSION = 4
MAX_ATTEMPTS = 10


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def part_completed(record: dict[str, Any], part: int) -> bool:
    return part in (record.get("credited_parts") or []) or any(
        session.get("session") == part and session.get("submittedAt")
        for session in record.get("completed_sessions") or []
    )


def new_secret() -> list[str]:
    return [secrets.choice(COLORS) for _ in range(4)]


def score_guess(secret: list[str], guess: list[str]) -> dict[str, int]:
    black = sum(left == right for left, right in zip(secret, guess))
    remaining_secret = [value for index, value in enumerate(secret) if value != guess[index]]
    remaining_guess = [value for index, value in enumerate(guess) if value != secret[index]]
    white = 0
    for color in remaining_guess:
        if color in remaining_secret:
            white += 1
            remaining_secret.remove(color)
    return {"black": black, "white": white}


def support_available(condition: str, session_number: int, round_number: int) -> bool:
    if condition == "control":
        return False
    if session_number == 1:
        return round_number == 4
    if session_number in (2, 3):
        return True
    return session_number == 4 and round_number == 1


def support_phase(condition: str, session_number: int, round_number: int) -> str:
    if condition == "control":
        return "never_supported"
    if session_number == 1 and round_number < 4:
        return "pre_introduction"
    if session_number == 1 and round_number == 4:
        return "introduced"
    if session_number in (2, 3) or (session_number == 4 and round_number == 1):
        return "supported"
    return "withdrawn"


def create_game_state(session_number: int, now: datetime) -> dict[str, Any]:
    return {
        "session": session_number,
        "roundStartedAt": iso(now),
        "round": 1,
        "secrets": [new_secret() for _ in range(ROUNDS_PER_SESSION)],
        "rounds": [],
        "guesses": [],
        "startedAt": iso(now),
    }


class WithdrawalStore:
    def __init__(self) -> None:
        self.base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        self.service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self._memory: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()

    @property
    def persistent(self) -> bool:
        return bool(self.base_url and self.service_key)

    def _request(
        self,
        method: str,
        path: str,
        payload: Any = None,
        prefer: str | None = None,
    ) -> list[dict[str, Any]]:
        headers = {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        request = urllib.request.Request(
            f"{self.base_url}/rest/v1/{path}",
            data=json.dumps(payload).encode("utf-8") if payload is not None else None,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else []
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase request failed ({exc.code}): {detail}") from exc

    def get(self, participant_id: str) -> dict[str, Any] | None:
        if not self.persistent:
            value = self._memory.get(participant_id)
            return copy.deepcopy(value) if value else None
        encoded = urllib.parse.quote(participant_id, safe="")
        rows = self._request(
            "GET",
            f"withdrawal_participants?participant_id=eq.{encoded}&select=*",
        )
        return rows[0] if rows else None

    def save(self, record: dict[str, Any]) -> dict[str, Any]:
        if not self.persistent:
            self._memory[record["participant_id"]] = copy.deepcopy(record)
            return copy.deepcopy(record)
        rows = self._request(
            "POST",
            "withdrawal_participants?on_conflict=participant_id",
            record,
            "resolution=merge-duplicates,return=representation",
        )
        return rows[0]

    def get_or_create(self, participant_id: str, condition: str | None = None, recruitment: dict | None = None) -> dict[str, Any]:
        if condition is not None and condition not in CONDITIONS:
            raise ValueError("Unknown condition")
        with self._lock:
            record = self.get(participant_id)
            if record:
                if condition is not None and record["condition"] != condition:
                    raise ValueError("Participant condition does not match the original assignment")
                changed = False
                for session in record.get("completed_sessions") or []:
                    if not session.get("confirmationCode"):
                        session["confirmationCode"] = f"MM-S{session['session']}-{secrets.token_hex(6).upper()}"
                        changed = True
                if changed:
                    return self.save(record)
                return record
            now = utc_now()
            assigned_condition = condition or secrets.choice(sorted(CONDITIONS))
            return self.save({
                "participant_id": participant_id,
                "condition": assigned_condition,
                "current_session": 1,
                "completed_at": None,
                "completed_sessions": [],
                "credited_parts": [],
                "game_state": create_game_state(1, now),
                "created_at": iso(now),
                "updated_at": iso(now),
                **({"recruitment": copy.deepcopy(recruitment)} if recruitment else {}),
            })

    def register_prolific(self, participant_id, condition, cohort, part, study_id, session_id=None):
        with self._lock:
            record = self.get(participant_id)
            if record is None and part != 1:
                raise ValueError("Complete Session 1 before opening a later session")
            if record is None:
                # Enroll in one write: a missing migration must not leave an unbound participant behind.
                return self.get_or_create(participant_id, condition, recruitment={
                    "platform": "prolific", "cohort": cohort,
                    "parts": {str(part): {"studyId": study_id, "sessionIds": [session_id] if session_id else []}},
                })
            if record and (record.get("recruitment") or {}).get("platform") != "prolific":
                raise ValueError("This participant ID is already registered through another recruitment platform")
            if record["condition"] != condition or record["recruitment"]["cohort"] != cohort:
                raise ValueError("Please return to your original Prolific project")
            record = self.get_or_create(participant_id, condition)
            recruitment = record["recruitment"]
            previous = recruitment["parts"].get(str(part))
            if previous and previous["studyId"] != study_id:
                raise ValueError("This session is already linked to another Prolific study")
            wave = recruitment["parts"].setdefault(str(part), {"studyId": study_id, "sessionIds": []})
            if session_id and session_id not in wave["sessionIds"]:
                wave["sessionIds"].append(session_id)
            record["updated_at"] = iso(utc_now())
            return self.save(record)

    def append_events(self, participant_id: str, events: list[dict[str, Any]]) -> int:
        if not events:
            return 0
        if not self.persistent:
            record = self._memory.get(participant_id)
            if record is not None:
                record.setdefault("events", []).extend(copy.deepcopy(events))
            return len(events)
        rows = []
        for event in events[:500]:
            rows.append({
                "participant_id": participant_id,
                "session_number": event.get("sessionNumber", 1),
                "round_number": event.get("roundNumber"),
                "event_type": str(event.get("type", "unknown"))[:100],
                "event_data": event.get("data") or {},
                "client_timestamp": event.get("timestamp"),
            })
        self._request("POST", "withdrawal_events", rows, "return=minimal")
        return len(rows)

    def ensure_session_started(
        self,
        record: dict[str, Any],
        expected_session: int | None = None,
    ) -> dict[str, Any]:
        recruitment = record.get("recruitment") or {}
        if recruitment.get("platform") == "prolific" and str(expected_session or record["current_session"]) not in recruitment.get("parts", {}):
            raise PermissionError("Please open this session from its study link on Prolific")
        if expected_session is None or expected_session == record["current_session"]:
            self.check_session_available(record)
        if record.get("completed_at") or record.get("game_state"):
            return record
        if expected_session is not None and expected_session != record["current_session"]:
            return record
        completed_sessions = record.get("completed_sessions") or []
        if any(item.get("session") == record["current_session"] for item in completed_sessions):
            return record
        now = utc_now()
        record["game_state"] = create_game_state(record["current_session"], now)
        record["updated_at"] = iso(now)
        return self.save(record)

    def check_session_available(self, record: dict[str, Any]) -> None:
        if record["participant_id"].startswith("debug-"):
            return
        available = record.get("next_session_available_at")
        if available and utc_now() < datetime.fromisoformat(available.replace("Z", "+00:00")):
            raise PermissionError(f"The next session is available at {available}. Please return at that time.")

    def public_state(
        self,
        record: dict[str, Any],
        expected_session: int | None = None,
    ) -> dict[str, Any]:
        if expected_session is not None and expected_session not in range(1, 5):
            raise ValueError("Part number must be between 1 and 4")
        credited_parts = record.get("credited_parts") or []
        if expected_session is not None:
            if expected_session > record["current_session"]:
                raise PermissionError("Complete the preceding session before opening this part")
            if expected_session < record["current_session"] and not part_completed(record, expected_session):
                raise ValueError("This study part does not match the participant record")
        record = self.ensure_session_started(record, expected_session)
        now = utc_now()
        game = record.get("game_state")
        if expected_session is not None and expected_session != record["current_session"]:
            game = None
        public_game = None
        if game:
            public_game = {
                key: copy.deepcopy(value)
                for key, value in game.items()
                if key != "secrets"
            }
        round_number = game["round"] if game else 1
        active_session = expected_session or record["current_session"]
        game_complete = any(
            item.get("session") == active_session
            for item in record.get("completed_sessions") or []
        )
        return {
            "participantId": record["participant_id"],
            "condition": record["condition"],
            "currentSession": record["current_session"],
            "totalSessions": 4,
            "serverTime": iso(now),
            "completed": bool(record.get("completed_at")),
            "completedAt": record.get("completed_at"),
            "completedSessions": copy.deepcopy(record.get("completed_sessions") or []),
            "creditedParts": copy.deepcopy(credited_parts),
            "partGameComplete": game_complete,
            "sessionConfirmationCode": next((
                item.get("confirmationCode")
                for item in record.get("completed_sessions") or []
                if item.get("session") == active_session
            ), None),
            "partCredited": active_session in credited_parts,
            "partCompleted": part_completed(record, active_session),
            "supportAvailable": support_available(record["condition"], active_session, round_number),
            "supportPhase": support_phase(record["condition"], active_session, round_number),
            "game": public_game,
            "storage": "supabase" if self.persistent else "memory",
        }

    def submit_guess(
        self,
        participant_id: str,
        condition: str | None,
        guess: list[str],
        expected_session: int | None = None,
    ) -> dict[str, Any]:
        if len(guess) != 4 or any(color not in COLORS for color in guess):
            raise ValueError("A guess must contain exactly four valid colors")
        with self._lock:
            record = self.get_or_create(participant_id, condition)
            if expected_session is not None and expected_session != record["current_session"]:
                raise PermissionError("This is not the participant's current session")
            record = self.ensure_session_started(record, expected_session)
            game = record.get("game_state")
            if record.get("completed_at"):
                raise ValueError("The study is already complete")
            if game is None:
                raise PermissionError("This part's game has already been completed")

            round_index = game["round"] - 1
            feedback = score_guess(game["secrets"][round_index], guess)
            attempt = len(game["guesses"]) + 1
            guess_record = {
                "attempt": attempt,
                "guess": guess,
                "feedback": feedback,
                "submittedAt": iso(utc_now()),
            }
            game["guesses"].append(guess_record)
            won = feedback["black"] == 4
            round_finished = won or attempt >= MAX_ATTEMPTS
            session_finished = False

            if round_finished:
                game["rounds"].append({
                    "round": game["round"],
                    "startedAt": game.get("roundStartedAt") or (game["startedAt"] if game["round"] == 1 else None),
                    "attempts": attempt,
                    "won": won,
                    "secret": game["secrets"][round_index],
                    "guessHistory": game["guesses"],
                    "completedAt": iso(utc_now()),
                })
                game["guesses"] = []
                if game["round"] < ROUNDS_PER_SESSION:
                    game["round"] += 1
                    game["roundStartedAt"] = iso(utc_now())
                else:
                    session_finished = True
                    now = utc_now()
                    record.setdefault("completed_sessions", []).append({
                        "session": game["session"],
                        "confirmationCode": f"MM-S{game['session']}-{secrets.token_hex(6).upper()}",
                        "startedAt": game["startedAt"],
                        "completedAt": iso(now),
                        "rounds": copy.deepcopy(game["rounds"]),
                    })
                    record["game_state"] = None

            record["updated_at"] = iso(utc_now())
            record = self.save(record)
            result = self.public_state(record, expected_session)
            result.update({
                "feedback": feedback,
                "attempt": attempt,
                "won": won,
                "roundFinished": round_finished,
                "sessionFinished": session_finished,
                "revealedSecret": game["secrets"][round_index] if round_finished else None,
            })
            return result

    def part_ready_for_credit(self, participant_id: str, part_number: int) -> dict[str, Any]:
        with self._lock:
            record = self.get_or_create(participant_id)
            if part_completed(record, part_number):
                return record
            if part_number != record["current_session"]:
                raise PermissionError("This SONA part is not the participant's current part")
            if record.get("game_state") is not None:
                raise ValueError("Complete all four Mastermind games before finishing this part")
            if not any(
                item.get("session") == part_number
                for item in record.get("completed_sessions") or []
            ):
                raise ValueError("No completed game session was found for this part")
            return record

    def mark_part_completed(self, participant_id: str, part_number: int, submitted_at: str) -> dict[str, Any]:
        with self._lock:
            record = self.part_ready_for_credit(participant_id, part_number)
            session = next(item for item in record["completed_sessions"] if item["session"] == part_number)
            if session.get("submittedAt"):
                return record
            session["submittedAt"] = submitted_at
            submitted = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
            if part_number == 4:
                record["completed_at"] = iso(submitted)
            elif record["current_session"] in (part_number, part_number + 1):
                record["current_session"] = part_number + 1
                record["next_session_available_at"] = iso(submitted + timedelta(hours=24))
            record["updated_at"] = iso(utc_now())
            return self.save(record)

    def mark_part_credited(self, participant_id: str, part_number: int) -> dict[str, Any]:
        with self._lock:
            record = self.part_ready_for_credit(participant_id, part_number)
            credited_parts = record.setdefault("credited_parts", [])
            if part_number in credited_parts:
                return record
            credited_parts.append(part_number)
            now = utc_now()
            for session in record.get("completed_sessions") or []:
                if session.get("session") == part_number:
                    session["creditedAt"] = iso(now)
            record["updated_at"] = iso(now)
            return self.save(record)
