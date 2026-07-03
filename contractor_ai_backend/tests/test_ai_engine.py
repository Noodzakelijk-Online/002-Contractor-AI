import pytest
from unittest.mock import patch, MagicMock
from contractor_ai_backend.ai_engine import ContractorAI

@pytest.fixture
def mock_openai():
    with patch('contractor_ai_backend.ai_engine.OpenAI') as mock:
        yield mock

@pytest.fixture
def ai_engine(mock_openai):
    return ContractorAI()

def test_generate_performance_insights_empty(ai_engine):
    """Test generating insights with empty data."""
    result = ai_engine.generate_performance_insights([])
    assert result == {"insights": [], "recommendations": []}

def test_generate_performance_insights_single_completed(ai_engine):
    """Test with a single completed job."""
    data = [{
        'status': 'completed',
        'actual_duration': 4,
        'actual_cost': 100.0
    }]
    result = ai_engine.generate_performance_insights(data)

    # Check insights strings are present
    insights = result['insights']
    assert any("Completion rate: 100.0%" in s for s in insights)
    assert any("Average job duration: 4.0 hours" in s for s in insights)
    assert any("Average job cost: €100.00" in s for s in insights)

    assert result['performance_score'] == 100.0
    assert result['recommendations'] == [] # Should be empty as metrics are good

def test_generate_performance_insights_mixed_status(ai_engine):
    """Test with mixed status jobs."""
    data = [
        {'status': 'completed', 'actual_duration': 4, 'actual_cost': 100.0},
        {'status': 'cancelled'},
        {'status': 'in_progress'}
    ]
    # Total 3 jobs, 1 completed. Rate = 1/3 ~ 33.3%

    result = ai_engine.generate_performance_insights(data)

    insights = result['insights']
    assert any("Completion rate: 33.3%" in s for s in insights)
    assert any("Average job duration: 4.0 hours" in s for s in insights)

    # precise float comparison can be tricky, but here we expect exactly 1/3 * 100
    assert abs(result['performance_score'] - 33.333) < 0.1
    assert "Consider improving job planning to increase completion rate" in result['recommendations']

def test_generate_performance_insights_high_duration(ai_engine):
    """Test with high duration jobs triggering recommendation."""
    data = [{
        'status': 'completed',
        'actual_duration': 8, # > 6 threshold
        'actual_cost': 200.0
    }]

    result = ai_engine.generate_performance_insights(data)

    insights = result['insights']
    assert any("Average job duration: 8.0 hours" in s for s in insights)
    assert "Look for opportunities to improve efficiency and reduce job duration" in result['recommendations']

def test_generate_performance_insights_missing_keys(ai_engine):
    """Test robustness with missing keys."""
    data = [{'status': 'completed'}] # Missing duration and cost

    result = ai_engine.generate_performance_insights(data)

    insights = result['insights']
    # Defaults are 0
    assert any("Average job duration: 0.0 hours" in s for s in insights)
    assert any("Average job cost: €0.00" in s for s in insights)

def test_generate_performance_insights_no_completed_jobs(ai_engine):
    """Test with jobs but none completed."""
    data = [{'status': 'cancelled'}, {'status': 'pending'}]

    result = ai_engine.generate_performance_insights(data)

    insights = result['insights']
    assert any("Completion rate: 0.0%" in s for s in insights)
    assert result['performance_score'] == 0.0
    assert "Consider improving job planning to increase completion rate" in result['recommendations']


def test_job_received_message_does_not_require_schedule(ai_engine):
    message = ai_engine.generate_client_communication(
        {
            'client_name': 'API Client',
            'job_type': 'general repair',
            'location': 'Amsterdam'
        },
        {},
        {},
        'job_received'
    )

    assert 'API Client' in message
    assert 'Scheduling in progress' in message


def test_weather_independent_schedule_has_valid_slot(ai_engine):
    with patch.object(ai_engine, '_get_weather_forecast', return_value={}):
        result = ai_engine.optimize_schedule(
            {
                'location': 'Amsterdam',
                'priority': 'medium',
                'weather_dependent': False,
                'estimated_duration': 2
            },
            {'id': 1, 'status': 'available'},
            []
        )

    assert result['recommended_slot'] is not None
    assert result['confidence'] in {'medium', 'high'}
