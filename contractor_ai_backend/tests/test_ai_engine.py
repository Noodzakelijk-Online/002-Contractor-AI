import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Add parent directory to path to allow importing from contractor_ai_backend
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

# Import the module explicitly so patch can find it
import contractor_ai_backend.ai_engine
from contractor_ai_backend.ai_engine import ContractorAI

class TestContractorAIPricing(unittest.TestCase):
    def setUp(self):
        # Patch OpenAI to prevent API calls during initialization
        self.patcher = patch('contractor_ai_backend.ai_engine.OpenAI')
        self.MockOpenAI = self.patcher.start()
        self.ai = ContractorAI()

    def tearDown(self):
        self.patcher.stop()

    def test_calculate_dynamic_pricing_base(self):
        """Test base case: medium urgency, standard complexity"""
        job_data = {
            'urgency': 'medium',
            'complexity_score': 5,
            'estimated_duration': 4,
            'required_tools': ['hammer', 'drill'], # 2 tools, no extra charge
            'weather_dependent': False
        }
        market_conditions = {
            'bad_weather': False,
            'demand_multiplier': 1.0
        }

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        self.assertEqual(pricing['hourly_rate'], 20.0)
        self.assertEqual(pricing['labor_cost'], 80.0)
        self.assertEqual(pricing['equipment_cost'], 0.0)
        self.assertEqual(pricing['total_cost'], 80.0)

    def test_calculate_dynamic_pricing_urgency_emergency(self):
        """Test emergency urgency multiplier"""
        job_data = {
            'urgency': 'emergency',
            'complexity_score': 5,
            'estimated_duration': 1
        }
        market_conditions = {}

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Urgency 'emergency' = 1.5
        # Final rate = 20.0 * 1.5 = 30.0

        self.assertEqual(pricing['hourly_rate'], 30.0)
        self.assertEqual(pricing['pricing_factors']['urgency_multiplier'], 1.5)

    def test_calculate_dynamic_pricing_high_complexity(self):
        """Test high complexity score"""
        job_data = {
            'urgency': 'medium',
            'complexity_score': 8, # +3 from base 5
            'estimated_duration': 1
        }
        market_conditions = {}

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Complexity 8 = 1.0 + (8-5)*0.1 = 1.3
        # Final rate = 20.0 * 1.3 = 26.0

        self.assertAlmostEqual(pricing['hourly_rate'], 26.0)
        self.assertAlmostEqual(pricing['pricing_factors']['complexity_multiplier'], 1.3)

    def test_calculate_dynamic_pricing_weather_impact(self):
        """Test weather impact when job is weather dependent and bad weather"""
        job_data = {
            'urgency': 'medium',
            'complexity_score': 5,
            'estimated_duration': 1,
            'weather_dependent': True
        }
        market_conditions = {
            'bad_weather': True
        }

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Weather multiplier = 1.1
        # Final rate = 20.0 * 1.1 = 22.0

        self.assertEqual(pricing['hourly_rate'], 22.0)
        self.assertEqual(pricing['pricing_factors']['weather_multiplier'], 1.1)

    def test_calculate_dynamic_pricing_demand_multiplier(self):
        """Test demand multiplier"""
        job_data = {
            'urgency': 'medium',
            'complexity_score': 5,
            'estimated_duration': 1
        }
        market_conditions = {
            'demand_multiplier': 1.2
        }

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Demand = 1.2
        # Final rate = 20.0 * 1.2 = 24.0

        self.assertEqual(pricing['hourly_rate'], 24.0)
        self.assertEqual(pricing['pricing_factors']['demand_multiplier'], 1.2)

    def test_calculate_dynamic_pricing_equipment_cost(self):
        """Test equipment cost for > 2 tools"""
        job_data = {
            'urgency': 'medium',
            'complexity_score': 5,
            'estimated_duration': 10,
            'required_tools': ['tool1', 'tool2', 'tool3'] # 3 tools -> charge equipment
        }
        market_conditions = {}

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Base rate = 20.0
        # Equipment rate = 2.50
        # Equipment cost = 2.50 * 10 = 25.0
        # Labor cost = 20.0 * 10 = 200.0
        # Total = 225.0

        self.assertEqual(pricing['equipment_cost'], 25.0)
        self.assertEqual(pricing['total_cost'], 225.0)

    def test_calculate_dynamic_pricing_combined_factors(self):
        """Test combination of multiple factors"""
        job_data = {
            'urgency': 'high', # 1.2
            'complexity_score': 7, # 1.2 (1.0 + 0.2)
            'estimated_duration': 5,
            'weather_dependent': True
        }
        market_conditions = {
            'bad_weather': True, # 1.1
            'demand_multiplier': 1.5
        }

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Base 20.0
        # Multipliers: 1.2 * 1.2 * 1.1 * 1.5 = 2.376
        # Rate = 20.0 * 2.376 = 47.52

        expected_rate = 20.0 * 1.2 * 1.2 * 1.1 * 1.5
        self.assertAlmostEqual(pricing['hourly_rate'], expected_rate, places=2)

        expected_labor = expected_rate * 5
        self.assertAlmostEqual(pricing['labor_cost'], expected_labor, places=2)

    def test_calculate_dynamic_pricing_urgency_low(self):
        """Test low urgency multiplier"""
        job_data = {
            'urgency': 'low',
            'complexity_score': 5,
            'estimated_duration': 1
        }
        market_conditions = {}

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Urgency 'low' = 0.9
        # Final rate = 20.0 * 0.9 = 18.0

        self.assertEqual(pricing['hourly_rate'], 18.0)
        self.assertEqual(pricing['pricing_factors']['urgency_multiplier'], 0.9)

    def test_calculate_dynamic_pricing_urgency_invalid(self):
        """Test invalid urgency defaults to 1.0"""
        job_data = {
            'urgency': 'invalid_urgency',
            'complexity_score': 5,
            'estimated_duration': 1
        }
        market_conditions = {}

        pricing = self.ai.calculate_dynamic_pricing(job_data, market_conditions)

        # Urgency invalid -> dict.get returns 1.0
        # Final rate = 20.0 * 1.0 = 20.0

        self.assertEqual(pricing['hourly_rate'], 20.0)
        self.assertEqual(pricing['pricing_factors']['urgency_multiplier'], 1.0)

if __name__ == '__main__':
    unittest.main()
