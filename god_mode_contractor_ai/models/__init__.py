"""
God-Mode Contractor AI - Unified Database Models
"""

from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()


def _loads_json(value, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


class Job(db.Model):
    """Enhanced Job model with all features"""
    __tablename__ = 'jobs'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Basic Information
    title = db.Column(db.String(200), nullable=False)
    client_name = db.Column(db.String(100), nullable=False)
    client_phone = db.Column(db.String(20))
    client_email = db.Column(db.String(100))
    location = db.Column(db.String(200))
    
    # Job Classification
    job_type = db.Column(db.String(50))  # plumbing, electrical, garden, etc.
    job_subcategory = db.Column(db.String(50))
    complexity_score = db.Column(db.Integer, default=5)  # 1-10
    priority = db.Column(db.String(20), default='medium')  # emergency, high, medium, low
    
    # Scheduling
    status = db.Column(db.String(20), default='pending')  # pending, scheduled, in_progress, completed, cancelled
    scheduled_date = db.Column(db.DateTime)
    estimated_duration = db.Column(db.Float)  # hours
    actual_start_time = db.Column(db.DateTime)
    actual_end_time = db.Column(db.DateTime)
    
    # Assignment
    assigned_worker_id = db.Column(db.Integer, db.ForeignKey('workers.id'))
    
    # Requirements
    required_tools = db.Column(db.Text)  # JSON array
    materials_needed = db.Column(db.Text)  # JSON array
    required_skills = db.Column(db.Text)  # JSON array
    special_requirements = db.Column(db.Text)
    safety_considerations = db.Column(db.Text)  # JSON array
    
    # Financial
    estimated_cost = db.Column(db.Float)
    actual_cost = db.Column(db.Float)
    cost_breakdown = db.Column(db.Text)  # JSON object
    
    # AI & Analytics
    ai_confidence = db.Column(db.String(20))  # high, medium, low
    ai_reasoning = db.Column(db.Text)
    weather_dependent = db.Column(db.Boolean, default=False)
    
    # Multi-modal Data
    has_images = db.Column(db.Boolean, default=False)
    has_voice = db.Column(db.Boolean, default=False)
    has_documents = db.Column(db.Boolean, default=False)
    
    # Quality & Progress
    progress_percentage = db.Column(db.Integer, default=0)
    quality_checkpoints = db.Column(db.Text)  # JSON array
    quality_score = db.Column(db.Integer)  # 1-10
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    communications = db.relationship('Communication', backref='job', lazy=True, cascade='all, delete-orphan')
    ai_decisions = db.relationship('AIDecision', backref='job', lazy=True, cascade='all, delete-orphan')
    vision_analyses = db.relationship('VisionAnalysis', backref='job', lazy=True, cascade='all, delete-orphan')
    predictive_insights = db.relationship('PredictiveInsight', backref='job', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        progress = self.progress_percentage or 0
        return {
            'id': self.id,
            'title': self.title,
            'client': self.client_name,
            'client_name': self.client_name,
            'client_phone': self.client_phone,
            'client_email': self.client_email,
            'phone': self.client_phone,
            'email': self.client_email,
            'address': self.location,
            'location': self.location,
            'job_type': self.job_type,
            'jobType': self.job_type,
            'job_subcategory': self.job_subcategory,
            'complexity_score': self.complexity_score,
            'priority': self.priority,
            'status': self.status,
            'scheduled_date': self.scheduled_date.isoformat() if self.scheduled_date else None,
            'startDate': self.scheduled_date.date().isoformat() if self.scheduled_date else None,
            'estimated_duration': self.estimated_duration,
            'assigned_worker_id': self.assigned_worker_id,
            'required_tools': _loads_json(self.required_tools, []),
            'tools': _loads_json(self.required_tools, []),
            'materials_needed': _loads_json(self.materials_needed, []),
            'required_skills': _loads_json(self.required_skills, []),
            'special_requirements': self.special_requirements,
            'safety_considerations': _loads_json(self.safety_considerations, []),
            'estimated_cost': self.estimated_cost,
            'estimatedCost': self.estimated_cost,
            'actual_cost': self.actual_cost,
            'actualCost': self.actual_cost,
            'cost_breakdown': _loads_json(self.cost_breakdown, {}),
            'ai_confidence': self.ai_confidence,
            'ai_reasoning': self.ai_reasoning,
            'weather_dependent': self.weather_dependent,
            'progress_percentage': progress,
            'progress': progress,
            'quality_checkpoints': _loads_json(self.quality_checkpoints, []),
            'quality_score': self.quality_score,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class Worker(db.Model):
    """Worker/Contractor model"""
    __tablename__ = 'workers'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20))
    email = db.Column(db.String(100))
    
    # Skills & Capabilities
    skills = db.Column(db.Text)  # JSON array
    certifications = db.Column(db.Text)  # JSON array
    specializations = db.Column(db.Text)  # JSON array
    
    # Status & Availability
    status = db.Column(db.String(20), default='available')  # available, busy, off_duty
    current_job_id = db.Column(db.Integer)
    
    # Performance Metrics
    success_rate = db.Column(db.Float, default=95.0)  # percentage
    on_time_rate = db.Column(db.Float, default=95.0)  # percentage
    quality_rating = db.Column(db.Float, default=4.5)  # 1-5 stars
    total_jobs_completed = db.Column(db.Integer, default=0)
    
    # Experience
    years_experience = db.Column(db.Integer, default=0)
    job_history = db.Column(db.Text)  # JSON array of past jobs
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    jobs = db.relationship('Job', backref='assigned_worker', lazy=True)
    
    def to_dict(self):
        skills = _loads_json(self.skills, [])
        specializations = _loads_json(self.specializations, [])
        current_job = Job.query.get(self.current_job_id) if self.current_job_id else None
        return {
            'id': self.id,
            'name': self.name,
            'phone': self.phone,
            'email': self.email,
            'skills': skills,
            'certifications': _loads_json(self.certifications, []),
            'specializations': specializations,
            'specialties': specializations or skills,
            'status': self.status,
            'current_job_id': self.current_job_id,
            'currentJob': current_job.title if current_job else None,
            'current_location': current_job.location if current_job else None,
            'success_rate': self.success_rate,
            'successRate': self.success_rate,
            'on_time_rate': self.on_time_rate,
            'quality_rating': self.quality_rating,
            'average_rating': self.quality_rating,
            'rating': self.quality_rating,
            'total_jobs_completed': self.total_jobs_completed,
            'jobs_completed': self.total_jobs_completed,
            'completedJobs': self.total_jobs_completed,
            'years_experience': self.years_experience,
            'job_history': _loads_json(self.job_history, []),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class Tool(db.Model):
    """Tool/Equipment model"""
    __tablename__ = 'tools'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50))  # power_tools, hand_tools, equipment, etc.
    status = db.Column(db.String(20), default='available')  # available, in_use, maintenance
    
    # Assignment
    assigned_to_job_id = db.Column(db.Integer)
    assigned_to_worker_id = db.Column(db.Integer)
    
    # Maintenance
    last_maintenance = db.Column(db.DateTime)
    next_maintenance_due = db.Column(db.DateTime)
    condition = db.Column(db.String(20), default='good')  # excellent, good, fair, poor
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        assigned_job = Job.query.get(self.assigned_to_job_id) if self.assigned_to_job_id else None
        current_location = assigned_job.location if assigned_job else 'Warehouse'
        return {
            'id': self.id,
            'name': self.name,
            'category': self.category,
            'status': self.status,
            'assigned_to_job_id': self.assigned_to_job_id,
            'assigned_to_worker_id': self.assigned_to_worker_id,
            'current_location': current_location,
            'currentLocation': current_location,
            'last_maintenance': self.last_maintenance.isoformat() if self.last_maintenance else None,
            'next_maintenance_due': self.next_maintenance_due.isoformat() if self.next_maintenance_due else None,
            'return_date': self.next_maintenance_due.date().isoformat() if self.next_maintenance_due else None,
            'returnDate': self.next_maintenance_due.date().isoformat() if self.next_maintenance_due else None,
            'condition': self.condition,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Communication(db.Model):
    """Multi-modal communication tracking"""
    __tablename__ = 'communications'
    
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=False)
    
    # Communication Details
    sender_type = db.Column(db.String(20))  # client, worker, ai, system
    sender_name = db.Column(db.String(100))
    message = db.Column(db.Text)
    
    # Channel & Format
    platform = db.Column(db.String(20))  # whatsapp, email, sms, voice, in_app
    message_type = db.Column(db.String(20), default='text')  # text, image, voice, document
    
    # Multi-modal Data
    has_attachment = db.Column(db.Boolean, default=False)
    attachment_type = db.Column(db.String(20))  # image, voice, document, video
    attachment_url = db.Column(db.String(500))
    
    # Status
    sent = db.Column(db.Boolean, default=True)
    delivered = db.Column(db.Boolean, default=False)
    read = db.Column(db.Boolean, default=False)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'sender_type': self.sender_type,
            'sender_name': self.sender_name,
            'message': self.message,
            'platform': self.platform,
            'message_type': self.message_type,
            'has_attachment': self.has_attachment,
            'attachment_type': self.attachment_type,
            'attachment_url': self.attachment_url,
            'sent': self.sent,
            'delivered': self.delivered,
            'read': self.read,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class AIDecision(db.Model):
    """AI decision tracking and learning"""
    __tablename__ = 'ai_decisions'
    
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=False)
    
    # Decision Details
    decision_type = db.Column(db.String(50))  # job_analysis, worker_assignment, scheduling, communication
    decision_data = db.Column(db.Text)  # JSON object with decision details
    
    # AI Reasoning
    confidence_level = db.Column(db.String(20))  # high, medium, low
    reasoning = db.Column(db.Text)
    alternative_options = db.Column(db.Text)  # JSON array
    
    # Execution & Outcome
    executed = db.Column(db.Boolean, default=False)
    outcome = db.Column(db.String(20))  # success, failure, pending
    feedback = db.Column(db.Text)  # JSON object with feedback data
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'decision_type': self.decision_type,
            'decision_data': _loads_json(self.decision_data, {}),
            'confidence_level': self.confidence_level,
            'reasoning': self.reasoning,
            'executed': self.executed,
            'outcome': self.outcome,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class VisionAnalysis(db.Model):
    """Computer vision analysis results"""
    __tablename__ = 'vision_analyses'
    
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=False)
    
    # Image Data
    image_url = db.Column(db.String(500))
    image_type = db.Column(db.String(50))  # before, during, after, issue, completion
    
    # Analysis Results
    detected_objects = db.Column(db.Text)  # JSON array
    detected_issues = db.Column(db.Text)  # JSON array
    quality_assessment = db.Column(db.String(20))  # excellent, good, fair, poor
    progress_estimate = db.Column(db.Integer)  # 0-100 percentage
    
    # AI Insights
    recommendations = db.Column(db.Text)  # JSON array
    confidence = db.Column(db.Float)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'image_url': self.image_url,
            'image_type': self.image_type,
            'detected_objects': _loads_json(self.detected_objects, []),
            'detected_issues': _loads_json(self.detected_issues, []),
            'quality_assessment': self.quality_assessment,
            'progress_estimate': self.progress_estimate,
            'recommendations': _loads_json(self.recommendations, []),
            'confidence': self.confidence,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class PredictiveInsight(db.Model):
    """Predictive analytics insights"""
    __tablename__ = 'predictive_insights'
    
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=True)
    
    # Insight Details
    insight_type = db.Column(db.String(50))  # cost_prediction, delay_risk, demand_forecast, failure_prediction
    insight_data = db.Column(db.Text)  # JSON object
    
    # Predictions
    prediction = db.Column(db.Text)
    confidence = db.Column(db.Float)
    impact_level = db.Column(db.String(20))  # high, medium, low
    
    # Recommendations
    recommended_actions = db.Column(db.Text)  # JSON array
    
    # Validation
    actual_outcome = db.Column(db.Text)  # For learning
    accuracy_score = db.Column(db.Float)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'insight_type': self.insight_type,
            'insight_data': _loads_json(self.insight_data, {}),
            'prediction': self.prediction,
            'confidence': self.confidence,
            'impact_level': self.impact_level,
            'recommended_actions': _loads_json(self.recommended_actions, []),
            'actual_outcome': self.actual_outcome,
            'accuracy_score': self.accuracy_score,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class IoTSensorData(db.Model):
    """IoT sensor data tracking"""
    __tablename__ = 'iot_sensor_data'
    
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=True)
    
    # Sensor Details
    sensor_id = db.Column(db.String(100))
    sensor_type = db.Column(db.String(50))  # temperature, humidity, motion, vibration, etc.
    location = db.Column(db.String(200))
    
    # Readings
    reading_value = db.Column(db.Float)
    reading_unit = db.Column(db.String(20))
    reading_status = db.Column(db.String(20))  # normal, warning, critical
    
    # Context
    metadata_json = db.Column('metadata', db.Text)  # JSON object
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'sensor_id': self.sensor_id,
            'sensor_type': self.sensor_type,
            'location': self.location,
            'reading_value': self.reading_value,
            'reading_unit': self.reading_unit,
            'reading_status': self.reading_status,
            'metadata': _loads_json(self.metadata_json, {}),
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
