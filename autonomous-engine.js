class AutonomousContractorEngine {
  constructor(options = {}) {
    this.now = options.now || (() => new Date());
    this.businessHours = options.businessHours || { start: 9, end: 17 };
  }

  analyzeJobRequest(input = {}) {
    const text = [
      input.title,
      input.service,
      input.description,
      input.message,
      input.address,
      input.location
    ].filter(Boolean).join(' ').toLowerCase();

    const profile = this.classifyJob(text);
    const urgency = this.detectUrgency(text, input.urgency);
    const complexityScore = this.estimateComplexity(text, profile, urgency);
    const estimatedHours = this.estimateDuration(profile, complexityScore, urgency);
    const pricing = this.calculatePricing({
      jobType: profile.jobType,
      urgency,
      complexityScore,
      estimatedHours,
      requiredTools: profile.requiredTools,
      weatherDependent: profile.weatherDependent
    });

    return {
      jobType: profile.jobType,
      priority: urgency,
      complexityScore,
      estimatedHours,
      weatherDependent: profile.weatherDependent,
      requiredSkills: profile.requiredSkills,
      requiredTools: profile.requiredTools,
      estimatedCost: pricing.totalCost,
      hourlyRate: pricing.hourlyRate,
      confidence: complexityScore > 7 ? 'medium' : 'high',
      reasoning: this.buildAnalysisReasoning(profile, urgency, complexityScore),
      clientQuestions: this.buildClientQuestions(profile, text),
      risks: this.identifyJobRisks({ profile, urgency, text })
    };
  }

  createJobFromRequest(input = {}, state = {}) {
    const analysis = this.analyzeJobRequest(input);
    const nextId = this.nextId(state.jobs || []);
    const title = input.title || input.service || this.titleFromType(analysis.jobType);

    return {
      id: nextId,
      title,
      client: input.client || input.client_name || input.clientName || 'New Client',
      phone: input.phone || input.client_phone || '',
      email: input.email || input.client_email || '',
      address: input.address || input.location || '',
      status: 'pending',
      priority: analysis.priority,
      worker: null,
      estimatedCost: analysis.estimatedCost,
      actualCost: 0,
      progress: 0,
      startDate: null,
      estimatedCompletion: null,
      tools: analysis.requiredTools,
      requiredSkills: analysis.requiredSkills,
      estimatedHours: analysis.estimatedHours,
      jobType: analysis.jobType,
      weatherDependent: analysis.weatherDependent,
      description: input.description || input.message || '',
      ai: {
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        risks: analysis.risks,
        clientQuestions: analysis.clientQuestions,
        lastDecisionAt: this.now().toISOString()
      }
    };
  }

  createPlan(job, state = {}) {
    if (!job) {
      return this.emptyPlan('Job not found');
    }

    const normalizedJob = this.normalizeJob(job);
    const availableWorkers = (state.workers || []).filter(worker => this.isWorkerAvailable(worker, normalizedJob));
    const workerRanking = this.rankWorkers(normalizedJob, availableWorkers);
    const selectedWorker = workerRanking[0]?.worker || null;
    const toolPlan = this.planTools(normalizedJob, state.tools || []);
    const schedule = selectedWorker
      ? this.findScheduleSlot(normalizedJob, selectedWorker, state.jobs || [])
      : null;
    const riskLevel = this.calculateRiskLevel(normalizedJob, selectedWorker, toolPlan, schedule);
    const requiresApproval = riskLevel === 'high' || normalizedJob.priority === 'critical' && !selectedWorker;
    const actions = [];

    if (selectedWorker) {
      actions.push({
        type: 'assign_worker',
        workerId: selectedWorker.id,
        workerName: selectedWorker.name,
        confidence: workerRanking[0].score,
        reason: workerRanking[0].reasoning.join('; ')
      });
    } else {
      actions.push({
        type: 'escalate',
        reason: 'No available worker has enough matching skills'
      });
    }

    if (toolPlan.reserved.length || toolPlan.missing.length) {
      actions.push({
        type: 'prepare_tools',
        reserved: toolPlan.reserved.map(tool => tool.name),
        missing: toolPlan.missing,
        reason: toolPlan.missing.length
          ? 'Some tools need manual sourcing'
          : 'Required tools are available'
      });
    }

    if (schedule) {
      actions.push({
        type: 'schedule_job',
        start: schedule.start,
        end: schedule.end,
        reason: schedule.reason
      });
    }

    actions.push({
      type: 'draft_client_update',
      status: 'draft',
      requiresApproval: true,
      notSent: true,
      message: this.generateClientUpdate(normalizedJob, selectedWorker, schedule)
    });

    return {
      jobId: normalizedJob.id,
      decisionId: `decision-${normalizedJob.id}-${this.now().getTime()}`,
      status: requiresApproval ? 'approval_recommended' : 'ready',
      confidence: this.planConfidence(workerRanking[0]?.score, toolPlan, schedule),
      riskLevel,
      requiresApproval,
      reasoning: this.planReasoning(normalizedJob, selectedWorker, toolPlan, schedule),
      actions,
      workerRanking: workerRanking.slice(0, 3).map(item => ({
        workerId: item.worker.id,
        workerName: item.worker.name,
        score: item.score,
        reasoning: item.reasoning
      })),
      toolPlan,
      schedule,
      createdAt: this.now().toISOString()
    };
  }

  executePlan(jobId, state = {}) {
    const job = (state.jobs || []).find(item => String(item.id) === String(jobId));
    const plan = this.createPlan(job, state);

    if (!job || plan.actions.some(action => action.type === 'escalate')) {
      return {
        success: false,
        plan,
        actionsApplied: [],
        message: plan.reasoning
      };
    }

    const actionsApplied = [];

    for (const action of plan.actions) {
      if (action.type === 'assign_worker') {
        const worker = (state.workers || []).find(item => String(item.id) === String(action.workerId));
        if (worker) {
          const previousWorker = (state.workers || []).find(item =>
            String(item.id) === String(job.assignedWorkerId)
            || item.name === job.worker
          );
          if (previousWorker && previousWorker.id !== worker.id) {
            this.releaseWorkerFromJob(previousWorker, job);
          }

          job.worker = worker.name;
          job.assignedWorkerId = worker.id;
          worker.status = 'active';
          worker.currentJob = job.title;
          worker.currentJobId = job.id;
          actionsApplied.push(`Assigned ${worker.name}`);
        }
      }

      if (action.type === 'prepare_tools') {
        for (const plannedTool of plan.toolPlan.reserved || []) {
          const tool = (state.tools || []).find(item =>
            String(item.id) === String(plannedTool.id)
            || this.matchesTool(item, plannedTool.name)
          );
          if (tool) {
            tool.status = 'reserved';
            tool.currentLocation = job.address || 'Reserved for job';
            tool.assignedJobId = job.id;
            tool.assignedWorkerId = job.assignedWorkerId || null;
          }
        }
        if ((plan.toolPlan.reserved || []).length) {
          actionsApplied.push('Prepared required tools');
        }
      }

      if (action.type === 'schedule_job' && plan.schedule) {
        job.status = 'scheduled';
        job.startDate = plan.schedule.start.slice(0, 10);
        job.estimatedCompletion = plan.schedule.end.slice(0, 10);
        job.scheduledStart = plan.schedule.start;
        job.scheduledEnd = plan.schedule.end;
        actionsApplied.push('Scheduled job');
      }
    }

    job.ai = {
      ...(job.ai || {}),
      confidence: plan.confidence,
      reasoning: plan.reasoning,
      riskLevel: plan.riskLevel,
      actions: actionsApplied,
      lastDecisionAt: this.now().toISOString()
    };

    return {
      success: true,
      plan,
      actionsApplied,
      job,
      message: actionsApplied.join(', ')
    };
  }

  runAutonomousCycle(state = {}, options = {}) {
    const maxActions = Math.max(1, Math.min(25, Number(options.maxActions || 5)));
    const targetState = options.dryRun ? this.cloneState(state) : state;
    const actions = [];
    const alerts = [];

    for (const job of targetState.jobs || []) {
      if (actions.length >= maxActions) break;

      if (job.status === 'pending') {
        const execution = this.executePlan(job.id, targetState);
        actions.push({
          jobId: job.id,
          type: execution.success ? 'plan_executed' : 'manual_review_required',
          message: execution.message,
          plan: execution.plan
        });
        if (!execution.success) {
          alerts.push({ jobId: job.id, severity: 'high', message: execution.message });
        }
        continue;
      }

      if (job.status === 'scheduled' && this.shouldStartJob(job)) {
        job.status = 'in_progress';
        job.progress = Math.max(Number(job.progress || 0), 10);
        const worker = (targetState.workers || []).find(item =>
          String(item.id) === String(job.assignedWorkerId)
          || item.name === job.worker
        );
        if (worker) {
          worker.status = 'active';
          worker.currentJob = job.title;
          worker.currentJobId = job.id;
        }
        for (const tool of targetState.tools || []) {
          if (String(tool.assignedJobId) === String(job.id)) {
            tool.status = 'in_use';
          }
        }
        job.ai = {
          ...(job.ai || {}),
          reasoning: 'Autonomous cycle started scheduled job at the planned time.',
          lastDecisionAt: this.now().toISOString()
        };
        actions.push({ jobId: job.id, type: 'job_started', message: `${job.title} started` });
        continue;
      }

      if (job.status === 'in_progress') {
        const nextProgress = Math.min(95, Number(job.progress || 0) + this.progressIncrement(job));
        job.progress = nextProgress;
        job.ai = {
          ...(job.ai || {}),
          reasoning: `Autonomous progress monitor updated job to ${nextProgress}%.`,
          lastDecisionAt: this.now().toISOString()
        };
        actions.push({ jobId: job.id, type: 'progress_updated', message: `${job.title} is ${nextProgress}% complete` });
      }
    }

    return {
      success: true,
      mode: options.dryRun ? 'dry_run' : 'applied',
      actions,
      alerts,
      insights: this.generateInsights(targetState),
      stateSummary: this.summarizeState(targetState),
      ranAt: this.now().toISOString()
    };
  }

  chat(message = '', state = {}) {
    const lower = message.toLowerCase();
    const summary = this.summarizeState(state);

    if (lower.includes('autonomous') || lower.includes('run') || lower.includes('decide')) {
      return {
        response: `Autonomous engine is ready. Current queue: ${summary.pendingJobs} pending, ${summary.scheduledJobs} scheduled, ${summary.inProgressJobs} active. Run a dry-run cycle to draft worker assignments, tool reservations, schedules, and client updates for review.`,
        suggestions: ['Preview autonomous cycle', 'Show pending jobs', 'Review high-risk jobs'],
        confidence: 'high'
      };
    }

    if (lower.includes('schedule') || lower.includes('plan')) {
      const nextPending = (state.jobs || []).find(job => job.status === 'pending') || (state.jobs || [])[0];
      const plan = nextPending ? this.createPlan(nextPending, state) : null;
      return {
        response: plan
          ? `Best next plan: ${plan.reasoning}`
          : 'There are no jobs to plan right now.',
        plan,
        suggestions: ['Review AI plan', 'Draft schedule', 'Check worker availability'],
        confidence: plan?.confidence || 'medium'
      };
    }

    if (lower.includes('worker') || lower.includes('team')) {
      const available = (state.workers || []).filter(worker => this.isWorkerAvailable(worker)).length;
      return {
        response: `${available} workers are available. ${summary.inProgressJobs} jobs are currently active, and ${summary.pendingJobs} jobs are waiting for assignment.`,
        suggestions: ['Assign pending jobs', 'Rebalance workload', 'Add worker'],
        confidence: 'high'
      };
    }

    if (lower.includes('tool') || lower.includes('equipment')) {
      const availableTools = (state.tools || []).filter(tool => this.toolStatus(tool) === 'available').length;
      return {
        response: `${availableTools} tools are available. I can draft required tool reservations for approval and flag conflicts before anything is committed.`,
        suggestions: ['Draft tool plan', 'Add tool', 'Review tool conflicts'],
        confidence: 'high'
      };
    }

    return {
      response: `I reviewed the current operation: ${summary.totalJobs} jobs, ${summary.availableWorkers} available workers, ${summary.availableTools} available tools. The next best action is to preview the autonomous cycle on pending work and approve any consequential changes.`,
      suggestions: ['Preview autonomous cycle', 'Create job plan', 'Review dashboard'],
      confidence: 'medium'
    };
  }

  classifyJob(text) {
    const profiles = [
      {
        match: ['leak', 'pipe', 'water', 'plumb', 'toilet', 'shower'],
        jobType: 'plumbing',
        requiredSkills: ['plumbing', 'repair'],
        requiredTools: ['Plumbing Kit'],
        weatherDependent: false
      },
      {
        match: ['bathroom', 'tile', 'shower', 'grout'],
        jobType: 'bathroom_renovation',
        requiredSkills: ['bathroom', 'tile', 'plumbing'],
        requiredTools: ['Tile Saw', 'Plumbing Kit'],
        weatherDependent: false
      },
      {
        match: ['kitchen', 'cabinet', 'countertop'],
        jobType: 'kitchen_renovation',
        requiredSkills: ['renovation', 'carpentry', 'installation'],
        requiredTools: ['Power tools', 'Measuring equipment'],
        weatherDependent: false
      },
      {
        match: ['garden', 'lawn', 'hedge', 'tree'],
        jobType: 'garden_maintenance',
        requiredSkills: ['garden', 'maintenance'],
        requiredTools: ['Lawn mower', 'Trimmer'],
        weatherDependent: true
      },
      {
        match: ['gutter', 'roof', 'ladder'],
        jobType: 'exterior_maintenance',
        requiredSkills: ['gutter', 'exterior', 'safety'],
        requiredTools: ['Extension Ladder', 'Safety Harness', 'Pressure Washer'],
        weatherDependent: true
      },
      {
        match: ['electric', 'socket', 'light', 'wiring'],
        jobType: 'electrical',
        requiredSkills: ['electrical', 'safety'],
        requiredTools: ['Electrical Kit', 'Measuring equipment'],
        weatherDependent: false
      }
    ];

    return profiles.find(profile => profile.match.some(term => text.includes(term))) || {
      jobType: 'general_maintenance',
      requiredSkills: ['general maintenance'],
      requiredTools: ['Basic tools'],
      weatherDependent: false
    };
  }

  detectUrgency(text, explicitUrgency) {
    if (explicitUrgency) return explicitUrgency;
    if (/(urgent|emergency|burst|flood|danger|critical|now|asap)/i.test(text)) return 'critical';
    if (/(soon|leak|blocked|broken|overflow)/i.test(text)) return 'high';
    if (/(quote|plan|renovation|replace)/i.test(text)) return 'medium';
    return 'low';
  }

  estimateComplexity(text, profile, urgency) {
    let score = 4;
    if (['bathroom_renovation', 'kitchen_renovation', 'electrical'].includes(profile.jobType)) score += 2;
    if (urgency === 'critical') score += 2;
    if (text.includes('complete') || text.includes('renovation')) score += 1;
    if (profile.requiredTools.length > 2) score += 1;
    return Math.max(1, Math.min(10, score));
  }

  estimateDuration(profile, complexityScore, urgency) {
    const baseHours = {
      plumbing: 3,
      bathroom_renovation: 18,
      kitchen_renovation: 24,
      garden_maintenance: 4,
      exterior_maintenance: 4,
      electrical: 3,
      general_maintenance: 4
    }[profile.jobType] || 4;
    const urgencyBuffer = urgency === 'critical' ? 0.8 : 1;
    return Math.max(1, Math.round(baseHours * (1 + complexityScore / 20) * urgencyBuffer));
  }

  calculatePricing(job) {
    const baseRate = 42;
    const urgencyMultiplier = { critical: 1.45, high: 1.2, medium: 1, low: 0.9 }[job.urgency] || 1;
    const complexityMultiplier = 1 + Math.max(0, Number(job.complexityScore || 5) - 5) * 0.08;
    const weatherMultiplier = job.weatherDependent ? 1.08 : 1;
    const hourlyRate = Math.round(baseRate * urgencyMultiplier * complexityMultiplier * weatherMultiplier);
    const equipmentCost = (job.requiredTools || []).length * 18;
    const totalCost = Math.round(hourlyRate * Number(job.estimatedHours || 4) + equipmentCost);
    return { hourlyRate, equipmentCost, totalCost };
  }

  rankWorkers(job, workers) {
    return workers
      .map(worker => {
        const skillScore = this.skillScore(job.requiredSkills, worker);
        const locationScore = this.locationScore(job.address || job.location, worker.location || worker.current_location);
        const ratingScore = Math.min(1, Number(worker.rating || worker.average_rating || 4.5) / 5);
        const workloadScore = worker.currentJob ? 0.45 : 1;
        const score = Number((skillScore * 0.42 + locationScore * 0.18 + ratingScore * 0.25 + workloadScore * 0.15).toFixed(2));
        const reasoning = [
          `skill match ${Math.round(skillScore * 100)}%`,
          `location fit ${Math.round(locationScore * 100)}%`,
          `rating ${Math.round(ratingScore * 100)}%`,
          worker.currentJob ? 'currently assigned' : 'available now'
        ];
        return { worker, score, reasoning };
      })
      .sort((a, b) => b.score - a.score);
  }

  skillScore(requiredSkills = [], worker = {}) {
    if (!requiredSkills.length) return 0.75;
    const workerText = [
      worker.specialty,
      ...(worker.skills || []),
      ...(worker.specialties || [])
    ].filter(Boolean).join(' ').toLowerCase();
    const matches = requiredSkills.filter(skill => workerText.includes(String(skill).toLowerCase())).length;
    return Math.max(0.2, matches / requiredSkills.length);
  }

  locationScore(jobLocation = '', workerLocation = '') {
    if (!jobLocation || !workerLocation) return 0.75;
    const jobCity = this.cityToken(jobLocation);
    const workerCity = this.cityToken(workerLocation);
    if (!jobCity || !workerCity) return 0.75;
    return jobCity === workerCity ? 1 : 0.65;
  }

  cityToken(value) {
    return String(value).split(',').pop().trim().toLowerCase();
  }

  planTools(job, tools) {
    const reserved = [];
    const missing = [];

    for (const required of job.requiredTools || job.tools || []) {
      const tool = tools.find(item => {
        if (!this.matchesTool(item, required)) return false;
        const status = this.toolStatus(item);
        if (status === 'available') return true;
        return status === 'reserved' && String(item.assignedJobId) === String(job.id);
      });
      if (tool) {
        reserved.push(tool);
      } else {
        missing.push(required);
      }
    }

    return { reserved, missing };
  }

  findScheduleSlot(job, worker, jobs) {
    const duration = Math.max(1, Number(job.estimatedHours || 4));
    const now = this.now();
    const urgent = ['critical', 'high', 'emergency'].includes(job.priority);
    const base = new Date(now);
    base.setMinutes(0, 0, 0);
    base.setHours(urgent ? Math.max(now.getHours() + 1, this.businessHours.start) : this.businessHours.start);

    for (let day = 0; day < 10; day += 1) {
      const date = new Date(base);
      date.setDate(base.getDate() + day);
      if (!urgent && date.getDay() === 0) continue;
      if (job.weatherDependent && !this.weatherAllowsOutdoorWork(date)) continue;

      for (let hour = this.businessHours.start; hour <= this.businessHours.end - Math.min(duration, 8); hour += 1) {
        const start = new Date(date);
        start.setHours(hour, 0, 0, 0);
        if (start < now && !urgent) continue;
        const end = new Date(start);
        end.setHours(start.getHours() + Math.min(duration, 8));
        if (!this.hasWorkerConflict(worker, start, end, jobs)) {
          return {
            start: start.toISOString(),
            end: end.toISOString(),
            reason: job.weatherDependent
              ? 'Selected earliest worker slot with acceptable weather'
              : 'Selected earliest worker slot without conflicts'
          };
        }
      }
    }

    return null;
  }

  hasWorkerConflict(worker, start, end, jobs) {
    return jobs.some(job => {
      if (!job.worker || job.worker !== worker.name) return false;
      if (!['scheduled', 'in_progress'].includes(job.status)) return false;
      const jobStart = job.scheduledStart || job.startDate;
      const jobEnd = job.scheduledEnd || job.estimatedCompletion;
      if (!jobStart || !jobEnd) return false;
      const existingStart = new Date(jobStart);
      const existingEnd = new Date(jobEnd);
      if (Number.isNaN(existingStart.getTime()) || Number.isNaN(existingEnd.getTime())) return false;
      return start < existingEnd && end > existingStart;
    });
  }

  weatherAllowsOutdoorWork(date) {
    const daySeed = date.getDate() + date.getMonth() * 3;
    const rainRisk = daySeed % 7;
    return rainRisk < 5;
  }

  shouldStartJob(job) {
    const scheduled = job.scheduledStart || job.startDate;
    if (!scheduled) return false;
    const scheduledDate = new Date(scheduled);
    if (Number.isNaN(scheduledDate.getTime())) return false;
    return scheduledDate <= this.now();
  }

  progressIncrement(job) {
    if (job.priority === 'critical') return 25;
    if (Number(job.estimatedHours || 4) <= 4) return 20;
    return 10;
  }

  isWorkerAvailable(worker, job = {}) {
    const status = String(worker.status || '').toLowerCase();
    if (
      (job.id !== undefined && job.id !== null && worker.currentJobId !== undefined && worker.currentJobId !== null
        && String(worker.currentJobId) === String(job.id))
      || (job.worker && worker.name === job.worker)
    ) {
      return true;
    }
    if (['available', 'traveling'].includes(status)) return true;
    return false;
  }

  releaseWorkerFromJob(worker, job) {
    if (!worker || !job) return;
    const matchesJob = String(worker.currentJobId || '') === String(job.id || '')
      || worker.currentJob === job.title;
    if (!matchesJob) return;
    worker.status = 'available';
    worker.currentJob = null;
    worker.currentJobId = null;
  }

  releaseJobResources(job, state = {}) {
    if (!job) {
      return { worker: null, tools: [] };
    }

    const worker = (state.workers || []).find(item =>
      String(item.id) === String(job.assignedWorkerId)
      || item.name === job.worker
    );
    if (worker) {
      this.releaseWorkerFromJob(worker, job);
    }

    const releasedTools = [];
    for (const tool of state.tools || []) {
      if (String(tool.assignedJobId || '') !== String(job.id || '')) continue;
      tool.status = 'available';
      tool.assignedJobId = null;
      tool.assignedWorkerId = null;
      tool.currentLocation = tool.homeLocation || 'Warehouse';
      releasedTools.push(tool);
    }

    return { worker: worker || null, tools: releasedTools };
  }

  cloneState(state = {}) {
    return {
      jobs: JSON.parse(JSON.stringify(state.jobs || [])),
      workers: JSON.parse(JSON.stringify(state.workers || [])),
      tools: JSON.parse(JSON.stringify(state.tools || []))
    };
  }

  matchesTool(tool, required) {
    const requiredText = String(required || '').toLowerCase();
    const toolText = [tool.name, tool.category].filter(Boolean).join(' ').toLowerCase();
    return toolText.includes(requiredText) || requiredText.includes(toolText) || requiredText.split(' ').some(part => part.length > 4 && toolText.includes(part));
  }

  toolStatus(tool) {
    return String(tool.status || 'available').toLowerCase();
  }

  calculateRiskLevel(job, worker, toolPlan, schedule) {
    let risk = 0;
    if (!worker) risk += 4;
    if (!schedule) risk += 3;
    if (toolPlan.missing.length) risk += 2;
    if (job.priority === 'critical') risk += 1;
    if (Number(job.complexityScore || 5) >= 8) risk += 1;
    if (risk >= 5) return 'high';
    if (risk >= 2) return 'medium';
    return 'low';
  }

  planConfidence(workerScore, toolPlan, schedule) {
    let confidence = Number(workerScore || 0.45);
    if (!schedule) confidence -= 0.2;
    if (toolPlan.missing.length) confidence -= 0.15;
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium';
    return 'low';
  }

  planReasoning(job, worker, toolPlan, schedule) {
    const parts = [];
    parts.push(worker ? `${worker.name} is the best worker match` : 'No suitable worker is available');
    parts.push(toolPlan.missing.length ? `Missing tools: ${toolPlan.missing.join(', ')}` : 'Required tools can be prepared');
    parts.push(schedule ? 'A schedule slot is available' : 'No schedule slot is available');
    if (job.weatherDependent) parts.push('Weather was considered for outdoor work');
    return parts.join('. ') + '.';
  }

  generateClientUpdate(job, worker, schedule) {
    if (!worker || !schedule) {
      return `Hi ${job.client || 'there'}, we received your request for ${job.title}. We are checking availability and will confirm the plan shortly.`;
    }
    const start = new Date(schedule.start).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    return `Hi ${job.client || 'there'}, ${worker.name} is assigned to ${job.title}. Planned start: ${start}. We will keep you updated.`;
  }

  generateInsights(state) {
    const summary = this.summarizeState(state);
    const insights = [];
    if (summary.pendingJobs > 0) insights.push(`${summary.pendingJobs} jobs are ready for autonomous planning.`);
    if (summary.availableWorkers === 0) insights.push('No workers are currently available; new jobs may need manual review.');
    if (summary.availableTools < 2) insights.push('Tool availability is tight; reserve equipment before accepting more work.');
    if (!insights.length) insights.push('Operation is balanced. No immediate autonomous intervention required.');
    return insights;
  }

  summarizeState(state) {
    const jobs = state.jobs || [];
    const workers = state.workers || [];
    const tools = state.tools || [];
    return {
      totalJobs: jobs.length,
      pendingJobs: jobs.filter(job => job.status === 'pending').length,
      scheduledJobs: jobs.filter(job => job.status === 'scheduled').length,
      inProgressJobs: jobs.filter(job => job.status === 'in_progress').length,
      completedJobs: jobs.filter(job => job.status === 'completed').length,
      availableWorkers: workers.filter(worker => this.isWorkerAvailable(worker)).length,
      availableTools: tools.filter(tool => this.toolStatus(tool) === 'available').length
    };
  }

  buildAnalysisReasoning(profile, urgency, complexityScore) {
    return `${this.titleFromType(profile.jobType)} detected with ${urgency} priority and complexity ${complexityScore}/10.`;
  }

  buildClientQuestions(profile, text) {
    const questions = [];
    if (!text.includes('photo')) questions.push('Can the client send a photo of the work area?');
    if (profile.weatherDependent) questions.push('Is there safe access to the outdoor work area?');
    if (profile.jobType.includes('renovation')) questions.push('Does the client already have preferred materials or fixtures?');
    return questions;
  }

  identifyJobRisks({ profile, urgency, text }) {
    const risks = [];
    if (urgency === 'critical') risks.push('Immediate response may disrupt existing schedule');
    if (profile.weatherDependent) risks.push('Weather can delay outdoor work');
    if (text.includes('water') || text.includes('electric')) risks.push('Safety check required before work starts');
    return risks;
  }

  normalizeJob(job) {
    const description = job.description || job.message || '';
    const analysis = job.jobType
      ? {
          jobType: job.jobType,
          priority: job.priority || 'medium',
          complexityScore: job.complexityScore || 5,
          estimatedHours: job.estimatedHours || 4,
          weatherDependent: Boolean(job.weatherDependent),
          requiredSkills: job.requiredSkills || [],
          requiredTools: job.tools || job.requiredTools || [],
          estimatedCost: job.estimatedCost || job.estimated_cost || 0,
          confidence: job.ai?.confidence || 'medium',
          reasoning: job.ai?.reasoning || ''
        }
      : this.analyzeJobRequest({ ...job, description });

    return {
      ...job,
      client: job.client || job.client_name,
      address: job.address || job.location,
      progress: Number(job.progress ?? job.progress_percentage ?? 0),
      estimatedCost: Number(job.estimatedCost ?? job.estimated_cost ?? analysis.estimatedCost),
      priority: job.priority || analysis.priority,
      jobType: analysis.jobType,
      complexityScore: analysis.complexityScore,
      estimatedHours: analysis.estimatedHours,
      weatherDependent: analysis.weatherDependent,
      requiredSkills: job.requiredSkills || analysis.requiredSkills,
      requiredTools: job.requiredTools || job.tools || analysis.requiredTools
    };
  }

  titleFromType(jobType) {
    return String(jobType || 'general_maintenance')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  nextId(items) {
    return Math.max(0, ...items.map(item => Number(item.id) || 0)) + 1;
  }

  emptyPlan(reason) {
    return {
      status: 'blocked',
      confidence: 'low',
      riskLevel: 'high',
      requiresApproval: true,
      reasoning: reason,
      actions: [],
      workerRanking: [],
      toolPlan: { reserved: [], missing: [] },
      schedule: null,
      createdAt: this.now().toISOString()
    };
  }
}

module.exports = { AutonomousContractorEngine };
