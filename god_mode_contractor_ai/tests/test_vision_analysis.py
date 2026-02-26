import unittest
import json
from datetime import datetime
from god_mode_contractor_ai.models import VisionAnalysis

class TestVisionAnalysis(unittest.TestCase):
    def test_to_dict_happy_path(self):
        """Test to_dict with all fields populated"""
        now = datetime.utcnow()
        va = VisionAnalysis(
            id=1,
            job_id=101,
            image_type='before',
            detected_objects=json.dumps(['pipe', 'wrench']),
            detected_issues=json.dumps(['leak']),
            quality_assessment='good',
            progress_estimate=50,
            recommendations=json.dumps(['replace pipe']),
            confidence=0.95,
            created_at=now
        )

        data = va.to_dict()

        self.assertEqual(data['id'], 1)
        self.assertEqual(data['job_id'], 101)
        self.assertEqual(data['image_type'], 'before')
        self.assertEqual(data['detected_objects'], ['pipe', 'wrench'])
        self.assertEqual(data['detected_issues'], ['leak'])
        self.assertEqual(data['quality_assessment'], 'good')
        self.assertEqual(data['progress_estimate'], 50)
        self.assertEqual(data['recommendations'], ['replace pipe'])
        self.assertEqual(data['created_at'], now.isoformat())

    def test_to_dict_empty_fields(self):
        """Test to_dict with optional fields as None or empty"""
        va = VisionAnalysis(
            id=2,
            job_id=102,
            image_type='during',
            detected_objects=None,
            detected_issues='', # Should handle empty string if possible
            quality_assessment=None,
            progress_estimate=None,
            recommendations=None,
            created_at=None
        )

        data = va.to_dict()

        self.assertEqual(data['id'], 2)
        self.assertEqual(data['job_id'], 102)
        self.assertEqual(data['image_type'], 'during')
        self.assertEqual(data['detected_objects'], [])
        self.assertEqual(data['detected_issues'], [])
        self.assertIsNone(data['quality_assessment'])
        self.assertIsNone(data['progress_estimate'])
        self.assertEqual(data['recommendations'], [])
        self.assertIsNone(data['created_at'])

    def test_json_serialization(self):
        """Test that JSON strings are correctly parsed"""
        complex_objects = [{'name': 'pipe', 'confidence': 0.9}, {'name': 'wire', 'confidence': 0.8}]
        va = VisionAnalysis(
            id=3,
            job_id=103,
            detected_objects=json.dumps(complex_objects)
        )

        data = va.to_dict()
        self.assertEqual(data['detected_objects'], complex_objects)

if __name__ == '__main__':
    unittest.main()
