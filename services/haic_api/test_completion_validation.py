import json
import unittest
from pathlib import Path

from completion_validation import validate_questionnaires


class CompletionValidationTests(unittest.TestCase):
    def setUp(self):
        self.requirements = json.loads(Path(__file__).with_name('study_requirements.json').read_text())

    def document(self, part, condition):
        values = {}
        for field in self.requirements[str(part)]:
            if field.get('supportedOnly') and condition == 'control':
                continue
            values[field['id']] = 50 if field['type'] == 'slider' else '7' if field['type'] == 'likert' else 'answered'
        return {'answers': {'test': {'endTime': 100, 'answer': values}}}

    def test_every_session_and_condition_accepts_complete_answers(self):
        for part in range(1, 5):
            for condition in ('advisor', 'judge', 'control'):
                validate_questionnaires(self.document(part, condition), part, condition)

    def test_games_only_or_unfinished_questionnaire_is_rejected(self):
        for data in (None, {'answers': {}}, {'answers': {'games': {'endTime': 100, 'answer': {'played-game': 'done'}}}}):
            with self.assertRaises(ValueError):
                validate_questionnaires(data, 1, 'advisor')
        data = self.document(4, 'advisor')
        data['answers']['test']['endTime'] = -1
        with self.assertRaises(ValueError):
            validate_questionnaires(data, 4, 'advisor')

    def test_each_required_answer_is_checked(self):
        for part in range(1, 5):
            for field in self.requirements[str(part)]:
                data = self.document(part, 'advisor')
                del data['answers']['test']['answer'][field['id']]
                with self.assertRaises(ValueError, msg=field['id']):
                    validate_questionnaires(data, part, 'advisor')

    def test_invalid_slider_and_likert_values_are_rejected(self):
        for invalid in (-1, 101, True, '50', float('nan')):
            data = self.document(2, 'advisor')
            data['answers']['test']['answer']['nasa-tlx-mental-demand'] = invalid
            with self.assertRaises(ValueError):
                validate_questionnaires(data, 2, 'advisor')
        data = self.document(2, 'advisor')
        data['answers']['test']['answer']['attention-check-session-2'] = '8'
        with self.assertRaises(ValueError):
            validate_questionnaires(data, 2, 'advisor')

    def test_wrong_attention_answer_does_not_deny_credit(self):
        data = self.document(2, 'advisor')
        data['answers']['test']['answer']['attention-check-session-2'] = '7'
        validate_questionnaires(data, 2, 'advisor')
