const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Contractor configuration
const CONTRACTOR_CONFIG = {
  email: 'noodzakelijkonline@gmail.com',
  phone: '+31068351517',
  company: 'Contractor AI Solutions',
  services: ['Garden Maintenance', 'General House Services', 'Renovations']
};

// Mock data for demonstration
let jobs = [
  {
    id: 1,
    title: 'Bathroom Renovation',
    client: 'Maria van der Berg',
    address: 'Hoofdstraat 123, Amsterdam',
    status: 'in_progress',
    priority: 'critical',
    worker: 'Anna Kowalski',
    estimatedCost: 1512,
    actualCost: 1200,
    progress: 65,
    startDate: '2024-10-15',
    estimatedCompletion: '2024-10-22',
    tools: ['Tile saw', 'Plumbing tools', 'Safety equipment'],
    description: 'Complete bathroom renovation including tiles, plumbing, and fixtures'
  },
  {
    id: 2,
    title: 'Gutter Cleaning & Inspection',
    client: 'Jan de Vries',
    address: 'Kerkstraat 45, Utrecht',
    status: 'scheduled',
    priority: 'high',
    worker: 'Marco Silva',
    estimatedCost: 90,
    actualCost: 0,
    progress: 0,
    startDate: '2024-10-18',
    estimatedCompletion: '2024-10-18',
    tools: ['Ladder', 'Pressure washer', 'Safety harness'],
    description: 'Clean gutters and inspect for damage or blockages'
  },
  {
    id: 3,
    title: 'Weekly Lawn Maintenance',
    client: 'Sophie Janssen',
    address: 'Parkweg 78, Rotterdam',
    status: 'completed',
    priority: 'medium',
    worker: 'Lisa Chen',
    estimatedCost: 45,
    actualCost: 45,
    progress: 100,
    startDate: '2024-10-14',
    estimatedCompletion: '2024-10-14',
    tools: ['Lawn mower', 'Trimmer', 'Rake'],
    description: 'Regular lawn mowing and garden maintenance'
  }
];

let workers = [
  {
    id: 1,
    name: 'Anna Kowalski',
    specialty: 'Bathroom Specialist',
    status: 'active',
    location: 'Amsterdam',
    rating: 4.9,
    completedJobs: 127,
    currentJob: 'Bathroom Renovation'
  },
  {
    id: 2,
    name: 'Marco Silva',
    specialty: 'Gutter Specialist',
    status: 'available',
    location: 'Utrecht',
    rating: 4.7,
    completedJobs: 89,
    currentJob: null
  },
  {
    id: 3,
    name: 'Lisa Chen',
    specialty: 'Garden Maintenance',
    status: 'traveling',
    location: 'Rotterdam',
    rating: 4.8,
    completedJobs: 156,
    currentJob: null
  }
];

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/dashboard', (req, res) => {
  const criticalJobs = jobs.filter(job => job.priority === 'critical').length;
  const aiHandling = jobs.filter(job => job.status === 'in_progress').length;
  const todayRevenue = jobs
    .filter(job => job.status === 'completed' && job.startDate === '2024-10-14')
    .reduce((sum, job) => sum + job.actualCost, 0);
  
  res.json({
    metrics: {
      criticalJobs,
      aiHandling,
      todayRevenue,
      onTimeRate: 94
    },
    jobs,
    workers,
    weather: {
      location: 'Amsterdam',
      condition: 'Partly Cloudy',
      temperature: 16,
      precipitation: 20,
      recommendation: 'Good conditions for outdoor work'
    },
    aiInsights: [
      'Schedule optimization: Move gutter cleaning to avoid rain tomorrow',
      'Resource alert: Tile saw available after Tuesday',
      'Client satisfaction: Maria van der Berg rated last job 5 stars'
    ]
  });
});

app.get('/api/jobs', (req, res) => {
  res.json(jobs);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.find(j => j.id === parseInt(req.params.id));
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

app.post('/api/jobs', (req, res) => {
  const newJob = {
    id: jobs.length + 1,
    ...req.body,
    status: 'scheduled',
    progress: 0,
    actualCost: 0,
    startDate: new Date().toISOString().split('T')[0]
  };
  jobs.push(newJob);
  res.json(newJob);
});

app.put('/api/jobs/:id', (req, res) => {
  const jobIndex = jobs.findIndex(j => j.id === parseInt(req.params.id));
  if (jobIndex === -1) {
    return res.status(404).json({ error: 'Job not found' });
  }
  jobs[jobIndex] = { ...jobs[jobIndex], ...req.body };
  res.json(jobs[jobIndex]);
});

app.get('/api/workers', (req, res) => {
  res.json(workers);
});

// AI Chat endpoint
app.post('/api/ai/chat', (req, res) => {
  const { message } = req.body;
  
  // Simple AI response simulation
  let response = "I'm analyzing your request...";
  
  if (message.toLowerCase().includes('schedule') || message.toLowerCase().includes('plan')) {
    response = "Based on current weather and worker availability, I recommend scheduling outdoor work for tomorrow morning. Anna is available for bathroom work, and Marco can handle the gutter cleaning after 2 PM.";
  } else if (message.toLowerCase().includes('weather')) {
    response = "Current weather in Amsterdam: 16°C, partly cloudy with 20% chance of rain. Good conditions for most outdoor work. I recommend completing gutter cleaning before tomorrow's forecasted rain.";
  } else if (message.toLowerCase().includes('worker') || message.toLowerCase().includes('team')) {
    response = "Your team status: Anna is currently working on the bathroom renovation (65% complete), Marco is available for new assignments, and Lisa just completed the lawn maintenance job with excellent client feedback.";
  } else if (message.toLowerCase().includes('client') || message.toLowerCase().includes('customer')) {
    response = "Client updates: Maria van der Berg's bathroom renovation is progressing well. I've sent her a progress update with photos. Jan de Vries confirmed availability for tomorrow's gutter cleaning.";
  }
  
  res.json({ 
    response,
    confidence: 'high',
    suggestions: [
      'Review today\'s schedule',
      'Check weather forecast',
      'Send client updates',
      'Optimize routes'
    ]
  });
});

// Simulate client request
app.post('/api/simulate/client-request', (req, res) => {
  const clientRequests = [
    {
      client: 'Emma Bakker',
      phone: '+31612345678',
      address: 'Nieuwmarkt 12, Amsterdam',
      service: 'Kitchen renovation',
      urgency: 'medium',
      budget: '€2000-3000',
      description: 'Need kitchen cabinets replaced and new countertop installed'
    },
    {
      client: 'Pieter Visser',
      phone: '+31687654321',
      address: 'Lange Voorhout 89, Den Haag',
      service: 'Garden maintenance',
      urgency: 'low',
      budget: '€100-200',
      description: 'Monthly garden cleanup and hedge trimming'
    }
  ];
  
  const request = clientRequests[Math.floor(Math.random() * clientRequests.length)];
  
  // Simulate AI analysis
  const aiAnalysis = {
    estimatedDuration: '2-3 days',
    recommendedWorker: 'Anna Kowalski',
    estimatedCost: request.budget,
    requiredTools: ['Power tools', 'Measuring equipment', 'Safety gear'],
    schedulingSuggestion: 'Next available slot: October 20-22',
    confidence: 'high'
  };
  
  res.json({
    request,
    aiAnalysis,
    status: 'analyzed',
    nextSteps: [
      'Send quote to client',
      'Schedule initial consultation',
      'Reserve required tools',
      'Assign worker'
    ]
  });
});

// Test email/SMS endpoint
app.post('/api/test/notifications', (req, res) => {
  const { type } = req.body;
  
  // Simulate sending notification
  setTimeout(() => {
    res.json({
      success: true,
      message: `${type} notification sent successfully to ${CONTRACTOR_CONFIG.email}`,
      timestamp: new Date().toISOString(),
      details: {
        recipient: type === 'email' ? CONTRACTOR_CONFIG.email : CONTRACTOR_CONFIG.phone,
        subject: 'Contractor AI System Test',
        content: 'This is a test notification from your Contractor AI system. All systems are operational!'
      }
    });
  }, 1000);
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Simulate AI analysis of uploaded file
  const analysis = {
    fileType: req.file.mimetype,
    size: req.file.size,
    analysis: 'Image processed successfully. Detected: work in progress, good quality, no safety issues identified.',
    confidence: 'high',
    suggestions: ['Continue current approach', 'Document completion photos']
  };
  
  res.json({
    success: true,
    filename: req.file.filename,
    analysis
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    services: {
      ai: 'operational',
      database: 'operational',
      notifications: 'operational'
    }
  });
});

// Start server
app.listen(port, () => {
  console.log(`Contractor AI System running on port ${port}`);
  console.log(`Dashboard: http://localhost:${port}`);
  console.log(`API Health: http://localhost:${port}/api/health`);
});

module.exports = app;

