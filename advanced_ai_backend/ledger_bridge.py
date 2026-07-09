"""Read-only bridge from the prototype analysis service to the Node ledger."""

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


@dataclass
class LedgerBridgeError(Exception):
    message: str
    code: str = 'ledger_unavailable'
    status_code: int = 503

    def __str__(self) -> str:
        return self.message


class NodeLedgerBridge:
    """Fetch authoritative dashboard state without creating a second data store."""

    def __init__(self, base_url: Optional[str] = None, token: Optional[str] = None, timeout_seconds: Optional[float] = None):
        self.base_url = (base_url if base_url is not None else os.environ.get('CONTRACTOR_LEDGER_API_URL', '')).rstrip('/')
        self.token = token if token is not None else os.environ.get('CONTRACTOR_LEDGER_API_TOKEN', '')
        self.timeout_seconds = float(timeout_seconds if timeout_seconds is not None else os.environ.get('CONTRACTOR_LEDGER_TIMEOUT_SECONDS', '5'))

    def _validated_base_url(self) -> str:
        if not self.base_url:
            raise LedgerBridgeError(
                'The advanced analysis service is not connected to the Node operating ledger.',
                code='ledger_not_configured'
            )
        parsed = urlparse(self.base_url)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
            raise LedgerBridgeError(
                'CONTRACTOR_LEDGER_API_URL must be an http(s) base URL.',
                code='ledger_configuration_invalid',
                status_code=500
            )
        return self.base_url

    def dashboard_url(self) -> Optional[str]:
        try:
            return self._validated_base_url()
        except LedgerBridgeError:
            return None

    def status(self) -> Dict[str, Any]:
        url = self.dashboard_url()
        if not url:
            return {'configured': False, 'mode': 'analysis_only'}
        parsed = urlparse(url)
        return {
            'configured': True,
            'mode': 'read_only_proxy',
            'target': f'{parsed.scheme}://{parsed.hostname}{f":{parsed.port}" if parsed.port else ""}'
        }

    def get_dashboard(self, request_id: Optional[str] = None) -> Dict[str, Any]:
        base_url = self._validated_base_url()
        headers = {'Accept': 'application/json'}
        if request_id:
            headers['X-Request-Id'] = request_id
        if self.token:
            headers['X-Contractor-AI-Token'] = self.token
        request = Request(f'{base_url}/api/dashboard', headers=headers, method='GET')
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except HTTPError as error:
            if error.code in {401, 403}:
                raise LedgerBridgeError('The Node operating ledger rejected the configured bridge credentials.', code='ledger_auth_failed') from error
            raise LedgerBridgeError('The Node operating ledger could not provide dashboard state.', code='ledger_request_failed') from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise LedgerBridgeError('The Node operating ledger is unavailable. No dashboard fallback was generated.', code='ledger_unavailable') from error

        if not isinstance(payload, dict):
            raise LedgerBridgeError('The Node operating ledger returned an invalid dashboard payload.', code='ledger_invalid_response')
        payload['advancedProxy'] = {
            'mode': 'read_only',
            'service': 'advanced_ai_backend',
            'authoritativeSource': 'node_operating_ledger'
        }
        return payload
