import unittest

from debug_participant import create_debug_participant
from withdrawal_store import WithdrawalStore


class DebugParticipantTests(unittest.TestCase):
    def test_regular_participant_cannot_skip_sessions(self):
        store = WithdrawalStore()
        store.base_url = ""
        store.service_key = ""
        record = store.get_or_create("regular-participant", "control")
        with self.assertRaises(PermissionError):
            store.public_state(record, 4)

    def test_each_session_and_condition_can_start_independently(self):
        store = WithdrawalStore()
        store.base_url = ""
        store.service_key = ""
        for session in range(1, 5):
            for condition in ("control", "advisor", "judge"):
                participant_id = create_debug_participant(store, session, condition)
                self.assertTrue(participant_id.startswith("debug-"))
                state = store.public_state(store.get(participant_id), session)
                self.assertEqual(state["currentSession"], session)
                self.assertEqual(state["condition"], condition)
                self.assertEqual(state["game"]["round"], 1)
                self.assertEqual(state["creditedParts"], [])
                self.assertEqual(state["supportAvailable"], condition != "control" and session > 1)


if __name__ == "__main__":
    unittest.main()
