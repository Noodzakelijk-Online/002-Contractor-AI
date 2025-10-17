from flask import Blueprint, request, jsonify
from models.job import db, Job, Worker, Tool, Communication, AIDecision
from ai_engine import ContractorAI
import json
from datetime import datetime, timedelta

contractor_ai_bp = Blueprint('contractor_ai', __name__)
ai_engine = ContractorAI()

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
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/job/<int:job_id>', methods=['GET'])
def get_job_details(job_id):
    """Get detailed job information"""
    try:
        job = Job.query.get_or_404(job_id)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        communications = Communication.query.filter_by(job_id=job_id).order_by(Communication.created_at.desc()).all()
        ai_decisions = AIDecision.query.filter_by(job_id=job_id).order_by(AIDecision.created_at.desc()).all()
        
        # Get required tools for this job
        required_tool_names = json.loads(job.required_tools) if job.required_tools else []
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
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/job/new', methods=['POST'])
def create_new_job():
    """Create a new job from client request"""
    try:
        data = request.get_json()
        
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
            'analysis': analysis,
            'message': 'Job created successfully and client notified'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/job/<int:job_id>/assign_worker', methods=['POST'])
def assign_worker_to_job(job_id):
    """AI-powered worker assignment"""
    try:
        job = Job.query.get_or_404(job_id)
        
        # Get available workers
        available_workers = Worker.query.filter_by(status='available').all()
        worker_data = [worker.to_dict() for worker in available_workers]
        
        # Get job requirements
        job_requirements = {
            'required_skills': json.loads(job.required_tools) if job.required_tools else [],
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
            'reasoning': reasoning
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
                'message': 'Job scheduled and client notified'
            })
        else:
            return jsonify({'error': 'No suitable time slots available'}), 400
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/job/<int:job_id>/execute_ai_plan', methods=['POST'])
def execute_ai_plan(job_id):
    """Execute the complete AI plan for a job"""
    try:
        job = Job.query.get_or_404(job_id)
        
        results = []
        
        # Step 1: Assign worker if not already assigned
        if not job.assigned_worker_id:
            assign_result = assign_worker_to_job(job_id)
            if assign_result[1] != 200:  # If error
                return assign_result
            results.append("Worker assigned")
        
        # Step 2: Schedule job if not already scheduled
        if not job.scheduled_start:
            schedule_result = schedule_job(job_id)
            if schedule_result[1] != 200:  # If error
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
            'message': 'AI plan executed successfully'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/job/<int:job_id>/start', methods=['POST'])
def start_job(job_id):
    """Start job execution"""
    try:
        job = Job.query.get_or_404(job_id)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        
        job.status = 'in_progress'
        job.actual_start = datetime.utcnow()
        
        # Update worker status
        if worker:
            worker.status = 'busy'
        
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
        
        return jsonify({'success': True, 'message': 'Job started successfully'})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/job/<int:job_id>/complete', methods=['POST'])
def complete_job(job_id):
    """Complete job execution"""
    try:
        job = Job.query.get_or_404(job_id)
        worker = Worker.query.get(job.assigned_worker_id) if job.assigned_worker_id else None
        
        data = request.get_json()
        
        job.status = 'completed'
        job.actual_end = datetime.utcnow()
        job.progress_percentage = 100
        job.actual_cost = data.get('actual_cost', job.estimated_cost)
        
        # Calculate actual duration
        if job.actual_start:
            duration = job.actual_end - job.actual_start
            job.actual_duration = duration.total_seconds() / 3600  # Convert to hours
        
        # Update worker status and stats
        if worker:
            worker.status = 'available'
            worker.jobs_completed += 1
        
        db.session.commit()
        
        # Send completion notification
        client_message = ai_engine.generate_client_communication(
            job.to_dict(), worker.to_dict() if worker else {}, {}, 'job_completed'
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
            f"Job Completed: {job.title}",
            f"✅ {job.title} has been completed successfully!\n\n"
            f"Worker: {worker.name if worker else 'Unknown'}\n"
            f"Duration: {job.actual_duration:.1f} hours\n"
            f"Cost: €{job.actual_cost}\n"
            f"Client has been notified and invoiced."
        )
        
        return jsonify({'success': True, 'message': 'Job completed successfully'})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/simulate_client_request', methods=['POST'])
def simulate_client_request():
    """Simulate a client request for testing"""
    try:
        data = request.get_json()
        
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
        
        # Create the job using the existing endpoint
        create_response = create_new_job()
        
        if create_response[1] == 200:  # Success
            return jsonify({
                'success': True,
                'scenario': scenario,
                'message': f'Simulated {scenario_type} request created successfully'
            })
        else:
            return create_response
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@contractor_ai_bp.route('/test_notifications', methods=['POST'])
def test_notifications():
    """Test email and SMS notifications"""
    try:
        data = request.get_json()
        notification_type = data.get('type', 'email')
        
        if notification_type == 'email':
            success = ai_engine.send_email_notification(
                ai_engine.contractor_email,
                "🧪 Test Email from Contractor AI",
                "This is a test email to verify the notification system is working correctly.\n\n"
                "If you receive this, the email integration is functioning properly!\n\n"
                f"Sent at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
            )
        elif notification_type == 'sms':
            success = ai_engine.send_sms_notification(
                ai_engine.contractor_phone,
                f"🧪 Test SMS from Contractor AI - System working! {datetime.now().strftime('%H:%M')}"
            )
        else:
            return jsonify({'error': 'Invalid notification type'}), 400
        
        return jsonify({
            'success': success,
            'message': f'Test {notification_type} sent to contractor'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

