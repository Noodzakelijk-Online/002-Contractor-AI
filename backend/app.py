import os
from flask import Flask, jsonify, request
from flask_migrate import Migrate
from dotenv import load_dotenv

from config import Config
from models import db

# Load environment variables
load_dotenv()

def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    Migrate(app, db)

    # --- Mock Data for Demo ---
    mock_jobs = [
      { "id": 1, "title": 'Bathroom Renovation', "status": 'In Progress', "priority": 'Critical', "client": "Mrs. Davis" },
      { "id": 2, "title": 'Gutter Cleaning', "status": 'Scheduled', "priority": 'High', "client": "Mr. Jones" },
      { "id": 3, "title": 'Garden Landscaping', "status": 'Pending', "priority": 'Medium', "client": "The Smiths" },
    ]

    mock_workers = [
      { "id": 1, "name": 'Anna Kowalski', "status": 'Active', "skills": ["tiling", "painting"] },
      { "id": 2, "name": 'Marco Silva', "status": 'On Standby', "skills": ["plumbing", "electrical"] },
      { "id": 3, "name": 'Ben Carter', "status": 'Active', "skills": ["carpentry", "demolition"] },
    ]

    # ----------------- API ROUTES ----------------- #
    @app.route('/')
    def index():
        return jsonify({"message": "Welcome to the Manus AI Brain!"})

    @app.route('/api/jobs', methods=['GET'])
    def get_jobs():
        return jsonify(mock_jobs)

    @app.route('/api/workers', methods=['GET'])
    def get_workers():
        return jsonify(mock_workers)

    @app.route('/api/dashboard_stats', methods=['GET'])
    def get_dashboard_stats():
        return jsonify({
            "active_jobs": len(mock_jobs),
            "workers_available": len([w for w in mock_workers if w['status'] == 'On Standby']),
            "critical_alerts": len([j for j in mock_jobs if j['priority'] == 'Critical'])
        })

    # ----------------- SIMULATION ROUTES ----------------- #
    @app.route('/api/simulate/message', methods=['POST'])
    def simulate_message():
        data = request.get_json()
        if not data or 'sender' not in data or 'message' not in data:
            return jsonify({"error": "Invalid payload. 'sender' and 'message' are required."}), 400

        sender = data['sender']
        message = data['message']
        print(f"SIMULATED MESSAGE RECEIVED from {sender}: {message}")

        mock_response = {
            "status": "received",
            "message_processed": message,
            "ai_action": "Logged message and triggered AI analysis."
        }

        return jsonify(mock_response), 200

    return app

if __name__ == '__main__':
    app = create_app()
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)