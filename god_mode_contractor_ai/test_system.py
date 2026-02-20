"""
Quick test script for God-Mode Contractor AI
"""

import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_imports():
    """Test that all modules can be imported"""
    print("Testing imports...")
    
    try:
        from models import db, Job, Worker, Tool, Communication, AIDecision
        print("✅ Models imported successfully")
    except Exception as e:
        print(f"❌ Models import failed: {e}")
        return False
    
    try:
        from ai_engine.core import GodModeContractorAI
        print("✅ AI Engine imported successfully")
    except Exception as e:
        print(f"❌ AI Engine import failed: {e}")
        return False
    
    return True

def test_ai_engine():
    """Test AI engine initialization"""
    print("\nTesting AI Engine...")
    
    try:
        from ai_engine.core import GodModeContractorAI
        ai = GodModeContractorAI()
        print("✅ AI Engine initialized successfully")
        
        # Test basic functionality
        metrics = ai.get_performance_metrics()
        print(f"✅ AI metrics: {metrics}")
        
        return True
    except Exception as e:
        print(f"❌ AI Engine test failed: {e}")
        return False

def test_database_models():
    """Test database models"""
    print("\nTesting Database Models...")
    
    try:
        from models import Job, Worker, Tool
        
        # Test model instantiation
        job = Job(
            title="Test Job",
            client_name="Test Client",
            job_type="testing",
            complexity_score=5
        )
        print("✅ Job model created")
        
        worker = Worker(
            name="Test Worker",
            skills='["testing"]'
        )
        print("✅ Worker model created")
        
        tool = Tool(
            name="Test Tool",
            category="testing"
        )
        print("✅ Tool model created")
        
        return True
    except Exception as e:
        print(f"❌ Database models test failed: {e}")
        return False

def main():
    print("=" * 60)
    print("God-Mode Contractor AI - System Test")
    print("=" * 60)
    
    all_passed = True
    
    # Run tests
    all_passed &= test_imports()
    all_passed &= test_ai_engine()
    all_passed &= test_database_models()
    
    print("\n" + "=" * 60)
    if all_passed:
        print("✅ ALL TESTS PASSED!")
        print("God-Mode system is ready to run.")
    else:
        print("❌ SOME TESTS FAILED")
        print("Please check the errors above.")
    print("=" * 60)
    
    return 0 if all_passed else 1

if __name__ == '__main__':
    sys.exit(main())
