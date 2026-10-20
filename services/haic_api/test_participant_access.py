import unittest
from unittest.mock import Mock, patch

from participant_access import ParticipantAccess


class ParticipantAccessTests(unittest.TestCase):
    def setUp(self):
        self.store = Mock(service_key='a-secret-not-shipped-to-the-browser')
        self.access = ParticipantAccess(self.store)

    def test_cookie_validity_and_expiry(self):
        with patch('participant_access.time.time', return_value=1000):
            cookie = self.access.issue_cookie('owner')
            self.assertEqual(self.access.read_cookie(cookie), 'owner')
            for invalid in (None, '', cookie + 'tampered'):
                with self.assertRaises(PermissionError):
                    self.access.read_cookie(invalid)
        with patch('participant_access.time.time', return_value=40000):
            with self.assertRaises(PermissionError):
                self.access.read_cookie(cookie)

    def test_cannot_take_over_an_existing_participant(self):
        self.store._request.side_effect = [[{'user_id': 'owner'}], []]
        with self.assertRaises(PermissionError):
            self.access.bind('other-user', 'participant-1')
        self.store.get_or_create.assert_not_called()
        self.assertEqual([call.args[0] for call in self.store._request.call_args_list], ['GET', 'GET'])

    def test_own_participant_is_allowed(self):
        self.store._request.return_value = [{'user_id': 'owner'}]
        self.access.require_owner('owner', 'participant-1')

    def test_public_api_cannot_create_its_own_debug_identity(self):
        self.store._request.return_value = []
        self.store.get.return_value = None
        with self.assertRaises(PermissionError):
            self.access.bind('owner', 'debug-not-created-by-admin')
        self.store.get_or_create.assert_not_called()

    def test_concurrent_first_claim_never_overwrites_owner(self):
        self.store._request.side_effect = [[], [], [{'user_id': 'winner'}], []]
        with self.assertRaises(PermissionError):
            self.access.bind('loser', 'participant-1')
        insert = self.store._request.call_args_list[1]
        self.assertEqual(insert.args[3], 'resolution=ignore-duplicates,return=minimal')
