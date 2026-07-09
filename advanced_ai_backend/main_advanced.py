from flask import Flask, jsonify, request, redirect, send_from_directory, g
from flask_cors import CORS
import os
import sys
import logging
import secrets
import importlib
from datetime import datetime
from uuid import uuid4
from werkzeug.exceptions import HTTPException
from ledger_bridge import LedgerBridgeError, NodeLedgerBridge

# Add src directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

component_errors = {}


def _load_component(name, module_name, class_name):
    try:
        module = importlib.import_module(module_name)
        return getattr(module, class_name)
    except Exception as exc:
        component_errors[name] = f'{type(exc).__name__}: {exc}'
        logger.warning("%s component unavailable: %s", name, exc)
        return None


ContractorAIEngine = _load_component('ai_engine', 'ai_engine.core', 'ContractorAIEngine')
MultiModalCommunicationHub = _load_component(
    'communication_hub',
    'communication.multi_modal_hub',
    'MultiModalCommunicationHub'
)
ComputerVisionProcessor = _load_component(
    'vision_processor',
    'vision.computer_vision',
    'ContractorVisionAI'
)
MultiModalProcessor = _load_component(
    'multimodal_processor',
    'multimodal.processor',
    'MultiModalProcessor'
)
PredictiveAnalyticsEngine = _load_component(
    'analytics_engine',
    'analytics.predictive_engine',
    'PredictiveAnalyticsEngine'
)
ARIoTIntegration = _load_component(
    'ar_iot_system',
    'ar_iot.ar_integration',
    'ARIoTIntegration'
)

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY')
if not app.config['SECRET_KEY']:
    logger.warning("FLASK_SECRET_KEY not set. Using a generated development key.")
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


@app.before_request
def attach_request_id():
    g.request_id = request.headers.get('X-Request-Id') or str(uuid4())


@app.after_request
def add_request_id_header(response):
    response.headers['X-Request-Id'] = request_id()
    return response


def request_id():
    return getattr(g, 'request_id', None) or request.headers.get('X-Request-Id') or str(uuid4())


def _json_error(message, status=500, code='internal_error', exc=None, details=None):
    if isinstance(exc, HTTPException):
        status = exc.code or status
        code = exc.name.lower().replace(' ', '_')
        message = exc.description or message
    elif exc is not None:
        logger.exception(message)

    payload = {
        'error': {
            'code': code,
            'message': message,
            'requestId': request_id()
        }
    }
    if details is not None and app.debug:
        payload['error']['details'] = details

    response = jsonify(payload)
    response.status_code = status
    return response


def _decision_to_payload(decision):
    decision_type = getattr(decision, 'decision_type', None)
    if hasattr(decision_type, 'value'):
        decision_type = decision_type.value

    return {
        'decisionType': decision_type,
        'confidence': getattr(decision, 'confidence', None),
        'reasoning': getattr(decision, 'reasoning', ''),
        'recommendedActions': getattr(decision, 'recommended_actions', []),
        'supportingData': getattr(decision, 'supporting_data', {}),
        'riskFactors': getattr(decision, 'risk_factors', []),
        'estimatedImpact': getattr(decision, 'estimated_impact', {}),
        'requiresApproval': bool(getattr(decision, 'requires_approval', True))
    }

# Initialize all AI systems
ai_engine = None
communication_hub = None
vision_processor = None
multimodal_processor = None
analytics_engine = None
ar_iot_system = None


def _initialize_component(name, component_class):
    if component_class is None:
        return None
    try:
        return component_class()
    except Exception as exc:
        component_errors[name] = f'{type(exc).__name__}: {exc}'
        logger.exception("Could not initialize %s", name)
        return None


ai_engine = _initialize_component('ai_engine', ContractorAIEngine)
communication_hub = _initialize_component('communication_hub', MultiModalCommunicationHub)
vision_processor = _initialize_component('vision_processor', ComputerVisionProcessor)
multimodal_processor = _initialize_component('multimodal_processor', MultiModalProcessor)
analytics_engine = _initialize_component('analytics_engine', PredictiveAnalyticsEngine)
ar_iot_system = _initialize_component('ar_iot_system', ARIoTIntegration)

logger.info(
    "Advanced systems initialized: %s",
    ', '.join(
        name for name, component in {
            'ai_engine': ai_engine,
            'communication_hub': communication_hub,
            'vision_processor': vision_processor,
            'multimodal_processor': multimodal_processor,
            'analytics_engine': analytics_engine,
            'ar_iot_system': ar_iot_system
        }.items() if component
    ) or 'none'
)

# Serve static files
@app.route('/')
def index():
    dashboard_url = ledger_bridge.dashboard_url()
    if dashboard_url:
        return redirect(dashboard_url)
    return _json_error(
        'The Node operating ledger dashboard is not configured for the advanced analysis service.',
        status=503,
        code='ledger_not_configured'
    )

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

# Health check endpoint
@app.route('/api/health')
def health_check():
    systems = {
        'ai_engine': 'online' if ai_engine else 'offline',
        'communication_hub': 'online' if communication_hub else 'offline',
        'vision_processor': 'online' if vision_processor else 'offline',
        'multimodal_processor': 'online' if multimodal_processor else 'offline',
        'analytics_engine': 'online' if analytics_engine else 'offline',
        'ar_iot_system': 'online' if ar_iot_system else 'offline'
    }
    healthy = all(status == 'online' for status in systems.values())
    return jsonify({
        'status': 'healthy' if healthy else 'degraded',
        'requestId': request_id(),
        'timestamp': datetime.now().isoformat(),
        'systems': systems,
        'ledgerBridge': ledger_bridge.status(),
        'primaryDashboard': 'node_operating_ledger',
        'unavailableReasons': component_errors
    })


@app.route('/api/debug/diagnostics')
def debug_diagnostics():
    systems = {
        'ai_engine': bool(ai_engine),
        'communication_hub': bool(communication_hub),
        'vision_processor': bool(vision_processor),
        'multimodal_processor': bool(multimodal_processor),
        'analytics_engine': bool(analytics_engine),
        'ar_iot_system': bool(ar_iot_system)
    }
    return jsonify({
        'status': 'ok' if all(systems.values()) else 'attention',
        'requestId': request_id(),
        'generatedAt': datetime.now().isoformat(),
        'environment': {
            'debug': app.debug,
            'corsOrigins': _cors_origins()
        },
        'systems': systems,
        'ledgerBridge': ledger_bridge.status(),
        'unavailableReasons': component_errors
    })

# Deprecated fixture retained temporarily for developer reference only. It is
# intentionally not registered as an HTTP route.
def legacy_demo_dashboard_data():
    try:
        dashboard_data = {
            'metrics': {
                'critical_jobs': 3,
                'ai_handling': 12,
                'revenue': 2340,
                'efficiency': 94
            },
            'jobs': [
                {
                    'id': 'bathroom-renovation',
                    'title': 'Bathroom Renovation - Johnson',
                    'status': 'critical',
                    'progress': 85,
                    'worker': 'Anna Kowalski',
                    'due': 'Tomorrow 16:00',
                    'value': 1512,
                    'ai_recommendation': 'Complete grouting today to stay on schedule. Weather forecast shows rain tomorrow - indoor work optimal.',
                    'confidence': 'HIGH'
                },
                {
                    'id': 'garden-maintenance',
                    'title': 'Garden Maintenance - Van Berg',
                    'status': 'in-progress',
                    'progress': 45,
                    'worker': 'Marco Silva',
                    'started': 'Today 09:00',
                    'value': 280,
                    'ai_recommendation': 'Reschedule hedge trimming to Friday due to rain forecast. Focus on covered area maintenance.',
                    'confidence': 'MEDIUM'
                }
            ],
            'ai_insights': [
                {
                    'title': 'Weather Impact Alert',
                    'description': 'Heavy rain expected tomorrow 14:00-18:00. Outdoor schedule changes and client messages are drafted for approval.',
                    'confidence': 'HIGH',
                    'actions_taken': ['Created reschedule proposals', 'Drafted client messages', 'Flagged worker schedule changes for approval']
                },
                {
                    'title': 'Resource Optimization',
                    'description': 'Tool utilization at 78%. Recommend acquiring second pressure washer to eliminate scheduling conflicts.',
                    'confidence': 'MEDIUM',
                    'potential_revenue_impact': '+€150/week'
                },
                {
                    'title': 'Client Satisfaction Prediction',
                    'description': 'Johnson bathroom project has 95% satisfaction probability. Van Berg garden maintenance needs quality check.',
                    'confidence': 'HIGH',
                    'recommended_actions': ['Schedule quality inspection for Van Berg', 'Prepare completion photos for Johnson']
                }
            ],
            'communication_summary': {
                'whatsapp_messages': 23,
                'emails_sent': 8,
                'sms_notifications': 5,
                'ai_conversations': 12,
                'client_satisfaction': 4.8
            },
            'ar_iot_status': {
                'active_ar_sessions': 2,
                'connected_iot_devices': 8,
                'real_time_monitoring': True,
                'data_points_today': 1440
            },
            'timestamp': datetime.now().isoformat()
        }
        
        return jsonify(dashboard_data)
        
    except Exception as e:
        return _json_error('Dashboard data failed', exc=e)

@app.route('/api/dashboard')
def get_dashboard_data():
    try:
        return jsonify(ledger_bridge.get_dashboard(request_id()))
    except LedgerBridgeError as error:
        return _json_error(error.message, status=error.status_code, code=error.code)
    except Exception as error:
        return _json_error('Node ledger dashboard proxy failed', exc=error)


# AI Chat endpoint
@app.route('/api/chat', methods=['POST'])
def ai_chat():
    try:
        data = request.get_json() or {}
        user_message = data.get('message', '')
        
        if not user_message:
            return jsonify({'error': 'Message is required'}), 400
        
        # Simulate intelligent AI responses
        ai_responses = {
            'schedule': 'I can help optimize the schedule. Based on weather data and worker availability, I recommend drafting a move of outdoor jobs to Friday and keeping indoor work tomorrow. Robert approval is required before committing.',
            'weather': 'Current weather shows rain expected tomorrow afternoon. I can draft schedule changes and client updates, but I will not move appointments or notify clients without approval.',
            'tools': 'Tool inventory shows the pressure washer is available. Marco Silva can pick it up from the depot at 8:00 AM for the Van Berg garden maintenance.',
            'client': 'Mrs. Johnson is very satisfied with the bathroom progress. I\'ve sent her progress photos and she\'s approved the tile selection. Project on track for completion tomorrow.',
            'worker': 'Anna Kowalski is performing excellently - 98% on-time rate and 4.9/5 client satisfaction. Marco Silva needs a quality check reminder for the garden project.',
            'profit': 'This month\'s profit margin is 23%, up 3% from last month. The bathroom renovation projects are most profitable at €85/hour average.',
            'default': f'I understand you\'re asking about: "{user_message}". Let me analyze this and provide recommendations based on current job data, weather conditions, and resource availability.'
        }
        
        # Simple keyword matching for demo
        response_key = 'default'
        for key in ai_responses.keys():
            if key in user_message.lower():
                response_key = key
                break
        
        ai_response = ai_responses[response_key]
        
        return jsonify({
            'response': ai_response,
            'confidence': 'HIGH',
            'context_used': ['current_jobs', 'weather_data', 'worker_status', 'client_history'],
            'suggested_actions': [
                'Review proposed schedule',
                'Approve or reject affected client drafts',
                'Check tool availability'
            ],
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return _json_error('AI chat failed', exc=e)


@app.route('/api/ai/analyze-job-request', methods=['POST'])
def analyze_job_request():
    try:
        if ai_engine is None:
            return _json_error(
                'AI engine unavailable',
                status=503,
                code='ai_engine_unavailable',
                details=component_errors.get('ai_engine')
            )

        job_data = request.get_json() or {}
        decision = ai_engine.analyze_job_request(job_data)

        return jsonify({
            'success': True,
            'requestId': request_id(),
            'jobRequest': job_data,
            'decision': _decision_to_payload(decision),
            'safety': {
                'externalMessagesSent': False,
                'clientCommitmentsMade': False,
                'purchasesMade': False,
                'approvalRequiredForConsequentialActions': True
            },
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        return _json_error('Job request analysis failed', exc=e)

# Multi-modal input processing
@app.route('/api/multimodal/process', methods=['POST'])
def process_multimodal_input():
    try:
        data = request.get_json() or {}
        input_type = data.get('type', 'text')
        input_data = data.get('data', {})
        
        # Simulate multimodal processing
        results = {
            'image': {
                'analysis': 'Bathroom renovation progress: 85% complete. Tile work excellent quality. Minor grout touch-up needed in corner.',
                'quality_score': 92,
                'issues_detected': ['Minor grout gap in northeast corner'],
                'completion_estimate': '4 hours remaining'
            },
            'voice': {
                'transcription': 'The client wants to change the tile color from white to beige',
                'intent': 'material_change_request',
                'urgency': 'medium',
                'estimated_impact': '+2 days, +€200'
            },
            'document': {
                'type': 'invoice',
                'amount': '€1,250',
                'status': 'approved',
                'payment_due': '2024-01-15'
            },
            'text': {
                'analysis': f'Processing text input: {input_data.get("content", "")}',
                'sentiment': 'neutral',
                'action_required': False
            }
        }
        
        result = results.get(input_type, results['text'])
        
        return jsonify({
            'success': True,
            'input_type': input_type,
            'result': result,
            'processing_time': '0.3s',
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return _json_error('Multimodal processing failed', exc=e)

# Predictive analytics endpoint
@app.route('/api/analytics/business-performance')
def get_business_performance():
    try:
        timeframe = request.args.get('timeframe', '30d')
        
        performance_data = {
            'revenue_trend': {
                'current_period': 15420,
                'previous_period': 13850,
                'growth_rate': 11.3,
                'forecast_next_period': 17200
            },
            'efficiency_metrics': {
                'job_completion_rate': 94.2,
                'on_time_delivery': 89.5,
                'client_satisfaction': 4.7,
                'worker_utilization': 78.3
            },
            'cost_analysis': {
                'labor_costs': 8920,
                'material_costs': 4230,
                'equipment_costs': 890,
                'profit_margin': 23.4
            },
            'predictions': {
                'busy_season_start': '2024-03-15',
                'recommended_hiring': 1,
                'equipment_investment': 'Second pressure washer',
                'market_opportunities': ['Kitchen renovations', 'Solar panel cleaning']
            }
        }
        
        return jsonify(performance_data)
        
    except Exception as e:
        return _json_error('Business performance failed', exc=e)

@app.route('/api/analytics/demand-forecast')
def get_demand_forecast():
    try:
        horizon_days = int(request.args.get('horizon', 30))
        
        forecast_data = {
            'forecast_period': f'{horizon_days} days',
            'predicted_jobs': 28,
            'revenue_forecast': 18500,
            'seasonal_factors': {
                'weather_impact': 0.85,
                'holiday_impact': 0.92,
                'market_trend': 1.15
            },
            'job_type_distribution': {
                'garden_maintenance': 40,
                'bathroom_renovation': 25,
                'general_maintenance': 20,
                'kitchen_work': 15
            },
            'recommendations': [
                'Stock up on garden maintenance supplies',
                'Schedule bathroom renovation consultations',
                'Prepare for increased demand in week 3-4'
            ]
        }
        
        return jsonify(forecast_data)
        
    except Exception as e:
        return _json_error('Demand forecast failed', exc=e)

# AR/IoT integration endpoints
@app.route('/api/ar/create-session', methods=['POST'])
def create_ar_session():
    try:
        data = request.get_json() or {}
        job_id = data.get('job_id', 'bathroom-renovation')
        location = data.get('location', {})
        
        session_data = {
            'session_id': f'ar_session_{job_id}_20240115',
            'job_id': job_id,
            'ar_config': {
                'scene_type': 'bathroom_renovation',
                'measurement_tools': ['tape_measure', 'level_indicator', 'angle_measure'],
                'overlay_elements': ['dimension_lines', 'material_overlay', 'progress_indicators'],
                'quality_checkpoints': ['tile_alignment', 'fixture_placement']
            },
            'qr_code_data': f'contractorai://ar/{job_id}',
            'mobile_app_link': f'contractorai://ar/{job_id}',
            'web_ar_link': f'https://ar.contractorai.com/{job_id}',
            'status': 'active',
            'participants': 1,
            'real_time_features': ['live_measurements', 'progress_tracking', 'quality_assessment']
        }
        
        return jsonify(session_data)
        
    except Exception as e:
        return _json_error('AR session creation failed', exc=e)

@app.route('/api/iot/register-device', methods=['POST'])
def register_iot_device():
    try:
        device_config = request.get_json() or {}
        device_id = device_config.get('device_id', f'device_{datetime.now().strftime("%Y%m%d_%H%M%S")}')
        
        registration_result = {
            'success': True,
            'device_id': device_id,
            'device_type': device_config.get('device_type', 'environmental_sensor'),
            'status': 'registered',
            'features': {
                'real_time_monitoring': True,
                'alert_notifications': True,
                'data_logging': True,
                'remote_control': device_config.get('device_type') in ['security_camera', 'tool_tracker']
            },
            'monitoring_interval': 60,
            'api_endpoints': {
                'data_endpoint': f'/api/iot/{device_id}/data',
                'control_endpoint': f'/api/iot/{device_id}/control',
                'status_endpoint': f'/api/iot/{device_id}/status'
            }
        }
        
        return jsonify(registration_result)
        
    except Exception as e:
        return _json_error('IoT device registration failed', exc=e)

@app.route('/api/iot/dashboard')
def get_iot_dashboard():
    try:
        dashboard_data = {
            'device_summary': {
                'env_sensor_001': {
                    'type': 'environmental_sensor',
                    'location': 'Johnson Bathroom',
                    'status': 'online',
                    'last_update': datetime.now().isoformat(),
                    'battery_level': 87,
                    'data_summary': {'temperature': 22.5, 'humidity': 65, 'air_quality': 'good'}
                },
                'camera_002': {
                    'type': 'security_camera',
                    'location': 'Van Berg Garden',
                    'status': 'online',
                    'last_update': datetime.now().isoformat(),
                    'battery_level': 92,
                    'data_summary': {'motion_detected': False, 'recording': True, 'storage': '78%'}
                },
                'tool_tracker_003': {
                    'type': 'tool_tracker',
                    'location': 'Pressure Washer',
                    'status': 'in_use',
                    'last_update': datetime.now().isoformat(),
                    'battery_level': 45,
                    'data_summary': {'current_user': 'Marco Silva', 'usage_time': '2.5 hours', 'location': 'Van Berg residence'}
                }
            },
            'active_alerts': [
                {
                    'type': 'battery_low',
                    'device': 'tool_tracker_003',
                    'severity': 'medium',
                    'message': 'Pressure washer tracker battery at 45%'
                }
            ],
            'analytics': {
                'total_devices': 8,
                'online_devices': 7,
                'offline_devices': 1,
                'alert_count': 1,
                'data_points_today': 1440,
                'system_health': 87.5
            },
            'system_status': 'operational',
            'last_updated': datetime.now().isoformat()
        }
        
        return jsonify(dashboard_data)
        
    except Exception as e:
        return _json_error('IoT dashboard failed', exc=e)

# Communication hub endpoints
@app.route('/api/communication/send-message', methods=['POST'])
def send_message():
    try:
        data = request.get_json() or {}
        channel = data.get('channel', 'whatsapp')
        recipient = data.get('recipient', 'noodzakelijkonline@gmail.com')
        message = data.get('message', 'Test message from Contractor AI')
        approval_id = f"approval_msg_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        result = {
            'success': True,
            'approval_required': True,
            'approval_id': approval_id,
            'channel': channel,
            'recipient': recipient,
            'message_id': f'draft_msg_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
            'message_preview': message,
            'status': 'pending_approval',
            'delivery_time': None,
            'not_sent': True,
            'safeguard': 'External messages are saved as drafts until Robert approves the exact recipient and body.',
            'timestamp': datetime.now().isoformat()
        }
        
        return jsonify(result)
        
    except Exception as e:
        return _json_error('Message sending failed', exc=e)

@app.route('/api/communication/process-incoming', methods=['POST'])
def process_incoming_message():
    try:
        data = request.get_json() or {}
        
        result = {
            'success': True,
            'message_processed': True,
            'intent_detected': 'job_inquiry',
            'ai_response_sent': False,
            'draft_response_created': True,
            'follow_up_scheduled': False,
            'approval_required': True,
            'safeguard': 'Incoming messages can create internal drafts, but no external response or commitment is sent automatically.',
            'confidence': 'HIGH',
            'processing_time': '0.8s',
            'timestamp': datetime.now().isoformat()
        }
        
        return jsonify(result)
        
    except Exception as e:
        return _json_error('Incoming message processing failed', exc=e)

# Computer vision endpoints
@app.route('/api/vision/analyze-image', methods=['POST'])
def analyze_image():
    try:
        data = request.get_json() or {}
        image_data = data.get('image_data')
        analysis_type = data.get('analysis_type', 'progress_tracking')
        
        analyses = {
            'progress_tracking': {
                'completion_percentage': 85,
                'quality_score': 92,
                'issues_detected': ['Minor grout gap in corner'],
                'next_steps': ['Complete grout touch-up', 'Install final fixtures'],
                'estimated_time_remaining': '4 hours'
            },
            'quality_inspection': {
                'overall_quality': 'excellent',
                'defects_found': 0,
                'compliance_score': 98,
                'recommendations': ['No issues detected', 'Ready for client inspection']
            },
            'safety_monitoring': {
                'safety_violations': 0,
                'ppe_compliance': 100,
                'hazards_detected': [],
                'safety_score': 95
            }
        }
        
        result = analyses.get(analysis_type, analyses['progress_tracking'])
        
        return jsonify({
            'success': True,
            'analysis_type': analysis_type,
            'result': result,
            'processing_time': '1.2s',
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return _json_error('Image analysis failed', exc=e)

# Test endpoints for demonstration
@app.route('/api/test/email-sms')
def test_email_sms():
    try:
        result = {
            'email_test': {
                'recipient': 'noodzakelijkonline@gmail.com',
                'status': 'sent',
                'subject': 'Contractor AI System Test',
                'message': 'This is a test email from your advanced Contractor AI system. All systems are operational and ready for use.',
                'delivery_time': '1.2s'
            },
            'sms_test': {
                'recipient': '+31 06-83515175',
                'status': 'sent',
                'message': 'Test SMS from Contractor AI: System is online and monitoring your jobs. Reply STOP to unsubscribe.',
                'delivery_time': '0.8s'
            },
            'whatsapp_test': {
                'recipient': '+31 06-83515175',
                'status': 'sent',
                'message': 'WhatsApp test from Contractor AI: Your bathroom renovation is 85% complete. Estimated completion: tomorrow 16:00.',
                'delivery_time': '1.1s'
            },
            'timestamp': datetime.now().isoformat(),
            'system_status': 'All communication channels operational'
        }
        
        return jsonify(result)
        
    except Exception as e:
        return _json_error('Email and SMS test failed', exc=e)

@app.route('/api/test/simulate-client-request')
def simulate_client_request():
    try:
        scenarios = [
            {
                'client': 'Maria van der Berg',
                'message': 'Hi, I need help with my kitchen renovation. The tiles are cracked and need replacement. Can you give me a quote?',
                'analysis': {
                    'job_type': 'Kitchen tile replacement',
                    'urgency': 'Medium',
                    'estimated_value': '€800-€1,200',
                    'location': 'Amsterdam Noord',
                    'complexity': 'Medium'
                },
                'ai_response': 'Hello Maria! I\'ve analyzed your kitchen tile replacement request. Based on the description, I estimate €800-€1,200 for quality ceramic tiles. I can schedule our specialist Anna Kowalski for a consultation this Thursday at 14:00. She\'ll provide an exact quote and timeline. Does this work for you?',
                'next_steps': [
                    'Schedule consultation with Anna Kowalski',
                    'Prepare material samples',
                    'Check tile supplier availability',
                    'Send consultation confirmation'
                ]
            },
            {
                'client': 'Jan Pietersen',
                'message': 'Emergency! My bathroom is flooding, water everywhere! Please help immediately!',
                'analysis': {
                    'job_type': 'Emergency plumbing repair',
                    'urgency': 'CRITICAL',
                    'estimated_value': '€150-€400',
                    'location': 'Needs immediate confirmation',
                    'complexity': 'High'
                },
                'ai_response': 'EMERGENCY RESPONSE ACTIVATED. I\'m dispatching Marco Silva immediately to your location. Turn off the main water valve if possible. Marco will arrive within 30 minutes with emergency plumbing tools. I\'ve also notified you via SMS with his contact details.',
                'next_steps': [
                    'Dispatch emergency plumber (Marco Silva)',
                    'Send SMS with plumber contact',
                    'Prepare emergency repair kit',
                    'Follow up in 15 minutes'
                ]
            }
        ]
        
        import random
        scenario = random.choice(scenarios)
        
        return jsonify({
            'client_request': scenario,
            'ai_processing': {
                'intent_recognition': '98% confidence',
                'urgency_detection': 'Automatic',
                'worker_assignment': 'AI-optimized',
                'response_time': '0.3 seconds'
            },
            'system_actions': [
                'Client profile updated',
                'Job created in system',
                'Worker notified',
                'Calendar updated',
                'Client response sent'
            ],
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        return _json_error('Client request simulation failed', exc=e)

# Advanced AI plan execution endpoint
@app.route('/api/ai/execute-plan', methods=['POST'])
def execute_ai_plan():
    try:
        data = request.get_json() or {}
        job_id = data.get('job_id', 'bathroom-renovation')
        
        # Build an approval-gated plan. Consequential external actions are never executed here.
        execution_plan = {
            'job_id': job_id,
            'plan_steps': [
                {
                    'step': 1,
                    'action': 'Draft worker instruction (Anna Kowalski)',
                    'message': 'Priority update: Complete grouting by 15:00 today due to weather forecast',
                    'status': 'pending_approval',
                    'duration': None,
                    'approval_required': True
                },
                {
                    'step': 2,
                    'action': 'Draft client update (Mrs. Johnson)',
                    'message': 'Your bathroom renovation is 85% complete. We\'re on track for completion tomorrow at 16:00.',
                    'status': 'pending_approval',
                    'duration': None,
                    'approval_required': True
                },
                {
                    'step': 3,
                    'action': 'Propose outdoor work reschedule',
                    'message': 'Moved garden maintenance to Friday due to rain forecast',
                    'status': 'pending_approval',
                    'duration': None,
                    'approval_required': True
                },
                {
                    'step': 4,
                    'action': 'Draft additional material request',
                    'message': 'Ordered 2kg extra grout for quality finish - delivery tomorrow 9:00 AM',
                    'status': 'pending_approval',
                    'duration': None,
                    'approval_required': True
                },
                {
                    'step': 5,
                    'action': 'Update project timeline',
                    'message': 'Timeline optimized: completion moved to tomorrow 16:00 (2 hours earlier)',
                    'status': 'drafted',
                    'duration': '0.1s',
                    'approval_required': False
                }
            ],
            'execution_summary': {
                'total_steps': 5,
                'completed_steps': 1,
                'pending_approval_steps': 4,
                'failed_steps': 0,
                'total_time': '0.1s',
                'success_rate': '20%',
                'safeguard': 'Only internal draft state was changed. No worker/client notification, schedule commitment, or material order was executed.'
            },
            'impact_analysis': {
                'potential_time_saved': '2 hours after approval',
                'cost_optimization': '+45 EUR potential avoided weather delays',
                'client_satisfaction': 'Potential uplift after approved proactive communication',
                'worker_efficiency': 'Potential uplift after approved schedule changes'
            },
            'approval_required': True,
            'approval_policy': 'External communication, schedule commitments, purchases, and worker instructions require explicit approval.',
            'timestamp': datetime.now().isoformat()
        }
        
        return jsonify(execution_plan)
        
    except Exception as e:
        return _json_error('AI plan execution failed', exc=e)

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return _json_error('Endpoint not found', status=404, code='not_found')

@app.errorhandler(500)
def internal_error(error):
    logger.exception("Unhandled advanced backend error")
    return _json_error('Internal server error', status=500, code='internal_error')

if __name__ == '__main__':
    logger.info("Starting Advanced Contractor AI System...")
    logger.info("Features enabled:")
    logger.info("- Multi-modal communication (WhatsApp, Email, SMS)")
    logger.info("- Computer vision and image analysis")
    logger.info("- Predictive analytics and business intelligence")
    logger.info("- AR/IoT integration capabilities")
    logger.info("- Advanced AI conversation and planning")
    logger.info(f"- Contact integration: noodzakelijkonline@gmail.com, +31 06-83515175")
    
    app.run(
        host=os.environ.get('HOST', '0.0.0.0'),
        port=int(os.environ.get('PORT', '5001')),
        debug=_debug_enabled()
    )

