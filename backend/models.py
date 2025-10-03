from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.types import JSON
import datetime

db = SQLAlchemy()

class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey('client.id'), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(50), nullable=False, default='Pending')
    estimated_cost = db.Column(db.Float, nullable=True)
    actual_cost = db.Column(db.Float, nullable=True)
    start_date = db.Column(db.DateTime, nullable=True)
    end_date = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    workers = db.relationship('Worker', secondary='job_worker_association', back_populates='jobs')

class Worker(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone_number = db.Column(db.String(20), nullable=True)
    email = db.Column(db.String(100), nullable=True)
    skills = db.Column(JSON, nullable=True) # e.g., {'plumbing': 5, 'electrical': 3}
    availability = db.Column(JSON, nullable=True) # e.g., {'monday': [9, 17], 'tuesday': [9, 17]}
    status = db.Column(db.String(50), nullable=False, default='Available')

    jobs = db.relationship('Job', secondary='job_worker_association', back_populates='workers')

class Client(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    phone_number = db.Column(db.String(20), nullable=True)
    email = db.Column(db.String(100), nullable=True)
    address = db.Column(db.String(255), nullable=True)

    jobs = db.relationship('Job', backref='client', lazy=True)

job_worker_association = db.Table('job_worker_association',
    db.Column('job_id', db.Integer, db.ForeignKey('job.id'), primary_key=True),
    db.Column('worker_id', db.Integer, db.ForeignKey('worker.id'), primary_key=True)
)