import json
import os
import sys
import unittest
from unittest import mock


ADVANCED_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ADVANCED_BACKEND_ROOT not in sys.path:
    sys.path.insert(0, ADVANCED_BACKEND_ROOT)

from ledger_bridge import LedgerBridgeError, NodeLedgerBridge


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode('utf-8')


class LedgerBridgeTests(unittest.TestCase):
    def test_dashboard_proxy_forwards_request_context_and_keeps_node_data_authoritative(self):
        bridge = NodeLedgerBridge(
            base_url='http://127.0.0.1:3000',
            token='test-token',
            timeout_seconds=2
        )
        captured = {}

        def fake_urlopen(request, timeout):
            captured['url'] = request.full_url
            captured['token'] = request.get_header('X-contractor-ai-token')
            captured['request_id'] = request.get_header('X-request-id')
            captured['timeout'] = timeout
            return FakeResponse({'source': 'node', 'ledger': {'metrics': {'openJobs': 3}}})

        with mock.patch('ledger_bridge.urlopen', side_effect=fake_urlopen):
            payload = bridge.get_dashboard('request-123')

        self.assertEqual(captured['url'], 'http://127.0.0.1:3000/api/dashboard')
        self.assertEqual(captured['token'], 'test-token')
        self.assertEqual(captured['request_id'], 'request-123')
        self.assertEqual(captured['timeout'], 2)
        self.assertEqual(payload['source'], 'node')
        self.assertEqual(payload['ledger']['metrics']['openJobs'], 3)
        self.assertEqual(payload['advancedProxy']['authoritativeSource'], 'node_operating_ledger')

    def test_unconfigured_bridge_refuses_to_generate_a_dashboard_fallback(self):
        bridge = NodeLedgerBridge(base_url='')
        with self.assertRaises(LedgerBridgeError) as context:
            bridge.get_dashboard()
        self.assertEqual(context.exception.code, 'ledger_not_configured')
        self.assertEqual(context.exception.status_code, 503)

    def test_bridge_status_redacts_credentials_and_query_parameters(self):
        bridge = NodeLedgerBridge(base_url='https://user:password@ledger.example.test:8443/internal?token=secret')
        status = bridge.status()
        self.assertTrue(status['configured'])
        self.assertEqual(status['target'], 'https://ledger.example.test:8443')
        self.assertNotIn('password', json.dumps(status))
        self.assertNotIn('secret', json.dumps(status))


if __name__ == '__main__':
    unittest.main()
