import unittest
import json
from app import create_app, db
from models import Job, Worker, Client
from config import Config

class TestConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False

class ManusTestCase(unittest.TestCase):
    def setUp(self):
        """Set up a test client and a test database."""
        self.app = create_app(TestConfig)
        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()
        self.client = self.app.test_client()

    def tearDown(self):
        """Tear down the database."""
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    def test_index_route(self):
        """Test the main index route."""
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['message'], "Welcome to the Manus AI Brain!")

    def test_create_job_model(self):
        """Test creating a job model and retrieving it."""
        # First, create a client because a job requires a client_id
        new_client = Client(name="Test Client")
        db.session.add(new_client)
        db.session.commit()

        new_job = Job(title="Test Job", status="Pending", client_id=new_client.id)
        db.session.add(new_job)
        db.session.commit()

        job = Job.query.filter_by(title="Test Job").first()
        self.assertIsNotNone(job)
        self.assertEqual(job.status, "Pending")

    def test_jobs_api_route(self):
        """Test the /api/jobs route."""
        response = self.client.get('/api/jobs')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0) # Should have mock data

    def test_simulate_message_endpoint(self):
        """Test the message simulation endpoint."""
        payload = {
            "sender": "whatsapp:+15551234567",
            "message": "Starttime: 09:00"
        }
        response = self.client.post('/api/simulate/message',
                                   data=json.dumps(payload),
                                   content_type='application/json')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data['status'], 'received')
        self.assertEqual(data['message_processed'], 'Starttime: 09:00')

    def test_simulate_message_invalid_payload(self):
        """Test the message simulation endpoint with an invalid payload."""
        response = self.client.post('/api/simulate/message',
                                   data=json.dumps({"message": "test"}),
                                   content_type='application/json')
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)

if __name__ == '__main__':
    unittest.main()