from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()

class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    client_name = db.Column(db.String(100), nullable=False)
    client_phone = db.Column(db.String(20), nullable=False)
    client_email = db.Column(db.String(100), nullable=True)
    location = db.Column(db.String(200), nullable=False)
    job_type = db.Column(db.String(50), nullable=False)
    complexity_score = db.Column(db.Integer, default=5)  # 1-10 scale
    status = db.Column(db.String(50), default='pending')  # pending, scheduled, in_progress, completed, cancelled
    priority = db.Column(db.String(20), default='medium')  # low, medium, high, critical
    
    # Financial information
    estimated_cost = db.Column(db.Float, default=0.0)
    actual_cost = db.Column(db.Float, default=0.0)
    hourly_rate = db.Column(db.Float, default=20.0)
    equipment_rate = db.Column(db.Float, default=2.50)
    profit_margin = db.Column(db.Float, default=0.0)
    
    # Scheduling
    scheduled_start = db.Column(db.DateTime, nullable=True)
    scheduled_end = db.Column(db.DateTime, nullable=True)
    actual_start = db.Column(db.DateTime, nullable=True)
    actual_end = db.Column(db.DateTime, nullable=True)
    buffer_time = db.Column(db.Integer, default=30)  # minutes
    
    # Worker assignment
    assigned_worker_id = db.Column(db.Integer, db.ForeignKey('worker.id'), nullable=True)
    
    # Requirements and details
    required_tools = db.Column(db.Text, nullable=True)  # JSON string
    materials_needed = db.Column(db.Text, nullable=True)  # JSON string
    special_requirements = db.Column(db.Text, nullable=True)
    weather_dependent = db.Column(db.Boolean, default=False)
    
    # Progress tracking
    progress_percentage = db.Column(db.Integer, default=0)
    tasks_completed = db.Column(db.Text, nullable=True)  # JSON string
    photos = db.Column(db.Text, nullable=True)  # JSON string of photo URLs
    
    # AI decision tracking
    ai_confidence = db.Column(db.String(20), default='medium')  # low, medium, high
    ai_reasoning = db.Column(db.Text, nullable=True)
    ai_risks = db.Column(db.Text, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Job {self.title}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'title': self.title,
            'client_name': self.client_name,
            'client_phone': self.client_phone,
            'client_email': self.client_email,
            'location': self.location,
            'job_type': self.job_type,
            'complexity_score': self.complexity_score,
            'status': self.status,
            'priority': self.priority,
            'estimated_cost': self.estimated_cost,
            'actual_cost': self.actual_cost,
            'hourly_rate': self.hourly_rate,
            'equipment_rate': self.equipment_rate,
            'profit_margin': self.profit_margin,
            'scheduled_start': self.scheduled_start.isoformat() if self.scheduled_start else None,
            'scheduled_end': self.scheduled_end.isoformat() if self.scheduled_end else None,
            'actual_start': self.actual_start.isoformat() if self.actual_start else None,
            'actual_end': self.actual_end.isoformat() if self.actual_end else None,
            'buffer_time': self.buffer_time,
            'assigned_worker_id': self.assigned_worker_id,
            'required_tools': json.loads(self.required_tools) if self.required_tools else [],
            'materials_needed': json.loads(self.materials_needed) if self.materials_needed else [],
            'special_requirements': self.special_requirements,
            'weather_dependent': self.weather_dependent,
            'progress_percentage': self.progress_percentage,
            'tasks_completed': json.loads(self.tasks_completed) if self.tasks_completed else [],
            'photos': json.loads(self.photos) if self.photos else [],
            'ai_confidence': self.ai_confidence,
            'ai_reasoning': self.ai_reasoning,
            'ai_risks': self.ai_risks,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

class Worker(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    email = db.Column(db.String(100), nullable=True)
    skills = db.Column(db.Text, nullable=True)  # JSON string
    certifications = db.Column(db.Text, nullable=True)  # JSON string
    hourly_rate = db.Column(db.Float, default=20.0)
    success_rate = db.Column(db.Float, default=95.0)  # percentage
    availability = db.Column(db.Text, nullable=True)  # JSON string
    current_location = db.Column(db.String(200), nullable=True)
    status = db.Column(db.String(20), default='available')  # available, busy, traveling, off_duty
    
    # Performance metrics
    jobs_completed = db.Column(db.Integer, default=0)
    average_rating = db.Column(db.Float, default=5.0)
    on_time_rate = db.Column(db.Float, default=95.0)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    jobs = db.relationship('Job', backref='worker', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'phone': self.phone,
            'email': self.email,
            'skills': json.loads(self.skills) if self.skills else [],
            'certifications': json.loads(self.certifications) if self.certifications else [],
            'hourly_rate': self.hourly_rate,
            'success_rate': self.success_rate,
            'availability': json.loads(self.availability) if self.availability else {},
            'current_location': self.current_location,
            'status': self.status,
            'jobs_completed': self.jobs_completed,
            'average_rating': self.average_rating,
            'on_time_rate': self.on_time_rate,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

class Tool(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    status = db.Column(db.String(20), default='available')  # available, in_use, maintenance, broken
    current_location = db.Column(db.String(200), nullable=True)
    assigned_to_job_id = db.Column(db.Integer, nullable=True)
    assigned_to_worker_id = db.Column(db.Integer, nullable=True)
    return_date = db.Column(db.DateTime, nullable=True)
    maintenance_due = db.Column(db.DateTime, nullable=True)
    purchase_date = db.Column(db.DateTime, nullable=True)
    cost = db.Column(db.Float, default=0.0)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'category': self.category,
            'status': self.status,
            'current_location': self.current_location,
            'assigned_to_job_id': self.assigned_to_job_id,
            'assigned_to_worker_id': self.assigned_to_worker_id,
            'return_date': self.return_date.isoformat() if self.return_date else None,
            'maintenance_due': self.maintenance_due.isoformat() if self.maintenance_due else None,
            'purchase_date': self.purchase_date.isoformat() if self.purchase_date else None,
            'cost': self.cost,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }

class Communication(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('job.id'), nullable=False)
    sender_type = db.Column(db.String(20), nullable=False)  # client, worker, ai, contractor
    sender_name = db.Column(db.String(100), nullable=False)
    message = db.Column(db.Text, nullable=False)
    message_type = db.Column(db.String(20), default='text')  # text, image, voice, system
    platform = db.Column(db.String(20), default='whatsapp')  # whatsapp, sms, email, system
    status = db.Column(db.String(20), default='sent')  # sent, delivered, read, failed
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'sender_type': self.sender_type,
            'sender_name': self.sender_name,
            'message': self.message,
            'message_type': self.message_type,
            'platform': self.platform,
            'status': self.status,
            'created_at': self.created_at.isoformat()
        }

class AIDecision(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('job.id'), nullable=False)
    decision_type = db.Column(db.String(50), nullable=False)  # worker_assignment, scheduling, pricing, etc.
    decision_data = db.Column(db.Text, nullable=False)  # JSON string
    confidence_level = db.Column(db.String(20), nullable=False)  # low, medium, high
    reasoning = db.Column(db.Text, nullable=False)
    risks = db.Column(db.Text, nullable=True)
    executed = db.Column(db.Boolean, default=False)
    execution_result = db.Column(db.Text, nullable=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'decision_type': self.decision_type,
            'decision_data': json.loads(self.decision_data) if self.decision_data else {},
            'confidence_level': self.confidence_level,
            'reasoning': self.reasoning,
            'risks': self.risks,
            'executed': self.executed,
            'execution_result': self.execution_result,
            'created_at': self.created_at.isoformat()
        }

