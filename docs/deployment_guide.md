# Manus AI - Deployment Guide

This guide provides step-by-step instructions for deploying the Manus AI platform, which consists of a Flask backend (the AI Brain) and a React frontend (the Command Center).

## Prerequisites

-   Python 3.9+ and pip
-   Node.js 16+ and a package manager (pnpm is recommended)
-   A database (PostgreSQL is recommended for production, but SQLite is used for development)
-   An OpenAI API Key for the AI functionalities.

## 1. Backend Deployment (The AI Brain)

The backend is a Flask application that serves the core API and AI logic.

### Step 1: Clone the Repository

```bash
git clone <your-repository-url>
cd manus-ai/backend
```

### Step 2: Install Dependencies

It is highly recommended to use a virtual environment.

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Step 3: Configure Environment Variables

Create a `.env` file in the `backend` directory. For production, you should switch to a robust database like PostgreSQL.

```
# backend/.env

# For Production (Recommended):
# DATABASE_URL="postgresql://user:password@host:port/dbname"

# For Development (SQLite):
DATABASE_URL="sqlite:///manus.db"

OPENAI_API_KEY="sk-your-real-openai-api-key"
FLASK_APP="app.py"
FLASK_DEBUG="False" # Set to False for production
SECRET_KEY="a-very-strong-and-long-random-secret-key"
```

### Step 4: Run Database Migrations

Apply the database schema to your configured database.

```bash
# Ensure FLASK_APP is set if you are not using a .flaskenv file
export FLASK_APP=app.py

flask db upgrade
```

### Step 5: Run the Backend Server

For production, it is recommended to use a production-grade WSGI server like Gunicorn.

```bash
gunicorn --bind 0.0.0.0:5000 app:app
```

The backend API will now be running on port 5000.

---

## 2. Frontend Deployment (The Command Center)

The frontend is a React application built with Vite.

### Step 1: Navigate to the Frontend Directory

```bash
cd ../frontend
```

### Step 2: Install Dependencies

```bash
pnpm install
```

### Step 3: Configure Environment Variables

The frontend may need to know the URL of the backend API. Create a `.env.production` file in the `frontend` directory.

```
# frontend/.env.production
VITE_API_BASE_URL="https://your-backend-api-domain.com"
```

Your application code should be updated to use `import.meta.env.VITE_API_BASE_URL` when making API calls.

### Step 4: Build the Application

This command will create a `dist` directory containing the optimized, static files for production. The build process also handles the PWA generation.

```bash
pnpm run build
```

### Step 5: Deploy the Frontend

The contents of the `frontend/dist` directory can be deployed to any static hosting service.

**Deploying to Vercel (as requested):**

1.  Push your code to a Git repository (e.g., GitHub, GitLab).
2.  Sign up for a Vercel account and connect it to your Git provider.
3.  Create a "New Project" in Vercel and import your repository.
4.  **Configuration:**
    -   **Framework Preset:** Vercel should automatically detect it as a Vite project.
    -   **Root Directory:** Set this to `frontend`.
    -   **Build Command:** `pnpm run build`
    -   **Output Directory:** `dist`
5.  Add your environment variables (like `VITE_API_BASE_URL`) in the Vercel project settings.
6.  Click "Deploy". Vercel will handle the rest.

---

## 3. The WhatsApp Bridge

The Bridge component is a native Android application and must be deployed separately. Refer to the `docs/bridge_blueprint.md` for detailed technical specifications to be provided to a mobile developer. The dedicated Android device running the Bridge must have a persistent internet connection and be configured to allow the Bridge app to run continuously in the background.