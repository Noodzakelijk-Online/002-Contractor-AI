"""
God-Mode Contractor AI - Unified Database Models
"""

from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()


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
        return {
            'id': self.id,
            'title': self.title,
            'client_name': self.client_name,
            'client_phone': self.client_phone,
            'client_email': self.client_email,
            'location': self.location,
            'job_type': self.job_type,
            'job_subcategory': self.job_subcategory,
            'complexity_score': self.complexity_score,
            'priority': self.priority,
            'status': self.status,
            'scheduled_date': self.scheduled_date.isoformat() if self.scheduled_date else None,
            'estimated_duration': self.estimated_duration,
            'assigned_worker_id': self.assigned_worker_id,
            'required_tools': json.loads(self.required_tools) if self.required_tools else [],
            'materials_needed': json.loads(self.materials_needed) if self.materials_needed else [],
            'required_skills': json.loads(self.required_skills) if self.required_skills else [],
            'special_requirements': self.special_requirements,
            'estimated_cost': self.estimated_cost,
            'actual_cost': self.actual_cost,
            'cost_breakdown': json.loads(self.cost_breakdown) if self.cost_breakdown else {},
            'ai_confidence': self.ai_confidence,
            'ai_reasoning': self.ai_reasoning,
            'weather_dependent': self.weather_dependent,
            'progress_percentage': self.progress_percentage,
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
        return {
            'id': self.id,
            'name': self.name,
            'phone': self.phone,
            'email': self.email,
            'skills': json.loads(self.skills) if self.skills else [],
            'certifications': json.loads(self.certifications) if self.certifications else [],
            'status': self.status,
            'success_rate': self.success_rate,
            'on_time_rate': self.on_time_rate,
            'quality_rating': self.quality_rating,
            'total_jobs_completed': self.total_jobs_completed,
            'years_experience': self.years_experience,
            'job_history': json.loads(self.job_history) if self.job_history else []
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
        return {
            'id': self.id,
            'name': self.name,
            'category': self.category,
            'status': self.status,
            'assigned_to_job_id': self.assigned_to_job_id,
            'condition': self.condition
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
            'decision_data': json.loads(self.decision_data) if self.decision_data else {},
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
            'image_type': self.image_type,
            'detected_objects': json.loads(self.detected_objects) if self.detected_objects else [],
            'detected_issues': json.loads(self.detected_issues) if self.detected_issues else [],
            'quality_assessment': self.quality_assessment,
            'progress_estimate': self.progress_estimate,
            'recommendations': json.loads(self.recommendations) if self.recommendations else [],
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
            'insight_data': json.loads(self.insight_data) if self.insight_data else {},
            'prediction': self.prediction,
            'confidence': self.confidence,
            'impact_level': self.impact_level,
            'recommended_actions': json.loads(self.recommended_actions) if self.recommended_actions else [],
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
    metadata = db.Column(db.Text)  # JSON object
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'job_id': self.job_id,
            'sensor_type': self.sensor_type,
            'location': self.location,
            'reading_value': self.reading_value,
            'reading_unit': self.reading_unit,
            'reading_status': self.reading_status,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
