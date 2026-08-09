const catalogSource = require('./contractor-framework-catalog.json');

const FAMILY_GUIDANCE = {
  1: ['Define the operating model and customer value.', 'Choose the revenue, delivery, and ownership trade-offs.', 'Record the evidence that would invalidate the model.'],
  2: ['Define the strategic question and time horizon.', 'Compare position, capabilities, and external conditions.', 'Record the selected trade-offs, owner, and review trigger.'],
  3: ['Define the customer, geography, and need.', 'Compare attractiveness, fit, urgency, and profitability evidence.', 'Record the target segment and excluded segments.'],
  4: ['Define the opportunity and decision gate.', 'Retain qualification, compliance, competitor, and price evidence.', 'Record the pursuit decision and next review.'],
  5: ['Define scope, parties, and delivery responsibility.', 'Compare risk allocation, design control, timing, and collaboration.', 'Record the selected delivery route and project constraints.'],
  6: ['Identify the contract or sector system and edition.', 'Retain applicability, amendments, precedence, and advice.', 'Record the controlled project interpretation without making a legal claim.'],
  7: ['Define the priced outcome and payment mechanism.', 'Test cash flow, risk transfer, measurement, and margin effects.', 'Record the approved pricing basis and change rules.'],
  8: ['Define estimate class, scope, and source date.', 'Retain quantities, rates, productivity, uncertainty, and exclusions.', 'Compare estimate to actuals and record the learning loop.'],
  9: ['Define the project decision and control horizon.', 'Retain scope, schedule, resource, dependency, and variance evidence.', 'Record the baseline, exception threshold, and owner.'],
  10: ['Define the flow or productivity constraint.', 'Measure current work, waste, reliability, and causes of variance.', 'Record the experiment, standard, and follow-up measure.'],
  11: ['Define the quality requirement and acceptance evidence.', 'Retain inspection, defect, cause, and corrective-action evidence.', 'Record hold points, accountable owner, and closure criteria.'],
  12: ['Define the activity, hazard, and exposed people.', 'Apply the hierarchy of controls and retain competency evidence.', 'Record stop-work, verification, and escalation criteria.'],
  13: ['Define the uncertain event, cause, and consequence.', 'Assess likelihood, impact, proximity, and control effectiveness.', 'Record response, residual exposure, owner, and trigger.'],
  14: ['Define the package, supply risk, and required capability.', 'Compare compliance, capacity, cost, lead time, and concentration.', 'Record the sourcing decision, controls, and review date.'],
  15: ['Define the financial decision and reporting period.', 'Retain source-linked cost, commitment, cash, and variance evidence.', 'Record thresholds, forecast action, and accountable owner.'],
  16: ['Define the role, capability, and capacity requirement.', 'Compare competency, availability, workload, and development evidence.', 'Record responsibility, delegation, and training action.'],
  17: ['Define the customer stage, expectation, and outcome.', 'Retain feedback, effort, communication, and recovery evidence.', 'Record the service change, owner, and follow-up signal.'],
  18: ['Define the asset, function, and criticality.', 'Compare condition, utilization, reliability, cost, and safety evidence.', 'Record maintain, repair, replace, rent, or retire decisions.'],
  19: ['Define the boundary, baseline, and environmental outcome.', 'Retain factor provenance, material, energy, waste, and carbon evidence.', 'Record reduction action without making an unsupported certification claim.'],
  20: ['Define information purpose, owner, exchange, and lifecycle.', 'Retain format, version, access, quality, and security requirements.', 'Record the controlled information delivery and acceptance rule.'],
  21: ['Define the obligation, authority, and control objective.', 'Retain policy, approval, segregation, privacy, and audit evidence.', 'Record the decision, retention rule, escalation, and independent review.'],
  22: ['Define the decision or problem precisely.', 'Separate facts, assumptions, options, criteria, and uncertainty.', 'Record the chosen action, dissent, expected outcome, and review date.'],
  23: ['Define the metric, period, source, target, and owner.', 'Compare trend, target, leading signals, and data-quality gaps.', 'Record the operating response and next measurement date.'],
};

const FAMILY_PLAYBOOKS = {
  1: {
    recommendedScope: 'organization', reviewCadenceDays: 90,
    evidenceSuggestions: ['Customer and service-line demand evidence', 'Revenue, margin, and recurring-work mix', 'Delivery capacity and ownership constraints'],
    measureSuggestions: ['Gross margin by service line', 'Repeat or recurring customer share', 'Revenue per crew-day'],
    safeguards: ['Validate assumptions before changing prices, ownership, staffing, or customer commitments.'],
  },
  2: {
    recommendedScope: 'organization', reviewCadenceDays: 90,
    evidenceSuggestions: ['Current scorecard and strategic objectives', 'Pipeline, market, and competitor evidence', 'Capability, capacity, and investment constraints'],
    measureSuggestions: ['Strategic objective completion rate', 'Portfolio gross-margin movement', 'Overdue strategic actions'],
    safeguards: ['Keep facts, assumptions, scenarios, and approved commitments distinguishable.'],
  },
  3: {
    recommendedScope: 'organization', reviewCadenceDays: 90,
    evidenceSuggestions: ['Lead, win-loss, and customer feedback records', 'Customer and service-line profitability', 'Service-area demand and route-density evidence'],
    measureSuggestions: ['Qualified opportunity conversion rate', 'Gross margin by target segment', 'Customer concentration percentage'],
    safeguards: ['Do not target or exclude people using protected personal characteristics.'],
  },
  4: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Opportunity qualification and client requirements', 'Tender compliance, competitor, and price evidence', 'Relevant capacity, reference work, and risk evidence'],
    measureSuggestions: ['Bid-hit or quote-conversion rate', 'Estimate-to-decision cycle time', 'Won-work forecast gross margin'],
    safeguards: ['A pursuit decision cannot submit a tender, quote, message, or price without its separate approval path.'],
  },
  5: {
    recommendedScope: 'job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Controlled scope and responsibility matrix', 'Design, schedule, interface, and risk allocation', 'Contract amendments and collaboration decisions'],
    measureSuggestions: ['Decision turnaround time', 'Schedule variance against approved baseline', 'Rework caused by interface gaps'],
    safeguards: ['Retain project-specific commercial and legal review before adopting a delivery route.'],
  },
  6: {
    recommendedScope: 'job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Signed contract suite, edition, and precedence', 'Project amendments, notices, and interpretations', 'Qualified legal or contract-administration advice'],
    measureSuggestions: ['Unresolved contractual actions', 'Notice compliance rate', 'Unrecovered authorized change value'],
    safeguards: ['This register records controlled interpretation evidence and does not provide legal advice.'],
  },
  7: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Approved scope, estimate, and pricing basis', 'Payment timing, retention, and cash-flow exposure', 'Change, escalation, allowance, and margin rules'],
    measureSuggestions: ['Forecast gross margin', 'Peak cash exposure', 'Authorized change recovery rate'],
    safeguards: ['Pricing and payment changes require commercial approval and never move funds automatically.'],
  },
  8: {
    recommendedScope: 'job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Source-dated quantity takeoff and WBS', 'Approved labor, material, equipment, and overhead rates', 'Comparable actual cost and productivity records'],
    measureSuggestions: ['Estimate-to-actual variance', 'Labor productivity variance', 'Gross-margin fade or gain'],
    safeguards: ['Retain source dates, uncertainty, assumptions, exclusions, and estimate class.'],
  },
  9: {
    recommendedScope: 'job', reviewCadenceDays: 14,
    evidenceSuggestions: ['Approved scope and schedule baseline', 'Dependencies, resources, constraints, and RAID records', 'Current progress, forecast, and decision logs'],
    measureSuggestions: ['Schedule adherence', 'Percent Plan Complete', 'Overdue blocker count'],
    safeguards: ['Do not replace an approved baseline or commitment without the governed change path.'],
  },
  10: {
    recommendedScope: 'job', reviewCadenceDays: 14,
    evidenceSuggestions: ['Observed workflow, handoffs, queues, and constraints', 'Plan reliability and reasons for variance', 'Current standard work and improvement experiments'],
    measureSuggestions: ['Cycle or lead time', 'Percent Plan Complete', 'Work-in-progress or constraint age'],
    safeguards: ['Productivity experiments cannot bypass safety, quality, competency, or worker consultation controls.'],
  },
  11: {
    recommendedScope: 'job', reviewCadenceDays: 14,
    evidenceSuggestions: ['Controlled requirements, drawings, and inspection plan', 'Inspection, defect, NCR, and corrective-action evidence', 'Hold, witness, acceptance, and handover records'],
    measureSuggestions: ['First-pass acceptance rate', 'Rework or defect frequency', 'Corrective-action closure time'],
    safeguards: ['Hold-point release requires current evidence and independent approval where configured.'],
  },
  12: {
    recommendedScope: 'job', reviewCadenceDays: 7,
    evidenceSuggestions: ['Current risk assessment, JHA, LMRA, and permits', 'Worker competency, briefing, and acknowledgement evidence', 'Incident, observation, near-miss, and control verification'],
    measureSuggestions: ['Critical controls verified before work', 'Overdue safety corrective actions', 'Incident and near-miss trend'],
    safeguards: ['Preserve stop-work authority; the application does not certify legal or physical site safety.'],
  },
  13: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Current risk register and premortem', 'Cost, schedule, contract, safety, and supply exposure', 'Control effectiveness, triggers, and contingency evidence'],
    measureSuggestions: ['High-risk action age', 'Residual exposure movement', 'Contingency drawdown against plan'],
    safeguards: ['A risk response does not itself bind insurance, legal, supplier, schedule, or spending commitments.'],
  },
  14: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Supplier capability and compliance records', 'Comparable bids, total cost, lead time, and capacity', 'Concentration, logistics, quality, and corrective-action evidence'],
    measureSuggestions: ['On-time and complete delivery rate', 'Receipt discrepancy rate', 'Supplier concentration percentage'],
    safeguards: ['Selection, order issue, delivery, and payment remain separate approval and provider-evidence steps.'],
  },
  15: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Approved budgets and source-linked actual costs', 'Issued commitments, invoices, receipts, and payment evidence', 'Current cost-to-complete, cash, and backlog forecast'],
    measureSuggestions: ['Forecast accuracy', 'Gross-margin fade or gain', 'Days sales outstanding or cash-conversion trend'],
    safeguards: ['Forecasts and reconciliations do not post accounts, initiate payments, or certify financial statements.'],
  },
  16: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Skills, qualifications, and role requirements', 'Availability, workload, assignment, and capacity records', 'Training, delegation, and development actions'],
    measureSuggestions: ['Critical-skill coverage', 'Crew utilization with overtime context', 'Overdue qualification or training actions'],
    safeguards: ['Retain only necessary workforce data and do not infer competency or sensitive characteristics.'],
  },
  17: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Customer journey, communication, and expectation records', 'NPS, CSAT, effort, complaint, and warranty evidence', 'Selection, handover, recovery, and consent records'],
    measureSuggestions: ['NPS, CSAT, or customer-effort result', 'Complaint or warranty closure time', 'Repeat-customer rate'],
    safeguards: ['Consent and approval remain required before testimonials, referrals, reviews, messages, or new work.'],
  },
  18: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Asset identity, criticality, custody, and condition', 'Inspection, calibration, maintenance, and repair records', 'Utilization, downtime, cost, and replacement evidence'],
    measureSuggestions: ['Equipment utilization', 'Unplanned downtime', 'Overdue inspection or maintenance count'],
    safeguards: ['Unsafe, damaged, lost, or unverified equipment remains quarantined from dispatch.'],
  },
  19: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 90,
    evidenceSuggestions: ['Defined boundary, baseline, and factor provenance', 'Material, waste, energy, transport, and water records', 'Design, supplier, and reduction-action evidence'],
    measureSuggestions: ['Source-linked emissions movement', 'Waste diversion or material recovery rate', 'Energy or fuel intensity'],
    safeguards: ['Calculations remain evidence records and do not claim certification, taxonomy alignment, or regulatory submission.'],
  },
  20: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Information requirements, owners, formats, and exchanges', 'Controlled revisions, access, approvals, and transmittals', 'Data quality, security, backup, and acceptance evidence'],
    measureSuggestions: ['Overdue information exchanges', 'Revision or coordination error rate', 'Approval and acknowledgment turnaround time'],
    safeguards: ['Apply least privilege and retain authoritative source, version, access, and acceptance boundaries.'],
  },
  21: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 90,
    evidenceSuggestions: ['Applicable obligation, policy, authority, and control', 'Approval, segregation, privacy, retention, and audit records', 'Exception, complaint, incident, and escalation evidence'],
    measureSuggestions: ['Overdue approvals or control actions', 'Open control exceptions', 'Audit finding closure time'],
    safeguards: ['Jurisdiction, retention, privacy, and legal interpretation require qualified review and operator policy.'],
  },
  22: {
    recommendedScope: 'organization_or_job', reviewCadenceDays: 30,
    evidenceSuggestions: ['Problem statement, facts, assumptions, and uncertainty', 'Options, criteria, trade-offs, and dissent', 'Decision, expected outcome, trigger, and follow-up evidence'],
    measureSuggestions: ['Decision cycle time', 'Expected-versus-observed outcome variance', 'Overdue decision review triggers'],
    safeguards: ['A recorded decision remains internal until its separate operational or external approval is complete.'],
  },
  23: {
    recommendedScope: 'organization', reviewCadenceDays: 30,
    evidenceSuggestions: ['Metric definition, source, owner, period, and target', 'Current and prior scorecard snapshots', 'Data-quality gaps, exceptions, and operating actions'],
    measureSuggestions: ['Target attainment by perspective', 'Metric data-completeness rate', 'Adverse trend and overdue action count'],
    safeguards: ['Missing or stale source data remains no-data and is never converted into a favorable value.'],
  },
};

const PLAYBOOK_FORMAT = 'contractor-ai/framework-family-playbook-v1';

function validateFamilyPlaybook(number, playbook) {
  if (
    !['organization', 'job', 'organization_or_job'].includes(playbook?.recommendedScope)
    || !Number.isInteger(playbook?.reviewCadenceDays)
    || playbook.reviewCadenceDays < 1
    || !Array.isArray(playbook.evidenceSuggestions)
    || playbook.evidenceSuggestions.length < 3
    || !Array.isArray(playbook.measureSuggestions)
    || playbook.measureSuggestions.length < 3
    || !Array.isArray(playbook.safeguards)
    || playbook.safeguards.length < 1
  ) {
    throw new Error(`Contractor.AI framework family ${number} has an incomplete operating playbook.`);
  }
  return { format: PLAYBOOK_FORMAT, ...playbook };
}

function validateCatalog(source = catalogSource) {
  if (source?.format !== 'contractor-ai/framework-catalog-v1' || source?.version !== 1) {
    throw new Error('Unsupported Contractor.AI framework catalog format.');
  }
  if (source.counts?.families !== 23 || source.counts?.frameworks !== 671 || source.counts?.familyMemberships !== 700) {
    throw new Error('Contractor.AI framework catalog coverage is incomplete.');
  }
  const familyIds = new Set(source.families.map(family => family.id));
  const frameworkIds = new Set();
  for (const framework of source.frameworks) {
    if (!framework.id || !framework.name || frameworkIds.has(framework.id)) {
      throw new Error('Contractor.AI framework catalog contains an invalid or duplicate framework.');
    }
    if (!framework.familyIds?.length || framework.familyIds.some(id => !familyIds.has(id))) {
      throw new Error(`Contractor.AI framework ${framework.id} has an invalid family membership.`);
    }
    frameworkIds.add(framework.id);
  }
  return source;
}

const validatedCatalog = validateCatalog();
const families = validatedCatalog.families.map(family => ({
  ...family,
  guidance: FAMILY_GUIDANCE[family.number],
  playbook: validateFamilyPlaybook(family.number, FAMILY_PLAYBOOKS[family.number]),
  frameworkCount: validatedCatalog.frameworks.filter(framework => framework.familyIds.includes(family.id)).length,
}));
const familyById = new Map(families.map(family => [family.id, family]));
const frameworkById = new Map(validatedCatalog.frameworks.map(framework => [framework.id, framework]));

function getFrameworkDefinition(frameworkId) {
  const framework = frameworkById.get(String(frameworkId || '').trim());
  if (!framework) return null;
  return {
    ...framework,
    families: framework.familyIds.map(id => familyById.get(id)),
  };
}

function compactFrameworkCatalogItem(framework) {
  return {
    ...framework,
    families: framework.familyIds.map(id => {
      const family = familyById.get(id);
      return { id: family.id, number: family.number, name: family.name };
    }),
  };
}

function compatibleFrameworkCatalogItem(framework) {
  return {
    ...framework,
    families: framework.familyIds.map(id => {
      const family = familyById.get(id);
      return {
        id: family.id,
        number: family.number,
        name: family.name,
        guidance: family.guidance,
        frameworkCount: family.frameworkCount,
      };
    }),
  };
}

function listFrameworkCatalog(options = {}) {
  const familyId = String(options.familyId || options.family_id || '').trim();
  const query = String(options.query || options.q || '').trim().toLowerCase();
  const parsedLimit = Number(options.limit ?? 1_000);
  const limit = Number.isInteger(parsedLimit) ? Math.min(1_000, Math.max(1, parsedLimit)) : 1_000;
  const parsedOffset = Number(options.offset ?? 0);
  const offset = Number.isInteger(parsedOffset) ? Math.max(0, parsedOffset) : 0;
  const compactFamilies = options.compactFamilies === true
    || ['1', 'true'].includes(String(options.compactFamilies || options.compact_families || '').toLowerCase());
  const matches = validatedCatalog.frameworks.filter(framework => (
    (!familyId || framework.familyIds.includes(familyId))
    && (!query || framework.name.toLowerCase().includes(query) || framework.id.includes(query))
  ));
  return {
    format: validatedCatalog.format,
    version: validatedCatalog.version,
    playbookFormat: PLAYBOOK_FORMAT,
    familyRepresentation: compactFamilies ? 'compact' : 'compatible',
    counts: validatedCatalog.counts,
    families,
    frameworks: matches.slice(offset, offset + limit).map(
      compactFamilies ? compactFrameworkCatalogItem : compatibleFrameworkCatalogItem,
    ),
    page: {
      offset,
      limit,
      returned: Math.min(limit, Math.max(0, matches.length - offset)),
      total: matches.length,
      hasMore: offset + limit < matches.length,
    },
  };
}

module.exports = {
  FAMILY_GUIDANCE,
  FAMILY_PLAYBOOKS,
  PLAYBOOK_FORMAT,
  getFrameworkDefinition,
  listFrameworkCatalog,
  validateCatalog,
};
