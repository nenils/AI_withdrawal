import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import app as api


class CompletionAPITests(unittest.TestCase):
    def setUp(self):
        self.store = Mock(persistent=True)
        active = patch.object(api, 'WITHDRAWAL_STORE', self.store)
        active.start()
        self.addCleanup(active.stop)
        self.client = TestClient(api.app)
        self.store.part_ready_for_credit.return_value = {
            'condition': 'advisor', 'credited_parts': [],
            'completed_sessions': [{'session': 2, 'confirmationCode': 'MM-S2-0123456789AB'}],
        }
        self.store.mark_part_credited.return_value = {'completed_at': None}

    def document(self):
        required = json.loads(Path(__file__).with_name('study_requirements.json').read_text())['2']
        answers = {field['id']: 50 if field['type'] == 'slider' else '7' for field in required}
        answers['played-game'] = 'MM-S2-0123456789AB'
        return {'answers': {'completed-form': {'endTime': 100, 'answer': answers}}}

    def test_sona_link_state_does_not_require_auth_or_browser_binding(self):
        self.store.public_state.return_value = {'participantId': 'sona-code'}
        for client in (self.client, TestClient(api.app)):
            response = client.post('/api/withdrawal/state', json={'participantId': 'sona-code', 'partNumber': 2})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['participantId'], 'sona-code')

    def test_credit_requires_uploaded_answers_and_wrong_attention_does_not_exclude(self):
        with patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
            source.return_value.revisit_participant.return_value = None
            payload = {'participantId': 'p1', 'partNumber': 2}
            self.assertEqual(self.client.post('/api/sona/complete-part', json=payload).status_code, 409)
            grant.assert_not_called()
            self.store.mark_part_credited.assert_not_called()
            source.return_value.revisit_participant.return_value = self.document()
            self.assertEqual(self.client.post('/api/sona/complete-part', json=payload).status_code, 200)
            grant.assert_called_once_with(2, 'p1')
            source.return_value.revisit_participant.assert_called_with('p1', 2)

    def test_debug_completion_validates_answers_but_never_grants_sona_credit(self):
        with patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
            source.return_value.revisit_participant.return_value = self.document()
            response = self.client.post('/api/sona/complete-part', json={'participantId': 'debug-test', 'partNumber': 2})
            self.assertEqual(response.status_code, 200)
            grant.assert_not_called()

    def test_repeated_credit_is_idempotent_without_reloading_answers(self):
        self.store.part_ready_for_credit.return_value['credited_parts'] = [2]
        with patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
            response = self.client.post('/api/sona/complete-part', json={'participantId': 'p1', 'partNumber': 2})
            self.assertEqual(response.status_code, 200)
            source.assert_not_called()
            grant.assert_not_called()
            self.store.mark_part_credited.assert_not_called()

    def test_shared_old_missing_or_other_session_codes_cannot_grant_credit(self):
        for code in ('MM-SESSION-2-COMPLETE', 'MM-S2-OTHERPERSON1', 'MM-S1-0123456789AB', None):
            with self.subTest(code=code), patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
                data = self.document()
                data['answers']['completed-form']['answer']['played-game'] = code
                source.return_value.revisit_participant.return_value = data
                response = self.client.post('/api/sona/complete-part', json={'participantId': 'p1', 'partNumber': 2})
                self.assertEqual(response.status_code, 409)
                grant.assert_not_called()
                self.store.mark_part_credited.assert_not_called()
