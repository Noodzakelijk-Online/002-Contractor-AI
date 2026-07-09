import json
import os
import shutil
import subprocess
import sys
import textwrap
import unittest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def probe_legacy_shim(module_name, mutation_path):
    script = textwrap.dedent(
        f'''
        import importlib
        import json
        import os
        import tempfile
        from unittest import mock

        runtime_dir = tempfile.mkdtemp(prefix='contractor-ai-legacy-shim-')
        os.environ['DATABASE_URL'] = 'sqlite:///' + os.path.join(runtime_dir, 'shim.sqlite')
        os.environ.pop('CONTRACTOR_AI_ENABLE_LEGACY_PYTHON_MUTATIONS', None)
        os.environ.pop('CONTRACTOR_LEDGER_API_URL', None)
        module = importlib.import_module('{module_name}')
        module.app.config['TESTING'] = True
        with mock.patch.object(module.ledger_bridge, 'get_dashboard', return_value={{'source': 'node', 'jobs': []}}):
            with module.app.test_client() as client:
                dashboard = client.get('/api/dashboard')
                mutation = client.post('{mutation_path}', json={{}})
                root = client.get('/')
        print(json.dumps({{
            'runtimeDir': runtime_dir,
            'dashboardStatus': dashboard.status_code,
            'dashboardSource': dashboard.get_json()['source'],
            'mutationStatus': mutation.status_code,
            'mutationCode': mutation.get_json()['error']['code'],
            'rootStatus': root.status_code,
            'rootCode': root.get_json()['error']['code']
        }}))
        '''
    )
    completed = subprocess.run(
        [sys.executable, '-c', script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=True
    )
    payload = json.loads(completed.stdout.strip().splitlines()[-1])
    shutil.rmtree(payload['runtimeDir'], ignore_errors=True)
    return payload


class LegacyCompatibilityShimTests(unittest.TestCase):
    def test_python_dashboards_proxy_node_ledger_and_fail_closed_for_writes(self):
        fixtures = [
            ('advanced_ai_backend.main', '/api/users'),
            ('contractor_ai_backend.main', '/api/jobs'),
            ('god_mode_contractor_ai.main', '/api/jobs')
        ]
        for module_name, mutation_path in fixtures:
            with self.subTest(module=module_name):
                payload = probe_legacy_shim(module_name, mutation_path)
                self.assertEqual(payload['dashboardStatus'], 200)
                self.assertEqual(payload['dashboardSource'], 'node')
                self.assertEqual(payload['mutationStatus'], 410)
                self.assertEqual(payload['mutationCode'], 'legacy_backend_disabled')
                self.assertEqual(payload['rootStatus'], 503)
                self.assertEqual(payload['rootCode'], 'ledger_not_configured')


if __name__ == '__main__':
    unittest.main()
