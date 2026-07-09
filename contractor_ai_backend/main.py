import os
import sys
import secrets
import logging
# Make the package runnable both as `python contractor_ai_backend/main.py`
# and from the repository root.
sys.path.insert(0, os.path.dirname(__file__))
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from flask import Flask, jsonify, redirect, request
from flask_cors import CORS
from sqlalchemy import inspect, text
from advanced_ai_backend.ledger_bridge import LedgerBridgeError, NodeLedgerBridge
from models.job import db as contractor_db
from models import user  # noqa: F401 - registers the User model with contractor_db
from routes.user import user_bp
from routes.contractor_ai import contractor_ai_bp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'))
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY')
if not app.config['SECRET_KEY']:
    logger.warning("FLASK_SECRET_KEY not set. Using generated random key. Sessions will not persist across restarts.")
    app.config['SECRET_KEY'] = secrets.token_hex(32)

def _cors_origins():
    configured = os.environ.get(
        'CORS_ORIGINS',
        'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173'
    )
    return [origin.strip() for origin in configured.split(',') if origin.strip()]


def _debug_enabled():
    return os.environ.get('FLASK_DEBUG', '').lower() in {'1', 'true', 'yes', 'on'}


CORS(app, resources={r"/api/*": {"origins": _cors_origins()}})
ledger_bridge = NodeLedgerBridge()


def _legacy_mutations_enabled():
    return os.environ.get('CONTRACTOR_AI_ENABLE_LEGACY_PYTHON_MUTATIONS', '').lower() in {'1', 'true', 'yes', 'on'}


def _ledger_error(error):
    return jsonify({
        'error': {
            'code': error.code,
            'message': error.message,
            'authoritativeSource': 'node_operating_ledger'
        }
    }), error.status_code


@app.before_request
def enforce_node_ledger_authority():
    if request.path == '/api/dashboard':
        try:
            return jsonify(ledger_bridge.get_dashboard(request.headers.get('X-Request-Id')))
        except LedgerBridgeError as error:
            return _ledger_error(error)

    if request.path == '/api/health':
        return jsonify({
            'status': 'compatibility_only',
            'service': 'contractor_ai_backend',
            'legacyMutationsEnabled': _legacy_mutations_enabled(),
            'ledgerBridge': ledger_bridge.status()
        })

    if request.path.startswith('/api/') and not _legacy_mutations_enabled():
        return jsonify({
            'error': {
                'code': 'legacy_backend_disabled',
                'message': 'This Python backend is a disabled compatibility shim. Use the Node operating ledger API on the configured Contractor.AI service.',
                'authoritativeSource': 'node_operating_ledger'
            }
        }), 410

app.register_blueprint(user_bp, url_prefix='/api')
app.register_blueprint(contractor_ai_bp, url_prefix='/api')

default_database_uri = f"sqlite:///{os.path.join(os.path.dirname(__file__), 'database', 'app.db')}"
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', default_database_uri)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
contractor_db.init_app(app)
with app.app_context():
    contractor_db.create_all()
    inspector = inspect(contractor_db.engine)
    if 'job' in inspector.get_table_names():
        columns = {column['name'] for column in inspector.get_columns('job')}
        migrations = {
            'actual_duration': 'ALTER TABLE job ADD COLUMN actual_duration FLOAT DEFAULT 0.0',
            'required_skills': 'ALTER TABLE job ADD COLUMN required_skills TEXT'
        }
        for column_name, statement in migrations.items():
            if column_name not in columns:
                contractor_db.session.execute(text(statement))
        contractor_db.session.commit()

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    dashboard_url = ledger_bridge.dashboard_url()
    if path in {'', 'index.html'} and dashboard_url:
        return redirect(dashboard_url)
    if path in {'', 'index.html'}:
        return jsonify({
            'error': {
                'code': 'ledger_not_configured',
                'message': 'Configure CONTRACTOR_LEDGER_API_URL before opening the Contractor.AI dashboard.',
                'authoritativeSource': 'node_operating_ledger'
            }
        }), 503
    return jsonify({'error': {'code': 'not_found', 'message': 'Static legacy dashboard assets are disabled.'}}), 404


if __name__ == '__main__':
    app.run(
        host=os.environ.get('HOST', '0.0.0.0'),
        port=int(os.environ.get('PORT', '5000')),
        debug=_debug_enabled()
    )
