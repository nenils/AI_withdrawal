import unittest
from unittest.mock import Mock

from submission_store import SubmissionStore


class SubmissionStoreTests(unittest.TestCase):
    def test_freeze_inserts_once_without_overwriting(self):
        store = Mock(persistent=True)
        original = {'data': {'answers': {'original': 1}}, 'sha256': 'saved'}
        store._request.side_effect = [[], [original]]
        saved = SubmissionStore(store).freeze('p1', 2, {'answers': {'replacement': 2}})
        self.assertEqual(saved, original)
        request = store._request.call_args_list[0]
        self.assertEqual(request.args[0], 'POST')
        self.assertEqual(request.args[3], 'resolution=ignore-duplicates,return=representation')
        self.assertEqual(len(request.args[2]['sha256']), 64)

    def test_freeze_does_not_succeed_without_persistent_storage(self):
        with self.assertRaises(RuntimeError):
            SubmissionStore(Mock(persistent=False)).freeze('p1', 2, {})
