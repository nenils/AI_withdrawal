import argparse
import csv
import io
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any


PART_NUMBERS = range(1, 5)


class SupabaseExportSource:
    def __init__(self) -> None:
        self.base_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        self.service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        self.collection_prefix = os.getenv("REVISIT_COLLECTION_PREFIX", "prod-")
        if not self.base_url or not self.service_key:
            raise RuntimeError("Supabase export credentials are not configured")

    @property
    def headers(self) -> dict[str, str]:
        return {
            "apikey": self.service_key,
            "Authorization": f"Bearer {self.service_key}",
        }

    def iter_table(
        self,
        table: str,
        select: str,
        order: str,
        page_size: int = 1000,
    ) -> Iterator[dict[str, Any]]:
        query = urllib.parse.urlencode({"select": select, "order": order})
        url = f"{self.base_url}/rest/v1/{table}?{query}"
        offset = 0
        while True:
            headers = self.headers | {"Range": f"{offset}-{offset + page_size - 1}"}
            request = urllib.request.Request(url, headers=headers, method="GET")
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    rows = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"Supabase export failed ({exc.code}): {detail}") from exc
            yield from rows
            if len(rows) < page_size:
                return
            offset += page_size

    def participants(self) -> list[dict[str, Any]]:
        return list(self.iter_table(
            "withdrawal_participants",
            "participant_id,condition,current_session,completed_at,completed_sessions,credited_parts,game_state,created_at,updated_at",
            "participant_id.asc",
        ))

    def events(self) -> Iterator[dict[str, Any]]:
        return self.iter_table(
            "withdrawal_events",
            "id,participant_id,session_number,round_number,event_type,event_data,client_timestamp,server_timestamp",
            "id.asc",
        )

    def revisit_participant(self, participant_id: str, part_number: int) -> dict[str, Any] | None:
        study_id = f"HAIC_part_{part_number}"
        object_path = f"{self.collection_prefix}{study_id}/participants/{participant_id}_participantData"
        encoded_path = urllib.parse.quote(object_path, safe="/")
        url = f"{self.base_url}/storage/v1/object/authenticated/revisit/{encoded_path}"
        request = urllib.request.Request(url, headers=self.headers, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase participant download failed ({exc.code}): {detail}") from exc


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _write_csv(
    archive: zipfile.ZipFile,
    name: str,
    fieldnames: list[str],
    rows: Iterable[dict[str, Any]],
) -> int:
    count = 0
    with archive.open(name, "w") as binary_file:
        with io.TextIOWrapper(binary_file, encoding="utf-8", newline="", write_through=True) as text_file:
            writer = csv.DictWriter(text_file, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                writer.writerow(row)
                count += 1
    return count


def _response_rows(records: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for record in records:
        data = record["data"]
        if not data:
            continue
        for component_instance, stored in (data.get("answers") or {}).items():
            answers = stored.get("answer") or {}
            if not isinstance(answers, dict):
                answers = {"_raw": answers}
            component_name = stored.get("componentName") or component_instance.rsplit("_", 1)[0]
            duration = None
            if stored.get("startTime") is not None and stored.get("endTime") is not None:
                duration = stored["endTime"] - stored["startTime"]
            for response_id, answer in answers.items():
                yield {
                    "participant_id": record["participant_id"],
                    "condition": record["condition"],
                    "part_number": record["part_number"],
                    "study_id": record["study_id"],
                    "part_completed": data.get("completed", False),
                    "component_instance": component_instance,
                    "component_name": component_name,
                    "trial_order": stored.get("trialOrder"),
                    "response_id": response_id,
                    "answer_json": _json(answer),
                    "start_time_ms": stored.get("startTime"),
                    "end_time_ms": stored.get("endTime"),
                    "duration_ms": duration,
                    "timed_out": stored.get("timedOut", False),
                    "window_event_count": len(stored.get("windowEvents") or []),
                }


def _game_rows(participants: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for participant in participants:
        for session in participant.get("completed_sessions") or []:
            for game in session.get("rounds") or []:
                yield {
                    "participant_id": participant["participant_id"],
                    "condition": participant["condition"],
                    "session_number": session.get("session"),
                    "game_number": game.get("round"),
                    "won": game.get("won"),
                    "attempts": game.get("attempts"),
                    "secret_json": _json(game.get("secret")),
                    "session_started_at": session.get("startedAt"),
                    "game_completed_at": game.get("completedAt"),
                    "session_completed_at": session.get("completedAt"),
                    "credited_at": session.get("creditedAt"),
                }


def _guess_rows(participants: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    for participant in participants:
        for session in participant.get("completed_sessions") or []:
            for game in session.get("rounds") or []:
                for guess in game.get("guessHistory") or []:
                    feedback = guess.get("feedback") or {}
                    yield {
                        "participant_id": participant["participant_id"],
                        "condition": participant["condition"],
                        "session_number": session.get("session"),
                        "game_number": game.get("round"),
                        "attempt": guess.get("attempt"),
                        "guess_json": _json(guess.get("guess")),
                        "black_feedback": feedback.get("black"),
                        "white_feedback": feedback.get("white"),
                        "submitted_at": guess.get("submittedAt"),
                        "game_completed": True,
                    }
        game_state = participant.get("game_state") or {}
        for guess in game_state.get("guesses") or []:
            feedback = guess.get("feedback") or {}
            yield {
                "participant_id": participant["participant_id"],
                "condition": participant["condition"],
                "session_number": game_state.get("session"),
                "game_number": game_state.get("round"),
                "attempt": guess.get("attempt"),
                "guess_json": _json(guess.get("guess")),
                "black_feedback": feedback.get("black"),
                "white_feedback": feedback.get("white"),
                "submitted_at": guess.get("submittedAt"),
                "game_completed": False,
            }


def create_export(destination: str | Path, source: SupabaseExportSource | Any) -> dict[str, int]:
    participants = source.participants()
    revisit_records: list[dict[str, Any]] = []
    by_participant = {row["participant_id"]: row for row in participants}
    for participant in participants:
        for part_number in PART_NUMBERS:
            revisit_records.append({
                "participant_id": participant["participant_id"],
                "condition": participant["condition"],
                "part_number": part_number,
                "study_id": f"HAIC_part_{part_number}",
                "data": source.revisit_participant(participant["participant_id"], part_number),
            })

    completion_rows = []
    for participant_id, participant in by_participant.items():
        participant_records = [row for row in revisit_records if row["participant_id"] == participant_id]
        row: dict[str, Any] = {
            "participant_id": participant_id,
            "condition": participant["condition"],
            "current_session": participant.get("current_session"),
            "credited_parts_json": _json(participant.get("credited_parts") or []),
            "completed_session_count": len(participant.get("completed_sessions") or []),
            "study_completed_at": participant.get("completed_at"),
            "created_at": participant.get("created_at"),
            "updated_at": participant.get("updated_at"),
        }
        for record in participant_records:
            data = record["data"]
            part = record["part_number"]
            row[f"part_{part}_data_found"] = data is not None
            row[f"part_{part}_completed"] = bool(data and data.get("completed"))
        row["all_four_parts_found"] = all(row[f"part_{part}_data_found"] for part in PART_NUMBERS)
        row["all_four_parts_completed"] = all(row[f"part_{part}_completed"] for part in PART_NUMBERS)
        completion_rows.append(row)

    counts: dict[str, int] = {}
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        counts["participants"] = _write_csv(archive, "participant_status.csv", [
            "participant_id", "condition", "current_session", "credited_parts_json",
            "completed_session_count", "study_completed_at", "created_at", "updated_at",
            *[f"part_{part}_{suffix}" for part in PART_NUMBERS for suffix in ("data_found", "completed")],
            "all_four_parts_found", "all_four_parts_completed",
        ], completion_rows)
        counts["responses"] = _write_csv(archive, "longitudinal_responses.csv", [
            "participant_id", "condition", "part_number", "study_id", "part_completed",
            "component_instance", "component_name", "trial_order", "response_id", "answer_json",
            "start_time_ms", "end_time_ms", "duration_ms", "timed_out", "window_event_count",
        ], _response_rows(revisit_records))
        counts["games"] = _write_csv(archive, "games.csv", [
            "participant_id", "condition", "session_number", "game_number", "won", "attempts",
            "secret_json", "session_started_at", "game_completed_at", "session_completed_at", "credited_at",
        ], _game_rows(participants))
        counts["guesses"] = _write_csv(archive, "guesses.csv", [
            "participant_id", "condition", "session_number", "game_number", "attempt", "guess_json",
            "black_feedback", "white_feedback", "submitted_at", "game_completed",
        ], _guess_rows(participants))
        counts["events"] = _write_csv(archive, "events.csv", [
            "id", "participant_id", "session_number", "round_number", "event_type", "event_data_json",
            "client_timestamp", "server_timestamp",
        ], ({
            **event,
            "event_data_json": _json(event.get("event_data") or {}),
        } for event in source.events()))
        archive.writestr(
            "raw/revisit_participants.jsonl",
            "".join(_json(record) + "\n" for record in revisit_records if record["data"] is not None),
        )
        archive.writestr("raw/withdrawal_participants.json", json.dumps(participants, ensure_ascii=False, indent=2))
        archive.writestr("manifest.json", json.dumps({
            "format_version": 1,
            "study_parts": [f"HAIC_part_{part}" for part in PART_NUMBERS],
            "row_counts": counts,
        }, indent=2))
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create one private longitudinal export from all four study parts.",
    )
    parser.add_argument(
        "destination",
        nargs="?",
        default="/tmp/ai-withdrawal-study-export.zip",
        help="ZIP path inside the API container.",
    )
    args = parser.parse_args()
    counts = create_export(args.destination, SupabaseExportSource())
    print(f"Created {args.destination}: {_json(counts)}")


if __name__ == "__main__":
    main()
