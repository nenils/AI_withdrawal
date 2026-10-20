import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
import app as api
from participant_access import COOKIE_NAME, ParticipantAccess


class SecurityAPITests(unittest.TestCase):
    def setUp(self):
        self.store = Mock(persistent=True, service_key='test-signing-key-not-shipped-to-client')
        self.access = ParticipantAccess(self.store)
        self.access.require_owner = Mock()
        self.patches = [patch.object(api, 'WITHDRAWAL_STORE', self.store), patch.object(api, 'PARTICIPANT_ACCESS', self.access)]
        for active in self.patches:
            active.start()
        self.addCleanup(lambda: [active.stop() for active in self.patches])
        self.client = TestClient(api.app)

    def sign_in(self):
        self.client.cookies.set(COOKIE_NAME, self.access.issue_cookie('owner'))

    def test_missing_cookie_blocks_state_guess_events_credit_and_llm(self):
        for path, payload in (
            ('/api/withdrawal/state', {'participantId': 'p1', 'partNumber': 1}),
            ('/api/withdrawal/guess', {'participantId': 'p1', 'partNumber': 1, 'guess': ['Blue'] * 4}),
            ('/api/withdrawal/events', {'participantId': 'p1', 'events': []}),
            ('/api/sona/complete-part', {'participantId': 'p1', 'partNumber': 1}),
            ('/api/llm/chat', {'participantId': 'p1', 'messages': []}),
            ('/api/rl/predict', {'participantId': 'p1'}),
        ):
            self.assertEqual(self.client.post(path, json=payload).status_code, 403, path)
        self.store.get_or_create.assert_not_called()

    def test_other_participant_is_denied_before_state_is_read(self):
        self.sign_in()
        self.access.require_owner.side_effect = PermissionError('Not your data')
        response = self.client.post('/api/withdrawal/state', json={'participantId': 'p2', 'partNumber': 1})
        self.assertEqual(response.status_code, 403)
        self.store.get_or_create.assert_not_called()

    def test_credit_requires_uploaded_answers_and_wrong_attention_does_not_exclude(self):
        self.sign_in()
        self.store.part_ready_for_credit.return_value = {'condition': 'advisor', 'credited_parts': []}
        self.store.mark_part_credited.return_value = {'completed_at': None}
        required = json.loads(Path(__file__).with_name('study_requirements.json').read_text())['2']
        answers = {field['id']: 50 if field['type'] == 'slider' else '7' for field in required}
        document = {'answers': {'completed-form': {'endTime': 100, 'answer': answers}}}
        with patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
            source.return_value.revisit_participant.return_value = None
            payload = {'participantId': 'p1', 'partNumber': 2}
            self.assertEqual(self.client.post('/api/sona/complete-part', json=payload).status_code, 409)
            grant.assert_not_called()
            self.store.mark_part_credited.assert_not_called()
            source.return_value.revisit_participant.return_value = document
            self.assertEqual(self.client.post('/api/sona/complete-part', json=payload).status_code, 200)
            grant.assert_called_once_with(2, 'p1')

    def test_config_archive_rejects_unapproved_hash(self):
        self.access.user_for_token = Mock(return_value='owner')
        response = self.client.post('/api/study/archive-config', json={
            'studyId': 'prod-HAIC_part_1', 'configHash': '0' * 64,
        })
        self.assertEqual(response.status_code, 409)
