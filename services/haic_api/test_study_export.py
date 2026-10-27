import csv
import io
import json
import tempfile
import unittest
import zipfile
import urllib.error
from pathlib import Path
from unittest.mock import patch

from study_export import create_export, SupabaseExportSource


class SupabaseDownloadTests(unittest.TestCase):
    def setUp(self):
        with patch.dict("os.environ", {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-key",
        }):
            self.source = SupabaseExportSource()

    def download_error(self, status, body):
        error = urllib.error.HTTPError(
            "https://example.supabase.co/storage/v1/object/authenticated/revisit/test",
            status, "Storage error", {}, io.BytesIO(body.encode()),
        )
        return patch("study_export.urllib.request.urlopen", side_effect=error)

    def test_missing_objects_accept_both_http_status_formats(self):
        for status, body in (
            (404, ""),
            (400, '{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}'),
            (400, '{"code":"NoSuchKey"}'),
            (400, '{"statusCode":404,"error":"not_found"}'),
        ):
            with self.subTest(status=status, body=body), self.download_error(status, body):
                self.assertIsNone(self.source.revisit_participant("participant-1", 2))

    def test_other_errors_still_abort_instead_of_hiding_missing_data(self):
        for status, body in (
            (400, '{"statusCode":"403","error":"AccessDenied"}'),
            (400, "Bad request"),
            (400, "[]"),
            (401, '{"error":"Unauthorized"}'),
            (403, '{"error":"Forbidden"}'),
            (500, '{"code":"NoSuchKey"}'),
        ):
            with self.subTest(status=status, body=body), self.download_error(status, body):
                with self.assertRaisesRegex(RuntimeError, f"download failed \\({status}\\)"):
                    self.source.revisit_participant("participant-1", 2)


class FakeExportSource:
    def participants(self):
        return [{
            "participant_id": "participant-1",
            "condition": "advisor",
            "current_session": 2,
            "completed_at": None,
            "completed_sessions": [{
                "session": 1,
                "startedAt": "2026-01-01T12:00:00Z",
                "completedAt": "2026-01-01T12:10:00Z",
                "creditedAt": "2026-01-01T12:11:00Z",
                "rounds": [{
                    "round": 1,
                    "won": True,
                    "attempts": 1,
                    "secret": ["Blue"] * 4,
                    "completedAt": "2026-01-01T12:02:00Z",
                    "guessHistory": [{
                        "attempt": 1,
                        "guess": ["Blue"] * 4,
                        "feedback": {"black": 4, "white": 0},
                        "submittedAt": "2026-01-01T12:02:00Z",
                    }],
                }],
            }],
            "credited_parts": [1],
            "game_state": {
                "session": 2,
                "round": 1,
                "guesses": [{
                    "attempt": 1,
                    "guess": ["Red"] * 4,
                    "feedback": {"black": 0, "white": 0},
                    "submittedAt": "2026-01-02T12:01:00Z",
                }],
            },
            "created_at": "2026-01-01T12:00:00Z",
            "updated_at": "2026-01-02T12:01:00Z",
        }]

    def revisit_participant(self, participant_id, part_number):
        if part_number != 1:
            return None
        return {
            "participantId": participant_id,
            "completed": True,
            "answers": {
                "session-state_1": {
                    "componentName": "session-state",
                    "trialOrder": "1",
                    "answer": {"state-responsibility": [6]},
                    "startTime": 1000,
                    "endTime": 2500,
                    "timedOut": False,
                    "windowEvents": [[1200, "click", [10, 20]]],
                },
            },
        }

    def events(self):
        yield {
            "id": 1,
            "participant_id": "participant-1",
            "session_number": 1,
            "round_number": 1,
            "event_type": "click",
            "event_data": {"x": 10, "y": 20},
            "client_timestamp": "2026-01-01T12:00:01Z",
            "server_timestamp": "2026-01-01T12:00:02Z",
        }


class StudyExportTests(unittest.TestCase):
    def test_combines_all_study_data_in_one_zip(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "export.zip"
            counts = create_export(destination, FakeExportSource())

            self.assertEqual(counts, {
                "participants": 1,
                "responses": 1,
                "games": 1,
                "guesses": 2,
                "events": 1,
            })
            with zipfile.ZipFile(destination) as archive:
                self.assertEqual(set(archive.namelist()), {
                    "participant_status.csv",
                    "longitudinal_responses.csv",
                    "games.csv",
                    "guesses.csv",
                    "events.csv",
                    "raw/revisit_participants.jsonl",
                    "raw/withdrawal_participants.json",
                    "manifest.json",
                })
                status = next(csv.DictReader(
                    archive.read("participant_status.csv").decode("utf-8").splitlines(),
                ))
                self.assertEqual(status["part_1_completed"], "True")
                self.assertEqual(status["part_2_data_found"], "False")
                self.assertEqual(status["all_four_parts_completed"], "False")

                response = next(csv.DictReader(
                    archive.read("longitudinal_responses.csv").decode("utf-8").splitlines(),
                ))
                self.assertEqual(response["part_number"], "1")
                self.assertEqual(response["response_id"], "state-responsibility")
                self.assertEqual(json.loads(response["answer_json"]), [6])


if __name__ == "__main__":
    unittest.main()
