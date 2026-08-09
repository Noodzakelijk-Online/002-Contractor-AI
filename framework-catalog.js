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

function listFrameworkCatalog(options = {}) {
  const familyId = String(options.familyId || options.family_id || '').trim();
  const query = String(options.query || options.q || '').trim().toLowerCase();
  const parsedLimit = Number(options.limit ?? 1_000);
  const limit = Number.isInteger(parsedLimit) ? Math.min(1_000, Math.max(1, parsedLimit)) : 1_000;
  const parsedOffset = Number(options.offset ?? 0);
  const offset = Number.isInteger(parsedOffset) ? Math.max(0, parsedOffset) : 0;
  const matches = validatedCatalog.frameworks.filter(framework => (
    (!familyId || framework.familyIds.includes(familyId))
    && (!query || framework.name.toLowerCase().includes(query) || framework.id.includes(query))
  ));
  return {
    format: validatedCatalog.format,
    version: validatedCatalog.version,
    counts: validatedCatalog.counts,
    families,
    frameworks: matches.slice(offset, offset + limit).map(framework => getFrameworkDefinition(framework.id)),
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
  getFrameworkDefinition,
  listFrameworkCatalog,
  validateCatalog,
};
