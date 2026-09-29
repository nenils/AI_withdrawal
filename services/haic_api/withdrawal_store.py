import copy
import json
import os
import secrets
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any


COLORS = ["Blue", "Green", "Red", "Yellow", "Purple", "Orange"]
CONDITIONS = {"control", "advisor", "judge"}
ROUNDS_PER_SESSION = 4
MAX_ATTEMPTS = 10


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


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

    def get_or_create(self, participant_id: str, condition: str | None = None) -> dict[str, Any]:
        if condition is not None and condition not in CONDITIONS:
            raise ValueError("Unknown condition")
        with self._lock:
            record = self.get(participant_id)
            if record:
                if condition is not None and record["condition"] != condition:
                    raise ValueError("Participant condition does not match the original assignment")
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
            })

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
                raise PermissionError("Complete the preceding SONA part before opening this part")
            if expected_session < record["current_session"] and expected_session not in credited_parts:
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
            "partCredited": active_session in credited_parts,
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
                raise PermissionError("This SONA part is not the participant's current part")
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
                    "attempts": attempt,
                    "won": won,
                    "secret": game["secrets"][round_index],
                    "guessHistory": game["guesses"],
                    "completedAt": iso(utc_now()),
                })
                game["guesses"] = []
                if game["round"] < ROUNDS_PER_SESSION:
                    game["round"] += 1
                else:
                    session_finished = True
                    now = utc_now()
                    record.setdefault("completed_sessions", []).append({
                        "session": game["session"],
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
            if part_number in (record.get("credited_parts") or []):
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
            if part_number == 4:
                record["completed_at"] = iso(now)
            else:
                record["current_session"] = part_number + 1
            record["updated_at"] = iso(now)
            return self.save(record)
