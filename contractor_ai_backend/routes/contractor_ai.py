from flask import Blueprint, request, jsonify, current_app, g
from werkzeug.exceptions import HTTPException
from models.job import db, Job, Worker, Tool, Communication, AIDecision
from ai_engine import ContractorAI
import json
from datetime import datetime, timedelta
from uuid import uuid4

contractor_ai_bp = Blueprint('contractor_ai', __name__)
ai_engine = ContractorAI()


@contractor_ai_bp.before_request
def _attach_request_id():
    g.request_id = request.headers.get('X-Request-Id') or str(uuid4())


@contractor_ai_bp.after_request
def _add_request_id_header(response):
    response.headers['X-Request-Id'] = _request_id()
    return response


def _request_id():
    return getattr(g, 'request_id', None) or request.headers.get('X-Request-Id') or str(uuid4())


def _json_error(message, status=500, code='internal_error', exc=None, details=None):
    if isinstance(exc, HTTPException):
        status = exc.code or status
        code = exc.name.lower().replace(' ', '_')
        message = exc.description or message
    elif exc is not None:
        current_app.logger.exception(message)

    payload = {
        'error': {
            'code': code,
            'message': message,
            'requestId': _request_id()
        }
    }
    if details is not None and current_app.debug:
        payload['error']['details'] = details

    response = jsonify(payload)
    response.status_code = status
    return response


def _collect_diagnostics():
    jobs = Job.query.all()
    workers = Worker.query.all()
    tools = Tool.query.all()
    issues = []
    worker_ids = {worker.id for worker in workers}
    job_ids = {job.id for job in jobs}

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
        if job.status == 'completed' and progress < 100:
            issues.append({
                'severity': 'warning',
                'collection': 'jobs',
                'id': job.id,
                'message': 'Completed job has progress below 100'
            })

    for worker in workers:
        active_jobs = [
            job for job in jobs
            if job.assigned_worker_id == worker.id and job.status in ['scheduled', 'in_progress']
        ]
        if worker.status == 'busy' and not active_jobs:
            issues.append({
                'severity': 'warning',
                'collection': 'workers',
                'id': worker.id,
                'message': 'Busy worker has no active assigned job'
            })

    for tool in tools:
        if tool.assigned_to_job_id and tool.assigned_to_job_id not in job_ids:
            issues.append({
                'severity': 'error',
                'collection': 'tools',
                'id': tool.id,
                'message': 'Tool references a missing job'
            })
        if tool.status == 'in_use' and not tool.assigned_to_job_id:
            issues.append({
                'severity': 'warning',
                'collection': 'tools',
                'id': tool.id,
                'message': 'In-use tool has no assigned job'
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
            'aiDecisions': AIDecision.query.count()
        },
        'issues': issues
    }


def _response_status(response):
    if isinstance(response, tuple):
        return response[1]
    return getattr(response, "status_code", 200)


def _release_job_resources(job):
    worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
    if worker:
        other_active_job = Job.query.filter(
            Job.assigned_worker_id == worker.id,
            Job.id != job.id,
            Job.status.in_(['scheduled', 'in_progress'])
        ).first()
        if not other_active_job:
            worker.status = 'available'

    released_tools = Tool.query.filter_by(assigned_to_job_id=job.id).all()
    for tool in released_tools:
        tool.status = 'available'
        tool.assigned_to_job_id = None
        tool.assigned_to_worker_id = None

    return worker, released_tools


def _create_job_from_payload(data):
    client_message = data.get('message', '')
    client_info = {
        'name': data.get('client_name', ''),
        'phone': data.get('client_phone', ''),
        'email': data.get('client_email', ''),
        'location': data.get('location', '')
    }

    analysis = ai_engine.analyze_job_request(client_message, client_info)

    job = Job(
        title=data.get('title', f"{analysis['job_type'].replace('_', ' ').title()} - {client_info['name']}"),
        client_name=client_info['name'],
        client_phone=client_info['phone'],
        client_email=client_info['email'],
        location=client_info['location'],
        job_type=analysis['job_type'],
        complexity_score=analysis['complexity_score'],
        priority=analysis['urgency'],
        estimated_cost=analysis['estimated_cost'],
        weather_dependent=analysis['weather_dependent'],
        required_tools=json.dumps(analysis['required_tools']),
        required_skills=json.dumps(analysis.get('required_skills', [])),
        materials_needed=json.dumps(analysis.get('materials_needed', [])),
        special_requirements=analysis.get('special_requirements'),
        ai_confidence=analysis['ai_confidence'],
        ai_reasoning=f"Job analyzed as {analysis['job_type']} with complexity {analysis['complexity_score']}/10"
    )

    db.session.add(job)
    db.session.commit()

    db.session.add(AIDecision(
        job_id=job.id,
        decision_type='job_analysis',
        decision_data=json.dumps(analysis),
        confidence_level=analysis['ai_confidence'],
        reasoning=f"Analyzed job request and categorized as {analysis['job_type']}",
        executed=True
    ))

    db.session.add(Communication(
        job_id=job.id,
        sender_type='client',
        sender_name=client_info['name'],
        message=client_message,
        platform='whatsapp'
    ))

    db.session.add(Communication(
        job_id=job.id,
        sender_type='ai',
        sender_name='Manus AI',
        message=ai_engine.generate_client_communication(job.to_dict(), {}, {}, 'job_received'),
        platform='whatsapp'
    ))

    db.session.commit()

    ai_engine.send_email_notification(
        ai_engine.contractor_email,
        f"New Job Request: {job.title}",
        f"New job received from {client_info['name']} at {client_info['location']}.\n"
        f"Type: {analysis['job_type']}\n"
        f"Urgency: {analysis['urgency']}\n"
        f"Estimated cost: €{analysis['estimated_cost']}\n"
        f"AI Confidence: {analysis['ai_confidence']}\n\n"
        f"View details: [Dashboard Link]"
    )

    return job, analysis

@contractor_ai_bp.route('/dashboard', methods=['GET'])
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
        today_revenue = sum([j.actual_cost or j.estimated_cost for j in jobs 
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
        
        return jsonify({
            'apiVersion': '1.1.0',
            'source': 'contractor-backend',
            'metrics': {
                'critical_jobs': critical_jobs,
                'ai_handling': ai_handling,
                'today_revenue': round(today_revenue, 2),
                'completed_today': completed_today,
                'total_jobs': total_jobs
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
            'tools': [tool.to_dict() for tool in tools]
        })
        
    except Exception as e:
        return _json_error('Dashboard data failed', exc=e)


@contractor_ai_bp.route('/debug/diagnostics', methods=['GET'])
def get_debug_diagnostics():
    """Return non-secret runtime diagnostics for debugging local state issues"""
    try:
        diagnostics = _collect_diagnostics()
        return jsonify({
            'status': 'ok' if diagnostics['valid'] else 'attention',
            'requestId': _request_id(),
            'generatedAt': datetime.utcnow().isoformat(),
            'diagnostics': diagnostics
        })
    except Exception as e:
        return _json_error('Diagnostics failed', exc=e)

@contractor_ai_bp.route('/jobs/<int:job_id>', methods=['GET'])
@contractor_ai_bp.route('/job/<int:job_id>', methods=['GET'])
def get_job_details(job_id):
    """Get detailed job information"""
    try:
        job = Job.query.get_or_404(job_id)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        communications = Communication.query.filter_by(job_id=job_id).order_by(Communication.created_at.desc()).all()
        ai_decisions = AIDecision.query.filter_by(job_id=job_id).order_by(AIDecision.created_at.desc()).all()
        
        # Get required tools for this job
        required_tool_names = job.to_dict().get('required_tools', [])
        required_tools = []
        for tool_name in required_tool_names:
            tool = Tool.query.filter_by(name=tool_name).first()
            if tool:
                required_tools.append(tool.to_dict())
        
        return jsonify({
            'job': job.to_dict(),
            'worker': worker.to_dict() if worker else None,
            'required_tools': required_tools,
            'communications': [comm.to_dict() for comm in communications],
            'ai_decisions': [decision.to_dict() for decision in ai_decisions]
        })
        
    except Exception as e:
        return _json_error('Job details failed', exc=e)

@contractor_ai_bp.route('/jobs', methods=['POST'])
@contractor_ai_bp.route('/job/new', methods=['POST'])
def create_new_job():
    """Create a new job from client request"""
    try:
        data = request.get_json() or {}
        
        # Analyze the job request using AI
        client_message = data.get('message', '')
        client_info = {
            'name': data.get('client_name', ''),
            'phone': data.get('client_phone', ''),
            'email': data.get('client_email', ''),
            'location': data.get('location', '')
        }
        
        # AI analysis
        analysis = ai_engine.analyze_job_request(client_message, client_info)
        
        # Create job record
        job = Job(
            title=data.get('title', f"{analysis['job_type'].replace('_', ' ').title()} - {client_info['name']}"),
            client_name=client_info['name'],
            client_phone=client_info['phone'],
            client_email=client_info['email'],
            location=client_info['location'],
            job_type=analysis['job_type'],
            complexity_score=analysis['complexity_score'],
            priority=analysis['urgency'],
            estimated_cost=analysis['estimated_cost'],
            weather_dependent=analysis['weather_dependent'],
            required_tools=json.dumps(analysis['required_tools']),
            materials_needed=json.dumps(analysis.get('materials_needed', [])),
            special_requirements=analysis.get('special_requirements'),
            ai_confidence=analysis['ai_confidence'],
            ai_reasoning=f"Job analyzed as {analysis['job_type']} with complexity {analysis['complexity_score']}/10"
        )
        
        db.session.add(job)
        db.session.commit()
        
        # Log the AI analysis
        ai_decision = AIDecision(
            job_id=job.id,
            decision_type='job_analysis',
            decision_data=json.dumps(analysis),
            confidence_level=analysis['ai_confidence'],
            reasoning=f"Analyzed job request and categorized as {analysis['job_type']}",
            executed=True
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
        
        # Send confirmation to client
        response_message = ai_engine.generate_client_communication(
            job.to_dict(), {}, {}, 'job_received'
        )
        
        ai_response = Communication(
            job_id=job.id,
            sender_type='ai',
            sender_name='Manus AI',
            message=response_message,
            platform='whatsapp'
        )
        db.session.add(ai_response)
        
        db.session.commit()
        
        # Send email notification to contractor
        ai_engine.send_email_notification(
            ai_engine.contractor_email,
            f"New Job Request: {job.title}",
            f"New job received from {client_info['name']} at {client_info['location']}.\n"
            f"Type: {analysis['job_type']}\n"
            f"Urgency: {analysis['urgency']}\n"
            f"Estimated cost: €{analysis['estimated_cost']}\n"
            f"AI Confidence: {analysis['ai_confidence']}\n\n"
            f"View details: [Dashboard Link]"
        )
        
        return jsonify({
            'success': True,
            'job_id': job.id,
            'job': job.to_dict(),
            'analysis': analysis,
            'message': 'Job created successfully and client notified'
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Job creation failed', exc=e)

@contractor_ai_bp.route('/jobs/<int:job_id>/assign-worker', methods=['POST'])
@contractor_ai_bp.route('/job/<int:job_id>/assign_worker', methods=['POST'])
def assign_worker_to_job(job_id):
    """AI-powered worker assignment"""
    try:
        job = Job.query.get_or_404(job_id)
        
        # Get available workers
        available_workers = Worker.query.filter_by(status='available').all()
        worker_data = [worker.to_dict() for worker in available_workers]
        
        # Get job requirements
        job_data = job.to_dict()
        job_requirements = {
            'required_skills': job_data.get('required_skills', []),
            'complexity_score': job.complexity_score,
            'urgency': job.priority
        }
        
        # AI worker selection
        best_worker, confidence, reasoning = ai_engine.select_optimal_worker(job_requirements, worker_data)
        
        if not best_worker:
            return jsonify({'error': 'No suitable workers available'}), 400
        
        # Assign worker
        job.assigned_worker_id = best_worker['id']
        job.ai_confidence = confidence
        job.ai_reasoning = f"Selected {best_worker['name']}: " + "; ".join(reasoning)
        
        # Log AI decision
        ai_decision = AIDecision(
            job_id=job.id,
            decision_type='worker_assignment',
            decision_data=json.dumps({
                'selected_worker': best_worker,
                'reasoning': reasoning
            }),
            confidence_level=confidence,
            reasoning=f"AI selected {best_worker['name']} based on skill match and availability",
            executed=True
        )
        db.session.add(ai_decision)
        db.session.commit()
        
        # Send notifications
        ai_engine.send_email_notification(
            ai_engine.contractor_email,
            f"Worker Assigned: {job.title}",
            f"AI has assigned {best_worker['name']} to job {job.title}.\n"
            f"Confidence: {confidence}\n"
            f"Reasoning: {'; '.join(reasoning)}"
        )
        
        return jsonify({
            'success': True,
            'assigned_worker': best_worker,
            'confidence': confidence,
            'reasoning': reasoning,
            'job': job.to_dict()
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Worker assignment failed', exc=e)

@contractor_ai_bp.route('/jobs/<int:job_id>/schedule', methods=['POST'])
@contractor_ai_bp.route('/job/<int:job_id>/schedule', methods=['POST'])
def schedule_job(job_id):
    """AI-powered job scheduling"""
    try:
        job = Job.query.get_or_404(job_id)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        
        if not worker:
            return jsonify({'error': 'No worker assigned to this job'}), 400
        
        # Get existing jobs for scheduling optimization
        existing_jobs = Job.query.filter(
            Job.status.in_(['scheduled', 'in_progress']),
            Job.id != job_id
        ).all()
        
        # AI scheduling
        schedule_result = ai_engine.optimize_schedule(
            job.to_dict(),
            worker.to_dict(),
            [j.to_dict() for j in existing_jobs]
        )
        
        if schedule_result['recommended_slot']:
            # Update job with schedule
            job.scheduled_start = datetime.fromisoformat(schedule_result['recommended_slot']['start'])
            job.scheduled_end = datetime.fromisoformat(schedule_result['recommended_slot']['end'])
            job.status = 'scheduled'
            
            # Log AI decision
            ai_decision = AIDecision(
                job_id=job.id,
                decision_type='scheduling',
                decision_data=json.dumps(schedule_result),
                confidence_level=schedule_result['confidence'],
                reasoning=schedule_result['reasoning'],
                executed=True
            )
            db.session.add(ai_decision)
            db.session.commit()
            
            # Send client notification
            client_message = ai_engine.generate_client_communication(
                job.to_dict(), worker.to_dict(), schedule_result, 'worker_assigned'
            )
            
            comm = Communication(
                job_id=job.id,
                sender_type='ai',
                sender_name='Manus AI',
                message=client_message,
                platform='whatsapp'
            )
            db.session.add(comm)
            db.session.commit()
            
            # Notify contractor
            ai_engine.send_email_notification(
                ai_engine.contractor_email,
                f"Job Scheduled: {job.title}",
                f"Job scheduled for {job.scheduled_start.strftime('%A, %B %d at %I:%M %p')}.\n"
                f"Worker: {worker.name}\n"
                f"Client notified: Yes\n"
                f"Confidence: {schedule_result['confidence']}"
            )
            
            return jsonify({
                'success': True,
                'schedule': schedule_result,
                'job': job.to_dict(),
                'message': 'Job scheduled and client notified'
            })
        else:
            return jsonify({'error': 'No suitable time slots available'}), 400
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Job scheduling failed', exc=e)

@contractor_ai_bp.route('/jobs/<int:job_id>/execute-ai-plan', methods=['POST'])
@contractor_ai_bp.route('/job/<int:job_id>/execute_ai_plan', methods=['POST'])
def execute_ai_plan(job_id):
    """Execute the complete AI plan for a job"""
    try:
        job = Job.query.get_or_404(job_id)
        
        results = []
        
        # Step 1: Assign worker if not already assigned
        if not job.assigned_worker_id:
            assign_result = assign_worker_to_job(job_id)
            if _response_status(assign_result) != 200:
                return assign_result
            results.append("Worker assigned")
        
        # Step 2: Schedule job if not already scheduled
        if not job.scheduled_start:
            schedule_result = schedule_job(job_id)
            if _response_status(schedule_result) != 200:
                return schedule_result
            results.append("Job scheduled")
        
        # Step 3: Update job status
        job.status = 'scheduled'
        db.session.commit()
        
        # Send comprehensive update to contractor
        ai_engine.send_email_notification(
            ai_engine.contractor_email,
            f"AI Plan Executed: {job.title}",
            f"AI has successfully executed the complete plan for {job.title}:\n\n" +
            "\n".join(f"✅ {result}" for result in results) +
            f"\n\nJob is now ready for execution."
        )
        
        ai_engine.send_sms_notification(
            ai_engine.contractor_phone,
            f"✅ AI Plan Complete: {job.title} - Worker assigned & scheduled. Check email for details."
        )
        
        return jsonify({
            'success': True,
            'actions_completed': results,
            'job': job.to_dict(),
            'message': 'AI plan executed successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('AI plan execution failed', exc=e)

@contractor_ai_bp.route('/jobs/<int:job_id>/start', methods=['POST'])
@contractor_ai_bp.route('/job/<int:job_id>/start', methods=['POST'])
def start_job(job_id):
    """Start job execution"""
    try:
        job = Job.query.get_or_404(job_id)
        if job.status == 'completed':
            return _json_error('Completed jobs cannot be restarted', status=409, code='job_already_completed')
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        if not worker:
            return _json_error('Assign and schedule a worker before starting this job', status=409, code='worker_required')
        
        job.status = 'in_progress'
        job.actual_start = job.actual_start or datetime.utcnow()
        job.progress_percentage = max(job.progress_percentage or 0, 10)
        
        # Update worker status
        worker.status = 'busy'
        for tool in Tool.query.filter_by(assigned_to_job_id=job.id).all():
            tool.status = 'in_use'
        
        db.session.commit()
        
        # Send notifications
        client_message = ai_engine.generate_client_communication(
            job.to_dict(), worker.to_dict() if worker else {}, {}, 'job_started'
        )
        
        comm = Communication(
            job_id=job.id,
            sender_type='ai',
            sender_name='Manus AI',
            message=client_message,
            platform='whatsapp'
        )
        db.session.add(comm)
        db.session.commit()
        
        # Notify contractor
        ai_engine.send_email_notification(
            ai_engine.contractor_email,
            f"Job Started: {job.title}",
            f"Work has begun on {job.title}.\n"
            f"Worker: {worker.name if worker else 'Unknown'}\n"
            f"Started at: {job.actual_start.strftime('%I:%M %p')}\n"
            f"Client has been notified."
        )
        
        return jsonify({
            'success': True,
            'job': job.to_dict(),
            'worker': worker.to_dict(),
            'message': 'Job started successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Job start failed', exc=e)

@contractor_ai_bp.route('/jobs/<int:job_id>/complete', methods=['POST'])
@contractor_ai_bp.route('/job/<int:job_id>/complete', methods=['POST'])
def complete_job(job_id):
    """Complete job execution"""
    try:
        job = Job.query.get_or_404(job_id)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        
        data = request.get_json() or {}
        already_completed = job.status == 'completed'
        
        job.status = 'completed'
        job.actual_end = job.actual_end or datetime.utcnow()
        job.progress_percentage = 100
        job.actual_cost = data.get('actual_cost', data.get('actualCost', job.actual_cost or job.estimated_cost))
        
        # Calculate actual duration
        duration_hours = 0.0
        if job.actual_start:
            duration = job.actual_end - job.actual_start
            duration_hours = duration.total_seconds() / 3600  # Convert to hours
            job.actual_duration = duration_hours
        
        # Update worker status and stats
        if worker and not already_completed:
            worker.jobs_completed += 1
        _release_job_resources(job)
        
        db.session.commit()
        
        if not already_completed:
            client_message = ai_engine.generate_client_communication(
                job.to_dict(), worker.to_dict() if worker else {}, {}, 'job_completed'
            )
            comm = Communication(
                job_id=job.id,
                sender_type='ai',
                sender_name='Manus AI',
                message=data.get('completion_note') or data.get('completionNote') or client_message,
                platform='whatsapp'
            )
            db.session.add(comm)
            db.session.commit()

            ai_engine.send_email_notification(
                ai_engine.contractor_email,
                f"Job Completed: {job.title}",
                f"✅ {job.title} has been completed successfully!\n\n"
                f"Worker: {worker.name if worker else 'Unknown'}\n"
                f"Duration: {duration_hours:.1f} hours\n"
                f"Cost: €{job.actual_cost}\n"
                f"Client has been notified and invoiced."
            )
        
        return jsonify({
            'success': True,
            'alreadyCompleted': already_completed,
            'job': job.to_dict(),
            'worker': worker.to_dict() if worker else None,
            'message': 'Job completed successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Job completion failed', exc=e)

@contractor_ai_bp.route('/ai/autonomous-cycle', methods=['POST'])
@contractor_ai_bp.route('/autonomous/run', methods=['POST'])
def run_autonomous_engine():
    """Run autonomous job planning and progress logic against current database state"""
    try:
        data = request.get_json() or {}
        max_actions = int(data.get('max_actions', 10))
        dry_run = bool(data.get('dry_run', False))
        actions = []
        alerts = []

        jobs = Job.query.order_by(Job.created_at.asc()).all()
        workers = Worker.query.all()
        tools = Tool.query.all()

        for job in jobs:
            if len(actions) >= max_actions:
                break

            if job.status == 'pending':
                available_workers = [worker for worker in workers if worker.status == 'available']
                best_worker, confidence, reasoning = ai_engine.select_optimal_worker(
                    {
                        'required_skills': job.to_dict().get('required_skills', []),
                        'complexity_score': job.complexity_score,
                        'urgency': job.priority
                    },
                    [worker.to_dict() for worker in available_workers]
                )

                if not best_worker:
                    message = f"No available worker found for {job.title}"
                    alerts.append({'job_id': job.id, 'severity': 'high', 'message': message})
                    if not dry_run:
                        db.session.add(AIDecision(
                            job_id=job.id,
                            decision_type='autonomous_worker_assignment',
                            decision_data=json.dumps({'available_workers': len(available_workers)}),
                            confidence_level='low',
                            reasoning=message,
                            executed=False
                        ))
                    actions.append({'job_id': job.id, 'type': 'manual_review_required', 'message': message})
                    continue

                worker_model = Worker.query.get(best_worker['id'])
                schedule_result = ai_engine.optimize_schedule(
                    job.to_dict(),
                    worker_model.to_dict(),
                    [item.to_dict() for item in jobs if item.id != job.id and item.status in ['scheduled', 'in_progress']]
                )

                if not schedule_result.get('recommended_slot'):
                    message = f"No safe schedule window found for {job.title}"
                    alerts.append({'job_id': job.id, 'severity': 'medium', 'message': message})
                    actions.append({'job_id': job.id, 'type': 'schedule_blocked', 'message': message})
                    continue

                required_tools = job.to_dict().get('required_tools', [])
                reserved_tools = []
                for required_tool in required_tools:
                    matching_tool = next(
                        (
                            tool for tool in tools
                            if tool.status == 'available'
                            and (
                                required_tool.lower() in tool.name.lower()
                                or tool.name.lower() in required_tool.lower()
                                or required_tool.lower() in tool.category.lower()
                            )
                        ),
                        None
                    )
                    if matching_tool:
                        reserved_tools.append(matching_tool.name)
                        if not dry_run:
                            matching_tool.status = 'reserved'
                            matching_tool.assigned_to_job_id = job.id
                            matching_tool.assigned_to_worker_id = worker_model.id
                            matching_tool.current_location = job.location

                if not dry_run:
                    job.assigned_worker_id = worker_model.id
                    job.scheduled_start = datetime.fromisoformat(schedule_result['recommended_slot']['start'])
                    job.scheduled_end = datetime.fromisoformat(schedule_result['recommended_slot']['end'])
                    job.status = 'scheduled'
                    job.ai_confidence = confidence
                    job.ai_reasoning = f"Autonomous engine assigned {worker_model.name}; {'; '.join(reasoning)}"
                    worker_model.status = 'busy'

                    db.session.add(AIDecision(
                        job_id=job.id,
                        decision_type='autonomous_plan',
                        decision_data=json.dumps({
                            'worker': best_worker,
                            'schedule': schedule_result,
                            'reserved_tools': reserved_tools
                        }),
                        confidence_level=confidence,
                        reasoning=job.ai_reasoning,
                        risks=json.dumps(schedule_result.get('alternatives', [])),
                        executed=True
                    ))

                    db.session.add(Communication(
                        job_id=job.id,
                        sender_type='ai',
                        sender_name='Manus AI',
                        message=ai_engine.generate_client_communication(
                            job.to_dict(),
                            worker_model.to_dict(),
                            schedule_result,
                            'worker_assigned'
                        ),
                        platform='whatsapp'
                    ))

                actions.append({
                    'job_id': job.id,
                    'type': 'planned',
                    'worker': worker_model.name,
                    'reserved_tools': reserved_tools,
                    'schedule': schedule_result
                })
                continue

            if job.status == 'scheduled' and job.scheduled_start and job.scheduled_start <= datetime.utcnow():
                if not dry_run:
                    job.status = 'in_progress'
                    job.actual_start = datetime.utcnow()
                    job.progress_percentage = max(job.progress_percentage or 0, 10)
                    job.ai_reasoning = 'Autonomous engine started due scheduled job.'
                    worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
                    if worker:
                        worker.status = 'busy'
                    for tool in Tool.query.filter_by(assigned_to_job_id=job.id).all():
                        tool.status = 'in_use'
                    db.session.add(AIDecision(
                        job_id=job.id,
                        decision_type='autonomous_start',
                        decision_data=json.dumps({'started_at': job.actual_start.isoformat()}),
                        confidence_level='high',
                        reasoning=job.ai_reasoning,
                        executed=True
                    ))
                actions.append({'job_id': job.id, 'type': 'started', 'message': f'{job.title} started'})
                continue

            if job.status == 'in_progress':
                next_progress = min(95, (job.progress_percentage or 0) + 15)
                if not dry_run:
                    job.progress_percentage = next_progress
                    job.ai_reasoning = f'Autonomous progress monitor updated job to {next_progress}%.'
                    db.session.add(AIDecision(
                        job_id=job.id,
                        decision_type='autonomous_progress_update',
                        decision_data=json.dumps({'progress_percentage': next_progress}),
                        confidence_level='medium',
                        reasoning=job.ai_reasoning,
                        executed=True
                    ))
                actions.append({'job_id': job.id, 'type': 'progress_updated', 'progress_percentage': next_progress})

        if not dry_run:
            db.session.commit()

        return jsonify({
            'success': True,
            'dry_run': dry_run,
            'actions': actions,
            'alerts': alerts,
            'summary': {
                'jobs_seen': len(jobs),
                'actions_taken': len(actions),
                'alerts': len(alerts)
            }
        })

    except Exception as e:
        db.session.rollback()
        return _json_error('Autonomous engine run failed', exc=e)

@contractor_ai_bp.route('/simulate/client-request', methods=['POST'])
@contractor_ai_bp.route('/simulate_client_request', methods=['POST'])
def simulate_client_request():
    """Simulate a client request for testing"""
    try:
        data = request.get_json() or {}
        
        # Simulate different types of requests
        scenarios = {
            'bathroom': {
                'client_name': 'Jan Bakker',
                'client_phone': '+31 06-12345678',
                'client_email': 'jan.bakker@email.com',
                'location': 'Hoofdstraat 123, Amsterdam',
                'message': 'Hi, I need my bathroom renovated. The tiles are old and the shower is leaking. Can you help?',
                'title': 'Bathroom Renovation'
            },
            'gutter': {
                'client_name': 'Maria van der Berg',
                'client_phone': '+31 06-87654321',
                'client_email': 'maria.vdberg@email.com',
                'location': 'Parkstraat 45, Utrecht',
                'message': 'My gutters are clogged and overflowing. Need cleaning and inspection.',
                'title': 'Gutter Cleaning & Inspection'
            },
            'emergency': {
                'client_name': 'Peter de Vries',
                'client_phone': '+31 06-99887766',
                'client_email': 'peter.devries@email.com',
                'location': 'Kerkstraat 78, Rotterdam',
                'message': 'URGENT: Water pipe burst in my kitchen! Water everywhere!',
                'title': 'Emergency Plumbing'
            }
        }
        
        scenario_type = data.get('scenario', 'bathroom')
        scenario = scenarios.get(scenario_type, scenarios['bathroom'])
        
        job, analysis = _create_job_from_payload(scenario)

        return jsonify({
            'success': True,
            'scenario': scenario,
            'job_id': job.id,
            'job': job.to_dict(),
            'analysis': analysis,
            'message': f'Simulated {scenario_type} request created successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        return _json_error('Client request simulation failed', exc=e)

@contractor_ai_bp.route('/test/notifications', methods=['POST'])
@contractor_ai_bp.route('/test_notifications', methods=['POST'])
def test_notifications():
    """Test email and SMS notifications"""
    try:
        data = request.get_json() or {}
        notification_type = data.get('type', 'all')
        channels = {}
        
        if notification_type in ['email', 'all']:
            channels['email'] = ai_engine.send_email_notification(
                ai_engine.contractor_email,
                "🧪 Test Email from Contractor AI",
                "This is a test email to verify the notification system is working correctly.\n\n"
                "If you receive this, the email integration is functioning properly!\n\n"
                f"Sent at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            )
        if notification_type in ['sms', 'all']:
            channels['sms'] = ai_engine.send_sms_notification(
                ai_engine.contractor_phone,
                f"🧪 Test SMS from Contractor AI - System working! {datetime.now().strftime('%H:%M')}"
            )
        if not channels:
            return jsonify({'error': 'Invalid notification type'}), 400
        
        return jsonify({
            'success': all(channels.values()),
            'channels': channels,
            'message': f'Test {notification_type} sent to contractor'
        })
        
    except Exception as e:
        return _json_error('Notification test failed', exc=e)

