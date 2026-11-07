import copy
import json
import os
from datetime import timedelta
from pathlib import Path
import unittest
from unittest.mock import patch, PropertyMock

from fastapi.testclient import TestClient
import app as api
from completion_validation import validate_questionnaires
from prolific import COHORTS, wave_config
from prolific_links import study_links
from withdrawal_store import WithdrawalStore, utc_now, iso


PID = "1234567890abcdef12345678"
SESSION = "abcdef1234567890abcdef12"


class ProlificTests(unittest.TestCase):
    def setUp(self):
        env = {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""}
        for cohort in COHORTS:
            for part in range(1, 5):
                prefix = f"PROLIFIC_{cohort.upper()}_PART_{part}"
                env[f"{prefix}_STUDY_ID"] = f"{cohort}{part}" + "0" * 22
                env[f"{prefix}_COMPLETION_URL"] = f"https://app.prolific.com/submissions/complete?cc={cohort.upper()}PART{part}"
        active = patch.dict(os.environ, env)
        active.start()
        self.addCleanup(active.stop)
        self.store = WithdrawalStore()
        active = patch.object(api, "WITHDRAWAL_STORE", self.store)
        active.start()
        self.addCleanup(active.stop)
        active = patch.object(api, "SubmissionStore")
        self.submissions = active.start().return_value
        self.addCleanup(active.stop)
        self.saved = {}
        self.submissions.get.side_effect = lambda pid, part: self.saved.get((pid, part))

        def freeze(pid, part, data):
            return self.saved.setdefault((pid, part), {"data": copy.deepcopy(data), "submitted_at": iso(utc_now())})

        self.submissions.freeze.side_effect = freeze
        active = patch.object(api, "SupabaseExportSource")
        self.source = active.start().return_value
        self.addCleanup(active.stop)
        self.source.revisit_participant.return_value = None
        active = patch.object(api, "grant_sona_credit")
        self.grant_sona = active.start()
        self.addCleanup(active.stop)
        self.client = TestClient(api.app, follow_redirects=False)

    def enter(self, cohort="a", part=1, pid=PID, **overrides):
        study_id = os.environ[f"PROLIFIC_{cohort.upper()}_PART_{part}_STUDY_ID"]
        return self.client.get(f"/api/prolific/start/{cohort}/{part}", params={
            "PROLIFIC_PID": pid, "STUDY_ID": study_id, "SESSION_ID": SESSION, **overrides,
        })

    def finish_games(self, part=1):
        for _ in range(4):
            record = self.store.get(PID)
            game = record["game_state"]
            self.store.submit_guess(PID, record["condition"], game["secrets"][game["round"] - 1], part)

    def document(self, part):
        record = self.store.get(PID)
        required = json.loads(Path(__file__).with_name("study_requirements.json").read_text())[str(part)]
        answers = {f["id"]: 50 if f["type"] == "slider" else "7" if f["type"] == "likert" else "answered"
                   for f in required if not f.get("supportedOnly") or record["condition"] != "control"}
        answers["played-game"] = next(s["confirmationCode"] for s in record["completed_sessions"] if s["session"] == part)
        return {"answers": {"form": {"endTime": 100, "answer": answers}}}

    def complete(self, part=1):
        self.source.revisit_participant.return_value = self.document(part)
        # Use the real in-memory game engine while mocking only the persistence boundary.
        with patch.object(WithdrawalStore, "persistent", new_callable=PropertyMock, return_value=True):
            with patch.object(self.store, "get", side_effect=lambda pid: copy.deepcopy(self.store._memory.get(pid))), \
                 patch.object(self.store, "save", side_effect=lambda r: self.store._memory.__setitem__(r["participant_id"], copy.deepcopy(r)) or copy.deepcopy(r)):
                return self.client.post("/api/study/complete-part", json={"participantId": PID, "partNumber": part})

    def test_all_twelve_links_bind_the_correct_condition_and_store_identifiers(self):
        for index, (cohort, condition) in enumerate(COHORTS.items()):
            pid = f"{index:024x}"
            response = self.enter(cohort, pid=pid)
            self.assertEqual(response.status_code, 302)
            self.assertIn("PROLIFIC_PID=" + pid, response.headers["location"])
            self.assertNotIn("participantId=", response.headers["location"])
            record = self.store.get(pid)
            self.assertEqual(record["condition"], condition)
            for part in range(1, 5):
                record["current_session"] = part
                record["game_state"] = None
                self.store.save(record)
                self.assertEqual(self.enter(cohort, part, pid).status_code, 302)
                record = self.store.get(pid)
                self.assertEqual(record["recruitment"]["parts"][str(part)]["sessionIds"], [SESSION])

    def test_published_links_match_the_generator(self):
        published = Path(__file__).parents[2].joinpath('PROLIFIC_LINKS.txt').read_text()
        links = list(study_links('https://iivm11.cit.tum.de'))
        self.assertEqual(len(links), 12)
        self.assertEqual(len({url for _, _, url in links}), 12)
        for _, _, url in links:
            self.assertIn(url, published)

    def test_initial_enrollment_is_a_single_write_with_platform_metadata(self):
        with patch.object(self.store, 'save', wraps=self.store.save) as save:
            self.assertEqual(self.enter().status_code, 302)
            save.assert_called_once()
            self.assertEqual(save.call_args.args[0]['recruitment']['platform'], 'prolific')

    def test_mismatched_wave_missing_id_and_cross_condition_are_rejected(self):
        self.assertEqual(self.enter(PROLIFIC_PID="").status_code, 409)
        self.assertEqual(self.enter(STUDY_ID="f" * 24).status_code, 409)
        self.assertEqual(self.enter(PROLIFIC_PID="{{%PROLIFIC_PID%}}").status_code, 409)
        self.assertEqual(self.enter().status_code, 302)
        self.assertEqual(self.enter("b").status_code, 409)
        self.assertEqual(self.store.get(PID)["condition"], "control")

    def test_session_id_is_optional_and_invalid_preview_values_are_ignored(self):
        for value in ("", "{{%SESSION_ID%}}", "PREVIEW", "invalid"):
            with self.subTest(value=value):
                response = self.enter(SESSION_ID=value)
                self.assertEqual(response.status_code, 302, response.text)
                self.assertNotIn("SESSION_ID=", response.headers["location"])
                self.assertEqual(self.store.get(PID)["recruitment"]["parts"]["1"]["sessionIds"], [])
        study_id, _ = wave_config("a", 1)
        response = self.client.get("/api/prolific/start/a/1", params={"PROLIFIC_PID": PID, "STUDY_ID": study_id})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.enter().status_code, 302)
        self.assertEqual(self.enter(SESSION_ID="").status_code, 302)
        self.assertEqual(self.store.get(PID)["recruitment"]["parts"]["1"]["sessionIds"], [SESSION])

    def test_missing_or_untrusted_return_url_is_rejected_before_recruitment(self):
        for value in ("", "https://example.com/submissions/complete?cc=BAD", "http://app.prolific.com/submissions/complete?cc=BAD"):
            with patch.dict(os.environ, {"PROLIFIC_A_PART_1_COMPLETION_URL": value}):
                self.assertEqual(self.enter().status_code, 503)
                self.assertIsNone(self.store.get(PID))

    def test_games_and_required_answers_are_mandatory_before_redirect(self):
        self.assertEqual(self.enter().status_code, 302)
        payload = {"participantId": PID, "partNumber": 1}
        self.assertEqual(self.client.post("/api/study/complete-part", json=payload).status_code, 409)
        self.finish_games()
        self.assertEqual(self.client.post("/api/study/complete-part", json=payload).status_code, 409)
        self.assertEqual(self.client.get("/api/prolific/complete", params=payload).status_code, 409)
        response = self.complete()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["completed"])
        self.assertFalse(response.json()["credited"])
        self.assertFalse(response.json()["creditPending"])
        self.assertIsNone(response.json()["nextSessionUrl"])
        self.assertIn("/api/prolific/complete?", response.json()["completionUrl"])
        self.grant_sona.assert_not_called()
        response = self.client.get("/api/prolific/complete", params=payload)
        self.assertEqual(response.status_code, 302)
        self.assertIn("cc=APART1", response.headers["location"])
        self.assertEqual(self.enter(part=2).status_code, 423)
        self.assertEqual(self.enter().status_code, 302)
        status = self.client.post("/api/withdrawal/part-status", json=payload).json()
        self.assertTrue(status["locked"])
        self.assertEqual(status["platform"], "prolific")

    def test_later_waves_require_prior_participation_and_new_prolific_entry(self):
        self.assertEqual(self.enter(part=2).status_code, 409)
        self.enter()
        self.assertEqual(self.enter(part=4).status_code, 409)
        self.finish_games()
        self.complete()
        record = self.store.get(PID)
        record["next_session_available_at"] = iso(utc_now() - timedelta(seconds=1))
        self.store.save(record)
        payload = {"participantId": PID, "partNumber": 2}
        self.assertEqual(self.client.post("/api/withdrawal/state", json=payload).status_code, 423)
        self.assertEqual(self.enter(part=2).status_code, 302)
        self.assertEqual(self.client.post("/api/withdrawal/state", json=payload).status_code, 200)

    def test_ownership_all_seven_items_required_in_all_conditions(self):
        for condition in COHORTS.values():
            required = json.loads(Path(__file__).with_name("study_requirements.json").read_text())["4"]
            answers = {f["id"]: 50 if f["type"] == "slider" else "7" for f in required
                       if not f.get("supportedOnly") or condition != "control"}
            ownership = [key for key in answers if key.startswith("ownership-")]
            self.assertEqual(len(ownership), 7)
            for key in ownership:
                data = {"answers": {"form": {"endTime": 100, "answer": {k: v for k, v in answers.items() if k != key}}}}
                with self.assertRaises(ValueError):
                    validate_questionnaires(data, 4, condition)

    def test_all_four_waves_preserve_support_schedule_and_ownership_for_each_condition(self):
        for cohort, condition in COHORTS.items():
            self.store._memory.clear()
            self.saved.clear()
            for part in range(1, 5):
                with self.subTest(cohort=cohort, part=part), patch("withdrawal_store.utc_now", return_value=utc_now() + timedelta(days=part)):
                    self.assertEqual(self.enter(cohort, part, SESSION_ID="").status_code, 302)
                    state = self.client.post("/api/withdrawal/state", json={"participantId": PID, "partNumber": part})
                    self.assertEqual(state.status_code, 200, state.text)
                    for game in range(1, 5):
                        record = self.store.get(PID)
                        state = self.store.public_state(record, part)
                        expected = condition != "control" and ((part == 1 and game == 4) or part in (2, 3) or (part == 4 and game == 1))
                        self.assertEqual(state["supportAvailable"], expected)
                        secret = record["game_state"]["secrets"][game - 1]
                        self.store.submit_guess(PID, condition, secret, part)
                    response = self.complete(part)
                    self.assertEqual(response.status_code, 200, response.text)
                    redirected = self.client.get(response.json()["completionUrl"])
                    self.assertEqual(redirected.status_code, 302, redirected.text)
                    self.assertIn(f"cc={cohort.upper()}PART{part}", redirected.headers["location"])
                    self.assertEqual(response.json()["studyCompleted"], part == 4)
                    status = self.client.post("/api/withdrawal/part-status", json={"participantId": PID, "partNumber": part})
                    self.assertTrue(status.json()["locked"])
                    if part == 4:
                        answers = self.saved[(PID, part)]["data"]["answers"]["form"]["answer"]
                        self.assertEqual(len([key for key in answers if key.startswith("ownership-")]), 7)
        self.grant_sona.assert_not_called()

    def test_copied_confirmation_code_cannot_finish(self):
        self.enter()
        self.finish_games()
        document = self.document(1)
        document["answers"]["form"]["answer"]["played-game"] = "MM-S1-COPIEDCODE12"
        self.source.revisit_participant.return_value = document
        record = self.store.get(PID)
        with patch.object(WithdrawalStore, "persistent", new_callable=PropertyMock, return_value=True), \
             patch.object(self.store, "get_or_create", return_value=record):
            response = self.client.post("/api/study/complete-part", json={"participantId": PID, "partNumber": 1})
        self.assertEqual(response.status_code, 409)
        self.submissions.freeze.assert_not_called()

    def test_losing_all_four_games_at_ten_guesses_is_valid_completion(self):
        self.enter()
        for _ in range(4):
            game = self.store.get(PID)["game_state"]
            secret = game["secrets"][game["round"] - 1]
            guess = ["Blue"] * 4 if secret != ["Blue"] * 4 else ["Green"] * 4
            for _ in range(10):
                self.store.submit_guess(PID, "control", guess, 1)
        response = self.complete()
        self.assertEqual(response.status_code, 200, response.text)


if __name__ == "__main__":
    unittest.main()
