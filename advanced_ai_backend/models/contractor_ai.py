from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timedelta
import json
from enum import Enum

db = SQLAlchemy()

class JobStatus(Enum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    ON_HOLD = "on_hold"

class JobPriority(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
    EMERGENCY = "emergency"

class WorkerStatus(Enum):
    AVAILABLE = "available"
    ON_JOB = "on_job"
    TRAVELING = "traveling"
    BREAK = "break"
    OFFLINE = "offline"

class ToolStatus(Enum):
    AVAILABLE = "available"
    IN_USE = "in_use"
    MAINTENANCE = "maintenance"
    BROKEN = "broken"

class CommunicationType(Enum):
    SMS = "sms"
    EMAIL = "email"
    WHATSAPP = "whatsapp"
    PHONE = "phone"
    IN_PERSON = "in_person"

# Core Models
class Client(db.Model):
    __tablename__ = 'clients'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=True)
    phone = db.Column(db.String(20), nullable=True)
    whatsapp = db.Column(db.String(20), nullable=True)
    address = db.Column(db.Text, nullable=True)
    
    # Preferences and history
    preferred_communication = db.Column(db.Enum(CommunicationType), default=CommunicationType.WHATSAPP)
    language_preference = db.Column(db.String(10), default='nl')
    payment_terms = db.Column(db.Integer, default=30)  # days
    credit_limit = db.Column(db.Float, default=0.0)
    
    # AI insights
    satisfaction_score = db.Column(db.Float, default=5.0)
    lifetime_value = db.Column(db.Float, default=0.0)
    risk_score = db.Column(db.Float, default=0.0)
    preferred_workers = db.Column(db.Text)  # JSON array of worker IDs
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_contact = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    jobs = db.relationship('Job', backref='client', lazy=True)
    communications = db.relationship('Communication', backref='client', lazy=True)

class Worker(db.Model):
    __tablename__ = 'workers'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=True)
    phone = db.Column(db.String(20), nullable=False)
    whatsapp = db.Column(db.String(20), nullable=True)
    
    # Work details
    hourly_rate = db.Column(db.Float, nullable=False, default=20.0)
    status = db.Column(db.Enum(WorkerStatus), default=WorkerStatus.AVAILABLE)
    current_location = db.Column(db.String(200), nullable=True)
    
    # Skills and certifications
    skills = db.Column(db.Text)  # JSON array of skills
    certifications = db.Column(db.Text)  # JSON array of certifications
    specialties = db.Column(db.Text)  # JSON array of specialties
    
    # Performance metrics
    jobs_completed = db.Column(db.Integer, default=0)
    success_rate = db.Column(db.Float, default=100.0)
    average_rating = db.Column(db.Float, default=5.0)
    on_time_rate = db.Column(db.Float, default=100.0)
    
    # Availability
    availability_schedule = db.Column(db.Text)  # JSON schedule
    max_hours_per_day = db.Column(db.Integer, default=8)
    max_jobs_per_day = db.Column(db.Integer, default=3)
    
    # IoT and tracking
    gps_location = db.Column(db.String(100), nullable=True)
    last_gps_update = db.Column(db.DateTime, nullable=True)
    device_id = db.Column(db.String(100), nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_active = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    jobs = db.relationship('Job', backref='assigned_worker', lazy=True)
    time_logs = db.relationship('TimeLog', backref='worker', lazy=True)

class Tool(db.Model):
    __tablename__ = 'tools'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    status = db.Column(db.Enum(ToolStatus), default=ToolStatus.AVAILABLE)
    
    # Location and tracking
    current_location = db.Column(db.String(200), nullable=True)
    gps_location = db.Column(db.String(100), nullable=True)
    iot_device_id = db.Column(db.String(100), nullable=True)
    
    # Maintenance
    last_maintenance = db.Column(db.DateTime, nullable=True)
    next_maintenance = db.Column(db.DateTime, nullable=True)
    maintenance_interval_days = db.Column(db.Integer, default=90)
    
    # Usage tracking
    total_usage_hours = db.Column(db.Float, default=0.0)
    usage_cost_per_hour = db.Column(db.Float, default=2.5)
    
    # Availability
    available_from = db.Column(db.DateTime, nullable=True)
    reserved_until = db.Column(db.DateTime, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_used = db.Column(db.DateTime, nullable=True)

class Job(db.Model):
    __tablename__ = 'jobs'
    
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    job_type = db.Column(db.String(50), nullable=False)
    
    # Client and location
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), nullable=False)
    location = db.Column(db.Text, nullable=False)
    gps_coordinates = db.Column(db.String(100), nullable=True)
    
    # Status and priority
    status = db.Column(db.Enum(JobStatus), default=JobStatus.PENDING)
    priority = db.Column(db.Enum(JobPriority), default=JobPriority.MEDIUM)
    
    # Worker assignment
    worker_id = db.Column(db.Integer, db.ForeignKey('workers.id'), nullable=True)
    
    # Scheduling
    scheduled_start = db.Column(db.DateTime, nullable=True)
    scheduled_end = db.Column(db.DateTime, nullable=True)
    actual_start = db.Column(db.DateTime, nullable=True)
    actual_end = db.Column(db.DateTime, nullable=True)
    
    # Financial
    estimated_cost = db.Column(db.Float, nullable=True)
    actual_cost = db.Column(db.Float, nullable=True)
    hourly_rate = db.Column(db.Float, default=20.0)
    equipment_rate = db.Column(db.Float, default=2.5)
    material_cost = db.Column(db.Float, default=0.0)
    
    # Requirements
    required_skills = db.Column(db.Text)  # JSON array
    required_tools = db.Column(db.Text)  # JSON array
    estimated_duration_hours = db.Column(db.Float, nullable=True)
    
    # AI analysis
    complexity_score = db.Column(db.Float, default=1.0)
    ai_confidence = db.Column(db.String(20), default='medium')
    ai_reasoning = db.Column(db.Text, nullable=True)
    risk_factors = db.Column(db.Text)  # JSON array
    
    # Progress tracking
    progress_percentage = db.Column(db.Float, default=0.0)
    milestones = db.Column(db.Text)  # JSON array
    
    # Quality and feedback
    client_rating = db.Column(db.Float, nullable=True)
    client_feedback = db.Column(db.Text, nullable=True)
    
    # Weather dependency
    weather_dependent = db.Column(db.Boolean, default=False)
    weather_conditions_required = db.Column(db.Text, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    communications = db.relationship('Communication', backref='job', lazy=True)
    time_logs = db.relationship('TimeLog', backref='job', lazy=True)
    media_files = db.relationship('MediaFile', backref='job', lazy=True)

class Communication(db.Model):
    __tablename__ = 'communications'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Participants
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), nullable=True)
    worker_id = db.Column(db.Integer, db.ForeignKey('workers.id'), nullable=True)
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=True)
    
    # Communication details
    type = db.Column(db.Enum(CommunicationType), nullable=False)
    direction = db.Column(db.String(10), nullable=False)  # 'inbound' or 'outbound'
    subject = db.Column(db.String(200), nullable=True)
    content = db.Column(db.Text, nullable=False)
    
    # AI processing
    sentiment_score = db.Column(db.Float, nullable=True)
    intent_classification = db.Column(db.String(50), nullable=True)
    ai_response_generated = db.Column(db.Boolean, default=False)
    
    # Status
    status = db.Column(db.String(20), default='pending')  # pending, processed, responded
    read_at = db.Column(db.DateTime, nullable=True)
    responded_at = db.Column(db.DateTime, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Relationships
    media_files = db.relationship('MediaFile', backref='communication', lazy=True)

class TimeLog(db.Model):
    __tablename__ = 'time_logs'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # References
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=False)
    worker_id = db.Column(db.Integer, db.ForeignKey('workers.id'), nullable=False)
    
    # Time tracking
    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime, nullable=True)
    break_start = db.Column(db.DateTime, nullable=True)
    break_end = db.Column(db.DateTime, nullable=True)
    
    # Calculated fields
    total_hours = db.Column(db.Float, nullable=True)
    break_hours = db.Column(db.Float, default=0.0)
    billable_hours = db.Column(db.Float, nullable=True)
    
    # Equipment usage
    equipment_used = db.Column(db.Boolean, default=False)
    equipment_hours = db.Column(db.Float, default=0.0)
    
    # Location tracking
    start_location = db.Column(db.String(200), nullable=True)
    end_location = db.Column(db.String(200), nullable=True)
    
    # Notes and status
    notes = db.Column(db.Text, nullable=True)
    approved = db.Column(db.Boolean, default=False)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class MediaFile(db.Model):
    __tablename__ = 'media_files'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # References
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=True)
    communication_id = db.Column(db.Integer, db.ForeignKey('communications.id'), nullable=True)
    worker_id = db.Column(db.Integer, db.ForeignKey('workers.id'), nullable=True)
    
    # File details
    filename = db.Column(db.String(255), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    file_type = db.Column(db.String(50), nullable=False)  # image, video, audio, document
    file_size = db.Column(db.Integer, nullable=True)
    mime_type = db.Column(db.String(100), nullable=True)
    
    # AI analysis
    ai_analysis = db.Column(db.Text, nullable=True)  # JSON with AI insights
    objects_detected = db.Column(db.Text, nullable=True)  # JSON array
    text_extracted = db.Column(db.Text, nullable=True)
    quality_score = db.Column(db.Float, nullable=True)
    
    # Metadata
    taken_at = db.Column(db.DateTime, nullable=True)
    gps_location = db.Column(db.String(100), nullable=True)
    device_info = db.Column(db.String(200), nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class AIInsight(db.Model):
    __tablename__ = 'ai_insights'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Insight details
    type = db.Column(db.String(50), nullable=False)  # prediction, recommendation, alert, etc.
    category = db.Column(db.String(50), nullable=False)  # scheduling, pricing, quality, etc.
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=False)
    
    # Confidence and impact
    confidence_score = db.Column(db.Float, nullable=False)
    impact_score = db.Column(db.Float, nullable=False)
    priority = db.Column(db.Enum(JobPriority), default=JobPriority.MEDIUM)
    
    # References
    job_id = db.Column(db.Integer, db.ForeignKey('jobs.id'), nullable=True)
    client_id = db.Column(db.Integer, db.ForeignKey('clients.id'), nullable=True)
    worker_id = db.Column(db.Integer, db.ForeignKey('workers.id'), nullable=True)
    
    # Action and status
    recommended_action = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default='active')  # active, implemented, dismissed
    implemented_at = db.Column(db.DateTime, nullable=True)
    
    # Data and context
    supporting_data = db.Column(db.Text, nullable=True)  # JSON
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=True)

class BusinessMetric(db.Model):
    __tablename__ = 'business_metrics'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Metric details
    metric_name = db.Column(db.String(100), nullable=False)
    metric_value = db.Column(db.Float, nullable=False)
    metric_unit = db.Column(db.String(20), nullable=True)
    
    # Time period
    period_type = db.Column(db.String(20), nullable=False)  # daily, weekly, monthly, yearly
    period_start = db.Column(db.DateTime, nullable=False)
    period_end = db.Column(db.DateTime, nullable=False)
    
    # Context
    category = db.Column(db.String(50), nullable=False)  # revenue, efficiency, quality, etc.
    subcategory = db.Column(db.String(50), nullable=True)
    
    # Comparison
    previous_value = db.Column(db.Float, nullable=True)
    target_value = db.Column(db.Float, nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

# Helper functions for JSON fields
def get_json_field(obj, field_name, default=None):
    """Safely get and parse JSON field"""
    try:
        value = getattr(obj, field_name)
        if value:
            return json.loads(value)
        return default or []
    except (json.JSONDecodeError, AttributeError):
        return default or []

def set_json_field(obj, field_name, value):
    """Safely set JSON field"""
    if value is not None:
        setattr(obj, field_name, json.dumps(value))
    else:
        setattr(obj, field_name, None)

