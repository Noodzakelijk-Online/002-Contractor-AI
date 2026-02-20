# God-Mode Contractor AI - Deployment Guide

## Quick Start (Local Development)

### Prerequisites
- Python 3.11 or higher
- pip3
- OpenAI API key

### Step-by-Step Setup

```bash
# 1. Navigate to the project directory
cd god_mode_contractor_ai

# 2. Install dependencies
pip3 install -r requirements.txt

# 3. Set your OpenAI API key
export OPENAI_API_KEY='your-api-key-here'

# 4. Run the application
python3 main.py
```

### Access the Application
- Web Interface: http://localhost:5000
- API Health Check: http://localhost:5000/api/health
- Dashboard: http://localhost:5000/api/dashboard

---

## Testing the System

```bash
# Run the test script
cd god_mode_contractor_ai
python3 test_system.py
```

Expected output:
```
============================================================
God-Mode Contractor AI - System Test
============================================================
Testing imports...
✅ Models imported successfully
✅ AI Engine imported successfully

Testing AI Engine...
✅ AI Engine initialized successfully
✅ AI metrics: {...}

Testing Database Models...
✅ Job model created
✅ Worker model created
✅ Tool model created

============================================================
✅ ALL TESTS PASSED!
God-Mode system is ready to run.
============================================================
```

---

## API Testing

### Create a New Job
```bash
curl -X POST http://localhost:5000/api/job/new \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Need bathroom renovation, tiles are cracked and shower leaks",
    "client_name": "John Doe",
    "client_phone": "+31612345678",
    "client_email": "john@example.com",
    "location": "Amsterdam, Netherlands"
  }'
```

### Get Dashboard Data
```bash
curl http://localhost:5000/api/dashboard
```

### Check System Health
```bash
curl http://localhost:5000/api/health
```

### Get Metrics
```bash
curl http://localhost:5000/api/metrics
```

---

## Production Deployment

### Option 1: Docker Deployment

Create `Dockerfile`:
```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 5000

CMD ["python3", "main.py"]
```

Build and run:
```bash
docker build -t god-mode-contractor-ai .
docker run -p 5000:5000 -e OPENAI_API_KEY='your-key' god-mode-contractor-ai
```

### Option 2: Cloud Deployment (Vercel)

Create `vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "main.py",
      "use": "@vercel/python"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "main.py"
    }
  ],
  "env": {
    "OPENAI_API_KEY": "@openai-api-key"
  }
}
```

Deploy:
```bash
vercel deploy --prod
```

### Option 3: Traditional Server

```bash
# Install dependencies
pip3 install -r requirements.txt

# Set environment variables
export OPENAI_API_KEY='your-key'

# Run with production server (gunicorn)
pip3 install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 main:app
```

---

## Environment Variables

### Required
```bash
export OPENAI_API_KEY='your-openai-api-key'
```

### Optional
```bash
export CONTRACTOR_EMAIL='your-email@example.com'
export CONTRACTOR_PHONE='+31-your-phone'
export CONTRACTOR_COMPANY='Your Company Name'
export FLASK_ENV='production'
export DATABASE_URL='sqlite:///database/app.db'
```

---

## Database Setup

The database is automatically created on first run. To reset:

```bash
# Remove existing database
rm -f database/app.db

# Restart the application
python3 main.py
```

To add demo data, you can use the Python shell:

```python
from main import app, db
from models import Job, Worker, Tool
import json

with app.app_context():
    # Add a worker
    worker = Worker(
        name="Anna Kowalski",
        phone="+31612345678",
        email="anna@example.com",
        skills=json.dumps(["plumbing", "renovation", "tiling"]),
        status="available",
        success_rate=98.5,
        on_time_rate=97.0,
        years_experience=8
    )
    db.session.add(worker)
    
    # Add tools
    tools = [
        Tool(name="Tile Cutter", category="power_tools", status="available"),
        Tool(name="Drill Set", category="power_tools", status="available"),
        Tool(name="Plumbing Wrench", category="hand_tools", status="available")
    ]
    for tool in tools:
        db.session.add(tool)
    
    db.session.commit()
    print("Demo data added!")
```

---

## Monitoring & Logs

### View Logs
```bash
# The application logs to stdout
python3 main.py

# To save logs to file
python3 main.py > logs/app.log 2>&1
```

### Monitor Performance
```bash
# Get system metrics
curl http://localhost:5000/api/metrics

# Get health status
curl http://localhost:5000/api/health
```

---

## Troubleshooting

### Issue: Import errors
**Solution:**
```bash
# Make sure you're in the correct directory
cd god_mode_contractor_ai

# Verify Python path
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
```

### Issue: OpenAI API errors
**Solution:**
```bash
# Verify API key is set
echo $OPENAI_API_KEY

# Test API key
python3 -c "from openai import OpenAI; client = OpenAI(); print('API key works!')"
```

### Issue: Database errors
**Solution:**
```bash
# Reset database
rm -f database/app.db
python3 main.py
```

### Issue: Port already in use
**Solution:**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or use a different port
# Edit main.py: app.run(host='0.0.0.0', port=5001, debug=True)
```

---

## Security Considerations

### Production Checklist
- [ ] Change SECRET_KEY in main.py
- [ ] Enable HTTPS
- [ ] Set up authentication
- [ ] Configure CORS properly
- [ ] Use environment variables for secrets
- [ ] Enable rate limiting
- [ ] Set up database backups
- [ ] Configure logging
- [ ] Use production WSGI server (gunicorn)
- [ ] Set DEBUG=False

### Recommended Security Additions

```python
# Add to main.py for production

# Rate limiting
from flask_limiter import Limiter
limiter = Limiter(app, key_func=lambda: request.remote_addr)

@app.route('/api/job/new', methods=['POST'])
@limiter.limit("10 per minute")
def create_new_job():
    # ... existing code

# Authentication
from functools import wraps
def require_api_key(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        api_key = request.headers.get('X-API-Key')
        if api_key != os.environ.get('API_KEY'):
            return jsonify({'error': 'Invalid API key'}), 401
        return f(*args, **kwargs)
    return decorated_function
```

---

## Scaling

### Horizontal Scaling
```bash
# Run multiple instances behind load balancer
# Instance 1
gunicorn -w 4 -b 0.0.0.0:5001 main:app

# Instance 2
gunicorn -w 4 -b 0.0.0.0:5002 main:app

# Use nginx as load balancer
```

### Database Scaling
```bash
# Migrate from SQLite to PostgreSQL
# Update DATABASE_URL
export DATABASE_URL='postgresql://user:pass@localhost/godmode'

# Update main.py
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL')
```

---

## Backup & Recovery

### Backup Database
```bash
# SQLite backup
cp database/app.db database/app.db.backup

# Automated backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
cp database/app.db backups/app_${DATE}.db
```

### Restore Database
```bash
cp database/app.db.backup database/app.db
```

---

## Performance Optimization

### Enable Caching
```python
from flask_caching import Cache

cache = Cache(app, config={'CACHE_TYPE': 'simple'})

@app.route('/api/dashboard')
@cache.cached(timeout=60)
def get_dashboard_data():
    # ... existing code
```

### Database Indexing
```python
# Add indexes to models
class Job(db.Model):
    # ... existing fields
    __table_args__ = (
        db.Index('idx_status', 'status'),
        db.Index('idx_scheduled_date', 'scheduled_date'),
    )
```

---

## Maintenance

### Regular Tasks
- [ ] Check logs daily
- [ ] Monitor API usage
- [ ] Review AI decisions
- [ ] Update dependencies monthly
- [ ] Backup database weekly
- [ ] Review security settings
- [ ] Monitor disk space

### Update Dependencies
```bash
pip3 install --upgrade -r requirements.txt
```

---

## Support

For issues or questions:
- Email: noodzakelijkonline@gmail.com
- Phone: +31 06-83515175
- GitHub: Create an issue

---

**Deployment Status Checklist:**
- [ ] Dependencies installed
- [ ] Environment variables set
- [ ] Database created
- [ ] Tests passing
- [ ] API accessible
- [ ] Security configured
- [ ] Monitoring enabled
- [ ] Backups configured
- [ ] Documentation reviewed

**Ready to deploy! 🚀**
