from models.job import db, Job, Worker, Tool, Communication, AIDecision
from datetime import datetime, timedelta
import json

def initialize_demo_data(app=None):
    """Initialize the database with demo data"""
    
    if app is None:
        from main import app
    
    with app.app_context():
        # Clear existing data
        db.drop_all()
        db.create_all()
    
    # Create workers
    workers = [
        Worker(
            name="Anna Kowalski",
            phone="+31 06-11111111",
            email="anna.kowalski@contractor.com",
            skills=json.dumps(["bathroom_renovation", "tiling", "plumbing", "waterproofing"]),
            certifications=json.dumps(["Plumbing Certificate", "Tile Installation"]),
            hourly_rate=22.0,
            success_rate=95.0,
            availability=json.dumps({"monday": "9-17", "tuesday": "9-17", "wednesday": "9-17", "thursday": "9-17", "friday": "9-17"}),
            current_location="Amsterdam",
            status="available",
            jobs_completed=47,
            average_rating=4.8,
            on_time_rate=96.0
        ),
        Worker(
            name="Marco Silva",
            phone="+31 06-22222222",
            email="marco.silva@contractor.com",
            skills=json.dumps(["gutter_cleaning", "roof_work", "exterior_maintenance", "safety_certified"]),
            certifications=json.dumps(["Height Safety Certificate", "Ladder Safety"]),
            hourly_rate=20.0,
            success_rate=92.0,
            availability=json.dumps({"monday": "8-16", "tuesday": "8-16", "wednesday": "8-16", "thursday": "8-16", "friday": "8-16"}),
            current_location="Utrecht",
            status="available",
            jobs_completed=63,
            average_rating=4.6,
            on_time_rate=94.0
        ),
        Worker(
            name="Sophie Jansen",
            phone="+31 06-33333333",
            email="sophie.jansen@contractor.com",
            skills=json.dumps(["garden_maintenance", "lawn_care", "hedge_trimming", "landscaping"]),
            certifications=json.dumps(["Landscaping Certificate", "Pesticide License"]),
            hourly_rate=18.0,
            success_rate=98.0,
            availability=json.dumps({"monday": "7-15", "tuesday": "7-15", "wednesday": "7-15", "thursday": "7-15", "friday": "7-15", "saturday": "8-12"}),
            current_location="Rotterdam",
            status="busy",
            jobs_completed=89,
            average_rating=4.9,
            on_time_rate=98.0
        )
    ]
    
    for worker in workers:
        db.session.add(worker)
    
    # Create tools
    tools = [
        Tool(name="Tile saw", category="power_tools", status="in_use", current_location="Amsterdam", 
             assigned_to_worker_id=1, return_date=datetime.now() + timedelta(days=2), cost=450.0),
        Tool(name="Plumbing tools", category="hand_tools", status="available", current_location="Warehouse", cost=200.0),
        Tool(name="Ladder (tall)", category="safety_equipment", status="available", current_location="Utrecht", cost=180.0),
        Tool(name="Pressure washer", category="cleaning_equipment", status="available", current_location="Utrecht", cost=320.0),
        Tool(name="Gutter tools", category="specialized_tools", status="available", current_location="Utrecht", cost=150.0),
        Tool(name="Safety harness", category="safety_equipment", status="available", current_location="Warehouse", cost=80.0),
        Tool(name="Lawn mower", category="garden_equipment", status="in_use", current_location="Rotterdam", 
             assigned_to_worker_id=3, return_date=datetime.now() + timedelta(hours=4), cost=380.0),
        Tool(name="Hedge trimmer", category="garden_equipment", status="available", current_location="Warehouse", cost=120.0)
    ]
    
    for tool in tools:
        db.session.add(tool)
    
    # Create jobs
    jobs = [
        Job(
            title="Bathroom Renovation - Phase 1",
            client_name="Jan Bakker",
            client_phone="+31 06-12345678",
            client_email="jan.bakker@email.com",
            location="Hoofdstraat 123, Amsterdam",
            job_type="bathroom_renovation",
            complexity_score=8,
            status="scheduled",
            priority="high",
            estimated_cost=1512.0,
            actual_cost=0.0,
            hourly_rate=22.0,
            equipment_rate=2.50,
            scheduled_start=datetime.now() + timedelta(days=1, hours=9),
            scheduled_end=datetime.now() + timedelta(days=1, hours=17),
            assigned_worker_id=1,
            required_tools=json.dumps(["Tile saw", "Plumbing tools", "Safety equipment"]),
            materials_needed=json.dumps(["Tiles", "Grout", "Waterproof membrane", "Plumbing fittings"]),
            special_requirements="Client has elderly parent - please work quietly",
            weather_dependent=False,
            progress_percentage=15,
            tasks_completed=json.dumps(["Initial assessment", "Material ordering"]),
            ai_confidence="high",
            ai_reasoning="Bathroom specialist Anna assigned based on 95% success rate and tile saw availability",
            created_at=datetime.now() - timedelta(days=2),
            updated_at=datetime.now() - timedelta(hours=2)
        ),
        Job(
            title="Gutter Cleaning & Inspection",
            client_name="Maria van der Berg",
            client_phone="+31 06-87654321",
            client_email="maria.vdberg@email.com",
            location="Parkstraat 45, Utrecht",
            job_type="gutter_maintenance",
            complexity_score=4,
            status="pending",
            priority="medium",
            estimated_cost=90.0,
            hourly_rate=20.0,
            equipment_rate=2.50,
            assigned_worker_id=None,
            required_tools=json.dumps(["Ladder (tall)", "Pressure washer", "Gutter tools", "Safety harness"]),
            materials_needed=json.dumps(["Gutter sealant", "Cleaning supplies"]),
            weather_dependent=True,
            progress_percentage=0,
            ai_confidence="medium",
            ai_reasoning="Weather-dependent outdoor work, requires height safety certification",
            created_at=datetime.now() - timedelta(hours=6),
            updated_at=datetime.now() - timedelta(hours=6)
        ),
        Job(
            title="Weekly Lawn Maintenance",
            client_name="Familie Hendriks",
            client_phone="+31 06-55566677",
            client_email="hendriks.family@email.com",
            location="Tuinlaan 89, Rotterdam",
            job_type="garden_maintenance",
            complexity_score=3,
            status="in_progress",
            priority="low",
            estimated_cost=75.0,
            actual_cost=75.0,
            hourly_rate=18.0,
            equipment_rate=2.50,
            scheduled_start=datetime.now() - timedelta(hours=2),
            scheduled_end=datetime.now() + timedelta(hours=2),
            actual_start=datetime.now() - timedelta(hours=2),
            assigned_worker_id=3,
            required_tools=json.dumps(["Lawn mower", "Hedge trimmer", "Garden tools"]),
            weather_dependent=True,
            progress_percentage=60,
            tasks_completed=json.dumps(["Lawn mowing", "Edge trimming"]),
            ai_confidence="high",
            ai_reasoning="Regular maintenance job assigned to garden specialist Sophie",
            created_at=datetime.now() - timedelta(days=7),
            updated_at=datetime.now() - timedelta(minutes=30)
        )
    ]
    
    for job in jobs:
        db.session.add(job)
    
    db.session.flush()  # Flush to get job IDs
    
    # Create communications
    communications = [
        # Bathroom job communications
        Communication(
            job_id=1,
            sender_type="client",
            sender_name="Jan Bakker",
            message="Hi, I need my bathroom renovated. The tiles are old and the shower is leaking. Can you help?",
            platform="whatsapp",
            created_at=datetime.now() - timedelta(days=2)
        ),
        Communication(
            job_id=1,
            sender_type="ai",
            sender_name="Manus AI",
            message="Hi Jan! I've received your bathroom renovation request. Analyzing requirements and finding the best specialist for you.",
            platform="whatsapp",
            created_at=datetime.now() - timedelta(days=2, hours=-1)
        ),
        Communication(
            job_id=1,
            sender_type="ai",
            sender_name="Manus AI",
            message="Great news! Anna Kowalski has been assigned to your job. She's a bathroom specialist with 95% success rate. Scheduled for tomorrow at 9:00 AM.",
            platform="whatsapp",
            created_at=datetime.now() - timedelta(days=1)
        ),
        
        # Gutter job communications
        Communication(
            job_id=2,
            sender_type="client",
            sender_name="Maria van der Berg",
            message="My gutters are clogged and overflowing. Need cleaning and inspection.",
            platform="whatsapp",
            created_at=datetime.now() - timedelta(hours=6)
        ),
        Communication(
            job_id=2,
            sender_type="ai",
            sender_name="Manus AI",
            message="Hi Maria! I've received your gutter cleaning request. Analyzing weather conditions and worker availability.",
            platform="whatsapp",
            created_at=datetime.now() - timedelta(hours=5, minutes=30)
        ),
        
        # Garden job communications
        Communication(
            job_id=3,
            sender_type="worker",
            sender_name="Sophie Jansen",
            message="Started the lawn maintenance. Weather is perfect today!",
            platform="whatsapp",
            created_at=datetime.now() - timedelta(hours=2)
        ),
        Communication(
            job_id=3,
            sender_type="ai",
            sender_name="Manus AI",
            message="Thanks Sophie! Client has been notified that work has started.",
            platform="whatsapp",
            created_at=datetime.now() - timedelta(hours=1, minutes=45)
        )
    ]
    
    for comm in communications:
        db.session.add(comm)
    
    # Create AI decisions
    ai_decisions = [
        AIDecision(
            job_id=1,
            decision_type="worker_assignment",
            decision_data=json.dumps({
                "selected_worker": "Anna Kowalski",
                "reasoning": ["Bathroom specialist (95% success rate)", "Tile saw available", "Perfect weather conditions for indoor work"]
            }),
            confidence_level="high",
            reasoning="Anna is the best match for bathroom renovation with required tools available",
            executed=True,
            execution_result="Worker successfully assigned and scheduled"
        ),
        AIDecision(
            job_id=2,
            decision_type="scheduling_analysis",
            decision_data=json.dumps({
                "weather_dependency": True,
                "optimal_window": "Tomorrow 10:00-13:00",
                "risk_factors": ["Rain expected afternoon", "High ladder work requires good weather"]
            }),
            confidence_level="medium",
            reasoning="Weather-dependent job requires careful timing",
            executed=False
        ),
        AIDecision(
            job_id=3,
            decision_type="progress_monitoring",
            decision_data=json.dumps({
                "progress_percentage": 60,
                "estimated_completion": "16:00",
                "quality_check": "On track"
            }),
            confidence_level="high",
            reasoning="Regular progress update based on worker check-in",
            executed=True,
            execution_result="Progress updated and client notified"
        )
    ]
    
    for decision in ai_decisions:
        db.session.add(decision)
    
    db.session.commit()
    print("Demo data initialized successfully!")

if __name__ == "__main__":
    from src.models.job import db
    initialize_demo_data()

