import importlib
import os
import sys
import unittest
from unittest import mock


ADVANCED_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ADVANCED_BACKEND_ROOT not in sys.path:
    sys.path.insert(0, ADVANCED_BACKEND_ROOT)

from ledger_bridge import LedgerBridgeError


class LocalOperatingEngineTests(unittest.TestCase):
    def setUp(self):
        os.environ.pop('OPENAI_API_KEY', None)
        self.core = importlib.import_module('ai_engine.core')
        self.core.OpenAI = None

    def test_local_job_analysis_creates_approval_gated_operating_plan(self):
        engine = self.core.ContractorAIEngine()

        decision = engine.analyze_job_request({
            'title': 'Replace cracked garden paving',
            'description': 'Client needs terrace paving fixed this week. Several slabs are cracked.',
            'client_name': 'Van Dijk',
            'location': 'Amsterdam',
            'desired_date': '2026-07-03',
            'email': 'client@example.test'
        })

        self.assertTrue(decision.requires_approval)
        self.assertEqual(decision.supporting_data['serviceProfile'], 'paving')
        self.assertTrue(decision.supporting_data['operatingLedgerFields']['weather_sensitive'])
        self.assertEqual(decision.supporting_data['autonomyPolicy']['externalCommunicationAllowed'], False)
        self.assertIn('plate_compactor', decision.supporting_data['requiredTools'])
        action_types = {action['type'] for action in decision.recommended_actions}
        self.assertIn('prepare_quote_draft', action_types)
        self.assertIn('reserve_tool_draft', action_types)
        self.assertIn('assess_weather_before_committing_date', action_types)

    def test_local_job_analysis_requests_missing_client_information(self):
        engine = self.core.ContractorAIEngine()

        decision = engine.analyze_job_request({
            'message': 'Need urgent painting repair tomorrow'
        })

        self.assertLess(decision.confidence, 0.8)
        self.assertIn('missingInformation', decision.supporting_data)
        self.assertIn('address', decision.supporting_data['missingInformation'])
        action_types = [action['type'] for action in decision.recommended_actions]
        self.assertIn('request_missing_client_information', action_types)

    def test_advanced_api_does_not_send_or_commit_without_approval(self):
        main_advanced = importlib.import_module('main_advanced')
        main_advanced.ai_engine = self.core.ContractorAIEngine()
        main_advanced.app.config['TESTING'] = True

        with main_advanced.app.test_client() as client:
            analysis_response = client.post('/api/ai/analyze-job-request', json={
                'title': 'Garden hedge cleanup',
                'description': 'Trim hedges and remove green waste.',
                'client_name': 'Robert',
                'address': 'Utrecht',
                'phone': '+31000000000'
            })
            self.assertEqual(analysis_response.status_code, 200)
            analysis = analysis_response.get_json()
            self.assertTrue(analysis['decision']['requiresApproval'])
            self.assertFalse(analysis['safety']['externalMessagesSent'])
            self.assertFalse(analysis['safety']['clientCommitmentsMade'])

            message_response = client.post('/api/communication/send-message', json={
                'channel': 'email',
                'recipient': 'client@example.test',
                'message': 'We can start tomorrow.'
            })
            self.assertEqual(message_response.status_code, 200)
            message = message_response.get_json()
            self.assertEqual(message['status'], 'pending_approval')
            self.assertTrue(message['not_sent'])

            plan_response = client.post('/api/ai/execute-plan', json={'job_id': 'job-123'})
            self.assertEqual(plan_response.status_code, 200)
            plan = plan_response.get_json()
            self.assertTrue(plan['approval_required'])
            self.assertEqual(plan['execution_summary']['pending_approval_steps'], 4)
            self.assertTrue(any(
                step['status'] == 'pending_approval'
                for step in plan['plan_steps']
            ))

    def test_advanced_dashboard_is_a_read_only_node_ledger_proxy(self):
        main_advanced = importlib.import_module('main_advanced')
        main_advanced.app.config['TESTING'] = True
        node_dashboard = {
            'source': 'node',
            'ledger': {'metrics': {'openJobs': 2}},
            'jobs': [{'id': 'job_1', 'title': 'Persisted ledger job'}]
        }

        with mock.patch.object(main_advanced.ledger_bridge, 'get_dashboard', return_value=node_dashboard) as proxy:
            with main_advanced.app.test_client() as client:
                response = client.get('/api/dashboard', headers={'X-Request-Id': 'advanced-proxy-test'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), node_dashboard)
        proxy.assert_called_once_with('advanced-proxy-test')

    def test_advanced_dashboard_returns_a_clear_error_when_the_ledger_is_unavailable(self):
        main_advanced = importlib.import_module('main_advanced')
        main_advanced.app.config['TESTING'] = True

        with mock.patch.object(
            main_advanced.ledger_bridge,
            'get_dashboard',
            side_effect=LedgerBridgeError('Ledger is unavailable', code='ledger_unavailable')
        ):
            with main_advanced.app.test_client() as client:
                response = client.get('/api/dashboard')

        self.assertEqual(response.status_code, 503)
        payload = response.get_json()
        self.assertEqual(payload['error']['code'], 'ledger_unavailable')
        self.assertEqual(payload['error']['message'], 'Ledger is unavailable')


if __name__ == '__main__':
    unittest.main()
