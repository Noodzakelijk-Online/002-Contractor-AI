import unittest
import json
from datetime import datetime
from flask import Flask
from god_mode_contractor_ai.models import db, IoTSensorData

class TestIoTSensorData(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
        db.init_app(self.app)

        self.app_context = self.app.app_context()
        self.app_context.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.app_context.pop()

    def test_to_dict_full_fields(self):
        now = datetime.utcnow()
        sensor_data = IoTSensorData(
            job_id=1,
            sensor_id='sensor-123',
            sensor_type='temperature',
            location='Living Room',
            reading_value=22.5,
            reading_unit='C',
            reading_status='normal',
            sensor_metadata=json.dumps({'battery': '95%', 'version': '1.0'}),
            created_at=now
        )

        result = sensor_data.to_dict()

        self.assertEqual(result['job_id'], 1)
        self.assertEqual(result['sensor_id'], 'sensor-123')
        self.assertEqual(result['sensor_type'], 'temperature')
        self.assertEqual(result['location'], 'Living Room')
        self.assertEqual(result['reading_value'], 22.5)
        self.assertEqual(result['reading_unit'], 'C')
        self.assertEqual(result['reading_status'], 'normal')
        self.assertEqual(result['sensor_metadata'], {'battery': '95%', 'version': '1.0'})
        self.assertEqual(result['created_at'], now.isoformat())

    def test_to_dict_minimal_fields(self):
        sensor_data = IoTSensorData(
            sensor_id='sensor-456'
        )
        db.session.add(sensor_data)
        db.session.commit()

        result = sensor_data.to_dict()

        self.assertIsNone(result['job_id'])
        self.assertEqual(result['sensor_id'], 'sensor-456')
        self.assertIsNone(result['sensor_type'])
        self.assertIsNone(result['location'])
        self.assertIsNone(result['reading_value'])
        self.assertIsNone(result['reading_unit'])
        self.assertIsNone(result['reading_status'])
        self.assertEqual(result['sensor_metadata'], {})
        self.assertIsNotNone(result['created_at'])

    def test_metadata_parsing(self):
        sensor_data = IoTSensorData(
            sensor_metadata=json.dumps({'complex': {'nested': 'data'}})
        )

        result = sensor_data.to_dict()
        self.assertEqual(result['sensor_metadata'], {'complex': {'nested': 'data'}})

    def test_metadata_none(self):
        sensor_data = IoTSensorData(
            sensor_metadata=None
        )

        result = sensor_data.to_dict()
        self.assertEqual(result['sensor_metadata'], {})

if __name__ == '__main__':
    unittest.main()
