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

    def test_local_image_analysis_requires_review_instead_of_inventing_progress(self):
        engine = self.core.ContractorAIEngine()
        context = self.core.JobContext(
            job_id=42,
            job_type='renovation',
            priority='high',
            location='Amsterdam',
            client_preferences={},
            required_skills=['tiling'],
            required_tools=['tile_cutter'],
            estimated_duration=12,
            weather_dependent=False,
            complexity_score=6
        )

        decision = engine.analyze_image_for_job_progress('/tmp/site-photo.jpg', context)

        self.assertEqual(decision.confidence, 0.0)
        self.assertTrue(decision.requires_approval)
        self.assertEqual(decision.supporting_data['analysisStatus'], 'manual_review_required')
        self.assertIn('vision_analysis_unavailable', decision.risk_factors)
        action_types = {action['type'] for action in decision.recommended_actions}
        self.assertIn('capture_field_evidence', action_types)
        self.assertIn('request_quality_review', action_types)
        self.assertNotIn('update_progress', action_types)

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
            self.assertEqual(message_response.status_code, 501)
            message_error = message_response.get_json()['error']
            self.assertEqual(message_error['code'], 'ledger_communication_unavailable')

            plan_response = client.post('/api/ai/execute-plan', json={'job_id': 'job-123'})
            self.assertEqual(plan_response.status_code, 501)
            plan_error = plan_response.get_json()['error']
            self.assertEqual(plan_error['code'], 'ledger_execution_unavailable')

            vision_response = client.post('/api/vision/analyze-image', json={
                'image_data': 'unverified-image-input',
                'analysis_type': 'progress_tracking'
            })
            self.assertEqual(vision_response.status_code, 501)
            vision_error = vision_response.get_json()['error']
            self.assertEqual(vision_error['code'], 'vision_analysis_unavailable')
            self.assertNotIn('completion_percentage', str(vision_error))

    def test_advanced_endpoints_refuse_unverified_operational_claims(self):
        main_advanced = importlib.import_module('main_advanced')
        main_advanced.app.config['TESTING'] = True

        endpoints = [
            ('post', '/api/chat', {}, 'conversational_ai_unavailable'),
            ('post', '/api/multimodal/process', {}, 'multimodal_processing_unavailable'),
            ('get', '/api/analytics/business-performance', None, 'ledger_analytics_unavailable'),
            ('get', '/api/analytics/demand-forecast', None, 'demand_forecasting_unavailable'),
            ('post', '/api/ar/create-session', {}, 'ar_integration_unavailable'),
            ('post', '/api/iot/register-device', {}, 'iot_integration_unavailable'),
            ('get', '/api/iot/dashboard', None, 'iot_integration_unavailable'),
            ('post', '/api/communication/process-incoming', {}, 'ledger_communication_unavailable'),
            ('get', '/api/test/email-sms', None, 'test_notification_delivery_unavailable'),
            ('get', '/api/test/simulate-client-request', None, 'test_client_request_simulation_unavailable')
        ]

        with main_advanced.app.test_client() as client:
            health = client.get('/api/health')
            self.assertEqual(health.status_code, 200)
            health_payload = health.get_json()
            self.assertEqual(health_payload['status'], 'analysis_only')
            self.assertEqual(health_payload['systems']['ai_engine'], 'online')
            self.assertNotEqual(health_payload['systems']['analytics_engine'], 'online')

            for method, path, payload, code in endpoints:
                with self.subTest(path=path):
                    response = getattr(client, method)(path, json=payload) if payload is not None else getattr(client, method)(path)
                    self.assertEqual(response.status_code, 501)
                    self.assertEqual(response.get_json()['error']['code'], code)

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
