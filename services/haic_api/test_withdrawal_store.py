import os
import unittest
from unittest.mock import patch

from withdrawal_store import COLORS, WithdrawalStore, score_guess, support_available, support_phase


class WithdrawalStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.environment = patch.dict(
            os.environ,
            {"SUPABASE_URL": "", "SUPABASE_SERVICE_ROLE_KEY": ""},
            clear=False,
        )
        self.environment.start()
        self.store = WithdrawalStore()

    def tearDown(self) -> None:
        self.environment.stop()

    def test_mastermind_scoring_handles_repeated_colors(self) -> None:
        result = score_guess(
            ["Blue", "Blue", "Red", "Green"],
            ["Blue", "Red", "Blue", "Yellow"],
        )
        self.assertEqual(result, {"black": 1, "white": 2})

    def test_support_schedule(self) -> None:
        self.assertFalse(support_available("advisor", 1, 3))
        self.assertTrue(support_available("advisor", 1, 4))
        self.assertTrue(support_available("judge", 3, 2))
        self.assertTrue(support_available("judge", 4, 1))
        self.assertFalse(support_available("judge", 4, 2))
        self.assertFalse(support_available("control", 2, 1))
        self.assertEqual(support_phase("advisor", 4, 2), "withdrawn")

    def test_condition_is_fixed_after_assignment(self) -> None:
        self.store.get_or_create("participant-1", "advisor")
        with self.assertRaises(ValueError):
            self.store.get_or_create("participant-1", "judge")

    def test_condition_can_be_randomly_assigned_once(self) -> None:
        first = self.store.get_or_create("participant-random")
        second = self.store.get_or_create("participant-random")
        self.assertIn(first["condition"], {"control", "advisor", "judge"})
        self.assertEqual(first["condition"], second["condition"])

    def test_ten_failed_attempts_advance_instead_of_ending_session(self) -> None:
        record = self.store.get_or_create("participant-2", "control")
        secret = record["game_state"]["secrets"][0]
        wrong = next(color for color in COLORS if color not in secret)
        guess = [wrong] * 4
        result = None
        for _ in range(10):
            result = self.store.submit_guess("participant-2", "control", guess)
        self.assertIsNotNone(result)
        self.assertTrue(result["roundFinished"])
        self.assertFalse(result["sessionFinished"])
        self.assertEqual(result["game"]["round"], 2)

    def test_sona_credit_advances_only_after_four_games(self) -> None:
        participant = "participant-3"
        for _round in range(4):
            record = self.store.get(participant)
            if record is None:
                record = self.store.get_or_create(participant, "advisor")
            secret = record["game_state"]["secrets"][record["game_state"]["round"] - 1]
            result = self.store.submit_guess(participant, "advisor", secret)
        self.assertTrue(result["sessionFinished"])
        self.assertTrue(result["partGameComplete"])
        self.assertEqual(result["currentSession"], 1)
        self.assertEqual(len(result["completedSessions"]), 1)

        credited = self.store.mark_part_credited(participant, 1)
        self.assertEqual(credited["current_session"], 2)
        self.assertEqual(credited["credited_parts"], [1])
        next_state = self.store.public_state(credited, 2)
        self.assertEqual(next_state["game"]["session"], 2)

    def test_future_sona_part_cannot_start_early(self) -> None:
        record = self.store.get_or_create("participant-4", "control")
        with self.assertRaises(PermissionError):
            self.store.public_state(record, 2)


if __name__ == "__main__":
    unittest.main()
