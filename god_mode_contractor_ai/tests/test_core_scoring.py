
import unittest
import sys
import os
from unittest import mock
from datetime import datetime, timedelta

# Add parent directory to path to import ai_engine
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from ai_engine.core import GodModeContractorAI

class TestSlotScore(unittest.TestCase):
    def setUp(self):
        # Mock OpenAI to avoid API calls during initialization
        with mock.patch('ai_engine.core.OpenAI'):
            self.ai = GodModeContractorAI()

    def test_base_score(self):
        """Test base score calculation"""
        # Base score is 5.0
        # Urgency: 'low' -> +0
        # Days out: 10 -> >3 -> +0
        # Weather dependent: False -> +0
        # Day: Monday (0) -> not optimal -> +0
        # Total: 5.0

        job_data = {'urgency': 'low', 'weather_dependent': False}
        worker_data = {}
        weather = {}

        # Set a date far in the future, on a Monday
        # Monday, Jan 1, 2024 is a Monday (weekday 0)
        future_date = datetime(2024, 1, 1, 10, 0)

        # Mock datetime.now() to be 10 days before
        with mock.patch('ai_engine.core.datetime') as mock_datetime:
            mock_datetime.now.return_value = future_date - timedelta(days=10)
            # We also need to mock date() method if it's called on the class,
            # but here it's called on the instance returned by now().
            # However, core.py does: (date.date() - datetime.now().date()).days
            # So mock_datetime.now() must return a datetime object that has a date() method.
            # Real datetime objects have this.

            # Since we are passing a real datetime object as 'date' argument,
            # and mock_datetime.now() returns a real datetime object (or mock behaving like one),
            # we should be careful.
            # If we use real datetime objects for return values, it works.

            score = self.ai._calculate_slot_score(future_date, job_data, worker_data, weather)
            self.assertEqual(score, 5.0)

    def test_urgency_emergency(self):
        """Test emergency urgency score"""
        # Urgency: 'emergency' and days_out=0 -> +5
        # Base: 5.0
        # Total: 10.0

        job_data = {'urgency': 'emergency'}
        worker_data = {}
        weather = {}

        target_date = datetime(2024, 1, 1, 10, 0) # Monday

        with mock.patch('ai_engine.core.datetime') as mock_datetime:
            mock_datetime.now.return_value = target_date

            score = self.ai._calculate_slot_score(target_date, job_data, worker_data, weather)
            self.assertEqual(score, 10.0)

    def test_urgency_high(self):
        """Test high urgency score"""
        # Urgency: 'high' and days_out=1 -> +3
        # Base: 5.0
        # Total: 8.0

        job_data = {'urgency': 'high'}
        worker_data = {}
        weather = {}

        target_date = datetime(2024, 1, 2, 10, 0) # Tuesday
        # Tuesday is optimal day (+1), so we need to avoid that for pure urgency test
        # Let's use Monday (Jan 1) as target, and Now as Sunday (Dec 31)

        target_date = datetime(2024, 1, 1, 10, 0) # Monday
        now_date = datetime(2023, 12, 31, 10, 0) # Sunday (1 day before)

        with mock.patch('ai_engine.core.datetime') as mock_datetime:
            mock_datetime.now.return_value = now_date

            score = self.ai._calculate_slot_score(target_date, job_data, worker_data, weather)
            self.assertEqual(score, 8.0)

    def test_urgency_medium(self):
        """Test medium urgency score"""
        # Urgency: 'medium' and days_out=3 -> +2
        # Base: 5.0
        # Total: 7.0

        job_data = {'urgency': 'medium'}
        worker_data = {}
        weather = {}

        target_date = datetime(2024, 1, 1, 10, 0) # Monday
        now_date = datetime(2023, 12, 29, 10, 0) # 3 days before

        with mock.patch('ai_engine.core.datetime') as mock_datetime:
            mock_datetime.now.return_value = now_date

            score = self.ai._calculate_slot_score(target_date, job_data, worker_data, weather)
            self.assertEqual(score, 7.0)

    def test_weather_dependent(self):
        """Test weather dependent score"""
        # Weather dependent: True -> +1
        # Base: 5.0
        # Total: 6.0

        job_data = {'urgency': 'low', 'weather_dependent': True}
        worker_data = {}
        weather = {}

        target_date = datetime(2024, 1, 1, 10, 0) # Monday
        now_date = datetime(2023, 12, 20, 10, 0) # Far before

        with mock.patch('ai_engine.core.datetime') as mock_datetime:
            mock_datetime.now.return_value = now_date

            score = self.ai._calculate_slot_score(target_date, job_data, worker_data, weather)
            self.assertEqual(score, 6.0)

    def test_optimal_day(self):
        """Test optimal day score"""
        # Tuesday (1) -> +1
        # Base: 5.0
        # Total: 6.0

        job_data = {'urgency': 'low'}
        worker_data = {}
        weather = {}

        target_date = datetime(2024, 1, 2, 10, 0) # Tuesday
        now_date = datetime(2023, 12, 20, 10, 0) # Far before

        with mock.patch('ai_engine.core.datetime') as mock_datetime:
            mock_datetime.now.return_value = now_date

            score = self.ai._calculate_slot_score(target_date, job_data, worker_data, weather)
            self.assertEqual(score, 6.0)

    def test_score_cap(self):
        """Test score capping at 10"""
        # Emergency (+5) + Weather (+1) + Optimal Day (+1) + Base (5) = 12
        # Cap: 10

        job_data = {'urgency': 'emergency', 'weather_dependent': True}
        worker_data = {}
        weather = {}

        target_date = datetime(2024, 1, 2, 10, 0) # Tuesday (Optimal)
        now_date = datetime(2024, 1, 2, 10, 0) # Same day (Emergency condition: days_out=0)

        with mock.patch('ai_engine.core.datetime') as mock_datetime:
            mock_datetime.now.return_value = now_date

            score = self.ai._calculate_slot_score(target_date, job_data, worker_data, weather)
            self.assertEqual(score, 10.0)

if __name__ == '__main__':
    unittest.main()
