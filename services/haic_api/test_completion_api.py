import json
from datetime import datetime, timedelta
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
        submissions = patch.object(api, 'SubmissionStore')
        self.submissions = submissions.start().return_value
        self.addCleanup(submissions.stop)
        self.submissions.get.return_value = None
        self.submissions.freeze.side_effect = lambda _pid, _part, data: {'data': data, 'submitted_at': '2026-11-02T12:00:00Z'}
        self.record = {
            'participant_id': 'p1', 'condition': 'advisor', 'credited_parts': [], 'current_session': 2,
            'completed_at': None, 'game_state': None,
            'completed_sessions': [{'session': 2, 'confirmationCode': 'MM-S2-0123456789AB'}],
        }
        self.store.part_ready_for_credit.return_value = self.record
        self.store.get.return_value = self.record
        self.store.get_or_create.return_value = self.record

        def complete(_pid, part, timestamp):
            self.record['completed_sessions'][0].setdefault('submittedAt', timestamp)
            self.record['current_session'] = part + 1
            self.record['next_session_available_at'] = (datetime.fromisoformat(timestamp.replace('Z', '+00:00')) + timedelta(hours=24)).isoformat()
            return self.record

        def credit(_pid, part):
            self.record['credited_parts'].append(part)
            return self.record

        self.store.mark_part_completed.side_effect = complete
        self.store.mark_part_credited.side_effect = credit

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

    def test_original_is_preserved_before_sona_credit(self):
        steps = []
        self.submissions.freeze.side_effect = lambda _pid, _part, data: steps.append('freeze') or {'data': data, 'submitted_at': '2026-11-02T12:00:00Z'}
        with patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
            source.return_value.revisit_participant.return_value = self.document()
            def grant_credit(*_):
                self.assertEqual(self.record['current_session'], 3)
                self.assertEqual(self.record['next_session_available_at'], '2026-11-03T12:00:00+00:00')
                steps.append('credit')
            grant.side_effect = grant_credit
            response = self.client.post('/api/sona/complete-part', json={'participantId': 'p1', 'partNumber': 2})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(steps, ['freeze', 'credit'])

    def test_failed_preservation_blocks_credit(self):
        self.submissions.freeze.side_effect = RuntimeError('Unable to preserve original')
        with patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
            source.return_value.revisit_participant.return_value = self.document()
            response = self.client.post('/api/sona/complete-part', json={'participantId': 'p1', 'partNumber': 2})
            self.assertEqual(response.status_code, 503)
            grant.assert_not_called()

    def test_credit_retry_uses_preserved_submission_not_later_answers(self):
        self.submissions.get.return_value = {'data': self.document(), 'submitted_at': '2026-10-27T12:00:00Z'}
        with patch.object(api, 'SupabaseExportSource') as source, patch.object(api, 'grant_sona_credit') as grant:
            grant.side_effect = RuntimeError('SONA unavailable')
            payload = {'participantId': 'p1', 'partNumber': 2}
            response = self.client.post('/api/sona/complete-part', json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['completed'])
            self.assertTrue(response.json()['creditPending'])
            self.assertFalse(response.json()['credited'])
            self.assertEqual(self.record['current_session'], 3)
            unlock = self.record['next_session_available_at']
            grant.side_effect = None
            self.assertEqual(self.client.post('/api/sona/complete-part', json=payload).status_code, 200)
            self.assertEqual(self.record['next_session_available_at'], unlock)
            source.assert_not_called()
            self.submissions.freeze.assert_not_called()

    def test_reopening_credited_session_only_records_a_separate_visit(self):
        self.record['credited_parts'] = [1, 2]
        self.record['current_session'] = 3
        response = self.client.post('/api/withdrawal/part-status', json={
            'participantId': 'p1', 'partNumber': 2, 'recordVisit': True,
        })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['locked'])
        self.assertTrue(response.json()['credited'])
        self.store.save.assert_not_called()
        event = self.store.append_events.call_args.args[1][0]
        self.assertEqual(event['type'], 'completedSessionReopened')
        self.assertEqual(event['sessionNumber'], 2)

    def test_opening_next_part_reconciles_an_existing_preserved_submission_without_sona(self):
        self.submissions.get.side_effect = lambda _pid, part: (
            {'data': self.document(), 'submitted_at': '2026-10-27T12:00:00Z'} if part == 2 else None
        )
        with patch.object(api, 'grant_sona_credit') as grant:
            response = self.client.post('/api/withdrawal/part-status', json={'participantId': 'p1', 'partNumber': 3})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self.record['current_session'], 3)
            self.assertEqual(self.record['next_session_available_at'], '2026-10-28T12:00:00+00:00')
            self.assertEqual(self.record['credited_parts'], [])
            grant.assert_not_called()

    def test_legacy_credit_based_unlock_is_rebased_to_original_submission_time(self):
        self.record['current_session'] = 3
        self.record['credited_parts'] = [2]
        self.record['next_session_available_at'] = '2026-11-05T12:00:00Z'
        self.submissions.get.side_effect = lambda _pid, part: (
            {'data': self.document(), 'submitted_at': '2026-11-02T12:00:00Z'} if part == 2 else None
        )
        response = self.client.post('/api/withdrawal/part-status', json={'participantId': 'p1', 'partNumber': 3})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.record['next_session_available_at'], '2026-11-03T12:00:00+00:00')
