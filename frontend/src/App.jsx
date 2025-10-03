import { useState, useEffect } from 'react';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Users, Briefcase, Bot, Sun, Moon, Bell, AlertTriangle, CheckCircle } from 'lucide-react';

// The base URL for the backend API
const API_BASE_URL = 'http://localhost:5000';

function App() {
  const [isQuietMode, setQuietMode] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [jobsRes, workersRes, statsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/jobs`),
          fetch(`${API_BASE_URL}/api/workers`),
          fetch(`${API_BASE_URL}/api/dashboard_stats`),
        ]);

        if (!jobsRes.ok || !workersRes.ok || !statsRes.ok) {
          throw new Error('Failed to fetch data from the server.');
        }

        const jobsData = await jobsRes.json();
        const workersData = await workersRes.json();
        const statsData = await statsRes.json();

        setJobs(jobsData);
        setWorkers(workersData);
        setStats(statsData);
        setError(null);
      } catch (err) {
        setError(err.message);
        // Set mock data on error so the UI doesn't break
        setJobs([
          { id: 1, title: 'Bathroom Renovation (Error)', status: 'In Progress', priority: 'Critical' },
        ]);
        setWorkers([
          { id: 1, name: 'Anna Kowalski (Error)', status: 'Active' },
        ]);
        setStats({ active_jobs: 1, workers_available: 1, critical_alerts: 1 });

      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const toggleQuietMode = () => {
    setQuietMode(!isQuietMode);
    document.body.classList.toggle('quiet-mode', !isQuietMode);
  };

  return (
    <div className={`flex h-screen bg-gray-100 dark:bg-gray-900 ${isQuietMode ? 'quiet' : ''}`}>
      {/* Sidebar */}
      <nav className="w-64 bg-white dark:bg-gray-800 shadow-md p-4 flex flex-col">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-8">Manus AI</h1>
        <ul>
          <li className="mb-4">
            <Button variant="ghost" className="w-full justify-start">
              <Briefcase className="mr-2 h-4 w-4" />
              Dashboard
            </Button>
          </li>
          <li className="mb-4">
            <Button variant="ghost" className="w-full justify-start">
              <Users className="mr-2 h-4 w-4" />
              Workers
            </Button>
          </li>
          <li className="mb-4">
            <Button variant="ghost" className="w-full justify-start">
              <Bot className="mr-2 h-4 w-4" />
              AI Settings
            </Button>
          </li>
        </ul>
        <div className="mt-auto">
          <Button onClick={toggleQuietMode} variant="outline" className="w-full mb-2">
            {isQuietMode ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            {isQuietMode ? 'Normal Mode' : 'Quiet Mode'}
          </Button>
          <Button variant="outline" className="w-full">
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </Button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-auto">
        <header className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-bold text-gray-800 dark:text-white">
            Executive Overview
          </h2>
          <Button>+ New Job</Button>
        </header>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6" role="alert">
            <p className="font-bold">Network Error</p>
            <p>{error} - Displaying cached or mock data. Please ensure the backend server is running.</p>
          </div>
        )}

        {loading ? (
          <p>Loading dashboard...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Jobs Card */}
            <Card>
              <CardHeader>
                <CardTitle>Active Jobs ({stats.active_jobs || 0})</CardTitle>
              </CardHeader>
              <CardContent>
                {jobs.map(job => (
                  <div key={job.id} className="mb-2">
                    <p className="font-semibold">{job.title}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Status: {job.status} - Priority: {job.priority}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Workers Card */}
            <Card>
              <CardHeader>
                <CardTitle>Worker Status ({workers.length || 0})</CardTitle>
              </CardHeader>
              <CardContent>
                {workers.map(worker => (
                  <div key={worker.id} className="mb-2 flex items-center">
                     {worker.status === 'Active' ? <CheckCircle className="text-green-500 mr-2 h-4 w-4"/> : <AlertTriangle className="text-yellow-500 mr-2 h-4 w-4"/>}
                    <p className="font-semibold">{worker.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 ml-auto">Status: {worker.status}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* AI Insights Card */}
            <Card>
              <CardHeader>
                <CardTitle>AI Insights</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Monitoring {stats.active_jobs || 0} jobs.
                  <span className={stats.critical_alerts > 0 ? 'text-red-500' : 'text-green-500'}>
                    {' '}{stats.critical_alerts || 0} critical alerts.
                  </span>
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;