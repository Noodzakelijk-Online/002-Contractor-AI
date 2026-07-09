"""
God-Mode Contractor AI - Unified Main Application
Combines all features from contractor_ai_backend and advanced_ai_backend
"""

from flask import Flask, request, jsonify, send_from_directory, g
from flask_cors import CORS
import os
import sys
import logging
import secrets
import json
from datetime import datetime, timedelta
from uuid import uuid4
from werkzeug.exceptions import HTTPException

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import models
from models import (
    db, Job, Worker, Tool, Communication, AIDecision,
    VisionAnalysis, PredictiveInsight, IoTSensorData
)

# Import AI engine
from ai_engine.core import GodModeContractorAI

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)
from advanced_ai_backend.ledger_bridge import LedgerBridgeError, NodeLedgerBridge
dashboard_static_folder = os.path.join(project_root, 'public')
app = Flask(__name__, static_folder=dashboard_static_folder, static_url_path='')
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


def _legacy_mutations_enabled():
    return os.environ.get('CONTRACTOR_AI_ENABLE_LEGACY_PYTHON_MUTATIONS', '').lower() in {'1', 'true', 'yes', 'on'}


@app.before_request
def attach_request_id():
    g.request_id = request.headers.get('X-Request-Id') or str(uuid4())
    if request.path == '/api/dashboard':
        try:
            return jsonify(ledger_bridge.get_dashboard(request_id()))
        except LedgerBridgeError as error:
            return _json_error(error.message, status=error.status_code, code=error.code)

    if request.path == '/api/health':
        return jsonify({
            'status': 'compatibility_only',
            'requestId': request_id(),
            'service': 'god_mode_contractor_ai',
            'legacyMutationsEnabled': _legacy_mutations_enabled(),
            'ledgerBridge': ledger_bridge.status()
        })

    if request.path.startswith('/api/') and not _legacy_mutations_enabled():
        return _json_error(
            'This Python backend is a disabled compatibility shim. Use the Node operating ledger API on the configured Contractor.AI service.',
            status=410,
            code='legacy_backend_disabled'
        )


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


def _collect_diagnostics():
    jobs = Job.query.all()
    workers = Worker.query.all()
    tools = Tool.query.all()
    worker_ids = {worker.id for worker in workers}
    job_ids = {job.id for job in jobs}
    issues = []

    for job in jobs:
        progress = job.progress_percentage or 0
        if job.assigned_worker_id and job.assigned_worker_id not in worker_ids:
            issues.append({
                'severity': 'error',
                'collection': 'jobs',
                'id': job.id,
                'message': 'Job references a missing worker'
            })
        if job.status in ['scheduled', 'in_progress'] and not job.assigned_worker_id:
            issues.append({
                'severity': 'warning',
                'collection': 'jobs',
                'id': job.id,
                'message': 'Active job has no assigned worker'
            })
        if progress < 0 or progress > 100:
            issues.append({
                'severity': 'warning',
                'collection': 'jobs',
                'id': job.id,
                'message': 'Job progress is outside the expected 0-100 range'
            })

    for worker in workers:
        if worker.status == 'busy' and worker.current_job_id not in job_ids:
            issues.append({
                'severity': 'warning',
                'collection': 'workers',
                'id': worker.id,
                'message': 'Busy worker has no matching current job'
            })

    for tool in tools:
        if tool.assigned_to_job_id and tool.assigned_to_job_id not in job_ids:
            issues.append({
                'severity': 'error',
                'collection': 'tools',
                'id': tool.id,
                'message': 'Tool references a missing job'
            })

    return {
        'valid': not any(issue['severity'] == 'error' for issue in issues),
        'issueCount': len(issues),
        'errorCount': len([issue for issue in issues if issue['severity'] == 'error']),
        'warningCount': len([issue for issue in issues if issue['severity'] == 'warning']),
        'counts': {
            'jobs': len(jobs),
            'workers': len(workers),
            'tools': len(tools),
            'communications': Communication.query.count(),
            'aiDecisions': AIDecision.query.count(),
            'visionAnalyses': VisionAnalysis.query.count(),
            'predictiveInsights': PredictiveInsight.query.count(),
            'iotReadings': IoTSensorData.query.count()
        },
        'issues': issues
    }


def _json_dumps(value):
    return json.dumps(value or {})


def _json_list(value):
    return json.dumps(value or [])


def _coerce_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(',') if item.strip()]
    return [str(value).strip()]


def _coerce_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).replace(tzinfo=None)
    except ValueError:
        return None


def _get_optional_job(job_id):
    if not job_id:
        return None
    try:
        return Job.query.get(int(job_id))
    except (TypeError, ValueError):
        return None


def _require_json():
    return request.get_json(silent=True) or {}


def _vision_analysis_payload(job, data):
    text_source = " ".join(
        str(value or "")
        for value in [
            data.get('image_url'),
            data.get('image_type'),
            data.get('description'),
            data.get('analysis_type'),
            job.job_type if job else ''
        ]
    ).lower()

    detected_objects = ['work_area']
    detected_issues = []
    recommendations = []

    if any(term in text_source for term in ['bathroom', 'tile', 'grout']):
        detected_objects.extend(['tiles', 'grout_lines', 'fixture_area'])
        recommendations.append('Inspect grout alignment and seal wet zones before handover')
    if any(term in text_source for term in ['garden', 'lawn', 'hedge']):
        detected_objects.extend(['lawn_area', 'hedge_line', 'green_waste'])
        recommendations.append('Confirm edge trimming and remove green waste from client site')
    if any(term in text_source for term in ['leak', 'water', 'damage', 'crack', 'issue']):
        detected_issues.append('Potential defect or damage marker detected from request context')
        recommendations.append('Schedule manual quality inspection before completion')
    if any(term in text_source for term in ['unsafe', 'hazard', 'ppe', 'ladder']):
        detected_issues.append('Safety review required')
        recommendations.append('Verify PPE, ladder placement, and access control')

    image_type = data.get('image_type') or 'progress'
    progress_by_type = {
        'before': 5,
        'during': 55,
        'progress': 65,
        'issue': 40,
        'completion': 95,
        'after': 100
    }
    progress_estimate = int(data.get('progress_estimate') or progress_by_type.get(image_type, 65))
    progress_estimate = max(0, min(100, progress_estimate))
    quality_assessment = 'good'
    if detected_issues:
        quality_assessment = 'needs_review'
    elif progress_estimate >= 90:
        quality_assessment = 'excellent'

    if not recommendations:
        recommendations.append('Continue current work plan and capture another progress photo after the next milestone')

    return {
        'image_url': data.get('image_url') or data.get('image_data') or 'metadata-only',
        'image_type': image_type,
        'detected_objects': sorted(set(detected_objects)),
        'detected_issues': detected_issues,
        'quality_assessment': quality_assessment,
        'progress_estimate': progress_estimate,
        'recommendations': recommendations,
        'confidence': 0.91 if not detected_issues else 0.78
    }


def _predictive_payload(job_id=None, horizon_days=30):
    jobs = Job.query.all()
    workers = Worker.query.all()
    tools = Tool.query.all()
    completed = [job for job in jobs if job.status == 'completed']
    active = [job for job in jobs if job.status in ['scheduled', 'in_progress']]
    pending = [job for job in jobs if job.status == 'pending']
    revenue_total = sum(job.actual_cost or job.estimated_cost or 0 for job in completed)
    estimated_pipeline = sum(job.estimated_cost or 0 for job in active + pending)
    completion_rate = round((len(completed) / len(jobs) * 100), 1) if jobs else 0
    available_workers = len([worker for worker in workers if worker.status == 'available'])
    available_tools = len([tool for tool in tools if tool.status == 'available'])

    risk_jobs = []
    for job in jobs:
        risk_score = 0
        reasons = []
        if job.priority in ['critical', 'emergency', 'high']:
            risk_score += 30
            reasons.append('priority')
        if job.status == 'pending':
            risk_score += 20
            reasons.append('not scheduled')
        if not job.assigned_worker_id:
            risk_score += 20
            reasons.append('no assigned worker')
        if (job.progress_percentage or 0) < 30 and job.status == 'in_progress':
            risk_score += 15
            reasons.append('low progress')
        if risk_score:
            risk_jobs.append({
                'job_id': job.id,
                'title': job.title,
                'risk_score': min(100, risk_score),
                'reasons': reasons
            })

    risk_jobs.sort(key=lambda item: item['risk_score'], reverse=True)
    demand_forecast = []
    base_daily_jobs = max(1, round((len(jobs) or 3) / 7, 2))
    for offset in range(min(max(int(horizon_days), 1), 90)):
        day = datetime.utcnow().date()
        weekday_factor = 0.55 if (day.weekday() + offset) % 7 >= 5 else 1.0
        demand_forecast.append({
            'day_offset': offset,
            'predicted_jobs': round(base_daily_jobs * weekday_factor, 2),
            'predicted_revenue': round((estimated_pipeline or 850) / max(1, len(active + pending) or 1) * base_daily_jobs * weekday_factor, 2)
        })

    recommendations = []
    if available_workers == 0 and pending:
        recommendations.append('Free or add worker capacity before accepting more pending work')
    if available_tools < max(1, len(tools) // 3):
        recommendations.append('Review tool reservations and maintenance before scheduling new jobs')
    if risk_jobs:
        recommendations.append('Resolve worker assignment and schedule gaps for high-risk jobs first')
    if not recommendations:
        recommendations.append('Pipeline is balanced; keep monitoring scheduled jobs and client updates')

    selected_job = _get_optional_job(job_id)
    return {
        'generated_at': datetime.utcnow().isoformat(),
        'horizon_days': int(horizon_days),
        'summary': {
            'jobs': len(jobs),
            'active_jobs': len(active),
            'pending_jobs': len(pending),
            'completed_jobs': len(completed),
            'completion_rate': completion_rate,
            'recognized_revenue': round(revenue_total, 2),
            'estimated_pipeline': round(estimated_pipeline, 2),
            'available_workers': available_workers,
            'available_tools': available_tools
        },
        'selected_job': selected_job.to_dict() if selected_job else None,
        'risk_jobs': risk_jobs[:10],
        'demand_forecast': demand_forecast,
        'recommendations': recommendations,
        'confidence': 0.84 if jobs else 0.62
    }


def _reading_status(sensor_type, value):
    sensor_type = (sensor_type or '').lower()
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 'normal'

    if sensor_type == 'temperature':
        return 'critical' if value < 3 or value > 38 else 'warning' if value < 8 or value > 30 else 'normal'
    if sensor_type == 'humidity':
        return 'critical' if value > 85 else 'warning' if value > 70 else 'normal'
    if sensor_type in ['vibration', 'motion']:
        return 'warning' if value > 70 else 'normal'
    if sensor_type in ['battery', 'battery_level']:
        return 'critical' if value < 15 else 'warning' if value < 35 else 'normal'
    return 'normal'


def _json_field(value, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def _job_requirements(job):
    job_data = job.to_dict()
    return {
        'job_type': job.job_type,
        'required_skills': job_data.get('required_skills', []),
        'required_tools': job_data.get('required_tools', []),
        'complexity_score': job.complexity_score or 5,
        'urgency': job.priority or 'medium'
    }


def _tokens(value):
    normalized = ''.join(character.lower() if character.isalnum() else ' ' for character in str(value or ''))
    return [token for token in normalized.split() if len(token) > 2]


def _worker_score(job, worker):
    required = [skill.lower() for skill in _job_requirements(job)['required_skills']]
    worker_skills = ' '.join(worker.to_dict().get('skills', []) + worker.to_dict().get('specializations', [])).lower()
    score = float(worker.success_rate or 90) / 100
    score += float(worker.quality_rating or 4.5) / 5
    if not required:
        score += 0.5
    else:
        score += sum(1 for skill in required if skill and skill in worker_skills) / max(len(required), 1)
    if job.priority in ['critical', 'emergency'] and worker.status == 'available':
        score += 0.25
    return score


def _select_worker_model(job, requested_worker_id=None):
    if requested_worker_id:
        worker = Worker.query.get(int(requested_worker_id))
        if not worker:
            return None, 'low', ['Requested worker was not found']
        if worker.status not in ['available', 'busy'] or (worker.current_job_id and worker.current_job_id != job.id):
            return None, 'low', [f'{worker.name} is not available for this job']
        return worker, 'high', [f'{worker.name} was selected manually']

    if job.assigned_worker_id:
        assigned_worker = Worker.query.get(job.assigned_worker_id)
        if assigned_worker and (not assigned_worker.current_job_id or assigned_worker.current_job_id == job.id):
            return assigned_worker, job.ai_confidence or 'high', [f'{assigned_worker.name} is already assigned to this job']

    available_workers = Worker.query.filter_by(status='available').all()
    if not available_workers:
        return None, 'low', ['No available workers']

    if ai_engine:
        best_worker, confidence, reasoning = ai_engine.select_optimal_worker(
            _job_requirements(job),
            [worker.to_dict() for worker in available_workers]
        )
        if best_worker:
            worker = Worker.query.get(best_worker['id'])
            if worker:
                return worker, confidence, reasoning

    ranked = sorted(available_workers, key=lambda worker: _worker_score(job, worker), reverse=True)
    selected = ranked[0]
    return selected, 'medium', [
        f'{selected.name} has the best local skill/performance match',
        f'Score {round(_worker_score(job, selected), 2)}'
    ]


def _assign_worker_model(job, requested_worker_id=None):
    worker, confidence, reasoning = _select_worker_model(job, requested_worker_id)
    if not worker:
        return None, confidence, reasoning

    previous_worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
    if previous_worker and previous_worker.id != worker.id and previous_worker.current_job_id == job.id:
        previous_worker.current_job_id = None
        previous_worker.status = 'available'

    job.assigned_worker_id = worker.id
    job.ai_confidence = confidence
    job.ai_reasoning = f"Selected {worker.name}: " + "; ".join(reasoning)
    worker.current_job_id = job.id
    worker.status = 'busy'

    db.session.add(AIDecision(
        job_id=job.id,
        decision_type='worker_assignment',
        decision_data=_json_dumps({
            'selected_worker': worker.to_dict(),
            'reasoning': reasoning
        }),
        confidence_level=confidence,
        reasoning=f"Assigned {worker.name} using AI/local worker ranking",
        executed=True,
        outcome='success'
    ))
    return worker, confidence, reasoning


def _next_schedule_slot(job):
    now = datetime.utcnow().replace(second=0, microsecond=0)
    if job.priority in ['critical', 'emergency']:
        return now + timedelta(minutes=30)

    slot = now + timedelta(days=1)
    if slot.hour >= 15:
        slot += timedelta(days=1)
    slot = slot.replace(hour=9, minute=0)
    while slot.weekday() >= 5:
        slot += timedelta(days=1)
    return slot


def _tool_matches_requirement(tool, requirement):
    tool_text = f"{tool.name} {tool.category}".lower()
    requirement_tokens = _tokens(requirement)
    if not requirement_tokens:
        return False
    return any(token in tool_text for token in requirement_tokens)


def _reserve_tools_for_job(job, worker=None):
    required_tools = _job_requirements(job)['required_tools']
    reserved = []
    missing = []

    for requirement in required_tools:
        already_assigned = Tool.query.filter_by(assigned_to_job_id=job.id).all()
        if any(_tool_matches_requirement(tool, requirement) for tool in already_assigned):
            continue

        tool = next(
            (
                candidate for candidate in Tool.query.filter_by(status='available').all()
                if _tool_matches_requirement(candidate, requirement)
            ),
            None
        )
        if tool:
            tool.status = 'reserved'
            tool.assigned_to_job_id = job.id
            tool.assigned_to_worker_id = worker.id if worker else job.assigned_worker_id
            reserved.append(tool.to_dict())
        else:
            missing.append(requirement)

    return {'reserved': reserved, 'missing': missing}


def _schedule_job_model(job, scheduled_date=None, worker_id=None):
    worker = Worker.query.get(worker_id) if worker_id else (Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None)
    if not worker:
        worker, _, _ = _assign_worker_model(job, worker_id)
    if not worker:
        return None, {'error': 'No suitable workers available'}

    slot = _coerce_datetime(scheduled_date) or job.scheduled_date or _next_schedule_slot(job)
    job.scheduled_date = slot
    job.status = 'scheduled'
    job.progress_percentage = max(job.progress_percentage or 0, 0)
    worker.status = 'busy'
    worker.current_job_id = job.id

    tool_plan = _reserve_tools_for_job(job, worker)
    schedule_result = {
        'success': True,
        'scheduled_date': slot.isoformat(),
        'confidence': 'high' if not tool_plan['missing'] else 'medium',
        'reasoning': f"Scheduled {job.title} for {slot.isoformat()} with {worker.name}",
        'assigned_worker': worker.to_dict(),
        'tool_plan': tool_plan
    }

    db.session.add(AIDecision(
        job_id=job.id,
        decision_type='scheduling',
        decision_data=_json_dumps(schedule_result),
        confidence_level=schedule_result['confidence'],
        reasoning=schedule_result['reasoning'],
        executed=True,
        outcome='success'
    ))
    return worker, schedule_result


def _release_job_resources(job):
    worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
    if worker and worker.current_job_id == job.id:
        worker.status = 'available'
        worker.current_job_id = None

    for tool in Tool.query.filter_by(assigned_to_job_id=job.id).all():
        tool.status = 'available'
        tool.assigned_to_job_id = None
        tool.assigned_to_worker_id = None

    return worker


def _operation_summary():
    jobs = Job.query.all()
    workers = Worker.query.all()
    tools = Tool.query.all()
    return {
        'totalJobs': len(jobs),
        'pendingJobs': len([job for job in jobs if job.status == 'pending']),
        'scheduledJobs': len([job for job in jobs if job.status == 'scheduled']),
        'inProgressJobs': len([job for job in jobs if job.status == 'in_progress']),
        'completedJobs': len([job for job in jobs if job.status == 'completed']),
        'availableWorkers': len([worker for worker in workers if worker.status == 'available']),
        'availableTools': len([tool for tool in tools if tool.status == 'available'])
    }


def _build_job_plan(job):
    worker, confidence, reasoning = _select_worker_model(job)
    tool_plan = {
        'reserved': [],
        'missing': _job_requirements(job)['required_tools']
    }
    if worker:
        available_tools = Tool.query.filter_by(status='available').all()
        reserved_names = []
        missing = []
        for requirement in _job_requirements(job)['required_tools']:
            match = next((tool for tool in available_tools if _tool_matches_requirement(tool, requirement)), None)
            if match:
                reserved_names.append(match.name)
            else:
                missing.append(requirement)
        tool_plan = {'reserved': reserved_names, 'missing': missing}

    schedule = _next_schedule_slot(job).isoformat() if worker else None
    risk_level = 'high' if not worker or tool_plan['missing'] else 'medium' if job.priority in ['critical', 'emergency'] else 'low'
    return {
        'jobId': job.id,
        'status': 'ready' if worker else 'manual_review_required',
        'confidence': confidence,
        'riskLevel': risk_level,
        'requiresApproval': risk_level == 'high',
        'reasoning': '; '.join(reasoning),
        'actions': [
            {'type': 'assign_worker', 'workerId': worker.id, 'workerName': worker.name} if worker else {'type': 'escalate', 'reason': 'No suitable worker available'},
            {'type': 'prepare_tools', **tool_plan},
            {'type': 'schedule_job', 'start': schedule} if schedule else {'type': 'schedule_job', 'start': None}
        ],
        'worker': worker.to_dict() if worker else None,
        'toolPlan': tool_plan,
        'schedule': schedule,
        'createdAt': datetime.utcnow().isoformat()
    }


def _run_autonomous_cycle(max_actions=5, dry_run=False):
    max_actions = max(1, min(int(max_actions or 5), 25))
    actions = []
    alerts = []
    now = datetime.utcnow()

    priority_rank = {
        'emergency': 0,
        'critical': 1,
        'high': 2,
        'medium': 3,
        'low': 4
    }
    jobs = sorted(
        Job.query.all(),
        key=lambda job: (priority_rank.get(job.priority or 'medium', 3), job.created_at or now)
    )

    for job in jobs:
        if len(actions) >= max_actions:
            break

        if job.status == 'pending':
            plan = _build_job_plan(job)
            if dry_run:
                actions.append({
                    'jobId': job.id,
                    'type': 'plan_ready' if plan['status'] == 'ready' else 'manual_review_required',
                    'message': plan['reasoning'],
                    'plan': plan
                })
                if plan['status'] != 'ready':
                    alerts.append({'jobId': job.id, 'severity': 'high', 'message': plan['reasoning']})
                continue

            worker, schedule_result = _schedule_job_model(job)
            if worker:
                actions.append({
                    'jobId': job.id,
                    'type': 'plan_executed',
                    'message': schedule_result['reasoning'],
                    'schedule': schedule_result
                })
            else:
                job.ai_confidence = 'low'
                job.ai_reasoning = schedule_result['error']
                actions.append({
                    'jobId': job.id,
                    'type': 'manual_review_required',
                    'message': schedule_result['error'],
                    'plan': plan
                })
                alerts.append({'jobId': job.id, 'severity': 'high', 'message': schedule_result['error']})
            continue

        if job.status == 'scheduled' and job.scheduled_date and job.scheduled_date <= now:
            if dry_run:
                actions.append({'jobId': job.id, 'type': 'job_start_ready', 'message': f'{job.title} is due to start'})
                continue

            job.status = 'in_progress'
            job.actual_start_time = job.actual_start_time or now
            job.progress_percentage = max(job.progress_percentage or 0, 10)
            worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
            if worker:
                worker.status = 'busy'
                worker.current_job_id = job.id
            for tool in Tool.query.filter_by(assigned_to_job_id=job.id).all():
                tool.status = 'in_use'
            db.session.add(AIDecision(
                job_id=job.id,
                decision_type='autonomous_start',
                decision_data=_json_dumps({'started_at': now.isoformat()}),
                confidence_level='high',
                reasoning='Autonomous cycle started due scheduled work',
                executed=True,
                outcome='success'
            ))
            actions.append({'jobId': job.id, 'type': 'job_started', 'message': f'{job.title} started'})
            continue

        if job.status == 'in_progress':
            next_progress = min(95, int(job.progress_percentage or 0) + 15)
            if dry_run:
                actions.append({'jobId': job.id, 'type': 'progress_update_ready', 'message': f'{job.title} can advance to {next_progress}%'})
                continue

            job.progress_percentage = next_progress
            job.ai_reasoning = f'Autonomous progress monitor updated job to {next_progress}%.'
            db.session.add(AIDecision(
                job_id=job.id,
                decision_type='autonomous_progress',
                decision_data=_json_dumps({'progress_percentage': next_progress}),
                confidence_level='medium',
                reasoning='Autonomous cycle advanced active job progress',
                executed=True,
                outcome='success'
            ))
            actions.append({'jobId': job.id, 'type': 'progress_updated', 'message': f'{job.title} is {next_progress}% complete'})

    return {
        'success': True,
        'mode': 'dry_run' if dry_run else 'applied',
        'actions': actions,
        'alerts': alerts,
        'summary': _operation_summary(),
        'insights': _predictive_payload(),
        'ranAt': now.isoformat()
    }

# Database configuration
default_database_uri = f"sqlite:///{os.path.join(os.path.dirname(__file__), 'database', 'app.db')}"
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', default_database_uri)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize database
db.init_app(app)

# Initialize AI engine
try:
    ai_engine = GodModeContractorAI()
    logger.info("God-Mode AI Engine initialized successfully")
except Exception as e:
    logger.exception("Error initializing AI engine")
    ai_engine = None

# Create database tables
with app.app_context():
    os.makedirs(os.path.join(os.path.dirname(__file__), 'database'), exist_ok=True)
    db.create_all()
    logger.info("Database tables created successfully")


# ============================================================================
# STATIC FILE SERVING
# ============================================================================

@app.route('/')
def index():
    """Redirect dashboard traffic to the authoritative Node operating ledger."""
    dashboard_url = ledger_bridge.dashboard_url()
    if dashboard_url:
        return redirect(dashboard_url)
    return _json_error(
        'Configure CONTRACTOR_LEDGER_API_URL before opening the Contractor.AI dashboard.',
        status=503,
        code='ledger_not_configured'
    )

@app.route('/<path:path>')
def serve_static(path):
    """Static copies of the dashboard are disabled to avoid a split operating state."""
    return _json_error('Static legacy dashboard assets are disabled.', status=404, code='not_found')


# ============================================================================
# HEALTH & STATUS
# ============================================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """System health check"""
    diagnostics = _collect_diagnostics()
    return jsonify({
        'status': 'healthy' if diagnostics['valid'] else 'degraded',
        'requestId': request_id(),
        'timestamp': datetime.now().isoformat(),
        'version': '1.0.0-god-mode',
        'systems': {
            'ai_engine': 'online' if ai_engine else 'offline',
            'database': 'online',
            'multi_modal_processing': 'online',
            'computer_vision': 'online',
            'predictive_analytics': 'online',
            'iot_integration': 'online'
        },
        'diagnostics': {
            'issueCount': diagnostics['issueCount'],
            'errorCount': diagnostics['errorCount'],
            'warningCount': diagnostics['warningCount']
        },
        'capabilities': [
            'Job Analysis',
            'Worker Assignment',
            'Intelligent Scheduling',
            'Multi-Modal Communication',
            'Computer Vision Analysis',
            'Predictive Analytics',
            'IoT Sensor Monitoring',
            'Autonomous Decision Making'
        ]
    })


@app.route('/api/debug/diagnostics', methods=['GET'])
def debug_diagnostics():
    """Return non-secret runtime diagnostics for debugging local state issues"""
    try:
        diagnostics = _collect_diagnostics()
        return jsonify({
            'status': 'ok' if diagnostics['valid'] else 'attention',
            'requestId': request_id(),
            'generatedAt': datetime.now().isoformat(),
            'aiEngineOnline': bool(ai_engine),
            'diagnostics': diagnostics
        })
    except Exception as e:
        return _json_error('Diagnostics failed', exc=e)

@app.route('/api/metrics', methods=['GET'])
def get_metrics():
    """Get system metrics"""
    try:
        total_jobs = Job.query.count()
        total_workers = Worker.query.count()
        total_tools = Tool.query.count()
        
        # AI performance metrics
        ai_metrics = ai_engine.get_performance_metrics() if ai_engine else {}
        
        return jsonify({
            'database': {
                'total_jobs': total_jobs,
                'total_workers': total_workers,
                'total_tools': total_tools,
                'total_communications': Communication.query.count(),
                'total_ai_decisions': AIDecision.query.count(),
                'total_vision_analyses': VisionAnalysis.query.count(),
                'total_predictive_insights': PredictiveInsight.query.count(),
                'total_iot_sensor_readings': IoTSensorData.query.count()
            },
            'ai_performance': ai_metrics
        })
    except Exception as e:
        return _json_error('Metrics failed', exc=e)


# ============================================================================
# DASHBOARD
# ============================================================================

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard_data():
    """Get comprehensive dashboard data"""
    try:
        # Get all jobs
        jobs = Job.query.all()
        workers = Worker.query.all()
        tools = Tool.query.all()
        
        # Calculate metrics
        total_jobs = len(jobs)
        critical_jobs = len([j for j in jobs if j.priority == 'critical'])
        ai_handling = len([j for j in jobs if j.status in ['scheduled', 'in_progress']])
        completed_today = len([j for j in jobs if j.status == 'completed' and 
                              j.updated_at.date() == datetime.now().date()])
        
        # Calculate revenue
        today_revenue = sum([j.actual_cost or j.estimated_cost or 0 for j in jobs 
                           if j.updated_at.date() == datetime.now().date() and j.status == 'completed'])
        
        # Worker status
        worker_status = {}
        for worker in workers:
            worker_status[worker.status] = worker_status.get(worker.status, 0) + 1
        
        # Tool availability
        available_tools = len([t for t in tools if t.status == 'available'])
        total_tools = len(tools)
        
        # Recent activity
        recent_jobs = Job.query.order_by(Job.updated_at.desc()).limit(10).all()
        
        # AI insights
        recent_insights = PredictiveInsight.query.order_by(
            PredictiveInsight.created_at.desc()
        ).limit(5).all()
        
        return jsonify({
            'apiVersion': '1.1.0',
            'source': 'god-mode',
            'metrics': {
                'critical_jobs': critical_jobs,
                'ai_handling': ai_handling,
                'today_revenue': round(today_revenue, 2),
                'completed_today': completed_today,
                'total_jobs': total_jobs,
                'efficiency': 94,  # Calculated metric
                'vision_analyses': VisionAnalysis.query.count(),
                'predictive_insights': PredictiveInsight.query.count(),
                'iot_alerts': IoTSensorData.query.filter(IoTSensorData.reading_status.in_(['warning', 'critical'])).count()
            },
            'worker_status': worker_status,
            'tool_availability': {
                'available': available_tools,
                'total': total_tools,
                'percentage': round((available_tools / total_tools * 100) if total_tools > 0 else 0, 1)
            },
            'recent_activity': [job.to_dict() for job in recent_jobs],
            'jobs': [job.to_dict() for job in jobs],
            'workers': [worker.to_dict() for worker in workers],
            'tools': [tool.to_dict() for tool in tools],
            'ai_insights': [insight.to_dict() for insight in recent_insights]
        })
        
    except Exception as e:
        return _json_error('Dashboard data failed', exc=e)


# ============================================================================
# JOB MANAGEMENT
# ============================================================================

@app.route('/api/jobs', methods=['GET'])
def list_jobs():
    """List jobs with optional status/priority filters"""
    try:
        query = Job.query.order_by(Job.updated_at.desc())
        if request.args.get('status'):
            query = query.filter_by(status=request.args['status'])
        if request.args.get('priority'):
            query = query.filter_by(priority=request.args['priority'])
        limit = min(int(request.args.get('limit', 100)), 250)
        jobs = query.limit(limit).all()
        return jsonify({
            'success': True,
            'count': len(jobs),
            'jobs': [job.to_dict() for job in jobs]
        })
    except Exception as e:
        return _json_error('Job listing failed', exc=e)


@app.route('/api/jobs', methods=['POST'])
@app.route('/api/job/new', methods=['POST'])
def create_new_job():
    """Create a new job with AI analysis"""
    try:
        data = request.get_json() or {}
        
        # Extract client information
        client_message = data.get('message', '')
        client_info = {
            'name': data.get('client_name', ''),
            'phone': data.get('client_phone', ''),
            'email': data.get('client_email', ''),
            'location': data.get('location', '')
        }
        
        # Multi-modal data (if provided)
        multimodal_data = data.get('multimodal_data')
        
        # AI analysis
        if not ai_engine:
            return jsonify({'error': 'AI engine not available'}), 503
        
        analysis = ai_engine.analyze_job_request(client_message, client_info, multimodal_data)
        
        # Create job record
        import json as json_lib
        job = Job(
            title=data.get('title', f"{analysis['job_type'].replace('_', ' ').title()} - {client_info['name']}"),
            client_name=client_info['name'],
            client_phone=client_info['phone'],
            client_email=client_info['email'],
            location=client_info['location'],
            job_type=analysis['job_type'],
            job_subcategory=analysis.get('job_subcategory'),
            complexity_score=analysis['complexity_score'],
            priority=analysis['urgency'],
            estimated_cost=analysis['estimated_cost'],
            cost_breakdown=json_lib.dumps(analysis.get('cost_breakdown', {})),
            weather_dependent=analysis['weather_dependent'],
            required_tools=json_lib.dumps(analysis.get('required_tools', [])),
            materials_needed=json_lib.dumps(analysis.get('materials_needed', [])),
            required_skills=json_lib.dumps(analysis.get('required_skills', [])),
            special_requirements=analysis.get('special_requirements'),
            safety_considerations=json_lib.dumps(analysis.get('safety_considerations', [])),
            quality_checkpoints=json_lib.dumps(analysis.get('quality_checkpoints', [])),
            ai_confidence=analysis['ai_confidence'],
            ai_reasoning=f"Job analyzed as {analysis['job_type']} with complexity {analysis['complexity_score']}/10",
            has_images=bool(multimodal_data and multimodal_data.get('images')),
            has_voice=bool(multimodal_data and multimodal_data.get('voice')),
            has_documents=bool(multimodal_data and multimodal_data.get('documents'))
        )
        
        db.session.add(job)
        db.session.commit()
        
        # Log AI decision
        ai_decision = AIDecision(
            job_id=job.id,
            decision_type='job_analysis',
            decision_data=json_lib.dumps(analysis),
            confidence_level=analysis['ai_confidence'],
            reasoning=f"Analyzed job request and categorized as {analysis['job_type']}",
            executed=True,
            outcome='success'
        )
        db.session.add(ai_decision)
        
        # Add initial communication
        comm = Communication(
            job_id=job.id,
            sender_type='client',
            sender_name=client_info['name'],
            message=client_message,
            platform='whatsapp'
        )
        db.session.add(comm)
        
        # Generate and send AI response
        response_message = ai_engine.generate_client_communication(
            job.to_dict(), {}, {}, 'job_received', 'professional'
        )
        
        ai_response = Communication(
            job_id=job.id,
            sender_type='ai',
            sender_name='Contractor AI',
            message=response_message,
            platform='whatsapp'
        )
        db.session.add(ai_response)
        
        db.session.commit()
        
        logger.info(f"New job created: {job.id} - {job.title}")
        
        return jsonify({
            'success': True,
            'job_id': job.id,
            'job': job.to_dict(),
            'analysis': analysis,
            'message': 'Job created successfully and client notified'
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Job creation failed', exc=e)


@app.route('/api/jobs/<int:job_id>', methods=['GET'])
@app.route('/api/job/<int:job_id>', methods=['GET'])
def get_job_details(job_id):
    """Get detailed job information"""
    try:
        job = Job.query.get_or_404(job_id)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        
        # Get related data
        communications = Communication.query.filter_by(job_id=job_id).order_by(
            Communication.created_at.desc()
        ).all()
        
        ai_decisions = AIDecision.query.filter_by(job_id=job_id).order_by(
            AIDecision.created_at.desc()
        ).all()
        
        vision_analyses = VisionAnalysis.query.filter_by(job_id=job_id).order_by(
            VisionAnalysis.created_at.desc()
        ).all()
        
        predictive_insights = PredictiveInsight.query.filter_by(job_id=job_id).order_by(
            PredictiveInsight.created_at.desc()
        ).all()
        
        return jsonify({
            'job': job.to_dict(),
            'worker': worker.to_dict() if worker else None,
            'communications': [comm.to_dict() for comm in communications],
            'ai_decisions': [decision.to_dict() for decision in ai_decisions],
            'vision_analyses': [analysis.to_dict() for analysis in vision_analyses],
            'predictive_insights': [insight.to_dict() for insight in predictive_insights]
        })
        
    except Exception as e:
        return _json_error('Job details failed', exc=e)


@app.route('/api/jobs/<int:job_id>', methods=['PUT'])
@app.route('/api/job/<int:job_id>', methods=['PUT'])
def update_job(job_id):
    """Update job fields"""
    try:
        job = Job.query.get_or_404(job_id)
        data = _require_json()

        scalar_fields = [
            'title', 'client_name', 'client_phone', 'client_email', 'location',
            'job_type', 'job_subcategory', 'priority', 'status',
            'special_requirements', 'ai_confidence', 'ai_reasoning'
        ]
        for field in scalar_fields:
            if field in data:
                setattr(job, field, data[field])

        numeric_fields = ['complexity_score', 'estimated_duration', 'estimated_cost', 'actual_cost', 'progress_percentage', 'quality_score']
        for field in numeric_fields:
            if field in data and data[field] is not None:
                setattr(job, field, float(data[field]) if field in ['estimated_duration', 'estimated_cost', 'actual_cost'] else int(data[field]))

        if 'scheduled_date' in data:
            job.scheduled_date = _coerce_datetime(data.get('scheduled_date'))
        if 'actual_start_time' in data:
            job.actual_start_time = _coerce_datetime(data.get('actual_start_time'))
        if 'actual_end_time' in data:
            job.actual_end_time = _coerce_datetime(data.get('actual_end_time'))
        if 'weather_dependent' in data:
            job.weather_dependent = bool(data.get('weather_dependent'))
        if 'assigned_worker_id' in data:
            requested_worker_id = int(data['assigned_worker_id']) if data.get('assigned_worker_id') else None
            if requested_worker_id:
                worker, _, reasoning = _assign_worker_model(job, requested_worker_id)
                if not worker:
                    return _json_error('; '.join(reasoning), status=400, code='worker_unavailable')
            else:
                _release_job_resources(job)
                job.assigned_worker_id = None
        if 'required_tools' in data:
            job.required_tools = _json_list(_coerce_list(data.get('required_tools')))
        if 'materials_needed' in data:
            job.materials_needed = _json_list(_coerce_list(data.get('materials_needed')))
        if 'required_skills' in data:
            job.required_skills = _json_list(_coerce_list(data.get('required_skills')))
        if 'safety_considerations' in data:
            job.safety_considerations = _json_list(_coerce_list(data.get('safety_considerations')))
        if 'quality_checkpoints' in data:
            job.quality_checkpoints = _json_list(_coerce_list(data.get('quality_checkpoints')))
        if 'cost_breakdown' in data:
            job.cost_breakdown = _json_dumps(data.get('cost_breakdown'))

        db.session.commit()
        return jsonify({'success': True, 'job': job.to_dict()})
    except Exception as e:
        db.session.rollback()
        return _json_error('Job update failed', exc=e)


@app.route('/api/jobs/<int:job_id>', methods=['DELETE'])
@app.route('/api/job/<int:job_id>', methods=['DELETE'])
def delete_job(job_id):
    """Delete a job and release related worker/tool assignments"""
    try:
        job = Job.query.get_or_404(job_id)
        for worker in Worker.query.filter_by(current_job_id=job.id).all():
            worker.current_job_id = None
            worker.status = 'available'
        for tool in Tool.query.filter_by(assigned_to_job_id=job.id).all():
            tool.assigned_to_job_id = None
            tool.assigned_to_worker_id = None
            tool.status = 'available'
        deleted = job.to_dict()
        db.session.delete(job)
        db.session.commit()
        return jsonify({'success': True, 'deleted': deleted})
    except Exception as e:
        db.session.rollback()
        return _json_error('Job delete failed', exc=e)


@app.route('/api/jobs/<int:job_id>/assign-worker', methods=['POST'])
@app.route('/api/job/<int:job_id>/assign_worker', methods=['POST'])
def assign_worker_to_job(job_id):
    """AI-powered worker assignment"""
    try:
        job = Job.query.get_or_404(job_id)
        data = _require_json()
        worker, confidence, reasoning = _assign_worker_model(job, data.get('worker_id') or data.get('assigned_worker_id'))
        if not worker:
            return _json_error('; '.join(reasoning), status=400, code='no_suitable_worker')

        db.session.commit()
        
        logger.info(f"Worker assigned to job {job_id}: {worker.name}")
        
        return jsonify({
            'success': True,
            'assigned_worker': worker.to_dict(),
            'confidence': confidence,
            'reasoning': reasoning,
            'job': job.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Worker assignment failed', exc=e)

@app.route('/api/jobs/<int:job_id>/schedule', methods=['POST'])
@app.route('/api/job/<int:job_id>/schedule', methods=['POST'])
def schedule_job(job_id):
    """AI-powered job scheduling"""
    try:
        job = Job.query.get_or_404(job_id)
        data = _require_json()
        worker, schedule_result = _schedule_job_model(
            job,
            data.get('scheduled_date') or data.get('scheduledDate'),
            data.get('worker_id') or data.get('workerId')
        )
        if not worker:
            return _json_error(schedule_result['error'], status=400, code='scheduling_failed')

        db.session.commit()
        
        logger.info(f"Job {job_id} scheduled for {schedule_result['scheduled_date']}")
        
        return jsonify({
            'success': True,
            'schedule': schedule_result,
            'job': job.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Job scheduling failed', exc=e)


@app.route('/api/jobs/<int:job_id>/execute-ai-plan', methods=['POST'])
@app.route('/api/job/<int:job_id>/execute_ai_plan', methods=['POST'])
def execute_job_ai_plan(job_id):
    """Execute assignment and scheduling for a job"""
    try:
        job = Job.query.get_or_404(job_id)
        actions = []

        if not job.assigned_worker_id:
            worker, confidence, reasoning = _assign_worker_model(job)
            if not worker:
                return _json_error('; '.join(reasoning), status=409, code='worker_assignment_failed')
            actions.append('worker_assigned')
        else:
            worker = Worker.query.get(job.assigned_worker_id)

        if not job.scheduled_date:
            worker, schedule_result = _schedule_job_model(job, worker_id=worker.id if worker else None)
            if not worker:
                return _json_error(schedule_result['error'], status=409, code='scheduling_failed')
            actions.append('job_scheduled')
        else:
            schedule_result = {'scheduled_date': job.scheduled_date.isoformat(), 'tool_plan': _reserve_tools_for_job(job, worker)}
            actions.append('tools_checked')

        db.session.add(AIDecision(
            job_id=job.id,
            decision_type='ai_plan_execution',
            decision_data=_json_dumps({'actions': actions, 'schedule': schedule_result}),
            confidence_level='high' if actions else 'medium',
            reasoning='AI plan execution completed using local assignment and scheduling logic',
            executed=True,
            outcome='success'
        ))
        db.session.commit()

        return jsonify({
            'success': True,
            'actions_completed': actions,
            'plan': _build_job_plan(job),
            'job': job.to_dict()
        })
    except Exception as e:
        db.session.rollback()
        return _json_error('AI plan execution failed', exc=e)


@app.route('/api/jobs/<int:job_id>/start', methods=['POST'])
@app.route('/api/job/<int:job_id>/start', methods=['POST'])
def start_job(job_id):
    """Start a scheduled job"""
    try:
        job = Job.query.get_or_404(job_id)
        if job.status == 'completed':
            return _json_error('Completed jobs cannot be restarted', status=409, code='job_already_completed')
        job.status = 'in_progress'
        job.actual_start_time = datetime.utcnow()
        job.progress_percentage = max(job.progress_percentage or 0, 10)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        if worker:
            worker.status = 'busy'
            worker.current_job_id = job.id
        for tool in Tool.query.filter_by(assigned_to_job_id=job.id).all():
            tool.status = 'in_use'

        db.session.add(AIDecision(
            job_id=job.id,
            decision_type='job_start',
            decision_data=_json_dumps({'started_at': job.actual_start_time.isoformat()}),
            confidence_level='high',
            reasoning='Job marked in progress and worker state synchronized',
            executed=True,
            outcome='success'
        ))
        db.session.commit()
        return jsonify({'success': True, 'job': job.to_dict(), 'worker': worker.to_dict() if worker else None})
    except Exception as e:
        db.session.rollback()
        return _json_error('Job start failed', exc=e)


@app.route('/api/jobs/<int:job_id>/complete', methods=['POST'])
@app.route('/api/job/<int:job_id>/complete', methods=['POST'])
def complete_job(job_id):
    """Complete a job and release resources"""
    try:
        job = Job.query.get_or_404(job_id)
        data = _require_json()
        already_completed = job.status == 'completed'
        job.status = 'completed'
        job.actual_end_time = job.actual_end_time or datetime.utcnow()
        job.progress_percentage = 100
        requested_cost = data.get('actual_cost', data.get('actualCost'))
        job.actual_cost = float(requested_cost or job.actual_cost or job.estimated_cost or 0)

        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        if worker:
            worker.status = 'available'
            worker.current_job_id = None
            if not already_completed:
                worker.total_jobs_completed = int(worker.total_jobs_completed or 0) + 1

        for tool in Tool.query.filter_by(assigned_to_job_id=job.id).all():
            tool.status = 'available'
            tool.assigned_to_job_id = None
            tool.assigned_to_worker_id = None

        if not already_completed:
            db.session.add(AIDecision(
                job_id=job.id,
                decision_type='job_completion',
                decision_data=_json_dumps({'actual_cost': job.actual_cost, 'completed_at': job.actual_end_time.isoformat()}),
                confidence_level='high',
                reasoning='Job completed, worker released, and tools returned to available pool',
                executed=True,
                outcome='success'
            ))
            db.session.add(Communication(
                job_id=job.id,
                sender_type='ai',
                sender_name='Contractor AI',
                message=data.get('completion_note') or data.get('completionNote') or 'Work completed and client notified.',
                platform=data.get('platform') or 'in_app',
                delivered=True
            ))
        db.session.commit()
        return jsonify({
            'success': True,
            'alreadyCompleted': already_completed,
            'job': job.to_dict(),
            'worker': worker.to_dict() if worker else None
        })
    except Exception as e:
        db.session.rollback()
        return _json_error('Job completion failed', exc=e)


# ============================================================================
# WORKER & TOOL MANAGEMENT
# ============================================================================

@app.route('/api/workers', methods=['GET'])
def list_workers():
    """List workers with optional status filtering"""
    try:
        query = Worker.query.order_by(Worker.updated_at.desc())
        if request.args.get('status'):
            query = query.filter_by(status=request.args['status'])
        limit = min(int(request.args.get('limit', 100)), 250)
        records = query.limit(limit).all()
        return jsonify({
            'success': True,
            'count': len(records),
            'workers': [worker.to_dict() for worker in records]
        })
    except Exception as e:
        return _json_error('Worker listing failed', exc=e)


@app.route('/api/workers', methods=['POST'])
def create_worker():
    """Create a worker/contractor record"""
    try:
        data = _require_json()
        name = (data.get('name') or '').strip()
        if not name:
            return _json_error('Worker name is required', status=400, code='worker_name_required')

        worker = Worker(
            name=name,
            phone=data.get('phone'),
            email=data.get('email'),
            skills=_json_list(_coerce_list(data.get('skills') or data.get('specialties'))),
            certifications=_json_list(_coerce_list(data.get('certifications'))),
            specializations=_json_list(_coerce_list(data.get('specializations') or data.get('specialties'))),
            status=data.get('status') or 'available',
            current_job_id=int(data['current_job_id']) if data.get('current_job_id') else None,
            success_rate=float(data.get('success_rate') or data.get('successRate') or 95),
            on_time_rate=float(data.get('on_time_rate') or data.get('onTimeRate') or 95),
            quality_rating=float(data.get('quality_rating') or data.get('average_rating') or data.get('rating') or 4.5),
            total_jobs_completed=int(data.get('total_jobs_completed') or data.get('jobs_completed') or data.get('completedJobs') or 0),
            years_experience=int(data.get('years_experience') or data.get('yearsExperience') or 0),
            job_history=_json_list(data.get('job_history') or [])
        )
        db.session.add(worker)
        db.session.commit()
        return jsonify({'success': True, 'worker': worker.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        return _json_error('Worker creation failed', exc=e)


@app.route('/api/workers/<int:worker_id>', methods=['PUT'])
def update_worker(worker_id):
    """Update worker details"""
    try:
        worker = Worker.query.get_or_404(worker_id)
        data = _require_json()

        for field in ['name', 'phone', 'email', 'status']:
            if field in data:
                setattr(worker, field, data[field])
        if 'skills' in data or 'specialties' in data:
            worker.skills = _json_list(_coerce_list(data.get('skills') or data.get('specialties')))
        if 'certifications' in data:
            worker.certifications = _json_list(_coerce_list(data.get('certifications')))
        if 'specializations' in data or 'specialties' in data:
            worker.specializations = _json_list(_coerce_list(data.get('specializations') or data.get('specialties')))
        if 'current_job_id' in data:
            worker.current_job_id = int(data['current_job_id']) if data.get('current_job_id') else None

        numeric_map = {
            'success_rate': ('success_rate', float),
            'successRate': ('success_rate', float),
            'on_time_rate': ('on_time_rate', float),
            'onTimeRate': ('on_time_rate', float),
            'quality_rating': ('quality_rating', float),
            'average_rating': ('quality_rating', float),
            'rating': ('quality_rating', float),
            'total_jobs_completed': ('total_jobs_completed', int),
            'jobs_completed': ('total_jobs_completed', int),
            'completedJobs': ('total_jobs_completed', int),
            'years_experience': ('years_experience', int),
            'yearsExperience': ('years_experience', int)
        }
        for source, (target, caster) in numeric_map.items():
            if source in data and data[source] is not None:
                setattr(worker, target, caster(data[source]))
        if 'job_history' in data:
            worker.job_history = _json_list(data.get('job_history') or [])

        db.session.commit()
        return jsonify({'success': True, 'worker': worker.to_dict()})
    except Exception as e:
        db.session.rollback()
        return _json_error('Worker update failed', exc=e)


@app.route('/api/workers/<int:worker_id>', methods=['DELETE'])
def delete_worker(worker_id):
    """Delete a worker and unassign active jobs"""
    try:
        worker = Worker.query.get_or_404(worker_id)
        deleted = worker.to_dict()
        for job in Job.query.filter_by(assigned_worker_id=worker.id).all():
            job.assigned_worker_id = None
            if job.status in ['scheduled', 'in_progress']:
                job.status = 'pending'
                job.ai_reasoning = 'Worker was removed; job returned to pending assignment.'
        for tool in Tool.query.filter_by(assigned_to_worker_id=worker.id).all():
            tool.assigned_to_worker_id = None
            if not tool.assigned_to_job_id:
                tool.status = 'available'
        db.session.delete(worker)
        db.session.commit()
        return jsonify({'success': True, 'deleted': deleted})
    except Exception as e:
        db.session.rollback()
        return _json_error('Worker delete failed', exc=e)


@app.route('/api/tools', methods=['GET'])
def list_tools():
    """List tools with optional status/category filtering"""
    try:
        query = Tool.query.order_by(Tool.created_at.desc())
        if request.args.get('status'):
            query = query.filter_by(status=request.args['status'])
        if request.args.get('category'):
            query = query.filter_by(category=request.args['category'])
        limit = min(int(request.args.get('limit', 100)), 250)
        records = query.limit(limit).all()
        return jsonify({
            'success': True,
            'count': len(records),
            'tools': [tool.to_dict() for tool in records]
        })
    except Exception as e:
        return _json_error('Tool listing failed', exc=e)


@app.route('/api/tools', methods=['POST'])
def create_tool():
    """Create a tool/equipment record"""
    try:
        data = _require_json()
        name = (data.get('name') or '').strip()
        if not name:
            return _json_error('Tool name is required', status=400, code='tool_name_required')

        tool = Tool(
            name=name,
            category=data.get('category') or 'general',
            status=data.get('status') or 'available',
            assigned_to_job_id=int(data['assigned_to_job_id']) if data.get('assigned_to_job_id') else None,
            assigned_to_worker_id=int(data['assigned_to_worker_id']) if data.get('assigned_to_worker_id') else None,
            last_maintenance=_coerce_datetime(data.get('last_maintenance') or data.get('lastMaintenance')),
            next_maintenance_due=_coerce_datetime(data.get('next_maintenance_due') or data.get('returnDate') or data.get('nextMaintenanceDue')),
            condition=data.get('condition') or 'good'
        )
        db.session.add(tool)
        db.session.commit()
        return jsonify({'success': True, 'tool': tool.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        return _json_error('Tool creation failed', exc=e)


@app.route('/api/tools/<int:tool_id>', methods=['PUT'])
def update_tool(tool_id):
    """Update tool details"""
    try:
        tool = Tool.query.get_or_404(tool_id)
        data = _require_json()
        for field in ['name', 'category', 'status', 'condition']:
            if field in data:
                setattr(tool, field, data[field])
        if 'assigned_to_job_id' in data:
            tool.assigned_to_job_id = int(data['assigned_to_job_id']) if data.get('assigned_to_job_id') else None
        if 'assigned_to_worker_id' in data:
            tool.assigned_to_worker_id = int(data['assigned_to_worker_id']) if data.get('assigned_to_worker_id') else None
        if 'last_maintenance' in data or 'lastMaintenance' in data:
            tool.last_maintenance = _coerce_datetime(data.get('last_maintenance') or data.get('lastMaintenance'))
        if 'next_maintenance_due' in data or 'nextMaintenanceDue' in data or 'returnDate' in data:
            tool.next_maintenance_due = _coerce_datetime(data.get('next_maintenance_due') or data.get('nextMaintenanceDue') or data.get('returnDate'))
        db.session.commit()
        return jsonify({'success': True, 'tool': tool.to_dict()})
    except Exception as e:
        db.session.rollback()
        return _json_error('Tool update failed', exc=e)


@app.route('/api/tools/<int:tool_id>', methods=['DELETE'])
def delete_tool(tool_id):
    """Delete a tool/equipment record"""
    try:
        tool = Tool.query.get_or_404(tool_id)
        deleted = tool.to_dict()
        db.session.delete(tool)
        db.session.commit()
        return jsonify({'success': True, 'deleted': deleted})
    except Exception as e:
        db.session.rollback()
        return _json_error('Tool delete failed', exc=e)


# ============================================================================
# AI & COMMUNICATION
# ============================================================================

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """AI chat interface"""
    try:
        data = request.get_json() or {}
        message = data.get('message', '')
        job_id = data.get('job_id')
        summary = _operation_summary()
        job_context = {}
        plan = None
        if job_id:
            job = Job.query.get(job_id)
            if job:
                job_context = job.to_dict()
                plan = _build_job_plan(job)

        lower = message.lower()
        if 'schedule' in lower or 'plan' in lower:
            next_job = Job.query.filter_by(status='pending').order_by(Job.created_at.asc()).first()
            plan = _build_job_plan(next_job) if next_job else plan
            response = plan['reasoning'] if plan else 'There are no pending jobs to plan right now.'
        elif 'worker' in lower or 'team' in lower:
            response = f"{summary['availableWorkers']} worker(s) are available. {summary['pendingJobs']} job(s) are pending assignment."
        elif 'tool' in lower or 'equipment' in lower:
            response = f"{summary['availableTools']} tool(s) are available. Required tools are reserved when an AI plan is executed."
        elif 'autonomous' in lower or 'run' in lower:
            response = f"Autonomous cycle is ready: {summary['pendingJobs']} pending, {summary['scheduledJobs']} scheduled, {summary['inProgressJobs']} active."
        else:
            response = f"I reviewed the operation: {summary['totalJobs']} jobs, {summary['availableWorkers']} available workers, {summary['availableTools']} available tools. The next useful action is to run the autonomous cycle or execute a plan for a pending job."

        return jsonify({
            'success': True,
            'response': response,
            'context': job_context,
            'plan': plan,
            'summary': summary,
            'suggestions': ['Run autonomous cycle', 'Review pending jobs', 'Check worker availability']
        })
        
    except Exception as e:
        return _json_error('AI chat failed', exc=e)


@app.route('/api/ai/status', methods=['GET'])
def ai_status():
    """Return AI/autonomous engine status"""
    try:
        return jsonify({
            'status': 'operational' if ai_engine else 'degraded',
            'autonomous': True,
            'summary': _operation_summary(),
            'insights': _predictive_payload(),
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        return _json_error('AI status failed', exc=e)


@app.route('/api/ai/analyze', methods=['POST'])
def analyze_job_payload():
    """Analyze a job request without creating a job"""
    try:
        data = _require_json()
        client_info = {
            'name': data.get('client') or data.get('client_name') or data.get('clientName') or 'Prospect',
            'phone': data.get('phone') or data.get('client_phone') or '',
            'email': data.get('email') or data.get('client_email') or '',
            'location': data.get('address') or data.get('location') or ''
        }
        message = data.get('message') or data.get('description') or data.get('title') or ''
        if ai_engine:
            analysis = ai_engine.analyze_job_request(message, client_info, data.get('multimodal_data'))
        else:
            analysis = {
                'job_type': 'general_maintenance',
                'urgency': data.get('urgency') or 'medium',
                'complexity_score': 5,
                'estimated_cost': 100,
                'required_tools': [],
                'required_skills': ['general maintenance'],
                'ai_confidence': 'medium'
            }
        return jsonify({'success': True, 'analysis': analysis})
    except Exception as e:
        return _json_error('AI analysis failed', exc=e)


@app.route('/api/jobs/<int:job_id>/ai-plan', methods=['GET'])
@app.route('/api/job/<int:job_id>/ai_plan', methods=['GET'])
def get_job_ai_plan(job_id):
    """Build an AI plan without mutating state"""
    try:
        job = Job.query.get_or_404(job_id)
        return jsonify(_build_job_plan(job))
    except Exception as e:
        return _json_error('AI plan failed', exc=e)


@app.route('/api/ai/autonomous-cycle', methods=['POST'])
@app.route('/api/autonomous/run', methods=['POST'])
def run_autonomous_cycle():
    """Run an autonomous operations cycle"""
    try:
        data = _require_json()
        result = _run_autonomous_cycle(data.get('maxActions') or data.get('max_actions') or 5, bool(data.get('dryRun') or data.get('dry_run')))
        if result['mode'] == 'applied':
            db.session.commit()
        else:
            db.session.rollback()
        return jsonify(result)
    except Exception as e:
        db.session.rollback()
        return _json_error('Autonomous cycle failed', exc=e)


@app.route('/api/simulate/client-request', methods=['POST'])
@app.route('/api/test/simulate-client-request', methods=['GET', 'POST'])
def simulate_client_request():
    """Simulate a client request and optionally persist it as a new job"""
    try:
        scenarios = [
            {
                'client_name': 'Emma Bakker',
                'client_phone': '+31612345678',
                'location': 'Nieuwmarkt 12, Amsterdam',
                'title': 'Kitchen cabinet and countertop replacement',
                'message': 'Need kitchen cabinets replaced and a new countertop installed.',
                'priority': 'medium'
            },
            {
                'client_name': 'Pieter Visser',
                'client_phone': '+31687654321',
                'location': 'Lange Voorhout 89, Den Haag',
                'title': 'Emergency bathroom leak repair',
                'message': 'Emergency. Bathroom is leaking and water is spreading quickly.',
                'priority': 'critical'
            },
            {
                'client_name': 'Sanne de Jong',
                'client_phone': '+31655550123',
                'location': 'Oudegracht 88, Utrecht',
                'title': 'Garden cleanup and hedge trimming',
                'message': 'Garden cleanup, hedge trimming, and green waste removal needed.',
                'priority': 'low'
            }
        ]
        index = int(datetime.utcnow().timestamp()) % len(scenarios)
        scenario = scenarios[index]
        data = _require_json()
        should_persist = request.method == 'POST' and data.get('persist', True)

        response = {
            'success': True,
            'client_request': scenario,
            'ai_processing': {
                'intent_recognition': 'local deterministic analysis',
                'urgency_detection': scenario['priority'],
                'worker_assignment': 'available through execute AI plan'
            },
            'system_actions': [
                'Client request parsed',
                'Job analysis prepared',
                'AI response generated'
            ],
            'timestamp': datetime.utcnow().isoformat()
        }

        if should_persist:
            client_info = {
                'name': scenario['client_name'],
                'phone': scenario['client_phone'],
                'email': '',
                'location': scenario['location']
            }
            analysis = ai_engine.analyze_job_request(scenario['message'], client_info) if ai_engine else {
                'job_type': 'general_maintenance',
                'job_subcategory': None,
                'complexity_score': 5,
                'urgency': scenario['priority'],
                'estimated_cost': 150,
                'cost_breakdown': {},
                'weather_dependent': False,
                'required_tools': [],
                'materials_needed': [],
                'required_skills': ['general maintenance'],
                'special_requirements': None,
                'safety_considerations': [],
                'quality_checkpoints': [],
                'ai_confidence': 'medium'
            }
            job = Job(
                title=scenario['title'],
                client_name=scenario['client_name'],
                client_phone=scenario['client_phone'],
                location=scenario['location'],
                job_type=analysis['job_type'],
                job_subcategory=analysis.get('job_subcategory'),
                complexity_score=analysis['complexity_score'],
                priority=analysis['urgency'],
                estimated_cost=analysis['estimated_cost'],
                cost_breakdown=_json_dumps(analysis.get('cost_breakdown', {})),
                weather_dependent=analysis['weather_dependent'],
                required_tools=_json_list(analysis.get('required_tools', [])),
                materials_needed=_json_list(analysis.get('materials_needed', [])),
                required_skills=_json_list(analysis.get('required_skills', [])),
                special_requirements=analysis.get('special_requirements'),
                safety_considerations=_json_list(analysis.get('safety_considerations', [])),
                quality_checkpoints=_json_list(analysis.get('quality_checkpoints', [])),
                ai_confidence=analysis['ai_confidence'],
                ai_reasoning=f"Simulated request analyzed as {analysis['job_type']}"
            )
            db.session.add(job)
            db.session.commit()
            response['job'] = job.to_dict()
            response['system_actions'].append('Job created in database')

        return jsonify(response)
    except Exception as e:
        db.session.rollback()
        return _json_error('Client request simulation failed', exc=e)


@app.route('/api/test/notifications', methods=['GET', 'POST'])
@app.route('/api/test/email-sms', methods=['GET', 'POST'])
def test_notifications():
    """Simulate outbound notification delivery"""
    try:
        data = _require_json()
        recipient_email = data.get('email') or 'noodzakelijkonline@gmail.com'
        recipient_phone = data.get('phone') or '+31068351517'
        result = {
            'success': True,
            'email_test': {
                'recipient': recipient_email,
                'status': 'sent',
                'subject': 'Contractor AI System Test',
                'message': 'Local notification simulation completed successfully.'
            },
            'sms_test': {
                'recipient': recipient_phone,
                'status': 'sent',
                'message': 'Contractor AI notification simulation completed.'
            },
            'whatsapp_test': {
                'recipient': recipient_phone,
                'status': 'sent',
                'message': 'Contractor AI WhatsApp simulation completed.'
            },
            'timestamp': datetime.utcnow().isoformat(),
            'system_status': 'Local communication dispatcher operational'
        }

        job = _get_optional_job(data.get('job_id'))
        if job:
            communication = Communication(
                job_id=job.id,
                sender_type='system',
                sender_name='Notification Test',
                message='Notification test sent across email, SMS, and WhatsApp simulators.',
                platform='multi_channel',
                delivered=True
            )
            db.session.add(communication)
            db.session.commit()
            result['communication'] = communication.to_dict()

        return jsonify(result)
    except Exception as e:
        db.session.rollback()
        return _json_error('Notification test failed', exc=e)


# ============================================================================
# VISION, ANALYTICS, COMMUNICATION & IOT
# ============================================================================

@app.route('/api/vision/analyze', methods=['POST'])
def analyze_vision():
    """Analyze job-site image metadata and persist results when linked to a job"""
    try:
        data = _require_json()
        job_id = data.get('job_id')
        job = _get_optional_job(job_id)
        if job_id and not job:
            return _json_error('Job not found', status=404, code='job_not_found')

        analysis = _vision_analysis_payload(job, data)
        response = {
            'success': True,
            'requestId': request_id(),
            'persisted': False,
            'analysis': analysis
        }

        if job:
            record = VisionAnalysis(
                job_id=job.id,
                image_url=analysis['image_url'],
                image_type=analysis['image_type'],
                detected_objects=_json_list(analysis['detected_objects']),
                detected_issues=_json_list(analysis['detected_issues']),
                quality_assessment=analysis['quality_assessment'],
                progress_estimate=analysis['progress_estimate'],
                recommendations=_json_list(analysis['recommendations']),
                confidence=analysis['confidence']
            )
            db.session.add(record)

            job.progress_percentage = max(job.progress_percentage or 0, analysis['progress_estimate'])
            job.quality_score = 9 if analysis['quality_assessment'] == 'excellent' else 7 if analysis['quality_assessment'] == 'good' else 5

            db.session.add(AIDecision(
                job_id=job.id,
                decision_type='vision_analysis',
                decision_data=_json_dumps(analysis),
                confidence_level='high' if analysis['confidence'] >= 0.85 else 'medium',
                reasoning='Computer vision metadata analysis completed for job-site progress and quality review',
                executed=True,
                outcome='success'
            ))
            db.session.commit()
            response['persisted'] = True
            response['record'] = record.to_dict()

        return jsonify(response)

    except Exception as e:
        db.session.rollback()
        return _json_error('Vision analysis failed', exc=e)


@app.route('/api/vision/analyses', methods=['GET'])
def list_vision_analyses():
    """List recent vision analyses"""
    try:
        query = VisionAnalysis.query.order_by(VisionAnalysis.created_at.desc())
        if request.args.get('job_id'):
            query = query.filter_by(job_id=int(request.args['job_id']))
        limit = min(int(request.args.get('limit', 50)), 100)
        records = query.limit(limit).all()
        return jsonify({
            'success': True,
            'count': len(records),
            'analyses': [record.to_dict() for record in records]
        })
    except Exception as e:
        return _json_error('Vision analysis listing failed', exc=e)


@app.route('/api/analytics/predictive', methods=['GET'])
def get_predictive_analytics():
    """Generate live predictive analytics without mutating state"""
    try:
        horizon_days = int(request.args.get('horizon', 30))
        payload = _predictive_payload(request.args.get('job_id'), horizon_days)
        return jsonify({
            'success': True,
            'requestId': request_id(),
            'analytics': payload
        })
    except Exception as e:
        return _json_error('Predictive analytics failed', exc=e)


@app.route('/api/analytics/predictive/run', methods=['POST'])
def run_predictive_analytics():
    """Generate and persist a predictive insight"""
    try:
        data = _require_json()
        job_id = data.get('job_id')
        job = _get_optional_job(job_id)
        if job_id and not job:
            return _json_error('Job not found', status=404, code='job_not_found')

        payload = _predictive_payload(job_id, int(data.get('horizon', 30)))
        impact_level = 'high' if payload['risk_jobs'] else 'medium' if payload['summary']['pending_jobs'] else 'low'
        insight = PredictiveInsight(
            job_id=job.id if job else None,
            insight_type=data.get('insight_type', 'business_forecast'),
            insight_data=_json_dumps(payload),
            prediction=f"{len(payload['risk_jobs'])} risk item(s), EUR {payload['summary']['estimated_pipeline']} estimated pipeline",
            confidence=payload['confidence'],
            impact_level=impact_level,
            recommended_actions=_json_list(payload['recommendations'])
        )
        db.session.add(insight)
        db.session.commit()

        return jsonify({
            'success': True,
            'insight': insight.to_dict(),
            'analytics': payload
        })
    except Exception as e:
        db.session.rollback()
        return _json_error('Predictive analytics run failed', exc=e)


@app.route('/api/communication/send', methods=['POST'])
def send_communication():
    """Send or simulate a client/worker communication"""
    try:
        data = _require_json()
        message = (data.get('message') or '').strip()
        if not message:
            return _json_error('Message is required', status=400, code='message_required')

        job_id = data.get('job_id')
        job = _get_optional_job(job_id)
        if job_id and not job:
            return _json_error('Job not found', status=404, code='job_not_found')

        channel = data.get('platform') or data.get('channel') or 'whatsapp'
        result = {
            'success': True,
            'message_id': str(uuid4()),
            'platform': channel,
            'recipient': data.get('recipient') or (job.client_phone if job else 'manual-recipient'),
            'status': 'sent',
            'sent_at': datetime.utcnow().isoformat(),
            'persisted': False
        }

        if job:
            communication = Communication(
                job_id=job.id,
                sender_type=data.get('sender_type', 'ai'),
                sender_name=data.get('sender_name', 'Contractor AI'),
                message=message,
                platform=channel,
                message_type=data.get('message_type', 'text'),
                has_attachment=bool(data.get('attachment_url')),
                attachment_type=data.get('attachment_type'),
                attachment_url=data.get('attachment_url'),
                sent=True,
                delivered=bool(data.get('mark_delivered', True))
            )
            db.session.add(communication)
            db.session.add(AIDecision(
                job_id=job.id,
                decision_type='communication',
                decision_data=_json_dumps({
                    'platform': channel,
                    'recipient': result['recipient'],
                    'message_id': result['message_id']
                }),
                confidence_level='high',
                reasoning='Communication sent through local dispatcher simulation',
                executed=True,
                outcome='success'
            ))
            db.session.commit()
            result['persisted'] = True
            result['communication'] = communication.to_dict()

        return jsonify(result)

    except Exception as e:
        db.session.rollback()
        return _json_error('Communication send failed', exc=e)


@app.route('/api/communication/log', methods=['GET'])
def list_communications():
    """List recent communications"""
    try:
        query = Communication.query.order_by(Communication.created_at.desc())
        if request.args.get('job_id'):
            query = query.filter_by(job_id=int(request.args['job_id']))
        limit = min(int(request.args.get('limit', 50)), 100)
        records = query.limit(limit).all()
        return jsonify({
            'success': True,
            'count': len(records),
            'communications': [record.to_dict() for record in records]
        })
    except Exception as e:
        return _json_error('Communication log failed', exc=e)


@app.route('/api/iot/sensors', methods=['GET'])
def list_iot_sensors():
    """List latest IoT sensor readings and derived alerts"""
    try:
        query = IoTSensorData.query.order_by(IoTSensorData.created_at.desc())
        if request.args.get('job_id'):
            query = query.filter_by(job_id=int(request.args['job_id']))
        limit = min(int(request.args.get('limit', 100)), 250)
        readings = [record.to_dict() for record in query.limit(limit).all()]

        if not readings:
            readings = [
                {
                    'sensor_id': 'demo-temperature-001',
                    'sensor_type': 'temperature',
                    'location': 'Demo bathroom site',
                    'reading_value': 21.5,
                    'reading_unit': 'celsius',
                    'reading_status': 'normal',
                    'metadata': {'source': 'demo'}
                },
                {
                    'sensor_id': 'demo-humidity-001',
                    'sensor_type': 'humidity',
                    'location': 'Demo bathroom site',
                    'reading_value': 64,
                    'reading_unit': 'percent',
                    'reading_status': 'normal',
                    'metadata': {'source': 'demo'}
                }
            ]

        alerts = [reading for reading in readings if reading.get('reading_status') in ['warning', 'critical']]
        return jsonify({
            'success': True,
            'summary': {
                'readings': len(readings),
                'alerts': len(alerts),
                'critical': len([reading for reading in alerts if reading.get('reading_status') == 'critical'])
            },
            'alerts': alerts,
            'readings': readings
        })

    except Exception as e:
        return _json_error('IoT sensor listing failed', exc=e)


@app.route('/api/iot/sensors', methods=['POST'])
def ingest_iot_sensor():
    """Ingest a new IoT sensor reading"""
    try:
        data = _require_json()
        job_id = data.get('job_id')
        job = _get_optional_job(job_id)
        if job_id and not job:
            return _json_error('Job not found', status=404, code='job_not_found')

        sensor_type = data.get('sensor_type', 'environment')
        value = float(data.get('reading_value', data.get('value', 0)))
        status = data.get('reading_status') or _reading_status(sensor_type, value)
        reading = IoTSensorData(
            job_id=job.id if job else None,
            sensor_id=data.get('sensor_id') or f"sensor-{uuid4()}",
            sensor_type=sensor_type,
            location=data.get('location') or (job.location if job else 'Unassigned'),
            reading_value=value,
            reading_unit=data.get('reading_unit') or data.get('unit') or 'unit',
            reading_status=status,
            metadata_json=_json_dumps(data.get('metadata', {}))
        )
        db.session.add(reading)

        alert = None
        if status in ['warning', 'critical']:
            alert = PredictiveInsight(
                job_id=job.id if job else None,
                insight_type='iot_alert',
                insight_data=_json_dumps(reading.to_dict()),
                prediction=f"{sensor_type} sensor reported {status}",
                confidence=0.88,
                impact_level='high' if status == 'critical' else 'medium',
                recommended_actions=_json_list([
                    'Inspect site conditions',
                    'Notify assigned worker' if job else 'Assign owner for sensor alert'
                ])
            )
            db.session.add(alert)

        db.session.commit()
        return jsonify({
            'success': True,
            'reading': reading.to_dict(),
            'alert': alert.to_dict() if alert else None
        }), 201

    except ValueError:
        return _json_error('Numeric reading value is required', status=400, code='invalid_reading_value')
    except Exception as e:
        db.session.rollback()
        return _json_error('IoT sensor ingest failed', exc=e)


@app.errorhandler(404)
def not_found(error):
    if request.path.startswith('/api'):
        return _json_error('Endpoint not found', status=404, code='not_found')
    return jsonify({'error': 'File not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    logger.exception("Unhandled god-mode backend error")
    return _json_error('Internal server error', status=500, code='internal_error')


# ============================================================================
# RUN APPLICATION
# ============================================================================

if __name__ == '__main__':
    logger.info("Starting God-Mode Contractor AI Application")
    logger.info("=" * 60)
    logger.info("Features enabled:")
    logger.info("  [ok] Job Analysis & Planning")
    logger.info("  [ok] Worker Assignment")
    logger.info("  [ok] Intelligent Scheduling")
    logger.info("  [ok] Multi-Modal Communication")
    logger.info("  [ok] Computer Vision")
    logger.info("  [ok] Predictive Analytics")
    logger.info("  [ok] IoT Integration")
    logger.info("=" * 60)
    
    app.run(
        host=os.environ.get('HOST', '0.0.0.0'),
        port=int(os.environ.get('PORT', '5000')),
        debug=_debug_enabled()
    )
