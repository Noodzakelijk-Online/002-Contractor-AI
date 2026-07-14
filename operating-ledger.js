const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { PostgresSyncDatabase } = require('./postgres-sync-database');

const LEDGER_CAPABILITY_BLUEPRINT = [
  {
    key: 'preconstruction',
    label: 'Preconstruction CRM and estimating',
    vendors: ['Buildr', 'Autodesk', 'Procore', 'Contractor Foreman', 'Sage'],
    capabilities: ['opportunities', 'client pipeline', 'takeoff', 'estimating', 'quote control', 'resource planning', 'handover'],
    sourceEvidence: [
      'Buildr emphasizes preconstruction CRM, estimate tracking, workforce planning, forecasting and project handover.',
      'Autodesk and Procore both surface bid/tender management, document control, estimating and project data as core construction workflows.'
    ],
    serviceGroups: [
      { name: 'Sales and preconstruction', services: ['Lead intake', 'opportunity qualification', 'site visit planning', 'estimate/quote draft', 'resource forecast'] },
      { name: 'Handover', services: ['Approved quote to job package', 'scope assumptions', 'client decisions', 'budget baseline'] }
    ]
  },
  {
    key: 'project-execution',
    label: 'Project execution ledger',
    vendors: ['Procore', 'Autodesk', 'Buildertrend', 'Contractor Foreman'],
    capabilities: ['jobs', 'tasks', 'schedule', 'site visits', 'change orders', 'RFIs', 'submittals', 'daily logs', 'photos', 'documents', 'punch and closeout'],
    sourceEvidence: [
      'Procore lists project management, schedule, site diary, observations, submittals, photos, snag/punch and closeout-style execution tools.',
      'Buildertrend and Contractor Foreman emphasize schedules, change orders, daily logs, punch lists, work orders and document control.'
    ],
    serviceGroups: [
      { name: 'Execution control', services: ['Job tasks', 'schedule plan', 'change control', 'RFI trail', 'submittal package'] },
      { name: 'Evidence and closeout', services: ['Daily report', 'documents/photos', 'punch list', 'handover readiness'] }
    ]
  },
  {
    key: 'field-production',
    label: 'Field production and resources',
    vendors: ['Raken', 'Procore', 'Contractor Foreman'],
    capabilities: ['daily field reports', 'RFIs', 'time tracking', 'production tracking', 'material tracking', 'equipment tracking', 'kiosk attendance', 'labor map'],
    sourceEvidence: [
      'Raken focuses on field-first daily reports, photo documentation, time tracking, production tracking, resource scheduling, material tracking and equipment management.',
      'Procore adds daywork sheets, resource tracking, timecards and equipment visibility.'
    ],
    serviceGroups: [
      { name: 'Field capture', services: ['Progress update', 'daily field report', 'photo evidence', 'time log'] },
      { name: 'Production resources', services: ['Material needs', 'tool/equipment reservation', 'worker instruction', 'production variance'] }
    ]
  },
  {
    key: 'safety-quality',
    label: 'Safety, quality, and site access',
    vendors: ['HammerTech', 'Raken', 'Contractor Foreman', 'Procore'],
    capabilities: ['orientations', 'JHAs', 'SDS', 'pre-task plans', 'permits', 'inspections', 'incidents', 'site access'],
    sourceEvidence: [
      'HammerTech centers on safety platform operations: orientations, JHAs, SDS, pre-task plans, permits, safety meetings, incidents, inspections and site access.',
      'Raken and Contractor Foreman add managed checklists, observations, incidents, toolbox talks, quality management and compliance proof.'
    ],
    serviceGroups: [
      { name: 'Mobilization safety', services: ['Orientation', 'JHA', 'SDS register', 'site access gate'] },
      { name: 'Quality assurance', services: ['Permit', 'inspection', 'observation', 'incident', 'safety talk'] }
    ]
  },
  {
    key: 'financial-control',
    label: 'Financial control and payments',
    vendors: ['Sage 100 Contractor', 'Built', 'Buildertrend', 'Contractor Foreman', 'Procore'],
    capabilities: ['job costing', 'scope-change approval', 'purchase orders', 'invoices', 'AIA/progress billing', 'draws', 'lien waivers', 'payments', 'risk controls'],
    sourceEvidence: [
      'Sage Construction Management emphasizes financials, contracts, change control, invoicing and construction accounting visibility.',
      'Built focuses on budget/draw management, invoice management, compliance tracking, lien waiver management, payments and risk mitigation.'
    ],
    serviceGroups: [
      { name: 'Cost control', services: ['Budget line', 'expense', 'purchase order', 'change order', 'invoice draft'] },
      { name: 'Payment risk', services: ['Payment follow-up', 'draw request', 'waiver/compliance hold', 'finance handoff'] }
    ]
  },
  {
    key: 'client-portal',
    label: 'Client portal and communication',
    vendors: ['Buildertrend', 'Contractor Foreman', 'Raken'],
    capabilities: ['client updates', 'selections', 'messages', 'approvals', 'service tickets', 'warranty'],
    sourceEvidence: [
      'Buildertrend emphasizes CRM, proposals, client portal, client updates, selections, change orders, communication, service and warranty.',
      'Contractor Foreman exposes client portal, work orders, service tickets, punch lists, daily logs and team communication.'
    ],
    serviceGroups: [
      { name: 'Client control', services: ['Draft client update', 'client selection', 'approval gate', 'reply follow-up'] },
      { name: 'Aftercare', services: ['Punch item', 'warranty claim', 'aftercare task', 'recurring service plan'] }
    ]
  },
  {
    key: 'eu-compliance',
    label: 'Netherlands and EU operating controls',
    vendors: ['Regional compliance', 'Sage', 'Built'],
    capabilities: ['permits', 'Peppol/UBL', 'VAT', 'GDPR', 'Wkb dossier', 'VCA certificates', 'CO2 reporting', 'approval audit'],
    sourceEvidence: [
      'Dutch and wider EU usage needs local proof controls layered over generic contractor software: Wkb-style evidence, VCA safety proof, VAT/UBL/Peppol readiness and GDPR-aware audit trails.',
      'Built-style finance risk controls map to EU subcontractor/payment holds and invoice evidence before money moves.'
    ],
    serviceGroups: [
      { name: 'Regulatory proof', services: ['Permit register', 'Wkb evidence package', 'VCA/SDS/site access proof', 'approval audit'] },
      { name: 'EU finance handoff', services: ['VAT/UBL invoice signal', 'finance export package', 'payment/compliance hold'] }
    ]
  }
];

const LEDGER_CAPABILITY_REQUIREMENTS = {
  preconstruction: [
    { key: 'intake', label: 'Client intake', table: 'job_requests', detailKey: 'request' },
    { key: 'quote', label: 'Quote or estimate', table: 'quotes', detailKey: 'quotes' },
    { key: 'site_visit', label: 'Site visit / survey', table: 'site_visits', detailKey: 'siteVisits' },
    { key: 'materials', label: 'Material scope', table: 'material_requirements', detailKey: 'materials' },
    { key: 'tools', label: 'Tool plan', table: 'tool_reservations', detailKey: 'tools' },
    { key: 'assignment', label: 'Resource plan', table: 'assignments', detailKey: 'assignments' }
  ],
  'project-execution': [
    { key: 'job', label: 'Job package', table: 'jobs', detailKey: 'id' },
    { key: 'tasks', label: 'Tasks', table: 'job_tasks', detailKey: 'tasks' },
    { key: 'schedule', label: 'Route or schedule plan', table: 'route_plans', detailKey: 'routePlans' },
    { key: 'change_order', label: 'Change control', table: 'change_orders', detailKey: 'changeOrders' },
    { key: 'rfi', label: 'RFI trail', table: 'rfi_records', detailKey: 'rfis' },
    { key: 'submittal', label: 'Submittals', table: 'submittal_records', detailKey: 'submittals' },
    { key: 'field_report', label: 'Daily field report', table: 'field_reports', detailKey: 'fieldReports' },
    { key: 'documents', label: 'Documents/photos', table: 'documents', detailKey: 'documents' },
    { key: 'closeout', label: 'Punch/closeout', table: 'punch_items', detailKey: 'punchItems' }
  ],
  'field-production': [
    { key: 'progress', label: 'Progress updates', table: 'progress_updates', detailKey: 'progress' },
    { key: 'field_report', label: 'Daily report', table: 'field_reports', detailKey: 'fieldReports' },
    { key: 'time', label: 'Time tracking', table: 'time_logs', detailKey: 'timeLogs' },
    { key: 'materials', label: 'Material tracking', table: 'material_requirements', detailKey: 'materials' },
    { key: 'equipment', label: 'Tool/equipment tracking', table: 'tool_reservations', detailKey: 'tools' },
    { key: 'evidence', label: 'Photo evidence', table: 'documents', detailKey: 'documents' },
    { key: 'instructions', label: 'Worker instructions', table: 'worker_instructions', detailKey: 'workerInstructions' }
  ],
  'safety-quality': [
    { key: 'orientation', label: 'Worker orientation', table: 'worker_orientations', detailKey: 'orientations' },
    { key: 'jha', label: 'JHA / risk assessment', table: 'jha_records', detailKey: 'jhas' },
    { key: 'sds', label: 'SDS register', table: 'sds_sheets', detailKey: 'sdsSheets' },
    { key: 'permit', label: 'Permits', table: 'permit_records', detailKey: 'permits' },
    { key: 'inspection', label: 'Inspections', table: 'inspection_records', detailKey: 'inspections' },
    { key: 'observation', label: 'Observations', table: 'observation_records', detailKey: 'observations' },
    { key: 'incident', label: 'Incidents', table: 'incident_records', detailKey: 'incidents' },
    { key: 'site_access', label: 'Site access gate', table: 'site_access_logs', detailKey: 'siteAccessLogs' }
  ],
  'financial-control': [
    { key: 'budget', label: 'Budget lines', table: 'budget_lines', detailKey: 'budgetLines' },
    { key: 'expense', label: 'Expenses', table: 'expenses', detailKey: 'expenses' },
    { key: 'purchase_order', label: 'Purchase orders', table: 'purchase_orders', detailKey: 'purchaseOrders' },
    { key: 'invoice', label: 'Invoices', table: 'invoices', detailKey: 'invoices' },
    { key: 'payment', label: 'Payments', table: 'payments', detailKey: 'payments' },
    { key: 'draw', label: 'Draw/progress request', table: 'draw_requests', detailKey: 'drawRequests' },
    { key: 'waiver', label: 'Waiver/compliance hold', table: 'lien_waivers', detailKey: 'lienWaivers' },
    { key: 'handoff', label: 'Finance handoff', table: 'finance_handoffs', detailKey: 'financeHandoffs' }
  ],
  'client-portal': [
    { key: 'communication', label: 'Client communication', table: 'communication_records', detailKey: 'communications' },
    { key: 'selection', label: 'Client selections', table: 'client_selections', detailKey: 'clientSelections' },
    { key: 'approval', label: 'Client approval trail', table: 'approvals', detailKey: 'approvals' },
    { key: 'punch', label: 'Punch items', table: 'punch_items', detailKey: 'punchItems' },
    { key: 'warranty', label: 'Warranty claims', table: 'warranty_claims', detailKey: 'warrantyClaims' },
    { key: 'aftercare', label: 'Aftercare', table: 'aftercare_items', detailKey: 'aftercare' },
    { key: 'recurring', label: 'Recurring service', table: 'recurring_plans', detailKey: 'recurringPlans' }
  ],
  'eu-compliance': [
    { key: 'permit', label: 'Permit evidence', table: 'permit_records', detailKey: 'permits' },
    { key: 'wkb', label: 'Wkb/photo dossier', table: 'documents', detailKey: 'documents' },
    { key: 'invoice', label: 'VAT/UBL invoice signal', table: 'invoices', detailKey: 'invoices' },
    { key: 'vca', label: 'VCA/SDS safety proof', table: 'sds_sheets', detailKey: 'sdsSheets' },
    { key: 'site_access', label: 'Site access proof', table: 'site_access_logs', detailKey: 'siteAccessLogs' },
    { key: 'approval_audit', label: 'Approval audit', table: 'approvals', detailKey: 'approvals' },
    { key: 'audit', label: 'Change audit', table: 'audit_events', detailKey: 'audit' }
  ]
};

const LEDGER_CLOSED_STATUSES = new Set([
  'accepted',
  'approved',
  'cancelled',
  'closed',
  'completed',
  'complete',
  'confirmed',
  'current',
  'declined',
  'done',
  'executed',
  'filed',
  'funded',
  'issued',
  'locked',
  'paid',
  'passed',
  'received',
  'rejected',
  'released',
  'resolved',
  'reviewed',
  'sent',
  'settled',
  'stored',
  'submitted',
  'verified'
]);

const ASSIGNMENT_CLOSED_STATUSES = new Set([
  'released',
  'cancelled',
  'completed',
  'closed',
  'rejected',
  'declined',
  'offline'
]);

const TOOL_RESERVATION_CLOSED_STATUSES = new Set([
  'released',
  'returned',
  'cancelled',
  'rejected',
  'declined',
  'completed',
  'closed',
  'lost',
  'retired'
]);

const INACTIVE_JOB_STATUSES = new Set([
  'archived',
  'pending_archive_approval',
  'cancelled',
  'canceled',
  'rejected',
  'deleted',
  'void'
]);

function capabilityRequirementActionTarget(requirementKey) {
  const targets = {
    intake: 'job_update_form',
    quote: 'quote_form',
    site_visit: 'site_visit_form',
    materials: 'material_form',
    tools: 'tool_reservation_form',
    equipment: 'tool_reservation_form',
    assignment: 'assignment_form',
    job: 'job_update_form',
    tasks: 'task_form',
    schedule: 'route_plan_form',
    change_order: 'change_order_form',
    rfi: 'rfi_form',
    submittal: 'submittal_form',
    field_report: 'field_report_form',
    documents: 'document_form',
    closeout: 'closeout_form',
    progress: 'progress_form',
    time: 'time_log_form',
    evidence: 'document_form',
    instructions: 'worker_instruction_form',
    orientation: 'orientation_form',
    jha: 'jha_form',
    sds: 'sds_form',
    vca: 'sds_form',
    permit: 'permit_form',
    inspection: 'inspection_form',
    observation: 'observation_form',
    incident: 'incident_form',
    site_access: 'site_access_form',
    budget: 'budget_line_form',
    expense: 'expense_form',
    purchase_order: 'purchase_order_form',
    invoice: 'invoice_form',
    payment: 'payment_form',
    draw: 'draw_request_form',
    waiver: 'lien_waiver_form',
    handoff: 'finance_handoff_form',
    communication: 'communication_draft_form',
    selection: 'client_selection_form',
    approval: 'approval_queue',
    approval_audit: 'approval_queue',
    punch: 'punch_item_form',
    warranty: 'warranty_claim_form',
    aftercare: 'aftercare_form',
    recurring: 'recurring_plan_form',
    wkb: 'document_form',
    audit: 'audit_log'
  };
  return targets[String(requirementKey || '')] || 'job_detail';
}

const JOB_OPERATING_PLAYBOOKS = [
  {
    key: 'garden_maintenance',
    label: 'Garden maintenance and green waste',
    keywords: ['garden', 'hedge', 'lawn', 'green waste', 'groen', 'tuin', 'trimming', 'maintenance'],
    tasks: [
      'Confirm access, water point, parking, and green-waste rules',
      'Walk the garden and photograph before state',
      'Complete hedge, lawn, pruning, and cleanup scope',
      'Load green waste and sweep paths before departure'
    ],
    tools: ['Hedge trimmer', 'Lawn mower', 'Leaf blower', 'Rake', 'Ladder', 'Trailer'],
    materials: [
      { name: 'Green-waste bags', quantity: 12, unit: 'bags', supplier: 'Local garden supplier' },
      { name: 'Plant ties and garden twine', quantity: 1, unit: 'pack', supplier: 'Local garden supplier' }
    ],
    quoteLineItems: [
      { description: 'Garden maintenance labor', quantity: 6, unitPrice: 55, costCode: 'labor_garden' },
      { description: 'Green waste handling', quantity: 1, unitPrice: 75, costCode: 'waste' }
    ],
    visitChecklist: ['Measure garden zones', 'Photograph hedges and waste volume', 'Confirm access and waste disposal'],
    loadingChecklist: ['Charge batteries', 'Load green-waste bags', 'Check trailer coupling and lights', 'Bring broom and blower'],
    safetyTopics: ['Manual handling', 'Blade/tool safety', 'Ladder footing', 'Public path protection'],
    hazards: ['Sharp cutting tools', 'Ladder work', 'Green waste lifting'],
    controls: ['Wear gloves and eye protection', 'Keep public paths clear', 'Stop work in high wind or lightning'],
    workerInstruction: 'Confirm access, protect paths, capture before/after photos, and do not promise extra pruning or disposal without approval.',
    qualityChecks: ['Hedges even and client-visible edges clean', 'Paths swept', 'Waste removed or staged as agreed'],
    recurring: { service: 'garden maintenance', intervalRule: 'FREQ=MONTHLY', nextDueDays: 30 }
  },
  {
    key: 'paving',
    label: 'Paving and outdoor hardscape',
    keywords: ['paving', 'patio', 'driveway', 'tegels', 'straatwerk', 'bestrating', 'hardscape'],
    tasks: [
      'Survey levels, drainage, access, and material storage',
      'Confirm paving pattern, edge restraints, and disposal scope',
      'Prepare base, bedding, and compaction plan',
      'Photograph base, edge, and final finish evidence'
    ],
    tools: ['Plate compactor', 'Tile cutter', 'Laser level', 'Shovel', 'Wheelbarrow', 'Trailer'],
    materials: [
      { name: 'Paving sand', quantity: 1, unit: 'm3', supplier: 'Builders merchant' },
      { name: 'Jointing sand', quantity: 6, unit: 'bags', supplier: 'Builders merchant' },
      { name: 'Edge restraints', quantity: 12, unit: 'm', supplier: 'Builders merchant' }
    ],
    quoteLineItems: [
      { description: 'Paving labor and setting out', quantity: 12, unitPrice: 60, costCode: 'labor_paving' },
      { description: 'Base and jointing material allowance', quantity: 1, unitPrice: 450, costCode: 'materials' }
    ],
    visitChecklist: ['Measure m2 and slope', 'Check drainage outlets', 'Confirm access for materials and waste'],
    loadingChecklist: ['Load compactor', 'Load level and measuring tools', 'Confirm sand and paving delivery window'],
    safetyTopics: ['Silica dust', 'Manual handling', 'Compactor use', 'Trip hazards'],
    hazards: ['Heavy lifting', 'Cutting dust', 'Open excavation or uneven base'],
    controls: ['Use dust suppression and PPE', 'Keep access route clear', 'Stop outdoor work in unsafe weather'],
    workerInstruction: 'Verify levels before install, photograph base preparation, and do not change paving pattern or drainage without approval.',
    qualityChecks: ['Surface falls away correctly', 'Edges restrained', 'No rocking pavers', 'Client-visible finish photographed']
  },
  {
    key: 'fencing',
    label: 'Fencing and boundary work',
    keywords: ['fence', 'fencing', 'schutting', 'gate', 'boundary', 'hek'],
    tasks: [
      'Confirm boundary line, neighbor constraints, and gate swing',
      'Check underground service risk before digging',
      'Set posts, panels, and hardware to agreed line',
      'Photograph post depth, alignment, and completed fence'
    ],
    tools: ['Post-hole digger', 'Impact driver', 'Level', 'String line', 'Concrete mixer', 'Trailer'],
    materials: [
      { name: 'Fence posts', quantity: 6, unit: 'pieces', supplier: 'Timber supplier' },
      { name: 'Fence panels', quantity: 5, unit: 'pieces', supplier: 'Timber supplier' },
      { name: 'Post concrete', quantity: 6, unit: 'bags', supplier: 'Builders merchant' }
    ],
    quoteLineItems: [
      { description: 'Fence installation labor', quantity: 10, unitPrice: 60, costCode: 'labor_fencing' },
      { description: 'Fence material allowance', quantity: 1, unitPrice: 950, costCode: 'materials' }
    ],
    visitChecklist: ['Confirm boundary and height', 'Check access and digging conditions', 'Confirm waste removal'],
    loadingChecklist: ['Load digging tools', 'Load level and fixings', 'Confirm post and panel delivery'],
    safetyTopics: ['Digging and services', 'Manual handling', 'Saw/cutting safety'],
    hazards: ['Underground service strike', 'Panel lifting', 'Sharp timber or metal edges'],
    controls: ['Confirm service risk', 'Two-person lift for panels', 'Keep boundary safe overnight'],
    workerInstruction: 'Confirm boundary before digging, photograph post line, and do not accept neighbor-driven changes without approval.',
    qualityChecks: ['Posts plumb', 'Line straight', 'Gate swings correctly', 'Site clean']
  },
  {
    key: 'painting',
    label: 'Painting and finishing',
    keywords: ['paint', 'painting', 'schilder', 'finish', 'decorating', 'wall', 'ceiling'],
    tasks: [
      'Confirm colors, finish level, exclusions, and client protection needs',
      'Prepare surfaces, mask edges, and protect floors/furniture',
      'Apply primer/paint coats with drying windows',
      'Complete snag walk and photo evidence'
    ],
    tools: ['Rollers', 'Brush set', 'Drop cloths', 'Masking tape', 'Step ladder', 'Work light'],
    materials: [
      { name: 'Primer', quantity: 5, unit: 'L', supplier: 'Paint supplier' },
      { name: 'Finish paint', quantity: 10, unit: 'L', supplier: 'Paint supplier' },
      { name: 'Masking tape and foil', quantity: 1, unit: 'set', supplier: 'Paint supplier' }
    ],
    quoteLineItems: [
      { description: 'Painting preparation and coats', quantity: 14, unitPrice: 55, costCode: 'labor_painting' },
      { description: 'Paint and protection materials', quantity: 1, unitPrice: 320, costCode: 'materials' }
    ],
    visitChecklist: ['Confirm colors and surfaces', 'Check moisture and substrate condition', 'Confirm furniture/protection scope'],
    loadingChecklist: ['Load floor protection', 'Load ladders and work lights', 'Confirm paint color codes'],
    safetyTopics: ['Ventilation', 'Ladder use', 'Chemical handling'],
    hazards: ['Wet paint access', 'Working at height', 'VOC exposure'],
    controls: ['Ventilate area', 'Use stable ladder setup', 'Store paint safely'],
    workerInstruction: 'Confirm color codes before opening paint, protect client property, and capture before/after photos.',
    qualityChecks: ['Coverage consistent', 'Edges clean', 'No client property damage', 'Snag list closed']
  },
  {
    key: 'renovation',
    label: 'Renovation and small construction',
    keywords: ['renovation', 'bathroom', 'kitchen', 'remodel', 'verbouwing', 'construction', 'install'],
    tasks: [
      'Lock scope, exclusions, client decisions, and access constraints',
      'Create material submittals and client selections before ordering',
      'Prepare safety, dust, waste, and neighbor-impact controls',
      'Track daily progress, RFIs, photos, punch items, and closeout'
    ],
    tools: ['Combi drill', 'Multitool', 'Dust extractor', 'Tile cutter', 'Laser level', 'Work light'],
    materials: [
      { name: 'Site protection materials', quantity: 1, unit: 'set', supplier: 'Builders merchant' },
      { name: 'Waste bags and rubble sacks', quantity: 20, unit: 'bags', supplier: 'Builders merchant' },
      { name: 'Fixings and consumables', quantity: 1, unit: 'allowance', supplier: 'Builders merchant' }
    ],
    quoteLineItems: [
      { description: 'Renovation labor allowance', quantity: 40, unitPrice: 65, costCode: 'labor_renovation' },
      { description: 'Protection, waste, and consumables', quantity: 1, unitPrice: 650, costCode: 'site_general' }
    ],
    visitChecklist: ['Confirm measurements and client selections', 'Photograph existing defects', 'Check water/electric shutoff and access'],
    loadingChecklist: ['Load dust control and protection', 'Load core power tools', 'Prepare receipts and document folder'],
    safetyTopics: ['Dust control', 'Electric/water isolation', 'Manual handling', 'Neighbor/public access'],
    hazards: ['Hidden services', 'Dust exposure', 'Noise and neighbor impact'],
    controls: ['Confirm isolation before demolition', 'Use extraction/PPE', 'Keep daily photo and RFI trail'],
    workerInstruction: 'Keep a daily record, raise RFIs before hidden-scope decisions, and do not commit scope or price changes without approval.',
    qualityChecks: ['Client selections matched', 'Hidden work documented', 'Punch list opened', 'Closeout package prepared'],
    clientSelections: ['Finish selection', 'Fixture selection'],
    requiresRfi: true
  },
  {
    key: 'handyman',
    label: 'Handyman and service work',
    keywords: ['handyman', 'repair', 'fix', 'maintenance', 'small job', 'service ticket', 'klus'],
    tasks: [
      'Confirm exact issue, access, photos, and parts needed',
      'Prepare tool/parts checklist before departure',
      'Complete repair or document blocker',
      'Create client update and invoice-ready record'
    ],
    tools: ['Combi drill', 'Basic hand-tool kit', 'Step ladder', 'Multimeter', 'Work light'],
    materials: [
      { name: 'Fixings and small parts allowance', quantity: 1, unit: 'set', supplier: 'Hardware supplier' }
    ],
    quoteLineItems: [
      { description: 'Handyman service call and labor', quantity: 3, unitPrice: 60, costCode: 'labor_service' },
      { description: 'Small parts allowance', quantity: 1, unitPrice: 45, costCode: 'materials' }
    ],
    visitChecklist: ['Confirm issue and photos', 'Check access and parking', 'Identify parts before departure'],
    loadingChecklist: ['Load basic tool kit', 'Load ladder and work light', 'Bring small fixings kit'],
    safetyTopics: ['Ladder setup', 'Electric isolation where relevant', 'Client property protection'],
    hazards: ['Unknown site conditions', 'Small electrical/plumbing risks'],
    controls: ['Stop and escalate hidden defects', 'Get approval for extra work', 'Photograph completion'],
    workerInstruction: 'Diagnose, repair if within scope, and draft a client update instead of promising extra work.',
    qualityChecks: ['Issue resolved or blocker documented', 'Client area clean', 'Completion photos attached']
  },
  {
    key: 'cleaning',
    label: 'Cleaning and site turnover',
    keywords: ['cleaning', 'schoonmaak', 'turnover', 'deep clean', 'post construction clean'],
    tasks: [
      'Confirm areas, access, waste, and client expectations',
      'Prepare supplies, PPE, and before-photo evidence',
      'Complete cleaning checklist by zone',
      'Capture after photos and client handover note'
    ],
    tools: ['Vacuum', 'Mop set', 'Buckets', 'Scraper', 'Step ladder'],
    materials: [
      { name: 'Cleaning supplies', quantity: 1, unit: 'set', supplier: 'Cleaning supplier' },
      { name: 'Waste bags', quantity: 10, unit: 'bags', supplier: 'Cleaning supplier' }
    ],
    quoteLineItems: [
      { description: 'Cleaning labor', quantity: 5, unitPrice: 45, costCode: 'labor_cleaning' },
      { description: 'Cleaning materials allowance', quantity: 1, unitPrice: 60, costCode: 'materials' }
    ],
    visitChecklist: ['Confirm zones and finish standard', 'Check waste and parking', 'Photograph before state'],
    loadingChecklist: ['Load cleaning kit', 'Load PPE and waste bags', 'Check vacuum/filter condition'],
    safetyTopics: ['Chemical handling', 'Wet floor slip risk', 'Waste handling'],
    hazards: ['Slips', 'Chemical exposure', 'Sharp debris'],
    controls: ['Use PPE', 'Mark wet floors', 'Separate sharp waste'],
    workerInstruction: 'Clean by zone, photograph before/after evidence, and flag damage or hidden waste before extra work.',
    qualityChecks: ['Zones completed', 'Waste removed', 'Client-ready photos captured'],
    recurring: { service: 'cleaning maintenance', intervalRule: 'FREQ=MONTHLY', nextDueDays: 30 }
  },
  {
    key: 'general_service',
    label: 'General contractor service',
    keywords: ['contracting', 'general', 'job', 'project'],
    tasks: [
      'Confirm scope, access, risks, and promised outcome',
      'Prepare quote, crew, tools, materials, and safety checklist',
      'Capture progress photos and client communication',
      'Prepare invoice, closeout, and aftercare follow-up'
    ],
    tools: ['Basic hand-tool kit', 'Work light', 'Step ladder'],
    materials: [
      { name: 'Consumables allowance', quantity: 1, unit: 'set', supplier: 'Local supplier' }
    ],
    quoteLineItems: [
      { description: 'Contractor service labor', quantity: 4, unitPrice: 60, costCode: 'labor_general' },
      { description: 'Consumables allowance', quantity: 1, unitPrice: 75, costCode: 'materials' }
    ],
    visitChecklist: ['Confirm access and scope', 'Photograph current state', 'Identify risks and materials'],
    loadingChecklist: ['Load basic tool kit', 'Confirm required materials', 'Prepare photo evidence plan'],
    safetyTopics: ['Site access', 'Manual handling', 'Client property protection'],
    hazards: ['Unknown site condition'],
    controls: ['Stop and ask before scope changes', 'Capture evidence', 'Use PPE'],
    workerInstruction: 'Confirm scope before starting, capture progress evidence, and escalate client-impacting changes.',
    qualityChecks: ['Scope complete', 'Evidence captured', 'Client update drafted']
  }
];

function nowIso() {
  return new Date().toISOString();
}

const AUDIT_CHAIN_ID = 'operating_ledger';
const AUDIT_CHAIN_FORMAT = 'contractor-ai-audit-chain/v1';
const AUDIT_CHAIN_ALGORITHM = 'sha256';
const AUDIT_CHAIN_GENESIS_HASH = '0'.repeat(64);

function auditEventHash(event = {}) {
  const payload = JSON.stringify([
    AUDIT_CHAIN_FORMAT,
    Number(event.sequenceNumber),
    String(event.previousHash || ''),
    String(event.id || ''),
    String(event.entityType || ''),
    String(event.entityId || ''),
    event.jobId === null || event.jobId === undefined ? null : String(event.jobId),
    String(event.action || ''),
    String(event.actor || ''),
    String(event.beforeJson ?? '{}'),
    String(event.afterJson ?? '{}'),
    String(event.metadataJson ?? '{}'),
    String(event.createdAt || '')
  ]);
  return crypto.createHash(AUDIT_CHAIN_ALGORITHM).update(payload, 'utf8').digest('hex');
}

function auditEventFromRow(row = {}) {
  return {
    sequenceNumber: Number(row.sequence_number),
    previousHash: row.previous_hash,
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    jobId: row.job_id,
    action: row.action,
    actor: row.actor,
    beforeJson: row.before_json,
    afterJson: row.after_json,
    metadataJson: row.metadata_json,
    createdAt: row.created_at
  };
}

function rebuildAuditChain(db) {
  const rows = db.prepare('SELECT * FROM audit_events ORDER BY created_at ASC, id ASC').all();
  db.prepare('UPDATE audit_events SET sequence_number = NULL, previous_hash = NULL, event_hash = NULL').run();
  let previousHash = AUDIT_CHAIN_GENESIS_HASH;
  let sequenceNumber = 0;
  for (const row of rows) {
    sequenceNumber += 1;
    const eventHash = auditEventHash({
      ...auditEventFromRow(row),
      sequenceNumber,
      previousHash
    });
    db.prepare(`
      UPDATE audit_events
      SET sequence_number = ?, previous_hash = ?, event_hash = ?
      WHERE id = ?
    `).run(sequenceNumber, previousHash, eventHash, row.id);
    previousHash = eventHash;
  }
  db.prepare('DELETE FROM audit_chain_state WHERE chain_id = ?').run(AUDIT_CHAIN_ID);
  if (rows.length) {
    db.prepare(`
      INSERT INTO audit_chain_state (chain_id, head_event_id, head_hash, event_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(AUDIT_CHAIN_ID, rows.at(-1).id, previousHash, sequenceNumber, nowIso());
  }
  return { eventCount: sequenceNumber, headHash: previousHash, headEventId: rows.at(-1)?.id || null };
}

function verifyAuditChainRows(rows = [], state = null, options = {}) {
  const orderedRows = [...rows].sort((left, right) => {
    const sequenceDifference = Number(left.sequence_number) - Number(right.sequence_number);
    return sequenceDifference || String(left.id || '').localeCompare(String(right.id || ''));
  });
  const failures = [];
  let expectedPreviousHash = AUDIT_CHAIN_GENESIS_HASH;
  let expectedSequenceNumber = 1;
  let lastEventId = null;
  let lastEventHash = AUDIT_CHAIN_GENESIS_HASH;
  const fail = failure => {
    if (failures.length < 25) failures.push(failure);
  };

  for (const row of orderedRows) {
    const sequenceNumber = Number(row.sequence_number);
    if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber !== expectedSequenceNumber) {
      fail({ code: 'sequence_gap', eventId: row.id, expected: expectedSequenceNumber, actual: row.sequence_number ?? null });
    }
    if (row.previous_hash !== expectedPreviousHash) {
      fail({ code: 'previous_hash_mismatch', eventId: row.id, sequenceNumber, expected: expectedPreviousHash, actual: row.previous_hash || null });
    }
    const calculatedHash = auditEventHash(auditEventFromRow(row));
    if (row.event_hash !== calculatedHash) {
      fail({ code: 'event_hash_mismatch', eventId: row.id, sequenceNumber, expected: calculatedHash, actual: row.event_hash || null });
    }
    expectedPreviousHash = row.event_hash || calculatedHash;
    lastEventHash = row.event_hash || calculatedHash;
    lastEventId = row.id;
    expectedSequenceNumber += 1;
  }

  if (!state && orderedRows.length) {
    fail({ code: 'chain_state_missing', eventCount: orderedRows.length });
  }
  if (state) {
    const stateCount = Number(state.event_count);
    if (!Number.isSafeInteger(stateCount) || stateCount !== orderedRows.length) {
      fail({ code: 'head_count_mismatch', expected: orderedRows.length, actual: state.event_count ?? null });
    }
    if ((state.head_event_id || null) !== lastEventId) {
      fail({ code: 'head_event_mismatch', expected: lastEventId, actual: state.head_event_id || null });
    }
    if (state.head_hash !== lastEventHash) {
      fail({ code: 'head_hash_mismatch', expected: lastEventHash, actual: state.head_hash || null });
    }
  }

  return {
    valid: failures.length === 0,
    status: failures.length === 0 ? 'verified' : 'integrity_failure',
    format: AUDIT_CHAIN_FORMAT,
    algorithm: AUDIT_CHAIN_ALGORITHM,
    eventCount: orderedRows.length,
    headEventId: lastEventId,
    headHash: lastEventHash,
    checkedAt: options.checkedAt || nowIso(),
    failures
  };
}

function databaseTableExists(db, tableName, databaseMode = 'sqlite') {
  if (databaseMode === 'postgres') {
    return Boolean(db.prepare(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?
    `).get(tableName));
  }
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function appendAuditEventToDatabase(db, event = {}, options = {}) {
  const databaseMode = options.databaseMode || 'sqlite';
  const id = event.id || makeId('audit');
  const createdAt = event.createdAt || nowIso();
  const entityType = event.entityType;
  const entityId = String(event.entityId);
  const jobId = event.jobId || null;
  const action = event.action;
  const actor = event.actor || 'Contractor.AI';
  const beforeJson = event.beforeJson ?? toJson(event.before ?? null);
  const afterJson = event.afterJson ?? toJson(event.after ?? null);
  const metadataJson = event.metadataJson ?? toJson(event.metadata ?? null);

  const chainAvailable = options.chainAvailable ?? databaseTableExists(db, 'audit_chain_state', databaseMode);
  if (!chainAvailable) {
    db.prepare(`
      INSERT INTO audit_events (id, entity_type, entity_id, job_id, action, actor, before_json, after_json, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entityType, entityId, jobId, action, actor, beforeJson, afterJson, metadataJson, createdAt);
    return { id, chained: false };
  }

  const lockClause = databaseMode === 'postgres' ? ' FOR UPDATE' : '';
  let state = db.prepare(`SELECT * FROM audit_chain_state WHERE chain_id = ?${lockClause}`).get(AUDIT_CHAIN_ID);
  if (!state) {
    const retainedEvents = Number(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count || 0);
    if (retainedEvents) {
      const error = new Error('Audit chain state is missing while retained events exist. Verify and recover the ledger before writing new audit evidence.');
      error.code = 'audit_chain_state_missing';
      throw error;
    }
    db.prepare(`
      INSERT OR IGNORE INTO audit_chain_state (chain_id, head_event_id, head_hash, event_count, updated_at)
      VALUES (?, NULL, ?, 0, ?)
    `).run(AUDIT_CHAIN_ID, AUDIT_CHAIN_GENESIS_HASH, createdAt);
    state = db.prepare(`SELECT * FROM audit_chain_state WHERE chain_id = ?${lockClause}`).get(AUDIT_CHAIN_ID);
  }
  if (!state) {
    const error = new Error('Audit chain state could not be initialized.');
    error.code = 'audit_chain_state_initialization_failed';
    throw error;
  }

  const sequenceNumber = Number(state.event_count || 0) + 1;
  const previousHash = state.head_hash || AUDIT_CHAIN_GENESIS_HASH;
  const eventHash = auditEventHash({
    sequenceNumber,
    previousHash,
    id,
    entityType,
    entityId,
    jobId,
    action,
    actor,
    beforeJson,
    afterJson,
    metadataJson,
    createdAt
  });
  db.prepare(`
    INSERT INTO audit_events (
      id, entity_type, entity_id, job_id, action, actor,
      before_json, after_json, metadata_json, created_at,
      sequence_number, previous_hash, event_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    entityType,
    entityId,
    jobId,
    action,
    actor,
    beforeJson,
    afterJson,
    metadataJson,
    createdAt,
    sequenceNumber,
    previousHash,
    eventHash
  );
  const advanced = db.prepare(`
    UPDATE audit_chain_state
    SET head_event_id = ?, head_hash = ?, event_count = ?, updated_at = ?
    WHERE chain_id = ? AND head_hash = ? AND event_count = ?
  `).run(id, eventHash, sequenceNumber, createdAt, AUDIT_CHAIN_ID, previousHash, Number(state.event_count || 0));
  if (Number(advanced.changes || 0) !== 1) {
    const error = new Error('Audit chain head changed before the event could be committed.');
    error.code = 'audit_chain_head_conflict';
    throw error;
  }
  return { id, chained: true, sequenceNumber, previousHash, eventHash };
}

function makeId(prefix) {
  const random = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random.replace(/-/g, '').slice(0, 24)}`;
}

function toJson(value, fallback = {}) {
  const input = value === undefined ? fallback : value;
  return JSON.stringify(input ?? fallback);
}

function fromJson(value, fallback = {}) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePriority(value) {
  const priority = normalizeText(value, 'medium').toLowerCase().replace(/[\s-]+/g, '_');
  if (['critical', 'high', 'medium', 'low'].includes(priority)) {
    return priority;
  }
  if (['urgent', 'emergency'].includes(priority)) {
    return 'critical';
  }
  return 'medium';
}

function normalizeStatus(value, fallback = 'open') {
  return normalizeText(value, fallback).toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeWorkerStatus(value, fallback = 'available') {
  const status = normalizeStatus(value, fallback);
  const aliases = {
    active: 'busy',
    on_job: 'busy',
    working: 'busy',
    ready: 'available',
    idle: 'available',
    standby: 'available',
    unavailable: 'offline',
    blocked: 'on_hold',
    sick: 'on_leave',
    leave: 'on_leave',
    onleave: 'on_leave'
  };
  return aliases[status] || status;
}

function isLedgerCapabilityRecordOpen(record = {}) {
  const status = normalizeStatus(record.status || record.riskLevel || record.priority, 'open');
  return !LEDGER_CLOSED_STATUSES.has(status);
}

function ledgerApprovalHumanTarget(value) {
  const text = normalizeText(value, 'approval')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Approval';
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const text = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'on'].includes(text)) return true;
  if (['false', 'no', 'n', '0', 'off'].includes(text)) return false;
  return fallback;
}

function normalizeRetainedDate(value, options = {}) {
  const text = normalizeText(value, '');
  if (!text) {
    if (options.required) {
      const error = new Error(`${options.label || 'Date'} is required`);
      error.statusCode = 400;
      error.code = options.code || 'date_required';
      throw error;
    }
    return null;
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const milliseconds = Date.parse(dateOnly ? `${text}T00:00:00.000Z` : text);
  if (!Number.isFinite(milliseconds) || (dateOnly && new Date(milliseconds).toISOString().slice(0, 10) !== text)) {
    const error = new Error(`${options.label || 'Date'} must be a valid date`);
    error.statusCode = 400;
    error.code = options.code || 'date_invalid';
    throw error;
  }
  return dateOnly ? text : new Date(milliseconds).toISOString();
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.filter(item => item !== undefined && item !== null && String(item).trim() !== '');
  }
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return String(value)
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function rowDate(value) {
  return value || null;
}

function futureIsoDate(days = 0) {
  const date = new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString();
}

function nextRecurringDueDate(currentDueAt, intervalRule) {
  const base = currentDueAt ? new Date(currentDueAt) : new Date();
  const date = Number.isNaN(base.getTime()) ? new Date() : base;
  const rule = normalizeText(intervalRule, 'monthly').toLowerCase();
  if (/year|annual|freq=yearly/.test(rule)) {
    date.setFullYear(date.getFullYear() + 1);
  } else if (/quarter|freq=quarterly/.test(rule)) {
    date.setMonth(date.getMonth() + 3);
  } else if (/week|freq=weekly/.test(rule)) {
    date.setDate(date.getDate() + 7);
  } else if (/day|freq=daily/.test(rule)) {
    date.setDate(date.getDate() + 1);
  } else {
    date.setMonth(date.getMonth() + 1);
  }
  return date.toISOString();
}

function safeLimit(value, fallback = 50, max = 500) {
  const limit = Math.max(1, Math.min(max, Number(value || fallback)));
  return Number.isFinite(limit) ? limit : fallback;
}

function auditHistorySequence(value, label = 'Audit cursor') {
  if (value === undefined || value === null || value === '') return null;
  const sequenceNumber = Number(value);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1) {
    const error = new Error(`${label} must be a positive integer`);
    error.statusCode = 400;
    error.code = 'audit_cursor_invalid';
    throw error;
  }
  return sequenceNumber;
}

function auditHistoryText(value, label, maxLength = 160) {
  const text = normalizeText(value);
  if (text.length > maxLength) {
    const error = new Error(`${label} cannot exceed ${maxLength} characters`);
    error.statusCode = 400;
    error.code = 'audit_filter_too_long';
    throw error;
  }
  return text || null;
}

function auditHistorySearchPattern(value) {
  const text = auditHistoryText(value, 'Audit search', 120);
  if (!text) return null;
  const searchable = text.toLowerCase().replace(/[%\\]/g, '').trim();
  return searchable ? `%${searchable}%` : null;
}

const LEDGER_SCHEMA_MIGRATIONS = [
  {
    version: '001_initial_ledger_schema',
    description: 'Record the consolidated operating ledger baseline.',
    apply() {}
  },
  {
    version: '002_document_storage_index',
    description: 'Index retained evidence references for controlled retrieval.',
    apply(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_documents_storage_ref ON documents(storage_ref)');
    }
  },
  {
    version: '003_durable_scheduler_leases',
    description: 'Persist autonomous scheduler leases and execution outcomes.',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_jobs (
          job_key TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'idle',
          interval_seconds INTEGER NOT NULL,
          lease_id TEXT,
          lease_until TEXT,
          last_started_at TEXT,
          last_completed_at TEXT,
          run_count INTEGER NOT NULL DEFAULT 0,
          last_result_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs(status, lease_until, last_completed_at);
      `);
    }
  },
  {
    version: '004_durable_request_idempotency',
    description: 'Persist bounded idempotency leases and completed API responses.',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS idempotency_records (
          key_hash TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'processing',
          lease_until TEXT,
          response_status INTEGER,
          response_body_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_idempotency_records_expiry ON idempotency_records(expires_at);
      `);
    }
  },
  {
    version: '005_postgres_double_precision',
    description: 'Preserve SQLite numeric precision for hosted finance, scheduling, and progress values.',
    apply(db, context = {}) {
      if (context.databaseMode !== 'postgres') return;
      const columns = db.prepare(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type = 'real'
        ORDER BY table_name, ordinal_position
      `).all();
      for (const column of columns) {
        const tableName = String(column.table_name || '');
        const columnName = String(column.column_name || '');
        if (!/^[a-z_][a-z0-9_]*$/i.test(tableName) || !/^[a-z_][a-z0-9_]*$/i.test(columnName)) {
          throw new Error('PostgreSQL precision migration found an unsafe schema identifier.');
        }
        db.exec(`ALTER TABLE "${tableName}" ALTER COLUMN "${columnName}" TYPE DOUBLE PRECISION`);
      }
    }
  },
  {
    version: '006_trade_partner_compliance',
    description: 'Retain supplier and subcontractor identity, compliance, and approval evidence.',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS trade_partners (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          partner_type TEXT NOT NULL DEFAULT 'supplier',
          contact_name TEXT,
          email TEXT,
          phone TEXT,
          address TEXT,
          city TEXT,
          country TEXT NOT NULL DEFAULT 'NL',
          registration_number TEXT,
          vat_number TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          insurance_expires_at TEXT,
          vca_expires_at TEXT,
          specialties_json TEXT NOT NULL DEFAULT '[]',
          data_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_trade_partners_status ON trade_partners(status, partner_type, updated_at);
      `);
    }
  },
  {
    version: '007_inactive_job_portal_revocation',
    description: 'Revoke legacy active client portal links retained by inactive jobs.',
    apply(db, context = {}) {
      const inactiveStatuses = [...INACTIVE_JOB_STATUSES];
      const placeholders = inactiveStatuses.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT access.*
        FROM client_portal_access access
        INNER JOIN jobs job ON job.id = access.job_id
        WHERE access.status = 'active' AND LOWER(job.status) IN (${placeholders})
        ORDER BY access.created_at ASC
      `).all(...inactiveStatuses);
      const chainAvailable = databaseTableExists(db, 'audit_chain_state', context.databaseMode);
      for (const row of rows) {
        const timestamp = nowIso();
        const reason = 'Legacy active portal access was revoked because the retained job is inactive.';
        const before = {
          id: row.id,
          jobId: row.job_id,
          clientId: row.client_id || null,
          status: row.status,
          approvalId: row.approval_id || null,
          expiresAt: row.expires_at || null,
          lastAccessedAt: row.last_accessed_at || null,
          revokedAt: row.revoked_at || null,
          data: fromJson(row.data_json, {})
        };
        const data = {
          ...before.data,
          revocation: {
            reason,
            revokedAt: timestamp,
            actor: 'ledger_migration'
          }
        };
        db.prepare(`
          UPDATE client_portal_access
          SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), data_json = ?, updated_at = ?
          WHERE id = ?
        `).run(timestamp, toJson(data), timestamp, row.id);
        appendAuditEventToDatabase(db, {
          entityType: 'client_portal_access',
          entityId: row.id,
          jobId: row.job_id,
          action: 'revoke_client_portal_access',
          actor: 'ledger_migration',
          before,
          after: { ...before, status: 'revoked', revokedAt: row.revoked_at || timestamp, data },
          metadata: {
            reason,
            migration: '007_inactive_job_portal_revocation',
            externalCommitments: 0
          },
          createdAt: timestamp
        }, { databaseMode: context.databaseMode, chainAvailable });
      }
    }
  },
  {
    version: '008_idempotency_lease_ownership',
    description: 'Bind evidence idempotency completion and cleanup to the active lease owner.',
    apply(db) {
      db.exec(`
        ALTER TABLE idempotency_records ADD COLUMN lease_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_idempotency_records_lease ON idempotency_records(status, lease_until, lease_id);
      `);
    }
  },
  {
    version: '009_durable_operator_sessions',
    description: 'Persist revocable browser sessions without retaining operator access keys.',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS operator_sessions (
          session_id_hash TEXT PRIMARY KEY,
          operator_id TEXT NOT NULL,
          role TEXT NOT NULL,
          token_fingerprint TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT,
          revocation_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_operator_sessions_expiry ON operator_sessions(expires_at, revoked_at);
        CREATE INDEX IF NOT EXISTS idx_operator_sessions_principal ON operator_sessions(operator_id, role, revoked_at);
      `);
    }
  },
  {
    version: '010_durable_auth_rate_limits',
    description: 'Persist hashed authentication failure windows across restarts and application replicas.',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_rate_limits (
          key_hash TEXT PRIMARY KEY,
          window_started_at TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expiry ON auth_rate_limits(expires_at);
      `);
    }
  },
  {
    version: '011_durable_api_rate_limits',
    description: 'Coordinate bounded API request windows across restarts and application replicas.',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_rate_limits (
          key_hash TEXT PRIMARY KEY,
          window_started_at TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry ON api_rate_limits(expires_at);
      `);
    }
  },
  {
    version: '012_tamper_evident_audit_chain',
    description: 'Chain retained audit events so modification, deletion, reordering, and stale heads are detectable.',
    apply(db) {
      db.exec(`
        ALTER TABLE audit_events ADD COLUMN sequence_number BIGINT;
        ALTER TABLE audit_events ADD COLUMN previous_hash TEXT;
        ALTER TABLE audit_events ADD COLUMN event_hash TEXT;
        CREATE TABLE IF NOT EXISTS audit_chain_state (
          chain_id TEXT PRIMARY KEY,
          head_event_id TEXT,
          head_hash TEXT NOT NULL,
          event_count BIGINT NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
      `);
      rebuildAuditChain(db);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_sequence_number ON audit_events(sequence_number);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_event_hash ON audit_events(event_hash);
      `);
    }
  },
  {
    version: '013_audit_history_queries',
    description: 'Index chained audit history for owner filtering and cursor pagination.',
    apply(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_audit_job_sequence ON audit_events(job_id, sequence_number DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_type_sequence ON audit_events(entity_type, sequence_number DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_action_sequence ON audit_events(action, sequence_number DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_actor_sequence ON audit_events(actor, sequence_number DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_created_sequence ON audit_events(created_at, sequence_number DESC);
      `);
    }
  }
];

class ContractorOperatingLedger {
  constructor(options = {}) {
    const unknownOptions = Object.keys(options).filter(key => !['dbFile', 'databaseUrl', 'stateProvider', 'logger'].includes(key));
    if (unknownOptions.length) {
      throw new Error(`Unsupported operating-ledger option(s): ${unknownOptions.join(', ')}. Use dbFile for the SQLite path.`);
    }
    const { dbFile, databaseUrl, stateProvider, logger } = options;
    this.dbFile = dbFile || path.join(__dirname, 'data', 'contractor-ledger.sqlite');
    this.databaseMode = databaseUrl ? 'postgres' : 'sqlite';
    this.stateProvider = typeof stateProvider === 'function' ? stateProvider : () => ({ jobs: [], workers: [], tools: [] });
    this.logger = typeof logger === 'function' ? logger : () => {};
    this.transactionDepth = 0;
    if (databaseUrl) {
      this.db = new PostgresSyncDatabase({ connectionString: databaseUrl });
    } else {
      fs.mkdirSync(path.dirname(this.dbFile), { recursive: true });
      this.db = new DatabaseSync(this.dbFile);
    }
    const initializeLedger = () => {
      this.initialize();
      this.applyMigrations();
      this.seedFromState();
    };
    try {
      if (this.databaseMode === 'postgres') {
        this.db.withAdvisoryLock(2026071302, initializeLedger);
      } else {
        initializeLedger();
      }
    } catch (error) {
      try {
        this.db.close();
      } catch {
        // Preserve the startup error that made the ledger unusable.
      }
      throw error;
    }
  }

  initialize() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        company TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        city TEXT,
        country TEXT NOT NULL DEFAULT 'NL',
        vat_number TEXT,
        preferred_language TEXT NOT NULL DEFAULT 'nl',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trade_partners (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        partner_type TEXT NOT NULL DEFAULT 'supplier',
        contact_name TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        city TEXT,
        country TEXT NOT NULL DEFAULT 'NL',
        registration_number TEXT,
        vat_number TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        insurance_expires_at TEXT,
        vca_expires_at TEXT,
        specialties_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_requests (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        source_channel TEXT NOT NULL DEFAULT 'manual',
        service TEXT,
        description TEXT,
        urgency TEXT NOT NULL DEFAULT 'medium',
        budget TEXT,
        status TEXT NOT NULL DEFAULT 'analyzed',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        request_id TEXT REFERENCES job_requests(id) ON DELETE SET NULL,
        client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        job_type TEXT NOT NULL DEFAULT 'general',
        description TEXT,
        address TEXT,
        city TEXT,
        region TEXT,
        country TEXT NOT NULL DEFAULT 'NL',
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'intake',
        phase TEXT NOT NULL DEFAULT 'intake',
        risk_level TEXT NOT NULL DEFAULT 'normal',
        estimated_hours REAL NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0,
        contract_value REAL NOT NULL DEFAULT 0,
        margin_target_percent REAL NOT NULL DEFAULT 20,
        progress_percent REAL NOT NULL DEFAULT 0,
        scheduled_start TEXT,
        scheduled_end TEXT,
        target_completion TEXT,
        approval_state TEXT NOT NULL DEFAULT 'pending',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_tasks (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'medium',
        assignee_id TEXT,
        due_at TEXT,
        completed_at TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'draft',
        currency TEXT NOT NULL DEFAULT 'EUR',
        subtotal REAL NOT NULL DEFAULT 0,
        tax_rate REAL NOT NULL DEFAULT 21,
        tax_amount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        valid_until TEXT,
        approval_id TEXT,
        line_items_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS site_visits (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        visit_type TEXT NOT NULL DEFAULT 'site_survey',
        status TEXT NOT NULL DEFAULT 'scheduled',
        scheduled_at TEXT,
        completed_at TEXT,
        assignee TEXT,
        findings TEXT,
        checklist_json TEXT NOT NULL DEFAULT '[]',
        photos_json TEXT NOT NULL DEFAULT '[]',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS change_orders (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        scope_delta TEXT,
        currency TEXT NOT NULL DEFAULT 'EUR',
        amount REAL NOT NULL DEFAULT 0,
        tax_rate REAL NOT NULL DEFAULT 21,
        tax_amount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        schedule_delta_days REAL NOT NULL DEFAULT 0,
        approval_id TEXT,
        line_items_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS field_reports (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        report_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        weather TEXT,
        manpower REAL NOT NULL DEFAULT 0,
        work_completed TEXT,
        blockers_json TEXT NOT NULL DEFAULT '[]',
        photos_json TEXT NOT NULL DEFAULT '[]',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rfi_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        question TEXT,
        response TEXT,
        responsible TEXT,
        due_at TEXT,
        answered_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS submittal_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        package_name TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        responsible TEXT,
        reviewer TEXT,
        due_at TEXT,
        submitted_at TEXT,
        approved_at TEXT,
        approval_id TEXT,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS client_selections (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'selection',
        status TEXT NOT NULL DEFAULT 'pending_client',
        client_name TEXT,
        currency TEXT NOT NULL DEFAULT 'EUR',
        value REAL NOT NULL DEFAULT 0,
        due_at TEXT,
        decided_at TEXT,
        approval_id TEXT,
        options_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS permit_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        permit_type TEXT NOT NULL DEFAULT 'site_access',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        holder TEXT,
        location TEXT,
        issued_at TEXT,
        expires_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inspection_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        inspection_type TEXT NOT NULL DEFAULT 'site_inspection',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        result TEXT NOT NULL DEFAULT 'pending',
        inspector TEXT,
        scheduled_at TEXT,
        completed_at TEXT,
        defects_json TEXT NOT NULL DEFAULT '[]',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS observation_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'quality',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        severity TEXT NOT NULL DEFAULT 'medium',
        responsible TEXT,
        due_at TEXT,
        closed_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS incident_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        incident_type TEXT NOT NULL DEFAULT 'near_miss',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reported',
        severity TEXT NOT NULL DEFAULT 'medium',
        reported_by TEXT,
        occurred_at TEXT,
        resolved_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS safety_meetings (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        meeting_type TEXT NOT NULL DEFAULT 'toolbox_talk',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        facilitator TEXT,
        scheduled_at TEXT,
        completed_at TEXT,
        attendees_json TEXT NOT NULL DEFAULT '[]',
        topics_json TEXT NOT NULL DEFAULT '[]',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worker_orientations (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        worker_name TEXT,
        company TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled',
        language TEXT,
        due_at TEXT,
        completed_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jha_records (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        risk_level TEXT NOT NULL DEFAULT 'medium',
        assignee TEXT,
        due_at TEXT,
        approved_at TEXT,
        hazards_json TEXT NOT NULL DEFAULT '[]',
        controls_json TEXT NOT NULL DEFAULT '[]',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sds_sheets (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        material TEXT NOT NULL,
        supplier TEXT,
        status TEXT NOT NULL DEFAULT 'missing',
        expires_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS site_access_logs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        orientation_id TEXT REFERENCES worker_orientations(id) ON DELETE SET NULL,
        worker_name TEXT,
        company TEXT,
        status TEXT NOT NULL DEFAULT 'blocked',
        orientation_valid INTEGER NOT NULL DEFAULT 0,
        checked_in_at TEXT,
        checked_out_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT,
        email TEXT,
        phone TEXT,
        status TEXT NOT NULL DEFAULT 'available',
        home_region TEXT,
        hourly_rate REAL NOT NULL DEFAULT 0,
        skills_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
        role TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        scheduled_start TEXT,
        scheduled_end TEXT,
        allocation_hours REAL NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL DEFAULT 'available',
        home_location TEXT,
        current_location TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_reservations (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        tool_id TEXT REFERENCES tools(id) ON DELETE SET NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        needed_from TEXT,
        needed_until TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT,
        unit TEXT NOT NULL DEFAULT 'unit',
        stock_quantity REAL NOT NULL DEFAULT 0,
        reorder_point REAL NOT NULL DEFAULT 0,
        supplier TEXT,
        cost_per_unit REAL NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS material_requirements (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        material_id TEXT REFERENCES materials(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit TEXT NOT NULL DEFAULT 'unit',
        status TEXT NOT NULL DEFAULT 'needed',
        supplier TEXT,
        cost REAL NOT NULL DEFAULT 0,
        needed_by TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS route_plans (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        origin TEXT,
        destination TEXT NOT NULL,
        waypoints_json TEXT NOT NULL DEFAULT '[]',
        distance_km REAL NOT NULL DEFAULT 0,
        duration_minutes REAL NOT NULL DEFAULT 0,
        route_risk TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'draft',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS loading_plans (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        vehicle TEXT,
        trailer_required INTEGER NOT NULL DEFAULT 0,
        checklist_json TEXT NOT NULL DEFAULT '[]',
        load_items_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'draft',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS procurement_orders (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        supplier TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        currency TEXT NOT NULL DEFAULT 'EUR',
        amount REAL NOT NULL DEFAULT 0,
        required_by TEXT,
        approval_id TEXT,
        items_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worker_instructions (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
        audience TEXT NOT NULL DEFAULT 'crew',
        channel TEXT NOT NULL DEFAULT 'app',
        title TEXT NOT NULL,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'document',
        title TEXT NOT NULL,
        filename TEXT,
        mime_type TEXT,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        storage_ref TEXT,
        status TEXT NOT NULL DEFAULT 'stored',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS progress_updates (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'note',
        progress_percent REAL NOT NULL DEFAULT 0,
        note TEXT,
        weather TEXT,
        blockers_json TEXT NOT NULL DEFAULT '[]',
        photos_json TEXT NOT NULL DEFAULT '[]',
        created_by TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS communication_records (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
        channel TEXT NOT NULL DEFAULT 'portal',
        direction TEXT NOT NULL DEFAULT 'outbound',
        subject TEXT,
        body TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        approval_id TEXT,
        sent_at TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS time_logs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
        work_date TEXT NOT NULL,
        hours REAL NOT NULL DEFAULT 0,
        billable INTEGER NOT NULL DEFAULT 1,
        rate REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'submitted',
        approval_id TEXT,
        notes TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'general',
        amount REAL NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'EUR',
        vendor TEXT,
        receipt_ref TEXT,
        status TEXT NOT NULL DEFAULT 'submitted',
        approval_id TEXT,
        notes TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        currency TEXT NOT NULL DEFAULT 'EUR',
        amount REAL NOT NULL DEFAULT 0,
        tax_amount REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        due_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS quality_checks (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        check_type TEXT NOT NULL DEFAULT 'final_quality',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_review',
        result TEXT NOT NULL DEFAULT 'pending',
        inspector TEXT,
        checked_at TEXT,
        defects_json TEXT NOT NULL DEFAULT '[]',
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS safety_checks (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        check_type TEXT NOT NULL DEFAULT 'site_safety',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        risk_level TEXT NOT NULL DEFAULT 'normal',
        assignee TEXT,
        due_at TEXT,
        completed_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'awaiting_invoice',
        currency TEXT NOT NULL DEFAULT 'EUR',
        amount REAL NOT NULL DEFAULT 0,
        due_at TEXT,
        paid_at TEXT,
        method TEXT,
        reference TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS budget_lines (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        cost_code TEXT NOT NULL DEFAULT '00-000',
        description TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        status TEXT NOT NULL DEFAULT 'draft',
        currency TEXT NOT NULL DEFAULT 'EUR',
        budget_amount REAL NOT NULL DEFAULT 0,
        committed_amount REAL NOT NULL DEFAULT 0,
        actual_amount REAL NOT NULL DEFAULT 0,
        forecast_amount REAL NOT NULL DEFAULT 0,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        budget_line_id TEXT REFERENCES budget_lines(id) ON DELETE SET NULL,
        supplier TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        currency TEXT NOT NULL DEFAULT 'EUR',
        amount REAL NOT NULL DEFAULT 0,
        required_by TEXT,
        approval_id TEXT,
        items_json TEXT NOT NULL DEFAULT '[]',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS draw_requests (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        invoice_id TEXT REFERENCES invoices(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        currency TEXT NOT NULL DEFAULT 'EUR',
        requested_amount REAL NOT NULL DEFAULT 0,
        approved_amount REAL NOT NULL DEFAULT 0,
        due_at TEXT,
        funded_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lien_waivers (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
        supplier TEXT,
        waiver_type TEXT NOT NULL DEFAULT 'conditional',
        status TEXT NOT NULL DEFAULT 'requested',
        currency TEXT NOT NULL DEFAULT 'EUR',
        amount REAL NOT NULL DEFAULT 0,
        due_at TEXT,
        received_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS finance_handoffs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        target_system TEXT NOT NULL DEFAULT 'FAB',
        package_type TEXT NOT NULL DEFAULT 'job_finance',
        status TEXT NOT NULL DEFAULT 'draft',
        currency TEXT NOT NULL DEFAULT 'EUR',
        amount REAL NOT NULL DEFAULT 0,
        approval_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS aftercare_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'client_follow_up',
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        owner TEXT,
        due_at TEXT,
        completed_at TEXT,
        notes TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS punch_items (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        severity TEXT NOT NULL DEFAULT 'medium',
        assignee TEXT,
        due_at TEXT,
        closed_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS warranty_claims (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        client_name TEXT,
        severity TEXT NOT NULL DEFAULT 'medium',
        due_at TEXT,
        resolved_at TEXT,
        approval_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recurring_plans (
        id TEXT PRIMARY KEY,
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
        service TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        interval_rule TEXT NOT NULL DEFAULT 'monthly',
        next_due_at TEXT,
        last_created_job_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS client_portal_access (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending_approval',
        approval_id TEXT,
        expires_at TEXT NOT NULL,
        last_accessed_at TEXT,
        revoked_at TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        job_id TEXT,
        approval_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by TEXT NOT NULL DEFAULT 'Contractor.AI',
        resolved_by TEXT,
        resolved_at TEXT,
        summary TEXT,
        reason TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        job_id TEXT,
        action TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'Contractor.AI',
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schedule_weather (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        location TEXT,
        forecast_at TEXT,
        condition TEXT,
        precipitation_percent REAL NOT NULL DEFAULT 0,
        recommendation TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS job_learning_profiles (
        job_type TEXT PRIMARY KEY,
        sample_count INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        avg_estimated_hours REAL NOT NULL DEFAULT 0,
        avg_actual_hours REAL NOT NULL DEFAULT 0,
        avg_estimated_cost REAL NOT NULL DEFAULT 0,
        avg_actual_cost REAL NOT NULL DEFAULT 0,
        avg_quote_total REAL NOT NULL DEFAULT 0,
        avg_invoice_total REAL NOT NULL DEFAULT 0,
        confidence TEXT NOT NULL DEFAULT 'low',
        tasks_json TEXT NOT NULL DEFAULT '[]',
        tools_json TEXT NOT NULL DEFAULT '[]',
        materials_json TEXT NOT NULL DEFAULT '[]',
        quote_items_json TEXT NOT NULL DEFAULT '[]',
        worker_signals_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_trade_partners_status ON trade_partners(status, partner_type, updated_at);
      CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(job_type, status);
      CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_job ON job_tasks(job_id);
      CREATE INDEX IF NOT EXISTS idx_quotes_job ON quotes(job_id);
      CREATE INDEX IF NOT EXISTS idx_site_visits_job ON site_visits(job_id);
      CREATE INDEX IF NOT EXISTS idx_change_orders_job ON change_orders(job_id);
      CREATE INDEX IF NOT EXISTS idx_field_reports_job ON field_reports(job_id);
      CREATE INDEX IF NOT EXISTS idx_rfi_records_job ON rfi_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_submittal_records_job ON submittal_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_client_selections_job ON client_selections(job_id);
      CREATE INDEX IF NOT EXISTS idx_permit_records_job ON permit_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_inspection_records_job ON inspection_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_observation_records_job ON observation_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_incident_records_job ON incident_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_safety_meetings_job ON safety_meetings(job_id);
      CREATE INDEX IF NOT EXISTS idx_worker_orientations_job ON worker_orientations(job_id);
      CREATE INDEX IF NOT EXISTS idx_jha_records_job ON jha_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_sds_sheets_job ON sds_sheets(job_id);
      CREATE INDEX IF NOT EXISTS idx_site_access_logs_job ON site_access_logs(job_id);
      CREATE INDEX IF NOT EXISTS idx_assignments_worker ON assignments(worker_id, status);
      CREATE INDEX IF NOT EXISTS idx_quality_checks_job ON quality_checks(job_id);
      CREATE INDEX IF NOT EXISTS idx_safety_checks_job ON safety_checks(job_id);
      CREATE INDEX IF NOT EXISTS idx_payments_job ON payments(job_id);
      CREATE INDEX IF NOT EXISTS idx_budget_lines_job ON budget_lines(job_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_job ON purchase_orders(job_id);
      CREATE INDEX IF NOT EXISTS idx_draw_requests_job ON draw_requests(job_id);
      CREATE INDEX IF NOT EXISTS idx_lien_waivers_job ON lien_waivers(job_id);
      CREATE INDEX IF NOT EXISTS idx_finance_handoffs_job ON finance_handoffs(job_id);
      CREATE INDEX IF NOT EXISTS idx_aftercare_job ON aftercare_items(job_id);
      CREATE INDEX IF NOT EXISTS idx_punch_items_job ON punch_items(job_id);
      CREATE INDEX IF NOT EXISTS idx_warranty_claims_job ON warranty_claims(job_id);
      CREATE INDEX IF NOT EXISTS idx_recurring_plans_due ON recurring_plans(status, next_due_at);
      CREATE INDEX IF NOT EXISTS idx_route_plans_job ON route_plans(job_id);
      CREATE INDEX IF NOT EXISTS idx_loading_plans_job ON loading_plans(job_id);
      CREATE INDEX IF NOT EXISTS idx_procurement_orders_job ON procurement_orders(job_id);
      CREATE INDEX IF NOT EXISTS idx_worker_instructions_job ON worker_instructions(job_id);
      CREATE INDEX IF NOT EXISTS idx_communications_job ON communication_records(job_id);
      CREATE INDEX IF NOT EXISTS idx_communications_status ON communication_records(direction, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_client_portal_access_job ON client_portal_access(job_id, status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_tool_reservations_tool ON tool_reservations(tool_id, tool_name, status);
      CREATE INDEX IF NOT EXISTS idx_learning_profiles_confidence ON job_learning_profiles(confidence, updated_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
    `);
  }

  close() {
    this.db.close();
  }

  applyMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger_schema_migrations (
        version TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    this.transaction(() => {
      const applied = new Set(this.db.prepare('SELECT version FROM ledger_schema_migrations').all().map(row => row.version));
      for (const migration of LEDGER_SCHEMA_MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        migration.apply(this.db, { databaseMode: this.databaseMode });
        this.db.prepare('INSERT INTO ledger_schema_migrations (version, description, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.description, nowIso());
      }
    });
  }

  migrationStatus() {
    const applied = this.db.prepare('SELECT version, description, applied_at FROM ledger_schema_migrations ORDER BY version').all().map(row => ({
      version: row.version,
      description: row.description,
      appliedAt: row.applied_at
    }));
    return {
      currentVersion: LEDGER_SCHEMA_MIGRATIONS.at(-1)?.version || null,
      applied,
      pending: LEDGER_SCHEMA_MIGRATIONS.filter(migration => !applied.some(entry => entry.version === migration.version)).map(migration => migration.version)
    };
  }

  createOperatorSession(input = {}) {
    const sessionIdHash = normalizeText(input.sessionIdHash);
    const operatorId = normalizeText(input.operatorId);
    const role = normalizeText(input.role);
    const tokenFingerprint = normalizeText(input.tokenFingerprint);
    const issuedAt = normalizeText(input.issuedAt);
    const expiresAt = normalizeText(input.expiresAt);
    const issuedTime = Date.parse(issuedAt);
    const expiresTime = Date.parse(expiresAt);
    if (!sessionIdHash || !operatorId || !role || !tokenFingerprint) {
      throw new Error('Operator session identity is incomplete.');
    }
    if (!Number.isFinite(issuedTime) || !Number.isFinite(expiresTime) || expiresTime <= issuedTime) {
      throw new Error('Operator session timestamps are invalid.');
    }
    const timestamp = nowIso();
    const revokedRetentionCutoff = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString();
    return this.transaction(() => {
      this.db.prepare(`
        DELETE FROM operator_sessions
        WHERE expires_at <= ? OR (revoked_at IS NOT NULL AND revoked_at <= ?)
      `).run(timestamp, revokedRetentionCutoff);
      this.db.prepare(`
        INSERT INTO operator_sessions (
          session_id_hash, operator_id, role, token_fingerprint,
          issued_at, expires_at, revoked_at, revocation_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `).run(
        sessionIdHash,
        operatorId,
        role,
        tokenFingerprint,
        new Date(issuedTime).toISOString(),
        new Date(expiresTime).toISOString(),
        timestamp,
        timestamp
      );
      return this.getOperatorSession(sessionIdHash, { at: new Date(issuedTime).toISOString() });
    });
  }

  getOperatorSession(sessionIdHash, options = {}) {
    const normalizedId = normalizeText(sessionIdHash);
    if (!normalizedId) return null;
    const at = normalizeText(options.at, nowIso());
    const row = options.includeRevoked === true
      ? this.db.prepare('SELECT * FROM operator_sessions WHERE session_id_hash = ?').get(normalizedId)
      : this.db.prepare(`
          SELECT * FROM operator_sessions
          WHERE session_id_hash = ? AND revoked_at IS NULL AND issued_at <= ? AND expires_at > ?
        `).get(normalizedId, at, at);
    if (!row) return null;
    return {
      sessionIdHash: row.session_id_hash,
      operatorId: row.operator_id,
      role: row.role,
      tokenFingerprint: row.token_fingerprint,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at || null,
      revocationReason: row.revocation_reason || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  revokeOperatorSession(sessionIdHash, options = {}) {
    const normalizedId = normalizeText(sessionIdHash);
    if (!normalizedId) return false;
    const timestamp = normalizeText(options.revokedAt, nowIso());
    const reason = normalizeText(options.reason, 'operator_logout').slice(0, 160);
    const result = this.db.prepare(`
      UPDATE operator_sessions
      SET revoked_at = ?, revocation_reason = ?, updated_at = ?
      WHERE session_id_hash = ? AND revoked_at IS NULL
    `).run(timestamp, reason, timestamp, normalizedId);
    return Number(result.changes || 0) === 1;
  }

  revokeAllOperatorSessions(options = {}) {
    const timestamp = normalizeText(options.revokedAt, nowIso());
    const reason = normalizeText(options.reason, 'operator_session_invalidation').slice(0, 160);
    const result = this.db.prepare(`
      UPDATE operator_sessions
      SET revoked_at = ?, revocation_reason = ?, updated_at = ?
      WHERE revoked_at IS NULL
    `).run(timestamp, reason, timestamp);
    return Number(result.changes || 0);
  }

  getAuthenticationRateLimit(keyHash, options = {}) {
    const normalizedKeyHash = normalizeText(keyHash).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedKeyHash)) throw new Error('Authentication rate-limit key must be a SHA-256 hash');
    const limit = Math.max(1, Math.round(normalizeNumber(options.limit, 10)));
    const windowMs = Math.max(1_000, Math.round(normalizeNumber(options.windowMs, 900_000)));
    const now = options.now ? new Date(options.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Authentication rate-limit time is invalid');
    const timestamp = now.toISOString();
    let row = this.db.prepare('SELECT * FROM auth_rate_limits WHERE key_hash = ?').get(normalizedKeyHash);
    if (row && row.expires_at <= timestamp) {
      this.db.prepare('DELETE FROM auth_rate_limits WHERE key_hash = ? AND expires_at <= ?').run(normalizedKeyHash, timestamp);
      row = null;
    }
    const attemptCount = Number(row?.attempt_count || 0);
    return {
      keyHash: normalizedKeyHash,
      attemptCount,
      limit,
      remaining: Math.max(0, limit - attemptCount),
      limited: attemptCount >= limit,
      windowStartedAt: row?.window_started_at || null,
      expiresAt: row?.expires_at || new Date(now.getTime() + windowMs).toISOString()
    };
  }

  recordAuthenticationFailure(keyHash, options = {}) {
    const normalizedKeyHash = normalizeText(keyHash).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedKeyHash)) throw new Error('Authentication rate-limit key must be a SHA-256 hash');
    const limit = Math.max(1, Math.round(normalizeNumber(options.limit, 10)));
    const windowMs = Math.max(1_000, Math.round(normalizeNumber(options.windowMs, 900_000)));
    const now = options.now ? new Date(options.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Authentication rate-limit time is invalid');
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + windowMs).toISOString();

    return this.transaction(() => {
      this.db.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ?').run(timestamp);
      this.db.prepare(`
        INSERT OR IGNORE INTO auth_rate_limits (key_hash, window_started_at, attempt_count, updated_at, expires_at)
        VALUES (?, ?, 0, ?, ?)
      `).run(normalizedKeyHash, timestamp, timestamp, expiresAt);
      this.db.prepare(`
        UPDATE auth_rate_limits
        SET attempt_count = attempt_count + 1, updated_at = ?
        WHERE key_hash = ?
      `).run(timestamp, normalizedKeyHash);
      return this.getAuthenticationRateLimit(normalizedKeyHash, { limit, windowMs, now: timestamp });
    });
  }

  clearAuthenticationRateLimit(keyHash) {
    const normalizedKeyHash = normalizeText(keyHash).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedKeyHash)) return false;
    const result = this.db.prepare('DELETE FROM auth_rate_limits WHERE key_hash = ?').run(normalizedKeyHash);
    return Number(result.changes || 0) > 0;
  }

  recordApiRateLimitRequest(keyHash, options = {}) {
    const normalizedKeyHash = normalizeText(keyHash).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalizedKeyHash)) throw new Error('API rate-limit key must be a SHA-256 hash');
    const limit = Math.max(1, Math.round(normalizeNumber(options.limit, 1_000)));
    const windowMs = Math.max(1_000, Math.round(normalizeNumber(options.windowMs, 60_000)));
    const now = options.now ? new Date(options.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('API rate-limit time is invalid');
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + windowMs).toISOString();

    return this.transaction(() => {
      this.db.prepare('DELETE FROM api_rate_limits WHERE expires_at <= ?').run(timestamp);
      this.db.prepare(`
        INSERT OR IGNORE INTO api_rate_limits (key_hash, window_started_at, request_count, updated_at, expires_at)
        VALUES (?, ?, 0, ?, ?)
      `).run(normalizedKeyHash, timestamp, timestamp, expiresAt);
      this.db.prepare(`
        UPDATE api_rate_limits
        SET request_count = request_count + 1, updated_at = ?
        WHERE key_hash = ?
      `).run(timestamp, normalizedKeyHash);
      const row = this.db.prepare('SELECT * FROM api_rate_limits WHERE key_hash = ?').get(normalizedKeyHash);
      const requestCount = Number(row.request_count || 0);
      return {
        keyHash: normalizedKeyHash,
        requestCount,
        limit,
        remaining: Math.max(0, limit - requestCount),
        limited: requestCount > limit,
        windowStartedAt: row.window_started_at,
        expiresAt: row.expires_at
      };
    });
  }

  clearApiRateLimits() {
    const result = this.db.prepare('DELETE FROM api_rate_limits').run();
    return Number(result.changes || 0);
  }

  getScheduledJob(jobKey) {
    const row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE job_key = ?').get(String(jobKey || ''));
    if (!row) return null;
    return {
      jobKey: row.job_key,
      status: row.status,
      intervalSeconds: Number(row.interval_seconds || 0),
      leaseId: row.lease_id,
      leaseUntil: row.lease_until,
      lastStartedAt: row.last_started_at,
      lastCompletedAt: row.last_completed_at,
      runCount: Number(row.run_count || 0),
      lastResult: fromJson(row.last_result_json, {}),
      updatedAt: row.updated_at
    };
  }

  claimScheduledJob(jobKey, options = {}) {
    const key = normalizeText(jobKey, 'autonomous_cycle');
    const intervalSeconds = Math.max(30, Math.round(normalizeNumber(options.intervalSeconds, 300)));
    const leaseSeconds = Math.max(10, Math.round(normalizeNumber(options.leaseSeconds, 120)));
    const now = options.now ? new Date(options.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Scheduler claim time is invalid');
    const nowValue = now.toISOString();
    const leaseUntil = new Date(now.getTime() + (leaseSeconds * 1000)).toISOString();

    return this.transaction(() => {
      let row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE job_key = ?').get(key);
      if (!row) {
        this.db.prepare(`
          INSERT OR IGNORE INTO scheduled_jobs (job_key, status, interval_seconds, lease_id, lease_until, last_started_at, last_completed_at, run_count, last_result_json, updated_at)
          VALUES (?, 'idle', ?, NULL, NULL, NULL, NULL, 0, '{}', ?)
        `).run(key, intervalSeconds, nowValue);
        row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE job_key = ?').get(key);
      }

      const current = this.getScheduledJob(key);
      const activeLease = current.leaseUntil && current.leaseUntil > nowValue;
      const nextDueAt = current.lastCompletedAt
        ? new Date(new Date(current.lastCompletedAt).getTime() + (current.intervalSeconds * 1000)).toISOString()
        : nowValue;
      if (activeLease || nextDueAt > nowValue) {
        return { claimed: false, reason: activeLease ? 'lease_active' : 'not_due', job: current, nextDueAt };
      }

      const leaseId = makeId('lease');
      const claimed = this.db.prepare(`
        UPDATE scheduled_jobs
        SET status = 'running', interval_seconds = ?, lease_id = ?, lease_until = ?, last_started_at = ?, run_count = run_count + 1, updated_at = ?
        WHERE job_key = ?
          AND COALESCE(lease_id, '') = COALESCE(?, '')
          AND COALESCE(lease_until, '') = COALESCE(?, '')
      `).run(intervalSeconds, leaseId, leaseUntil, nowValue, nowValue, key, current.leaseId, current.leaseUntil);
      if (Number(claimed.changes || 0) !== 1) {
        const latest = this.getScheduledJob(key);
        const latestActiveLease = latest?.leaseUntil && latest.leaseUntil > nowValue;
        const latestNextDueAt = latest?.lastCompletedAt
          ? new Date(new Date(latest.lastCompletedAt).getTime() + (latest.intervalSeconds * 1000)).toISOString()
          : nowValue;
        return {
          claimed: false,
          reason: latestActiveLease ? 'lease_active' : latestNextDueAt > nowValue ? 'not_due' : 'claim_lost',
          job: latest,
          nextDueAt: latestNextDueAt
        };
      }
      return { claimed: true, leaseId, job: this.getScheduledJob(key), nextDueAt };
    });
  }

  completeScheduledJob(jobKey, leaseId, result = {}, options = {}) {
    const key = normalizeText(jobKey, 'autonomous_cycle');
    const now = options.now ? new Date(options.now) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Scheduler completion time is invalid');
    const nowValue = now.toISOString();
    const success = result.success !== false;
    return this.transaction(() => {
      const current = this.getScheduledJob(key);
      if (!current || current.leaseId !== leaseId) {
        return { completed: false, reason: 'lease_not_owned', job: current };
      }
      const completed = this.db.prepare(`
        UPDATE scheduled_jobs
        SET status = ?, lease_id = NULL, lease_until = NULL, last_completed_at = ?, last_result_json = ?, updated_at = ?
        WHERE job_key = ? AND lease_id = ?
      `).run(success ? 'idle' : 'failed', nowValue, toJson(result), nowValue, key, leaseId);
      if (Number(completed.changes || 0) !== 1) {
        return { completed: false, reason: 'lease_not_owned', job: this.getScheduledJob(key) };
      }
      const job = this.getScheduledJob(key);
      this.audit({ entityType: 'scheduled_job', entityId: key, action: success ? 'complete_scheduled_job' : 'fail_scheduled_job', actor: options.actor || 'scheduler', after: job });
      return { completed: true, job };
    });
  }

  claimIdempotentRequest({ keyHash, scope, requestHash, ttlMs = 24 * 60 * 60 * 1000, leaseMs = 2 * 60 * 1000, now: requestedNow } = {}) {
    const normalizedKeyHash = normalizeText(keyHash);
    const normalizedScope = normalizeText(scope);
    const normalizedRequestHash = normalizeText(requestHash);
    if (!normalizedKeyHash || !normalizedScope || !normalizedRequestHash) {
      throw new Error('Idempotency key hash, scope, and request hash are required.');
    }

    const now = requestedNow ? new Date(requestedNow) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error('Idempotency claim time is invalid.');
    const timestamp = now.toISOString();
    const leaseId = makeId('request_lease');
    const leaseUntil = new Date(now.getTime() + Math.max(5_000, Number(leaseMs) || 0)).toISOString();
    const expiresAt = new Date(now.getTime() + Math.max(60_000, Number(ttlMs) || 0)).toISOString();

    return this.transaction(() => {
      this.db.prepare('DELETE FROM idempotency_records WHERE expires_at <= ?').run(timestamp);
      const inserted = this.db.prepare(`
        INSERT OR IGNORE INTO idempotency_records (
          key_hash, scope, request_hash, status, lease_id, lease_until, response_status,
          response_body_json, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, 'processing', ?, ?, NULL, NULL, ?, ?, ?)
      `).run(normalizedKeyHash, normalizedScope, normalizedRequestHash, leaseId, leaseUntil, timestamp, timestamp, expiresAt);

      if (Number(inserted.changes || 0) === 1) {
        return { claimed: true, replayed: false, keyHash: normalizedKeyHash, leaseId, leaseUntil, expiresAt };
      }

      const existing = this.db.prepare('SELECT * FROM idempotency_records WHERE key_hash = ?').get(normalizedKeyHash);
      if (!existing) return { claimed: false, replayed: false, reason: 'claim_lost' };
      if (existing.scope !== normalizedScope || existing.request_hash !== normalizedRequestHash) {
        return { claimed: false, replayed: false, reason: 'request_conflict' };
      }
      if (existing.status === 'completed') {
        return {
          claimed: false,
          replayed: true,
          responseStatus: Number(existing.response_status || 200),
          responseBody: fromJson(existing.response_body_json, {}),
          completedAt: existing.updated_at,
          expiresAt: existing.expires_at
        };
      }

      const activeLeaseUntil = Date.parse(existing.lease_until || '');
      if (Number.isFinite(activeLeaseUntil) && activeLeaseUntil > now.getTime()) {
        return {
          claimed: false,
          replayed: false,
          reason: 'request_in_progress',
          retryAfterMs: activeLeaseUntil - now.getTime()
        };
      }

      const reclaimed = this.db.prepare(`
        UPDATE idempotency_records
        SET status = 'processing', lease_id = ?, lease_until = ?, response_status = NULL,
            response_body_json = NULL, updated_at = ?, expires_at = ?
        WHERE key_hash = ? AND request_hash = ? AND status = 'processing'
          AND COALESCE(lease_id, '') = COALESCE(?, '')
          AND COALESCE(lease_until, '') = COALESCE(?, '')
      `).run(
        leaseId,
        leaseUntil,
        timestamp,
        expiresAt,
        normalizedKeyHash,
        normalizedRequestHash,
        existing.lease_id,
        existing.lease_until
      );
      if (Number(reclaimed.changes || 0) === 1) {
        return { claimed: true, replayed: false, reclaimed: true, keyHash: normalizedKeyHash, leaseId, leaseUntil, expiresAt };
      }
      const latest = this.db.prepare('SELECT * FROM idempotency_records WHERE key_hash = ?').get(normalizedKeyHash);
      const latestLeaseUntil = Date.parse(latest?.lease_until || '');
      if (
        latest
        && latest.scope === normalizedScope
        && latest.request_hash === normalizedRequestHash
        && latest.status === 'processing'
        && Number.isFinite(latestLeaseUntil)
        && latestLeaseUntil > now.getTime()
      ) {
        return {
          claimed: false,
          replayed: false,
          reason: 'request_in_progress',
          retryAfterMs: latestLeaseUntil - now.getTime()
        };
      }
      return { claimed: false, replayed: false, reason: 'claim_lost' };
    });
  }

  completeIdempotentRequest(keyHash, requestHash, responseStatus, responseBody, leaseId) {
    const normalizedLeaseId = normalizeText(leaseId);
    if (!normalizedLeaseId) return false;
    const timestamp = nowIso();
    const updated = this.db.prepare(`
      UPDATE idempotency_records
      SET status = 'completed', lease_id = NULL, lease_until = NULL, response_status = ?,
          response_body_json = ?, updated_at = ?
      WHERE key_hash = ? AND request_hash = ? AND status = 'processing' AND lease_id = ?
    `).run(Number(responseStatus || 200), toJson(responseBody, {}), timestamp, keyHash, requestHash, normalizedLeaseId);
    return Number(updated.changes || 0) === 1;
  }

  releaseIdempotentRequest(keyHash, requestHash, leaseId) {
    const normalizedLeaseId = normalizeText(leaseId);
    if (!normalizedLeaseId) return false;
    const released = this.db.prepare(`
      DELETE FROM idempotency_records
      WHERE key_hash = ? AND request_hash = ? AND status = 'processing' AND lease_id = ?
    `).run(keyHash, requestHash, normalizedLeaseId);
    return Number(released.changes || 0) === 1;
  }

  transaction(callback) {
    if (this.transactionDepth > 0) {
      this.transactionDepth += 1;
      try {
        return callback();
      } finally {
        this.transactionDepth -= 1;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionDepth = 1;
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth = 0;
    }
  }

  count(table) {
    return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count || 0);
  }

  operationalJobStatusSql(alias = 'jobs') {
    const inactive = [...INACTIVE_JOB_STATUSES].map(status => `'${status}'`).join(', ');
    return `${alias}.status NOT IN (${inactive})`;
  }

  jobAllowsOperations(status) {
    return !INACTIVE_JOB_STATUSES.has(normalizeStatus(status, 'intake'));
  }

  activeAssignmentStatusSql(alias = 'assignments') {
    const closed = [...ASSIGNMENT_CLOSED_STATUSES].map(status => `'${status}'`).join(', ');
    return `${alias}.status NOT IN (${closed})`;
  }

  activeToolReservationStatusSql(alias = 'tool_reservations') {
    const closed = [...TOOL_RESERVATION_CLOSED_STATUSES].map(status => `'${status}'`).join(', ');
    return `${alias}.status NOT IN (${closed})`;
  }

  workerAssignmentScope(workerId) {
    const rows = this.db.prepare(`
      SELECT assignments.*, jobs.title AS job_title, jobs.status AS job_status,
        CASE WHEN jobs.id IS NULL OR ${this.operationalJobStatusSql('jobs')} THEN 1 ELSE 0 END AS is_operational
      FROM assignments
      LEFT JOIN jobs ON jobs.id = assignments.job_id
      WHERE assignments.worker_id = ?
        AND ${this.activeAssignmentStatusSql('assignments')}
      ORDER BY assignments.created_at ASC
    `).all(workerId).map(row => ({
      id: row.id,
      jobId: row.job_id,
      jobTitle: row.job_title || row.job_id || 'Unlinked assignment',
      jobStatus: row.job_status || null,
      status: row.status,
      scheduledStart: row.scheduled_start || null,
      scheduledEnd: row.scheduled_end || null,
      operational: Number(row.is_operational || 0) === 1
    }));
    return {
      retained: rows,
      operational: rows.filter(row => row.operational),
      dormant: rows.filter(row => !row.operational)
    };
  }

  toolReservationScope(toolId) {
    const rows = this.db.prepare(`
      SELECT tool_reservations.*, jobs.title AS job_title, jobs.status AS job_status,
        CASE WHEN jobs.id IS NULL OR ${this.operationalJobStatusSql('jobs')} THEN 1 ELSE 0 END AS is_operational
      FROM tool_reservations
      LEFT JOIN jobs ON jobs.id = tool_reservations.job_id
      WHERE tool_reservations.tool_id = ?
        AND ${this.activeToolReservationStatusSql('tool_reservations')}
      ORDER BY tool_reservations.created_at ASC
    `).all(toolId).map(row => ({
      id: row.id,
      jobId: row.job_id,
      jobTitle: row.job_title || row.job_id || 'Unlinked reservation',
      jobStatus: row.job_status || null,
      status: row.status,
      neededFrom: row.needed_from || null,
      neededUntil: row.needed_until || null,
      operational: Number(row.is_operational || 0) === 1
    }));
    return {
      retained: rows,
      operational: rows.filter(row => row.operational),
      dormant: rows.filter(row => !row.operational)
    };
  }

  activeRecordScope(table) {
    if (table === 'jobs') {
      return {
        from: 'jobs AS records',
        condition: this.operationalJobStatusSql('records')
      };
    }
    if (table === 'job_requests') {
      return {
        from: 'job_requests AS records LEFT JOIN jobs ON jobs.request_id = records.id',
        condition: `(jobs.id IS NULL OR ${this.operationalJobStatusSql('jobs')})`
      };
    }
    return {
      from: `${table} AS records LEFT JOIN jobs ON jobs.id = records.job_id`,
      condition: `(records.job_id IS NULL OR ${this.operationalJobStatusSql('jobs')})`
    };
  }

  countActiveRecords(table, condition = '1 = 1', params = []) {
    const scope = this.activeRecordScope(table);
    return Number(this.db.prepare(`
      SELECT COUNT(DISTINCT records.id) AS count
      FROM ${scope.from}
      WHERE ${scope.condition} AND (${condition})
    `).get(...params).count || 0);
  }

  sumActiveRecords(table, column, condition = '1 = 1', params = []) {
    const scope = this.activeRecordScope(table);
    return normalizeNumber(this.db.prepare(`
      SELECT COALESCE(SUM(records.${column}), 0) AS total
      FROM ${scope.from}
      WHERE ${scope.condition} AND (${condition})
    `).get(...params).total, 0);
  }

  getJobRow(jobId) {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  }

  requireJob(jobId, { allowInactive = false } = {}) {
    const row = this.getJobRow(jobId);
    if (!row) {
      const error = new Error('Ledger job not found');
      error.statusCode = 404;
      throw error;
    }
    const status = normalizeStatus(row.status, 'intake');
    if (!allowInactive && !this.jobAllowsOperations(status)) {
      const restoreAvailable = ['archived', 'pending_archive_approval'].includes(status);
      const recovery = restoreAvailable
        ? 'Use the approval-gated restore workflow before recording new operational changes.'
        : 'This terminal job state does not permit new operational changes.';
      const error = new Error(`Job ${row.title || row.id} is ${status} and read-only. ${recovery}`);
      error.statusCode = 409;
      error.code = 'job_inactive_read_only';
      error.details = {
        jobId: row.id,
        jobStatus: status,
        restoreAvailable
      };
      throw error;
    }
    return row;
  }

  auditChainState({ lock = false } = {}) {
    const lockClause = lock && this.databaseMode === 'postgres' ? ' FOR UPDATE' : '';
    return this.db.prepare(`SELECT * FROM audit_chain_state WHERE chain_id = ?${lockClause}`).get(AUDIT_CHAIN_ID) || null;
  }

  audit({ entityType, entityId, jobId = null, action, actor = 'Contractor.AI', before = null, after = null, metadata = null, createdAt = null }) {
    return this.transaction(() => appendAuditEventToDatabase(this.db, {
      entityType,
      entityId,
      jobId,
      action,
      actor,
      before,
      after,
      metadata,
      createdAt
    }, { databaseMode: this.databaseMode, chainAvailable: true }).id);
  }

  verifyAuditIntegrity() {
    return this.transaction(() => {
      const state = this.auditChainState({ lock: true });
      const rows = this.db.prepare('SELECT * FROM audit_events ORDER BY sequence_number ASC, id ASC').all();
      return verifyAuditChainRows(rows, state);
    });
  }

  seedFromState() {
    const state = this.stateProvider() || {};
    const stateJobs = Array.isArray(state.jobs) ? state.jobs : [];
    const stateWorkers = Array.isArray(state.workers) ? state.workers : [];
    const stateTools = Array.isArray(state.tools) ? state.tools : [];

    if (!stateJobs.length && !stateWorkers.length && !stateTools.length) {
      return;
    }

    this.transaction(() => {
      if (this.count('jobs') || this.count('clients')) return;
      for (const worker of stateWorkers) {
        const id = `legacy_worker_${worker.id}`;
        const timestamp = nowIso();
        this.db.prepare(`
          INSERT OR IGNORE INTO workers (id, name, role, status, home_region, hourly_rate, skills_json, data_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          normalizeText(worker.name, 'Worker'),
          worker.specialty || worker.role || null,
          normalizeStatus(worker.status, 'available'),
          worker.location || worker.currentLocation || null,
          normalizeNumber(worker.hourlyRate || worker.hourly_rate, 0),
          toJson(worker.skills || worker.specialties || (worker.specialty ? [worker.specialty] : []), []),
          toJson({ legacyId: worker.id, rating: worker.rating, completedJobs: worker.completedJobs }),
          timestamp,
          timestamp
        );
      }

      for (const tool of stateTools) {
        const id = `legacy_tool_${tool.id}`;
        const timestamp = nowIso();
        this.db.prepare(`
          INSERT OR IGNORE INTO tools (id, name, category, status, home_location, current_location, data_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          normalizeText(tool.name, 'Tool'),
          normalizeText(tool.category, 'general'),
          normalizeStatus(tool.status, 'available'),
          tool.homeLocation || tool.currentLocation || tool.location || 'Warehouse',
          tool.currentLocation || tool.location || 'Warehouse',
          toJson({ legacyId: tool.id, assignedJobId: tool.assignedJobId, assignedWorkerId: tool.assignedWorkerId }),
          timestamp,
          timestamp
        );
      }

      for (const job of stateJobs) {
        const client = this.findOrCreateClient({
          name: job.client || job.client_name || 'Unknown client',
          phone: job.phone || job.client_phone || null,
          email: job.email || job.client_email || null,
          address: job.address || job.location || null,
          country: 'NL',
          source: 'seed'
        }, { audit: false });
        const jobId = `legacy_job_${job.id}`;
        const requestId = makeId('req');
        const timestamp = nowIso();
        this.db.prepare(`
          INSERT OR IGNORE INTO job_requests (id, client_id, source_channel, service, description, urgency, budget, status, data_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          requestId,
          client.id,
          'legacy_state',
          job.service || job.jobType || job.job_type || 'contracting',
          job.description || '',
          normalizePriority(job.priority),
          job.budget || String(job.estimatedCost || job.estimated_cost || ''),
          'imported',
          toJson({ legacyId: job.id }),
          timestamp,
          timestamp
        );
        this.db.prepare(`
          INSERT OR IGNORE INTO jobs (
            id, request_id, client_id, title, job_type, description, address, city, region, country, priority, status, phase,
            risk_level, estimated_hours, estimated_cost, contract_value, margin_target_percent, progress_percent,
            scheduled_start, scheduled_end, target_completion, approval_state, data_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          jobId,
          requestId,
          client.id,
          normalizeText(job.title || job.service, 'Imported job'),
          normalizeText(job.jobType || job.job_type || job.service, 'general'),
          job.description || '',
          job.address || job.location || null,
          job.city || null,
          job.region || null,
          job.country || 'NL',
          normalizePriority(job.priority),
          normalizeStatus(job.status, 'intake'),
          normalizeStatus(job.phase, normalizeStatus(job.status, 'intake')),
          job.priority === 'critical' ? 'high' : 'normal',
          normalizeNumber(job.estimatedHours || job.estimated_hours, 0),
          normalizeNumber(job.estimatedCost || job.estimated_cost, 0),
          normalizeNumber(job.contractValue || job.contract_value || job.estimatedCost || job.estimated_cost, 0),
          normalizeNumber(job.marginTargetPercent || job.margin_target_percent, 20),
          Math.max(0, Math.min(100, normalizeNumber(job.progress || job.progress_percentage, 0))),
          rowDate(job.scheduledStart || job.startDate),
          rowDate(job.scheduledEnd || job.estimatedCompletion),
          rowDate(job.estimatedCompletion),
          ['completed', 'in_progress'].includes(normalizeStatus(job.status)) ? 'approved' : 'pending',
          toJson({ legacyId: job.id, worker: job.worker, assignedWorkerId: job.assignedWorkerId, tools: job.tools || job.requiredTools || [] }),
          timestamp,
          timestamp
        );
        this.addTask(jobId, {
          title: `Operate ${job.title || 'imported job'}`,
          description: job.description || 'Imported from current Contractor.AI state.',
          status: normalizeStatus(job.status) === 'completed' ? 'completed' : 'open',
          priority: normalizePriority(job.priority),
          dueAt: job.estimatedCompletion || null
        }, { actor: 'system_seed', audit: false });
      }

      this.audit({
        entityType: 'ledger',
        entityId: 'seed',
        action: 'seed_from_current_state',
        actor: 'system',
        after: {
          jobs: stateJobs.length,
          workers: stateWorkers.length,
          tools: stateTools.length
        }
      });
    });
  }

  findOrCreateClient(payload = {}, options = {}) {
    const name = normalizeText(payload.name || payload.client || payload.clientName || payload.company, 'Unknown client');
    const email = normalizeText(payload.email || payload.client_email, '');
    const phone = normalizeText(payload.phone || payload.client_phone, '');
    const existing = this.db.prepare(`
      SELECT * FROM clients
      WHERE lower(name) = lower(?)
        AND (COALESCE(email, '') = ? OR ? = '')
        AND (COALESCE(phone, '') = ? OR ? = '')
      ORDER BY created_at ASC
      LIMIT 1
    `).get(name, email, email, phone, phone);
    if (existing) {
      return this.mapClient(existing);
    }

    const id = makeId('client');
    const timestamp = nowIso();
    const record = {
      id,
      name,
      company: payload.company || null,
      email: email || null,
      phone: phone || null,
      address: payload.address || payload.location || null,
      city: payload.city || null,
      country: normalizeText(payload.country, 'NL'),
      vatNumber: payload.vatNumber || payload.vat_number || null,
      preferredLanguage: normalizeText(payload.preferredLanguage || payload.language, 'nl'),
      data: { source: payload.source || 'manual', notes: payload.notes || null },
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.db.prepare(`
      INSERT INTO clients (id, name, company, email, phone, address, city, country, vat_number, preferred_language, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.name,
      record.company,
      record.email,
      record.phone,
      record.address,
      record.city,
      record.country,
      record.vatNumber,
      record.preferredLanguage,
      toJson(record.data),
      record.createdAt,
      record.updatedAt
    );

    if (options.audit !== false) {
      this.audit({ entityType: 'client', entityId: id, action: 'create_client', actor: options.actor || 'Contractor.AI', after: record });
    }
    return record;
  }

  listClients(filters = {}) {
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const rows = this.db.prepare(`
      SELECT * FROM clients
      WHERE (? = '' OR lower(name || ' ' || COALESCE(company, '') || ' ' || COALESCE(email, '') || ' ' || COALESCE(phone, '') || ' ' || COALESCE(address, '')) LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(search, `%${search}%`, limit);
    return rows.map(row => this.mapClient(row));
  }

  updateClient(clientId, payload = {}, options = {}) {
    const before = this.db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!before) {
      const error = new Error('Client not found');
      error.statusCode = 404;
      throw error;
    }
    const timestamp = nowIso();
    const data = { ...fromJson(before.data_json), ...(payload.data || {}) };
    this.db.prepare(`
      UPDATE clients
      SET name = ?, company = ?, email = ?, phone = ?, address = ?, city = ?, country = ?, vat_number = ?, preferred_language = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      normalizeText(payload.name ?? before.name, before.name),
      payload.company ?? before.company,
      payload.email ?? payload.client_email ?? before.email,
      payload.phone ?? payload.client_phone ?? before.phone,
      payload.address ?? payload.location ?? before.address,
      payload.city ?? before.city,
      normalizeText(payload.country ?? before.country, 'NL'),
      payload.vatNumber ?? payload.vat_number ?? before.vat_number,
      normalizeText(payload.preferredLanguage ?? payload.language ?? before.preferred_language, 'nl'),
      toJson(data),
      timestamp,
      clientId
    );
    const after = this.mapClient(this.db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId));
    if (options.audit !== false) {
      this.audit({ entityType: 'client', entityId: clientId, action: 'update_client', actor: options.actor || 'Contractor.AI', before: this.mapClient(before), after });
    }
    return after;
  }

  assessTradePartnerCompliance(partner, options = {}) {
    if (!partner) {
      return {
        status: 'missing',
        compliant: false,
        blockers: [{ code: 'trade_partner_missing', message: 'A retained trade partner is required.' }],
        warnings: [],
        checkedAt: nowIso()
      };
    }

    const data = partner.data || {};
    const status = normalizeStatus(partner.status, 'active');
    const partnerType = normalizeStatus(partner.partnerType, 'supplier');
    const requiresInsurance = normalizeBoolean(data.requiresInsurance, ['subcontractor', 'both'].includes(partnerType));
    const requiresVca = normalizeBoolean(data.requiresVca, false);
    const vatExempt = normalizeBoolean(data.vatExempt, false);
    const checkedAt = options.now ? new Date(options.now) : new Date();
    const checkedTimestamp = Number.isNaN(checkedAt.getTime()) ? new Date() : checkedAt;
    const blockers = [];
    const warnings = [];
    const addBlocker = (code, message) => blockers.push({ code, message });
    const addWarning = (code, message) => warnings.push({ code, message });
    const checkExpiry = (value, { required, label, code }) => {
      if (!value) {
        if (required) addBlocker(`${code}_missing`, `${label} expiry evidence is required.`);
        return;
      }
      const expiry = new Date(value);
      if (Number.isNaN(expiry.getTime())) {
        addBlocker(`${code}_invalid`, `${label} expiry evidence is invalid.`);
        return;
      }
      const daysRemaining = Math.ceil((expiry.getTime() - checkedTimestamp.getTime()) / 86_400_000);
      if (daysRemaining < 0) {
        addBlocker(`${code}_expired`, `${label} evidence expired ${Math.abs(daysRemaining)} day(s) ago.`);
      } else if (daysRemaining <= 30) {
        addWarning(`${code}_expiring`, `${label} evidence expires in ${daysRemaining} day(s).`);
      }
    };

    if (status !== 'active') addBlocker('trade_partner_inactive', `Trade partner status is ${status}.`);
    if (!normalizeText(partner.registrationNumber, '')) addBlocker('registration_number_missing', 'Registration or KVK evidence is required.');
    if (!vatExempt && !normalizeText(partner.vatNumber, '')) addBlocker('vat_number_missing', 'VAT evidence or an explicit VAT exemption is required.');
    if (!normalizeText(data.verificationReference, '')) addBlocker('verification_reference_missing', 'A retained verification reference is required.');
    if (!data.verifiedAt || Number.isNaN(new Date(data.verifiedAt).getTime())) {
      addBlocker('verification_date_missing', 'A valid verification date is required.');
    } else if (new Date(data.verifiedAt).getTime() > checkedTimestamp.getTime() + 86_400_000) {
      addBlocker('verification_date_future', 'The verification date cannot be in the future.');
    }
    checkExpiry(partner.insuranceExpiresAt, { required: requiresInsurance, label: 'Liability insurance', code: 'insurance' });
    checkExpiry(partner.vcaExpiresAt, { required: requiresVca, label: 'VCA', code: 'vca' });

    const inactive = blockers.some(item => item.code === 'trade_partner_inactive');
    const expired = blockers.some(item => item.code.endsWith('_expired'));
    const complianceStatus = inactive
      ? 'blocked'
      : expired
        ? 'expired'
        : blockers.length
          ? 'needs_review'
          : warnings.length
            ? 'expiring'
            : 'verified';
    return {
      status: complianceStatus,
      compliant: blockers.length === 0,
      blockers,
      warnings,
      checkedAt: checkedTimestamp.toISOString(),
      requirements: {
        registrationNumber: true,
        vatNumber: !vatExempt,
        insurance: requiresInsurance,
        vca: requiresVca,
        verificationReference: true
      }
    };
  }

  getTradePartner(partnerId) {
    const row = this.db.prepare('SELECT * FROM trade_partners WHERE id = ?').get(partnerId);
    if (!row) {
      const error = new Error('Trade partner not found');
      error.statusCode = 404;
      error.code = 'trade_partner_not_found';
      throw error;
    }
    return this.mapTradePartner(row);
  }

  findTradePartnerByName(name) {
    const normalizedName = normalizeText(name, '');
    if (!normalizedName) return null;
    const row = this.db.prepare(`
      SELECT * FROM trade_partners
      WHERE lower(name) = lower(?)
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 1
    `).get(normalizedName);
    return row ? this.mapTradePartner(row) : null;
  }

  listTradePartners(filters = {}) {
    const requestedStatus = normalizeStatus(filters.status, '');
    const requestedType = normalizeStatus(filters.partnerType || filters.partner_type || filters.type, '');
    const includeRetired = normalizeBoolean(filters.includeRetired ?? filters.include_retired, false)
      || requestedStatus === 'retired';
    const search = normalizeText(filters.search || filters.q, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const pendingRetirements = new Map(this.db.prepare(`
      SELECT target_id, id FROM approvals
      WHERE target_type = 'trade_partner_retirement' AND status = 'pending'
    `).all().map(row => [row.target_id, row.id]));
    const rows = this.db.prepare(`
      SELECT * FROM trade_partners
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 500
    `).all().map(row => {
      const partner = this.mapTradePartner(row);
      return { ...partner, retirementApprovalId: pendingRetirements.get(partner.id) || null };
    });
    return rows.filter(partner => {
      if (!includeRetired && partner.status === 'retired') return false;
      if (requestedStatus && partner.status !== requestedStatus) return false;
      if (requestedType && partner.partnerType !== requestedType && partner.partnerType !== 'both') return false;
      if (!search) return true;
      return JSON.stringify({
        name: partner.name,
        partnerType: partner.partnerType,
        contactName: partner.contactName,
        email: partner.email,
        city: partner.city,
        registrationNumber: partner.registrationNumber,
        vatNumber: partner.vatNumber,
        specialties: partner.specialties
      }).toLowerCase().includes(search);
    }).slice(0, limit);
  }

  summarizeTradePartners(partners = this.listTradePartners({ includeRetired: true, limit: 500 })) {
    return partners.reduce((summary, partner) => {
      summary.total += 1;
      if (partner.status === 'active') summary.active += 1;
      if (partner.status === 'retired') summary.retired += 1;
      if (partner.compliance.status === 'verified') summary.verified += 1;
      if (partner.compliance.status === 'expiring') summary.expiring += 1;
      if (['needs_review', 'expired', 'blocked'].includes(partner.compliance.status)) summary.actionRequired += 1;
      return summary;
    }, { total: 0, active: 0, verified: 0, expiring: 0, actionRequired: 0, retired: 0 });
  }

  upsertTradePartner(payload = {}, options = {}) {
    const id = normalizeText(options.id || payload.id, makeId('partner'));
    const before = this.db.prepare('SELECT * FROM trade_partners WHERE id = ?').get(id);
    const existing = before ? this.mapTradePartner(before) : null;
    if (existing?.status === 'retired') {
      const error = new Error('Retired trade partners are retained and cannot be edited directly');
      error.statusCode = 409;
      error.code = 'trade_partner_retired';
      throw error;
    }
    const name = normalizeText(payload.name ?? existing?.name, '');
    if (name.length < 2) {
      const error = new Error('Trade partner name must contain at least two characters');
      error.statusCode = 400;
      error.code = 'trade_partner_name_required';
      throw error;
    }
    const partnerType = normalizeStatus(payload.partnerType ?? payload.partner_type ?? payload.type ?? existing?.partnerType, 'supplier');
    if (!['supplier', 'subcontractor', 'both'].includes(partnerType)) {
      const error = new Error('Trade partner type must be supplier, subcontractor, or both');
      error.statusCode = 400;
      error.code = 'trade_partner_type_invalid';
      throw error;
    }
    const status = normalizeStatus(payload.status ?? existing?.status, 'active');
    if (!['active', 'on_hold'].includes(status)) {
      const error = new Error('Trade partner status changes to retired require the approval-gated retirement route');
      error.statusCode = 409;
      error.code = 'trade_partner_retirement_route_required';
      throw error;
    }
    const duplicate = this.db.prepare(`
      SELECT id FROM trade_partners
      WHERE lower(name) = lower(?) AND id <> ? AND status <> 'retired'
      LIMIT 1
    `).get(name, id);
    if (duplicate) {
      const error = new Error('An active trade partner with this name already exists');
      error.statusCode = 409;
      error.code = 'trade_partner_duplicate';
      throw error;
    }
    const email = normalizeText(payload.email ?? existing?.email, '');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error('Trade partner email address is invalid');
      error.statusCode = 400;
      error.code = 'trade_partner_email_invalid';
      throw error;
    }
    const optionalDate = (value, fallback) => {
      if (value === undefined) return fallback || null;
      if (value === null || value === '') return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        const error = new Error('Trade partner compliance dates must be valid dates');
        error.statusCode = 400;
        error.code = 'trade_partner_date_invalid';
        throw error;
      }
      return parsed.toISOString();
    };
    const existingData = existing?.data || {};
    const requiresInsuranceInput = payload.requiresInsurance ?? payload.requires_insurance;
    const requiresVcaInput = payload.requiresVca ?? payload.requires_vca;
    const vatExemptInput = payload.vatExempt ?? payload.vat_exempt;
    const data = {
      ...existingData,
      ...(payload.data || {}),
      requiresInsurance: requiresInsuranceInput === undefined
        ? (existingData.requiresInsurance ?? ['subcontractor', 'both'].includes(partnerType))
        : normalizeBoolean(requiresInsuranceInput, false),
      requiresVca: requiresVcaInput === undefined
        ? normalizeBoolean(existingData.requiresVca, false)
        : normalizeBoolean(requiresVcaInput, false),
      vatExempt: vatExemptInput === undefined
        ? normalizeBoolean(existingData.vatExempt, false)
        : normalizeBoolean(vatExemptInput, false),
      verificationReference: payload.verificationReference ?? payload.verification_reference ?? existingData.verificationReference ?? null,
      verifiedAt: optionalDate(payload.verifiedAt ?? payload.verified_at, existingData.verifiedAt),
      notes: payload.notes ?? payload.note ?? existingData.notes ?? null
    };
    const specialties = payload.specialties === undefined
      ? existing?.specialties || []
      : normalizeList(payload.specialties);
    const timestamp = nowIso();
    const values = [
      name,
      partnerType,
      payload.contactName ?? payload.contact_name ?? existing?.contactName ?? null,
      email || null,
      payload.phone ?? existing?.phone ?? null,
      payload.address ?? existing?.address ?? null,
      payload.city ?? existing?.city ?? null,
      normalizeText(payload.country ?? existing?.country, 'NL').toUpperCase(),
      payload.registrationNumber ?? payload.registration_number ?? payload.kvkNumber ?? payload.kvk_number ?? existing?.registrationNumber ?? null,
      payload.vatNumber ?? payload.vat_number ?? existing?.vatNumber ?? null,
      status,
      optionalDate(payload.insuranceExpiresAt ?? payload.insurance_expires_at, existing?.insuranceExpiresAt),
      optionalDate(payload.vcaExpiresAt ?? payload.vca_expires_at, existing?.vcaExpiresAt),
      toJson(specialties, []),
      toJson(data),
      timestamp
    ];
    if (before) {
      this.db.prepare(`
        UPDATE trade_partners
        SET name = ?, partner_type = ?, contact_name = ?, email = ?, phone = ?, address = ?, city = ?, country = ?,
          registration_number = ?, vat_number = ?, status = ?, insurance_expires_at = ?, vca_expires_at = ?,
          specialties_json = ?, data_json = ?, updated_at = ?
        WHERE id = ?
      `).run(...values, id);
    } else {
      this.db.prepare(`
        INSERT INTO trade_partners (
          id, name, partner_type, contact_name, email, phone, address, city, country, registration_number,
          vat_number, status, insurance_expires_at, vca_expires_at, specialties_json, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, ...values.slice(0, -1), timestamp, timestamp);
    }
    const after = this.getTradePartner(id);
    if (options.audit !== false) {
      this.audit({
        entityType: 'trade_partner',
        entityId: id,
        action: before ? 'update_trade_partner' : 'create_trade_partner',
        actor: options.actor || 'Contractor.AI',
        before: existing,
        after,
        metadata: { complianceStatus: after.compliance.status, externalCommitments: 0 }
      });
    }
    return after;
  }

  requestTradePartnerRetirement(partnerId, payload = {}, options = {}) {
    return this.transaction(() => {
      const partner = this.getTradePartner(partnerId);
      const actor = options.actor || payload.actor || 'Contractor.AI';
      if (partner.status === 'retired') {
        return { partner, approval: null, retained: true, retired: true, requiresApproval: false, operationStatus: 'already_retired' };
      }
      const pending = this.db.prepare(`
        SELECT * FROM approvals
        WHERE target_type = 'trade_partner_retirement' AND target_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(partnerId);
      if (pending) {
        return { partner, approval: this.mapApproval(pending), retained: true, retired: false, requiresApproval: true, operationStatus: 'pending_approval' };
      }
      const reason = normalizeText(payload.reason || payload.notes, '');
      if (reason.length < 8) {
        const error = new Error('Trade partner retirement requires an operational reason of at least eight characters');
        error.statusCode = 400;
        error.code = 'trade_partner_retirement_reason_required';
        throw error;
      }
      const activeProcurement = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM procurement_orders
        WHERE status NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'closed', 'received')
          AND (lower(COALESCE(supplier, '')) = lower(?) OR data_json LIKE ?)
      `).get(partner.name, `%${partner.id}%`).count || 0);
      const activePurchaseOrders = Number(this.db.prepare(`
        SELECT COUNT(*) AS count FROM purchase_orders
        WHERE status NOT IN ('cancelled', 'canceled', 'rejected', 'void', 'closed', 'received')
          AND (lower(COALESCE(supplier, '')) = lower(?) OR data_json LIKE ?)
      `).get(partner.name, `%${partner.id}%`).count || 0);
      const approval = this.createApproval({
        targetType: 'trade_partner_retirement',
        targetId: partnerId,
        approvalType: 'destructive_action',
        requestedBy: actor,
        summary: `Retire trade partner: ${partner.name}`,
        reason,
        data: {
          partnerId,
          name: partner.name,
          partnerType: partner.partnerType,
          previousStatus: partner.status,
          requestedStatus: 'retired',
          activeProcurement,
          activePurchaseOrders,
          compliance: partner.compliance
        }
      }, { actor, audit: false });
      this.audit({
        entityType: 'trade_partner',
        entityId: partnerId,
        action: 'request_trade_partner_retirement',
        actor,
        before: partner,
        after: { ...partner, retirementApprovalId: approval.id },
        metadata: { approvalId: approval.id, activeProcurement, activePurchaseOrders, externalCommitments: 0 }
      });
      return { partner, approval, retained: true, retired: false, requiresApproval: true, operationStatus: 'pending_approval' };
    });
  }

  resolveTradePartnerForSpend(payload = {}, supplier = '') {
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    const partnerId = payload.tradePartnerId || payload.trade_partner_id || payload.partnerId || payload.partner_id
      || payload.supplierId || payload.supplier_id || data.tradePartnerId || null;
    if (partnerId) return this.getTradePartner(partnerId);
    return this.findTradePartnerByName(supplier || payload.supplier || payload.vendor || '');
  }

  tradePartnerComplianceSnapshot(partner) {
    if (!partner) return null;
    return {
      partnerId: partner.id,
      name: partner.name,
      partnerType: partner.partnerType,
      status: partner.status,
      complianceStatus: partner.compliance.status,
      compliant: partner.compliance.compliant,
      blockers: partner.compliance.blockers,
      warnings: partner.compliance.warnings,
      checkedAt: partner.compliance.checkedAt
    };
  }

  assertTradePartnerReadyForCommitment(record, recordType = 'supplier commitment') {
    const data = fromJson(record?.data_json, record?.data || {});
    const partner = this.resolveTradePartnerForSpend({ ...data, tradePartnerId: data.tradePartnerId }, record?.supplier || '');
    if (!partner) {
      const error = new Error(`A retained trade partner must be linked before approving this ${recordType}`);
      error.statusCode = 409;
      error.code = 'trade_partner_required';
      throw error;
    }
    if (!partner.compliance.compliant) {
      const reasons = partner.compliance.blockers.map(item => item.message).slice(0, 3).join(' ');
      const error = new Error(`${partner.name} is not compliance-ready. ${reasons}`.trim());
      error.statusCode = 409;
      error.code = 'trade_partner_compliance_required';
      throw error;
    }
    return partner;
  }

  tradePartnerReadinessForSpend(record) {
    const data = fromJson(record?.data_json, record?.data || {});
    try {
      const partner = this.resolveTradePartnerForSpend({ ...data, tradePartnerId: data.tradePartnerId }, record?.supplier || '');
      if (!partner) {
        return {
          partner: null,
          compliance: this.assessTradePartnerCompliance(null),
          supplier: record?.supplier || null
        };
      }
      return { partner, compliance: partner.compliance, supplier: partner.name };
    } catch (error) {
      return {
        partner: null,
        compliance: {
          status: 'missing',
          compliant: false,
          blockers: [{ code: error.code || 'trade_partner_missing', message: error.message }],
          warnings: [],
          checkedAt: nowIso()
        },
        supplier: record?.supplier || null
      };
    }
  }

  upsertWorker(payload = {}, options = {}) {
    const id = normalizeText(options.id || payload.id, makeId('worker'));
    const before = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(id);
    const existing = before ? this.mapWorker(before) : null;
    if (existing?.status === 'retired') {
      const error = new Error('Retired workers are retained and cannot be edited directly');
      error.statusCode = 409;
      error.code = 'worker_retired';
      throw error;
    }
    const name = normalizeText(payload.name ?? existing?.name, '');
    if (name.length < 2) {
      const error = new Error('Worker name must contain at least two characters');
      error.statusCode = 400;
      error.code = 'worker_name_required';
      throw error;
    }
    const status = normalizeWorkerStatus(payload.status ?? existing?.status, 'available');
    const editableStatuses = new Set(['available', 'busy', 'traveling', 'offline', 'on_leave', 'on_hold', 'inactive']);
    if (status === 'retired') {
      const error = new Error('Worker retirement requires the approval-gated retirement route');
      error.statusCode = 409;
      error.code = 'worker_retirement_route_required';
      throw error;
    }
    if (!editableStatuses.has(status)) {
      const error = new Error('Worker status must be available, busy, traveling, offline, on leave, on hold, or inactive');
      error.statusCode = 400;
      error.code = 'worker_status_invalid';
      throw error;
    }
    const email = normalizeText(payload.email ?? existing?.email, '');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const error = new Error('Worker email address is invalid');
      error.statusCode = 400;
      error.code = 'worker_email_invalid';
      throw error;
    }
    if (email) {
      const duplicateEmail = this.db.prepare(`
        SELECT id FROM workers
        WHERE lower(email) = lower(?) AND id <> ? AND status <> 'retired'
        LIMIT 1
      `).get(email, id);
      if (duplicateEmail) {
        const error = new Error('An active worker with this email address already exists');
        error.statusCode = 409;
        error.code = 'worker_email_duplicate';
        throw error;
      }
    }
    const timestamp = nowIso();
    const skillsInput = payload.skills ?? payload.specialties;
    const skills = skillsInput === undefined
      ? (before ? fromJson(before.skills_json, []) : normalizeText(payload.specialty || payload.role, '') ? [normalizeText(payload.specialty || payload.role)] : [])
      : normalizeList(skillsInput);
    const hourlyRate = normalizeNumber(payload.hourlyRate ?? payload.hourly_rate ?? before?.hourly_rate, 0);
    if (hourlyRate < 0) {
      const error = new Error('Worker hourly rate cannot be negative');
      error.statusCode = 400;
      error.code = 'worker_hourly_rate_invalid';
      throw error;
    }
    const data = {
      ...fromJson(before?.data_json, {}),
      ...(payload.data || {}),
      legacyId: payload.legacyId ?? payload.legacy_id ?? fromJson(before?.data_json, {}).legacyId ?? null,
      rating: payload.rating ?? fromJson(before?.data_json, {}).rating ?? null,
      completedJobs: payload.completedJobs ?? payload.completed_jobs ?? fromJson(before?.data_json, {}).completedJobs ?? null,
      notes: payload.notes ?? payload.note ?? fromJson(before?.data_json, {}).notes ?? null
    };

    if (before) {
      this.db.prepare(`
        UPDATE workers
        SET name = ?, role = ?, email = ?, phone = ?, status = ?, home_region = ?, hourly_rate = ?, skills_json = ?, data_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        payload.role ?? payload.specialty ?? before.role,
        email || null,
        payload.phone ?? before.phone,
        status,
        payload.homeRegion ?? payload.home_region ?? payload.location ?? payload.currentLocation ?? before.home_region,
        hourlyRate,
        toJson(skills, []),
        toJson(data),
        timestamp,
        id
      );
    } else {
      this.db.prepare(`
        INSERT INTO workers (id, name, role, email, phone, status, home_region, hourly_rate, skills_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        payload.role || payload.specialty || null,
        email || null,
        payload.phone || null,
        status,
        payload.homeRegion || payload.home_region || payload.location || payload.currentLocation || null,
        hourlyRate,
        toJson(skills, []),
        toJson(data),
        timestamp,
        timestamp
      );
    }

    const after = this.getWorker(id);
    if (options.audit !== false) {
      this.audit({
        entityType: 'worker',
        entityId: id,
        action: before ? 'update_worker' : 'create_worker',
        actor: options.actor || 'Contractor.AI',
        before: existing,
        after,
        metadata: { externalCommitments: 0 }
      });
    }
    return after;
  }

  listWorkers(filters = {}) {
    const status = normalizeWorkerStatus(filters.status, '');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const pendingRetirements = new Map(this.db.prepare(`
      SELECT target_id, id FROM approvals
      WHERE target_type = 'worker_retirement' AND status = 'pending'
    `).all().map(row => [row.target_id, row.id]));
    const assignmentCounts = new Map(this.db.prepare(`
      SELECT assignments.worker_id,
        SUM(CASE WHEN jobs.id IS NULL OR ${this.operationalJobStatusSql('jobs')} THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN jobs.id IS NOT NULL AND NOT (${this.operationalJobStatusSql('jobs')}) THEN 1 ELSE 0 END) AS dormant_count
      FROM assignments
      LEFT JOIN jobs ON jobs.id = assignments.job_id
      WHERE assignments.worker_id IS NOT NULL
        AND ${this.activeAssignmentStatusSql('assignments')}
      GROUP BY assignments.worker_id
    `).all().map(row => [row.worker_id, {
      active: Number(row.active_count || 0),
      dormant: Number(row.dormant_count || 0)
    }]));
    return this.db.prepare(`
      SELECT * FROM workers
      WHERE (? = '' OR lower(name || ' ' || COALESCE(role, '') || ' ' || COALESCE(home_region, '') || ' ' || COALESCE(email, '') || ' ' || skills_json) LIKE ?)
      ORDER BY updated_at DESC
    `).all(search, `%${search}%`).map(row => {
      const worker = this.mapWorker(row);
      const workerAssignments = assignmentCounts.get(worker.id) || { active: 0, dormant: 0 };
      return {
        ...worker,
        retirementApprovalId: pendingRetirements.get(worker.id) || null,
        activeAssignmentCount: workerAssignments.active,
        dormantAssignmentCount: workerAssignments.dormant,
        retainedAssignmentCount: workerAssignments.active + workerAssignments.dormant
      };
    }).filter(worker => !status || worker.status === status).slice(0, limit);
  }

  getWorker(workerId) {
    const row = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
    if (!row) {
      const error = new Error('Worker not found');
      error.statusCode = 404;
      error.code = 'worker_not_found';
      throw error;
    }
    const pendingRetirement = this.db.prepare(`
      SELECT id FROM approvals
      WHERE target_type = 'worker_retirement' AND target_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(workerId);
    const assignmentScope = this.workerAssignmentScope(workerId);
    return {
      ...this.mapWorker(row),
      retirementApprovalId: pendingRetirement?.id || null,
      activeAssignmentCount: assignmentScope.operational.length,
      dormantAssignmentCount: assignmentScope.dormant.length,
      retainedAssignmentCount: assignmentScope.retained.length
    };
  }

  summarizeWorkers(workers = this.listWorkers({ limit: 500 })) {
    return workers.reduce((summary, worker) => {
      summary.total += 1;
      summary.activeAssignments += Number(worker.activeAssignmentCount || 0);
      summary.dormantAssignments += Number(worker.dormantAssignmentCount || 0);
      if (worker.status === 'retired') summary.retired += 1;
      else {
        summary.active += 1;
        if (worker.status === 'available') summary.available += 1;
        else summary.unavailable += 1;
      }
      if (worker.retirementApprovalId) summary.pendingRetirement += 1;
      return summary;
    }, { total: 0, active: 0, available: 0, unavailable: 0, pendingRetirement: 0, retired: 0, activeAssignments: 0, dormantAssignments: 0 });
  }

  retireWorker(workerId, options = {}) {
    const before = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
    if (!before) return null;
    const timestamp = nowIso();
    this.db.prepare("UPDATE workers SET status = 'retired', updated_at = ? WHERE id = ?").run(timestamp, workerId);
    const after = this.mapWorker(this.db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId));
    if (options.audit !== false) {
      this.audit({ entityType: 'worker', entityId: workerId, action: 'retire_worker', actor: options.actor || 'Contractor.AI', before: this.mapWorker(before), after });
    }
    return after;
  }

  requestWorkerRetirement(workerId, payload = {}, options = {}) {
    return this.transaction(() => {
      const before = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
      if (!before) return null;
      const worker = this.getWorker(workerId);
      const actor = options.actor || payload.actor || 'Contractor.AI';
      if (normalizeStatus(before.status, '') === 'retired') {
        return {
          worker,
          approval: null,
          retained: true,
          retired: true,
          requiresApproval: false,
          operationStatus: 'already_retired'
        };
      }

      const pendingApproval = this.db.prepare(`
        SELECT * FROM approvals
        WHERE target_type = 'worker_retirement'
          AND target_id = ?
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(workerId);
      if (pendingApproval) {
        return {
          worker,
          approval: this.mapApproval(pendingApproval),
          retained: true,
          retired: false,
          requiresApproval: true,
          operationStatus: 'pending_approval'
        };
      }

      const reason = normalizeText(payload.reason || payload.notes, '');
      if (reason.length < 8) {
        const error = new Error('Worker retirement requires an operational reason of at least eight characters');
        error.statusCode = 400;
        error.code = 'worker_retirement_reason_required';
        throw error;
      }
      const assignmentScope = this.workerAssignmentScope(workerId);
      const activeAssignments = assignmentScope.operational;
      const dormantAssignments = assignmentScope.dormant;
      const approval = this.createApproval({
        targetType: 'worker_retirement',
        targetId: workerId,
        approvalType: 'destructive_action',
        requestedBy: actor,
        summary: `Retire worker: ${worker.name}`,
        reason,
        data: {
          workerId,
          legacyWorkerId: payload.legacyWorkerId || payload.legacy_worker_id || worker.data?.legacyId || null,
          name: worker.name,
          role: worker.role,
          requestedAction: 'retire',
          requestedStatus: 'retired',
          activeAssignmentCount: activeAssignments.length,
          activeAssignments,
          dormantAssignmentCount: dormantAssignments.length,
          dormantAssignments,
          before: worker
        }
      }, { actor });

      this.audit({
        entityType: 'worker',
        entityId: workerId,
        action: 'request_worker_retirement',
        actor,
        before: worker,
        after: { ...worker, retirementApprovalId: approval.id },
        metadata: {
          approvalId: approval.id,
          activeAssignmentCount: activeAssignments.length,
          dormantAssignmentCount: dormantAssignments.length,
          externalCommitments: 0
        }
      });

      return {
        worker: { ...worker, retirementApprovalId: approval.id },
        approval,
        retained: true,
        retired: false,
        requiresApproval: true,
        operationStatus: 'pending_approval'
      };
    });
  }

  assessToolInspection(tool = {}, referenceAt = nowIso()) {
    const data = tool.data || fromJson(tool.data_json, {});
    const history = Array.isArray(data.inspectionHistory) ? data.inspectionHistory : [];
    const latestInspection = history.length ? history[history.length - 1] : null;
    const maintenanceHistory = Array.isArray(data.maintenanceHistory) ? data.maintenanceHistory : [];
    const latestMaintenance = maintenanceHistory.length ? maintenanceHistory[maintenanceHistory.length - 1] : null;
    const lastResult = normalizeStatus(latestInspection?.result || data.lastInspectionResult, '');
    const dueAt = normalizeText(data.inspectionDueAt, '') || null;
    const required = normalizeBoolean(data.inspectionRequired, Boolean(dueAt));
    const dueDate = dueAt ? String(dueAt).slice(0, 10) : null;
    const referenceDate = new Date(Date.parse(referenceAt) || Date.now()).toISOString().slice(0, 10);
    const dueMilliseconds = dueDate ? Date.parse(`${dueDate}T00:00:00.000Z`) : Number.NaN;
    const referenceMilliseconds = Date.parse(`${referenceDate}T00:00:00.000Z`);
    const daysUntilDue = Number.isFinite(dueMilliseconds)
      ? Math.round((dueMilliseconds - referenceMilliseconds) / 86_400_000)
      : null;

    let status = 'not_required';
    let blocksReservation = false;
    const maintenanceResolvedLatestInspection = normalizeStatus(latestMaintenance?.outcome, '') === 'completed'
      && latestInspection?.id
      && String(latestMaintenance.sourceInspectionId || '') === String(latestInspection.id);
    if (lastResult === 'failed') {
      status = maintenanceResolvedLatestInspection ? 'reinspection_required' : 'failed';
      blocksReservation = true;
    } else if (lastResult === 'limited') {
      status = maintenanceResolvedLatestInspection ? 'reinspection_required' : 'limited';
      blocksReservation = true;
    } else if (required && !dueAt) {
      status = 'not_recorded';
      blocksReservation = true;
    } else if (required && !Number.isFinite(dueMilliseconds)) {
      status = 'invalid';
      blocksReservation = true;
    } else if (required && daysUntilDue < 0) {
      status = 'overdue';
      blocksReservation = true;
    } else if (required && daysUntilDue <= 30) {
      status = 'due_soon';
    } else if (required) {
      status = 'current';
    }

    return {
      required,
      status,
      dueAt,
      daysUntilDue,
      blocksReservation,
      requiresAttention: blocksReservation || status === 'due_soon',
      reservationReady: !blocksReservation,
      latestInspection,
      maintenanceResolvedLatestInspection,
      lastInspectedAt: latestInspection?.inspectedAt || data.lastInspectedAt || null,
      lastResult: lastResult || null,
      historyCount: history.length
    };
  }

  assessToolMaintenance(tool = {}) {
    const data = tool.data || fromJson(tool.data_json, {});
    const history = Array.isArray(data.maintenanceHistory) ? data.maintenanceHistory : [];
    const latestMaintenance = history.length ? history[history.length - 1] : null;
    const outcome = normalizeStatus(latestMaintenance?.outcome || data.lastMaintenanceOutcome, 'not_recorded');
    return {
      status: outcome,
      latestMaintenance,
      lastMaintainedAt: latestMaintenance?.performedAt || data.lastMaintainedAt || null,
      historyCount: history.length,
      requiresAttention: outcome === 'follow_up_required'
    };
  }

  upsertTool(payload = {}, options = {}) {
    const id = normalizeText(options.id || payload.id, makeId('tool'));
    const before = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(id);
    const existing = before ? this.mapTool(before) : null;
    if (existing?.status === 'retired') {
      const error = new Error('Retired equipment is retained and cannot be edited directly');
      error.statusCode = 409;
      error.code = 'tool_retired';
      throw error;
    }
    const name = normalizeText(payload.name ?? existing?.name, '');
    if (name.length < 2) {
      const error = new Error('Equipment name must contain at least two characters');
      error.statusCode = 400;
      error.code = 'tool_name_required';
      throw error;
    }
    const status = normalizeStatus(payload.status ?? existing?.status, 'available');
    const editableStatuses = new Set(['available', 'in_use', 'maintenance', 'inspection_due', 'inactive', 'lost']);
    if (status === 'retired') {
      const error = new Error('Equipment retirement requires the approval-gated retirement route');
      error.statusCode = 409;
      error.code = 'tool_retirement_route_required';
      throw error;
    }
    if (!editableStatuses.has(status)) {
      const error = new Error('Equipment status must be available, in use, maintenance, inspection due, inactive, or lost');
      error.statusCode = 400;
      error.code = 'tool_status_invalid';
      throw error;
    }
    const timestamp = nowIso();
    const existingData = fromJson(before?.data_json, {});
    const incomingData = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? payload.data
      : {};
    const inspectionDueInput = Object.prototype.hasOwnProperty.call(incomingData, 'inspectionDueAt')
      ? incomingData.inspectionDueAt
      : Object.prototype.hasOwnProperty.call(payload, 'inspectionDueAt')
        ? payload.inspectionDueAt
        : Object.prototype.hasOwnProperty.call(payload, 'inspection_due_at')
          ? payload.inspection_due_at
          : existingData.inspectionDueAt ?? null;
    const inspectionDueAt = normalizeRetainedDate(inspectionDueInput, {
      label: 'Equipment inspection due date',
      code: 'tool_inspection_due_invalid'
    });
    const inspectionRequired = normalizeBoolean(
      incomingData.inspectionRequired ?? payload.inspectionRequired ?? payload.inspection_required,
      normalizeBoolean(existingData.inspectionRequired, Boolean(inspectionDueAt))
    );
    if (inspectionRequired && !inspectionDueAt) {
      const error = new Error('Equipment requiring inspection must retain its next inspection due date');
      error.statusCode = 400;
      error.code = 'tool_inspection_due_required';
      throw error;
    }
    const data = {
      ...existingData,
      ...incomingData,
      legacyId: payload.legacyId ?? payload.legacy_id ?? existingData.legacyId ?? null,
      assignedJobId: payload.assignedJobId ?? payload.assigned_job_id ?? existingData.assignedJobId ?? null,
      assignedWorkerId: payload.assignedWorkerId ?? payload.assigned_worker_id ?? existingData.assignedWorkerId ?? null,
      inspectionRequired,
      inspectionDueAt,
      inspectionHistory: Array.isArray(existingData.inspectionHistory) ? existingData.inspectionHistory : [],
      lastInspectionId: existingData.lastInspectionId || null,
      lastInspectedAt: existingData.lastInspectedAt || null,
      lastInspectionResult: existingData.lastInspectionResult || null,
      maintenanceHistory: Array.isArray(existingData.maintenanceHistory) ? existingData.maintenanceHistory : [],
      lastMaintenanceId: existingData.lastMaintenanceId || null,
      lastMaintainedAt: existingData.lastMaintainedAt || null,
      lastMaintenanceOutcome: existingData.lastMaintenanceOutcome || null
    };

    if (before) {
      this.db.prepare(`
        UPDATE tools
        SET name = ?, category = ?, status = ?, home_location = ?, current_location = ?, data_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        normalizeText(payload.category ?? before.category, 'general'),
        status,
        payload.homeLocation ?? payload.home_location ?? before.home_location,
        payload.currentLocation ?? payload.current_location ?? payload.location ?? before.current_location,
        toJson(data),
        timestamp,
        id
      );
    } else {
      this.db.prepare(`
        INSERT INTO tools (id, name, category, status, home_location, current_location, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        normalizeText(payload.category, 'general'),
        status,
        payload.homeLocation || payload.home_location || payload.currentLocation || payload.current_location || payload.location || 'Warehouse',
        payload.currentLocation || payload.current_location || payload.location || 'Warehouse',
        toJson(data),
        timestamp,
        timestamp
      );
    }

    const after = this.mapTool(this.db.prepare('SELECT * FROM tools WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({
        entityType: 'tool',
        entityId: id,
        action: before ? 'update_tool' : 'create_tool',
        actor: options.actor || 'Contractor.AI',
        before: before ? this.mapTool(before) : null,
        after
      });
    }
    return after;
  }

  recordToolInspection(toolId, payload = {}, options = {}) {
    return this.transaction(() => {
      const beforeRow = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId);
      if (!beforeRow) return null;
      const before = this.mapTool(beforeRow);
      if (normalizeStatus(before.status, '') === 'retired') {
        const error = new Error('Retired equipment cannot receive a new operational inspection record');
        error.statusCode = 409;
        error.code = 'tool_retired';
        throw error;
      }
      const pendingRetirement = this.db.prepare(`
        SELECT id FROM approvals
        WHERE target_type = 'tool_retirement' AND target_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(toolId);
      if (pendingRetirement) {
        const error = new Error('Resolve the pending retirement decision before recording another equipment inspection');
        error.statusCode = 409;
        error.code = 'tool_retirement_pending';
        error.details = { toolId, approvalId: pendingRetirement.id };
        throw error;
      }

      const result = normalizeStatus(payload.result, '');
      if (!['passed', 'failed', 'limited'].includes(result)) {
        const error = new Error('Equipment inspection result must be passed, failed, or limited');
        error.statusCode = 400;
        error.code = 'tool_inspection_result_invalid';
        throw error;
      }
      const inspector = normalizeText(payload.inspector || payload.inspectedBy, '');
      if (inspector.length < 2) {
        const error = new Error('Retain the name or internal reference of the person who performed the inspection');
        error.statusCode = 400;
        error.code = 'tool_inspector_required';
        throw error;
      }
      const inspectedAt = normalizeRetainedDate(payload.inspectedAt || payload.inspected_at || nowIso(), {
        required: true,
        label: 'Equipment inspection date',
        code: 'tool_inspection_date_invalid'
      });
      const inspectedDate = String(inspectedAt).slice(0, 10);
      const today = nowIso().slice(0, 10);
      if (inspectedDate > today) {
        const error = new Error('Equipment inspection evidence cannot be dated in the future');
        error.statusCode = 400;
        error.code = 'tool_inspection_future_date';
        throw error;
      }
      const data = fromJson(beforeRow.data_json, {});
      const inspectionBefore = this.assessToolInspection(before);
      if (result === 'passed' && ['failed', 'limited'].includes(inspectionBefore.status)) {
        const error = new Error('Retain completed maintenance linked to the failed or limited inspection before recording a passing reinspection');
        error.statusCode = 409;
        error.code = 'tool_maintenance_required_before_reinspection';
        error.details = {
          toolId,
          inspectionId: inspectionBefore.latestInspection?.id || null,
          inspectionStatus: inspectionBefore.status
        };
        throw error;
      }
      const inspectionRequired = normalizeBoolean(data.inspectionRequired, Boolean(data.inspectionDueAt));
      const nextDueAt = normalizeRetainedDate(payload.nextDueAt || payload.next_due_at, {
        required: result === 'passed' && inspectionRequired,
        label: 'Next equipment inspection due date',
        code: result === 'passed' && inspectionRequired ? 'tool_inspection_next_due_required' : 'tool_inspection_next_due_invalid'
      });
      if (result === 'passed' && nextDueAt && String(nextDueAt).slice(0, 10) <= inspectedDate) {
        const error = new Error('The next equipment inspection must be due after the retained inspection date');
        error.statusCode = 400;
        error.code = 'tool_inspection_next_due_invalid';
        throw error;
      }
      const notes = normalizeText(payload.notes || payload.findings, '');
      if (result !== 'passed' && notes.length < 8) {
        const error = new Error('Failed or limited inspections require retained findings of at least eight characters');
        error.statusCode = 400;
        error.code = 'tool_inspection_findings_required';
        throw error;
      }

      const actor = options.actor || payload.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const inspection = {
        id: makeId('toolinspection'),
        result,
        inspector,
        inspectedAt,
        nextDueAt,
        reference: normalizeText(payload.reference || payload.evidenceReference, '') || null,
        notes: notes || null,
        recordedAt: timestamp,
        recordedBy: actor,
        certificationClaimed: false
      };
      const history = Array.isArray(data.inspectionHistory) ? data.inspectionHistory : [];
      let status = normalizeStatus(before.status, 'available');
      if (result === 'failed') status = 'maintenance';
      else if (result === 'limited') status = 'inspection_due';
      else if (status === 'inspection_due') status = 'available';
      const nextData = {
        ...data,
        inspectionRequired,
        inspectionDueAt: result === 'passed' ? nextDueAt : (data.inspectionDueAt || inspectedAt),
        inspectionHistory: [...history, inspection],
        lastInspectionId: inspection.id,
        lastInspectedAt: inspectedAt,
        lastInspectionResult: result
      };
      this.db.prepare('UPDATE tools SET status = ?, data_json = ?, updated_at = ? WHERE id = ?')
        .run(status, toJson(nextData), timestamp, toolId);
      const after = this.mapTool(this.db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId));
      const inspectionState = this.assessToolInspection(after);
      this.audit({
        entityType: 'tool',
        entityId: toolId,
        action: 'record_tool_inspection',
        actor,
        before: { ...before, inspection: this.assessToolInspection(before) },
        after: { ...after, inspection: inspectionState },
        metadata: {
          inspectionId: inspection.id,
          result,
          activeReservationCount: this.toolReservationScope(toolId).operational.length,
          certificationClaimed: false,
          externalCommitments: 0
        }
      });
      return {
        tool: { ...after, inspection: inspectionState },
        inspection,
        retained: true,
        reservationReady: inspectionState.reservationReady,
        externalCommitments: 0
      };
    });
  }

  recordToolMaintenance(toolId, payload = {}, options = {}) {
    return this.transaction(() => {
      const beforeRow = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId);
      if (!beforeRow) return null;
      const before = this.mapTool(beforeRow);
      if (normalizeStatus(before.status, '') === 'retired') {
        const error = new Error('Retired equipment cannot receive a new operational maintenance record');
        error.statusCode = 409;
        error.code = 'tool_retired';
        throw error;
      }
      const pendingRetirement = this.db.prepare(`
        SELECT id FROM approvals
        WHERE target_type = 'tool_retirement' AND target_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(toolId);
      if (pendingRetirement) {
        const error = new Error('Resolve the pending retirement decision before recording equipment maintenance');
        error.statusCode = 409;
        error.code = 'tool_retirement_pending';
        error.details = { toolId, approvalId: pendingRetirement.id };
        throw error;
      }
      const requestedSpend = normalizeNumber(
        payload.amount ?? payload.cost ?? payload.spendAmount ?? payload.spend_amount,
        0
      );
      if (requestedSpend > 0 || normalizeBoolean(payload.externalCommitment ?? payload.external_commitment, false)) {
        const error = new Error('This maintenance evidence route cannot create supplier spend or an external service commitment');
        error.statusCode = 409;
        error.code = 'tool_maintenance_spend_requires_approval';
        throw error;
      }

      const outcome = normalizeStatus(payload.outcome || payload.result, '');
      if (!['completed', 'follow_up_required'].includes(outcome)) {
        const error = new Error('Equipment maintenance outcome must be completed or follow up required');
        error.statusCode = 400;
        error.code = 'tool_maintenance_outcome_invalid';
        throw error;
      }
      const maintenanceType = normalizeStatus(payload.maintenanceType || payload.maintenance_type || payload.type, 'corrective');
      if (!['corrective', 'preventive', 'repair', 'service'].includes(maintenanceType)) {
        const error = new Error('Equipment maintenance type must be corrective, preventive, repair, or service');
        error.statusCode = 400;
        error.code = 'tool_maintenance_type_invalid';
        throw error;
      }
      const performedBy = normalizeText(payload.performedBy || payload.performed_by || payload.technician, '');
      if (performedBy.length < 2) {
        const error = new Error('Retain the person or internal reference responsible for the maintenance evidence');
        error.statusCode = 400;
        error.code = 'tool_maintenance_performer_required';
        throw error;
      }
      const performedAt = normalizeRetainedDate(payload.performedAt || payload.performed_at || nowIso(), {
        required: true,
        label: 'Equipment maintenance date',
        code: 'tool_maintenance_date_invalid'
      });
      if (String(performedAt).slice(0, 10) > nowIso().slice(0, 10)) {
        const error = new Error('Equipment maintenance evidence cannot be dated in the future');
        error.statusCode = 400;
        error.code = 'tool_maintenance_future_date';
        throw error;
      }
      const notes = normalizeText(payload.notes || payload.workPerformed || payload.work_performed, '');
      if (notes.length < 8) {
        const error = new Error('Equipment maintenance requires retained work evidence of at least eight characters');
        error.statusCode = 400;
        error.code = 'tool_maintenance_evidence_required';
        throw error;
      }

      const actor = options.actor || payload.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const data = fromJson(beforeRow.data_json, {});
      const inspectionBefore = this.assessToolInspection(before);
      const maintenance = {
        id: makeId('toolmaintenance'),
        outcome,
        maintenanceType,
        performedBy,
        performedAt,
        reference: normalizeText(payload.reference || payload.evidenceReference, '') || null,
        notes,
        sourceInspectionId: inspectionBefore.latestInspection?.id || null,
        recordedAt: timestamp,
        recordedBy: actor,
        supplierSpend: 0,
        externalCommitments: 0
      };
      const history = Array.isArray(data.maintenanceHistory) ? data.maintenanceHistory : [];
      let status = normalizeStatus(before.status, 'available');
      if (outcome === 'follow_up_required') {
        status = 'maintenance';
      } else if (inspectionBefore.required && inspectionBefore.blocksReservation) {
        status = 'inspection_due';
      } else if (['maintenance', 'inspection_due'].includes(status)) {
        status = 'available';
      }
      const nextData = {
        ...data,
        maintenanceHistory: [...history, maintenance],
        lastMaintenanceId: maintenance.id,
        lastMaintainedAt: performedAt,
        lastMaintenanceOutcome: outcome
      };
      this.db.prepare('UPDATE tools SET status = ?, data_json = ?, updated_at = ? WHERE id = ?')
        .run(status, toJson(nextData), timestamp, toolId);
      const after = this.mapTool(this.db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId));
      const inspectionState = this.assessToolInspection(after);
      const maintenanceState = this.assessToolMaintenance(after);
      this.audit({
        entityType: 'tool',
        entityId: toolId,
        action: 'record_tool_maintenance',
        actor,
        before: {
          ...before,
          inspection: inspectionBefore,
          maintenance: this.assessToolMaintenance(before)
        },
        after: { ...after, inspection: inspectionState, maintenance: maintenanceState },
        metadata: {
          maintenanceId: maintenance.id,
          outcome,
          sourceInspectionId: maintenance.sourceInspectionId,
          activeReservationCount: this.toolReservationScope(toolId).operational.length,
          supplierSpend: 0,
          externalCommitments: 0
        }
      });
      return {
        tool: { ...after, inspection: inspectionState, maintenance: maintenanceState },
        maintenance,
        retained: true,
        reinspectionRequired: inspectionState.status === 'reinspection_required',
        reservationReady: inspectionState.reservationReady && status === 'available',
        externalCommitments: 0
      };
    });
  }

  listTools(filters = {}) {
    const status = normalizeText(filters.status, '');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const pendingRetirements = new Map(this.db.prepare(`
      SELECT target_id, id FROM approvals
      WHERE target_type = 'tool_retirement' AND status = 'pending'
    `).all().map(row => [row.target_id, row.id]));
    const reservationCounts = new Map(this.db.prepare(`
      SELECT tool_reservations.tool_id,
        SUM(CASE WHEN jobs.id IS NULL OR ${this.operationalJobStatusSql('jobs')} THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN jobs.id IS NOT NULL AND NOT (${this.operationalJobStatusSql('jobs')}) THEN 1 ELSE 0 END) AS dormant_count
      FROM tool_reservations
      LEFT JOIN jobs ON jobs.id = tool_reservations.job_id
      WHERE tool_reservations.tool_id IS NOT NULL
        AND ${this.activeToolReservationStatusSql('tool_reservations')}
      GROUP BY tool_reservations.tool_id
    `).all().map(row => [row.tool_id, {
      active: Number(row.active_count || 0),
      dormant: Number(row.dormant_count || 0)
    }]));
    return this.db.prepare(`
      SELECT * FROM tools
      WHERE (? = '' OR status = ?)
        AND (? = '' OR lower(name || ' ' || category || ' ' || COALESCE(current_location, '')) LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(status, status, search, `%${search}%`, limit).map(row => {
      const tool = this.mapTool(row);
      const reservations = reservationCounts.get(tool.id) || { active: 0, dormant: 0 };
      return {
        ...tool,
        inspection: this.assessToolInspection(tool),
        maintenance: this.assessToolMaintenance(tool),
        retirementApprovalId: pendingRetirements.get(tool.id) || null,
        activeReservationCount: reservations.active,
        dormantReservationCount: reservations.dormant,
        retainedReservationCount: reservations.active + reservations.dormant
      };
    });
  }

  summarizeTools(tools = this.listTools({ limit: 500 })) {
    return tools.reduce((summary, tool) => {
      summary.total += 1;
      summary.activeReservations += Number(tool.activeReservationCount || 0);
      summary.dormantReservations += Number(tool.dormantReservationCount || 0);
      if (tool.status === 'retired') summary.retired += 1;
      else {
        summary.active += 1;
        const inspectionAttention = tool.inspection?.requiresAttention === true;
        const reservationReady = tool.status === 'available'
          && !tool.retirementApprovalId
          && tool.inspection?.blocksReservation !== true;
        if (reservationReady) summary.available += 1;
        if (!reservationReady || inspectionAttention) summary.attention += 1;
      }
      if (tool.retirementApprovalId) summary.pendingRetirement += 1;
      if (tool.inspection?.status === 'overdue') summary.inspectionOverdue += 1;
      if (tool.inspection?.status === 'due_soon') summary.inspectionDueSoon += 1;
      if (['not_recorded', 'invalid'].includes(tool.inspection?.status)) summary.inspectionMissing += 1;
      if (tool.inspection?.blocksReservation) summary.inspectionBlocked += 1;
      if (tool.status === 'maintenance' || tool.maintenance?.requiresAttention) summary.maintenanceAttention += 1;
      summary.maintenanceRecords += Number(tool.maintenance?.historyCount || 0);
      return summary;
    }, {
      total: 0,
      active: 0,
      available: 0,
      attention: 0,
      pendingRetirement: 0,
      retired: 0,
      activeReservations: 0,
      dormantReservations: 0,
      inspectionOverdue: 0,
      inspectionDueSoon: 0,
      inspectionMissing: 0,
      inspectionBlocked: 0,
      maintenanceAttention: 0,
      maintenanceRecords: 0
    });
  }

  retireTool(toolId, options = {}) {
    const before = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId);
    if (!before) return null;
    const timestamp = nowIso();
    this.db.prepare("UPDATE tools SET status = 'retired', updated_at = ? WHERE id = ?").run(timestamp, toolId);
    const after = this.mapTool(this.db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId));
    if (options.audit !== false) {
      this.audit({ entityType: 'tool', entityId: toolId, action: 'retire_tool', actor: options.actor || 'Contractor.AI', before: this.mapTool(before), after });
    }
    return after;
  }

  requestToolRetirement(toolId, payload = {}, options = {}) {
    return this.transaction(() => {
      const before = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(toolId);
      if (!before) return null;
      const tool = this.listTools({ limit: 500 }).find(item => item.id === toolId) || this.mapTool(before);
      const actor = options.actor || payload.actor || 'Contractor.AI';
      if (normalizeStatus(before.status, '') === 'retired') {
        return {
          tool,
          approval: null,
          retained: true,
          retired: true,
          requiresApproval: false,
          operationStatus: 'already_retired'
        };
      }

      const pendingApproval = this.db.prepare(`
        SELECT * FROM approvals
        WHERE target_type = 'tool_retirement'
          AND target_id = ?
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(toolId);
      if (pendingApproval) {
        return {
          tool,
          approval: this.mapApproval(pendingApproval),
          retained: true,
          retired: false,
          requiresApproval: true,
          operationStatus: 'pending_approval'
        };
      }

      const reason = normalizeText(payload.reason || payload.notes, '');
      if (reason.length < 8) {
        const error = new Error('Equipment retirement requires an operational reason of at least eight characters');
        error.statusCode = 400;
        error.code = 'tool_retirement_reason_required';
        throw error;
      }
      const reservationScope = this.toolReservationScope(toolId);
      const activeReservations = reservationScope.operational;
      const dormantReservations = reservationScope.dormant;
      const approval = this.createApproval({
        targetType: 'tool_retirement',
        targetId: toolId,
        approvalType: 'destructive_action',
        requestedBy: actor,
        summary: `Retire tool: ${tool.name}`,
        reason,
        data: {
          toolId,
          legacyToolId: payload.legacyToolId || payload.legacy_tool_id || tool.data?.legacyId || null,
          name: tool.name,
          category: tool.category,
          requestedAction: 'retire',
          requestedStatus: 'retired',
          activeReservationCount: activeReservations.length,
          activeReservations,
          dormantReservationCount: dormantReservations.length,
          dormantReservations,
          before: tool
        }
      }, { actor });

      this.audit({
        entityType: 'tool',
        entityId: toolId,
        action: 'request_tool_retirement',
        actor,
        before: tool,
        after: { ...tool, retirementApprovalId: approval.id },
        metadata: {
          approvalId: approval.id,
          activeReservationCount: activeReservations.length,
          dormantReservationCount: dormantReservations.length,
          externalCommitments: 0
        }
      });

      return {
        tool: { ...tool, retirementApprovalId: approval.id },
        approval,
        retained: true,
        retired: false,
        requiresApproval: true,
        operationStatus: 'pending_approval'
      };
    });
  }

  createIntake(payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const client = this.findOrCreateClient(payload.client || payload, { actor });
      const timestamp = nowIso();
      const requestId = makeId('req');
      const service = normalizeText(payload.service || payload.jobType || payload.job_type || payload.title, 'contracting');
      const priority = normalizePriority(payload.priority || payload.urgency);
      const estimate = normalizeNumber(payload.estimatedCost || payload.estimated_cost || payload.value || payload.budgetAmount, 0);

      this.db.prepare(`
        INSERT INTO job_requests (id, client_id, source_channel, service, description, urgency, budget, status, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requestId,
        client.id,
        normalizeText(payload.sourceChannel || payload.source_channel, 'manual'),
        service,
        payload.description || '',
        priority,
        payload.budget || payload.budgetRange || '',
        'analyzed',
        toJson({ raw: payload }),
        timestamp,
        timestamp
      );

      const jobId = normalizeText(options.jobId || payload.ledgerJobId || payload.ledgerId, '') || makeId('job');
      if (this.getJobRow(jobId)) {
        return this.updateJob(jobId, payload, { actor });
      }
      const job = {
        id: jobId,
        requestId,
        clientId: client.id,
        title: normalizeText(payload.title, `${service} for ${client.name}`),
        jobType: normalizeText(payload.jobType || payload.job_type || service, 'general'),
        description: payload.description || '',
        address: payload.address || payload.location || client.address || '',
        city: payload.city || client.city || '',
        region: payload.region || payload.province || '',
        country: normalizeText(payload.country || client.country, 'NL'),
        priority,
        status: normalizeStatus(payload.status, 'intake'),
        phase: 'intake',
        riskLevel: priority === 'critical' ? 'high' : 'normal',
        estimatedHours: normalizeNumber(payload.estimatedHours || payload.estimated_hours, priority === 'critical' ? 4 : 8),
        estimatedCost: estimate,
        contractValue: normalizeNumber(payload.contractValue || payload.contract_value || estimate, estimate),
        marginTargetPercent: normalizeNumber(payload.marginTargetPercent || payload.margin_target_percent, 20),
        progressPercent: Math.max(0, Math.min(100, normalizeNumber(payload.progressPercent || payload.progress_percentage, 0))),
        scheduledStart: payload.scheduledStart || payload.scheduled_start || payload.startDate || null,
        scheduledEnd: payload.scheduledEnd || payload.scheduled_end || null,
        targetCompletion: payload.targetCompletion || payload.target_completion || payload.estimatedCompletion || null,
        approvalState: 'pending',
        data: {
          source: 'ledger_intake',
          eu: {
            peppolReady: payload.peppolReady === true,
            vatRate: normalizeNumber(payload.vatRate || payload.taxRate, 21),
            wkbRequired: payload.wkbRequired === true,
            vcaRequired: payload.vcaRequired !== false
          }
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };

      this.db.prepare(`
        INSERT INTO jobs (
          id, request_id, client_id, title, job_type, description, address, city, region, country, priority, status, phase,
          risk_level, estimated_hours, estimated_cost, contract_value, margin_target_percent, progress_percent,
          scheduled_start, scheduled_end, target_completion, approval_state, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        job.id,
        job.requestId,
        job.clientId,
        job.title,
        job.jobType,
        job.description,
        job.address,
        job.city,
        job.region,
        job.country,
        job.priority,
        job.status,
        job.phase,
        job.riskLevel,
        job.estimatedHours,
        job.estimatedCost,
        job.contractValue,
        job.marginTargetPercent,
        job.progressPercent,
        job.scheduledStart,
        job.scheduledEnd,
        job.targetCompletion,
        job.approvalState,
        toJson(job.data),
        job.createdAt,
        job.updatedAt
      );

      const taskPayloads = Array.isArray(payload.tasks) && payload.tasks.length
        ? payload.tasks
        : this.defaultTasksForJob(job);
      const tasks = taskPayloads.map(task => this.addTask(job.id, task, { actor, audit: false }));

      const quote = this.createQuote(job.id, {
        currency: payload.currency || 'EUR',
        taxRate: payload.taxRate ?? payload.vatRate ?? 21,
        lineItems: Array.isArray(payload.lineItems) ? payload.lineItems : payload.quote?.lineItems,
        subtotal: payload.subtotal,
        total: payload.total,
        validUntil: payload.validUntil
      }, { actor, audit: false });

      const materials = (Array.isArray(payload.materials) ? payload.materials : [])
        .map(item => this.addMaterialRequirement(job.id, item, { actor, audit: false }));
      const toolReservations = (Array.isArray(payload.tools) ? payload.tools : Array.isArray(payload.requiredTools) ? payload.requiredTools : [])
        .map(item => this.reserveTool(job.id, typeof item === 'string' ? { toolName: item } : item, { actor, audit: false }));

      let assignment = null;
      if (payload.workerId || payload.workerName || payload.assignAutomatically !== false) {
        assignment = this.addAssignment(job.id, {
          workerId: payload.workerId,
          workerName: payload.workerName,
          role: payload.assignmentRole || 'Lead contractor',
          scheduledStart: job.scheduledStart,
          scheduledEnd: job.scheduledEnd,
          allocationHours: job.estimatedHours
        }, { actor, audit: false, optional: true });
      }

      const progress = this.addProgressUpdate(job.id, {
        status: job.status,
        progressPercent: job.progressPercent,
        note: 'Client intake captured and operating ledger opened.'
      }, { actor, audit: false });

      const communication = this.addCommunication(job.id, {
        clientId: client.id,
        channel: 'portal',
        direction: 'outbound',
        subject: `Intake received: ${job.title}`,
        body: `Draft acknowledgement for ${client.name}. Quote ${quote.id} is waiting for approval before sending.`,
        status: 'draft',
        requiresApproval: true
      }, { actor, audit: false });

      this.audit({
        entityType: 'job',
        entityId: job.id,
        jobId: job.id,
        action: 'create_intake_job',
        actor,
        after: { job, client, requestId, tasks: tasks.length, quote: quote.id, materials: materials.length, tools: toolReservations.length, assignmentId: assignment?.id || null },
        metadata: {
          source: 'ledger_intake',
          progressId: progress.id,
          communicationId: communication.id,
          communicationApprovalId: communication.approvalId || communication.approval?.id || null
        }
      });

      let operatingPackage = null;
      const applyPlaybook = payload.applyPlaybook === true
        || payload.applyOperatingPlaybook === true
        || payload.createOperatingPackage === true
        || normalizeStatus(payload.playbookMode || payload.playbook_mode, '') === 'apply';

      if (applyPlaybook) {
        const playbookResult = this.applyJobPlaybook(job.id, {
          ...payload,
          includeQuote: false
        }, { actor });
        operatingPackage = {
          playbook: playbookResult.playbook,
          created: playbookResult.created,
          skipped: playbookResult.skipped,
          summary: playbookResult.summary
        };
      }

      const detail = this.getJobDetail(job.id, { includeAudit: true });
      if (operatingPackage) {
        detail.operatingPackage = operatingPackage;
      }
      return detail;
    });
  }

  defaultTasksForJob(job) {
    const due = job.targetCompletion || job.scheduledStart || null;
    return [
      { title: 'Validate scope and site constraints', status: 'open', priority: job.priority, dueAt: due },
      { title: 'Prepare quote and approval package', status: 'open', priority: job.priority, dueAt: due },
      { title: 'Reserve crew, tools, and materials', status: 'open', priority: job.priority, dueAt: due },
      { title: 'Create client update draft', status: 'open', priority: 'medium', dueAt: due }
    ];
  }

  defaultSiteVisitChecklist(job = {}) {
    const service = normalizeText(job.job_type || job.jobType, 'job');
    return [
      'Confirm access, parking, working hours, and neighbour constraints',
      `Measure and photo the ${service} work area before quoting or dispatch`,
      'Record hidden risks, utilities, moisture, ground conditions, or safety constraints',
      'Confirm required tools, materials, waste removal, and trailer/loading needs',
      'Identify scope exclusions and client decisions before the quote is sent'
    ];
  }

  listJobPlaybooks() {
    return JOB_OPERATING_PLAYBOOKS.map(playbook => ({
      key: playbook.key,
      label: playbook.label,
      keywords: [...playbook.keywords],
      tasks: [...playbook.tasks],
      tools: [...playbook.tools],
      materials: playbook.materials.map(item => ({ ...item })),
      quoteLineItems: playbook.quoteLineItems.map(item => ({ ...item })),
      safetyTopics: [...playbook.safetyTopics],
      hazards: [...playbook.hazards],
      controls: [...playbook.controls],
      qualityChecks: [...playbook.qualityChecks],
      recurring: playbook.recurring ? { ...playbook.recurring } : null
    }));
  }

  resolveJobPlaybook(job = {}, payload = {}) {
    const requested = normalizeStatus(payload.playbookKey || payload.playbook_key || payload.playbook || payload.template, '');
    if (requested) {
      const direct = JOB_OPERATING_PLAYBOOKS.find(playbook => playbook.key === requested);
      if (direct) return direct;
    }

    const haystack = normalizeText([
      payload.service,
      payload.jobType,
      payload.job_type,
      job.job_type,
      job.jobType,
      job.title,
      job.description
    ].filter(Boolean).join(' '), '').toLowerCase();
    let best = null;
    let bestScore = 0;
    for (const playbook of JOB_OPERATING_PLAYBOOKS) {
      const score = playbook.keywords.reduce((sum, keyword) => {
        return haystack.includes(keyword.toLowerCase()) ? sum + 1 : sum;
      }, 0);
      if (score > bestScore) {
        best = playbook;
        bestScore = score;
      }
    }
    return best || JOB_OPERATING_PLAYBOOKS.find(playbook => playbook.key === 'general_service');
  }

  recordMatches(records, fieldNames, expectedValue) {
    const expected = normalizeText(expectedValue, '').toLowerCase();
    if (!expected) return false;
    return records.some(record => {
      return fieldNames.some(fieldName => normalizeText(record?.[fieldName], '').toLowerCase() === expected);
    });
  }

  buildJobPlaybookPlan(jobId, payload = {}) {
    const detail = this.getJobDetail(jobId, { includeAudit: false });
    const playbook = this.resolveJobPlaybook(detail, payload);
    const actions = [];
    const skipped = [];
    const dueAt = payload.dueAt || payload.due_at || detail.targetCompletion || detail.scheduledStart || futureIsoDate(3);
    const plannedStart = payload.plannedStart || payload.planned_start || detail.scheduledStart || futureIsoDate(1);
    const plannedEnd = payload.plannedEnd || payload.planned_end || detail.scheduledEnd || detail.targetCompletion || futureIsoDate(2);
    const existing = {
      tasks: detail.tasks || [],
      tools: detail.tools || [],
      materials: detail.materials || []
    };
    const addAction = (type, label, recordPayload, reason = '') => {
      actions.push({ type, label, payload: recordPayload, reason });
    };
    const addSkipped = (type, label, reason = 'already_exists') => {
      skipped.push({ type, label, reason });
    };

    for (const title of playbook.tasks) {
      if (this.recordMatches(existing.tasks, ['title'], title)) {
        addSkipped('task', title);
      } else {
        addAction('task', title, {
          title,
          status: 'open',
          priority: detail.priority || 'medium',
          dueAt,
          notes: `Created from ${playbook.label} playbook.`
        });
      }
    }

    for (const toolName of playbook.tools) {
      if (this.recordMatches(existing.tools, ['toolName'], toolName)) {
        addSkipped('tool_reservation', toolName);
      } else {
        addAction('tool_reservation', toolName, {
          toolName,
          status: 'reserved',
          neededFrom: plannedStart,
          neededUntil: plannedEnd,
          notes: `Internal reservation suggestion from ${playbook.label} playbook.`
        });
      }
    }

    for (const material of playbook.materials) {
      if (this.recordMatches(existing.materials, ['name'], material.name)) {
        addSkipped('material_requirement', material.name);
      } else {
        addAction('material_requirement', material.name, {
          ...material,
          status: 'needed',
          neededBy: plannedStart,
          notes: `Material need inferred from ${playbook.label} playbook.`
        });
      }
    }

    if (payload.includeQuote !== false && !detail.quotes.length) {
      addAction('quote', `${playbook.label} quote draft`, {
        status: 'draft',
        currency: payload.currency || 'EUR',
        taxRate: payload.taxRate ?? payload.vatRate ?? 21,
        lineItems: playbook.quoteLineItems,
        notes: `Draft quote from ${playbook.label} playbook. Approval is required before sending.`
      });
    } else if (detail.quotes.length) {
      addSkipped('quote', 'Quote draft', 'quote_exists');
    }

    if (!detail.siteVisits.length) {
      addAction('site_visit', `${playbook.label} site visit`, {
        visitType: 'site_survey',
        status: 'scheduled',
        scheduledAt: plannedStart,
        checklist: playbook.visitChecklist,
        notes: `Site visit checklist from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('site_visit', 'Site visit', 'site_visit_exists');
    }

    if (!detail.routePlans.length) {
      addAction('route_plan', `${playbook.label} route plan`, {
        origin: payload.origin || 'Depot / warehouse',
        destination: detail.address || detail.city || 'Job site',
        routeRisk: detail.riskLevel || 'normal',
        status: 'draft',
        notes: `Route/access draft from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('route_plan', 'Route plan', 'route_plan_exists');
    }

    if (!detail.loadingPlans.length) {
      addAction('loading_plan', `${playbook.label} loading plan`, {
        vehicle: payload.vehicle || 'Work van',
        trailerRequired: playbook.tools.some(tool => /trailer/i.test(tool)),
        checklist: playbook.loadingChecklist,
        status: 'draft',
        departureAt: plannedStart,
        notes: `Loading checklist from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('loading_plan', 'Loading plan', 'loading_plan_exists');
    }

    if (!detail.fieldReports.length) {
      addAction('field_report', `${playbook.label} daily report`, {
        title: `${playbook.label} daily field report`,
        status: 'draft',
        reportDate: plannedStart,
        notes: `Daily report draft from ${playbook.label} playbook.`,
        blockers: [],
        photos: []
      });
    } else {
      addSkipped('field_report', 'Field report', 'field_report_exists');
    }

    if (!detail.safetyMeetings.length) {
      addAction('safety_meeting', `${playbook.label} safety talk`, {
        title: `${playbook.label} pre-task safety talk`,
        status: 'scheduled',
        meetingType: 'pre_task_talk',
        scheduledAt: plannedStart,
        topics: playbook.safetyTopics,
        notes: `Safety talk from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('safety_meeting', 'Safety meeting', 'safety_meeting_exists');
    }

    if (!detail.jhas.length) {
      addAction('jha', `${playbook.label} JHA`, {
        title: `${playbook.label} job hazard analysis`,
        status: 'draft',
        riskLevel: detail.riskLevel || 'medium',
        dueAt: plannedStart,
        hazards: playbook.hazards,
        controls: playbook.controls,
        ppe: ['Safety shoes', 'Gloves', 'Eye protection'],
        notes: `Internal JHA draft from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('jha', 'JHA', 'jha_exists');
    }

    if (playbook.materials.length && !detail.sdsSheets.length) {
      addAction('sds_sheet', 'Site materials SDS register', {
        material: `${playbook.label} material register`,
        supplier: playbook.materials[0]?.supplier || null,
        status: 'requested',
        notes: `SDS/material safety register requested from ${playbook.label} playbook.`
      });
    } else if (detail.sdsSheets.length) {
      addSkipped('sds_sheet', 'SDS register', 'sds_exists');
    }

    if (!detail.siteAccessLogs.length) {
      addAction('site_access', `${playbook.label} site access gate`, {
        workerName: payload.workerName || 'Assigned crew',
        company: payload.company || 'Internal crew',
        status: 'blocked',
        orientationValid: false,
        accessPoint: payload.accessPoint || 'Main site access',
        notes: `Access remains blocked until orientation and site rules are confirmed.`
      });
    } else {
      addSkipped('site_access', 'Site access', 'site_access_exists');
    }

    if (!detail.workerInstructions.length) {
      addAction('worker_instruction', `${playbook.label} worker instruction`, {
        audience: 'crew',
        channel: 'app',
        status: 'draft',
        title: `${playbook.label} crew brief`,
        body: playbook.workerInstruction,
        notes: 'Internal draft. Publish or send only after approval where required.'
      });
    } else {
      addSkipped('worker_instruction', 'Worker instruction', 'worker_instruction_exists');
    }

    if (!detail.budgetLines.length) {
      const budgetAmount = normalizeNumber(payload.budgetAmount || detail.estimatedCost || detail.contractValue, 0);
      addAction('budget_line', `${playbook.label} budget control`, {
        costCode: `PB-${playbook.key.slice(0, 12).toUpperCase()}`,
        description: `${playbook.label} budget control`,
        category: 'job_cost',
        status: 'draft',
        budgetAmount,
        forecastAmount: budgetAmount,
        notes: `Budget line from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('budget_line', 'Budget line', 'budget_line_exists');
    }

    for (const selectionTitle of playbook.clientSelections || []) {
      if (this.recordMatches(detail.clientSelections || [], ['title'], selectionTitle)) {
        addSkipped('client_selection', selectionTitle);
      } else {
        addAction('client_selection', selectionTitle, {
          title: selectionTitle,
          category: 'client_decision',
          status: 'pending_client',
          dueAt,
          options: ['Approve as specified', 'Request alternative', 'Defer until site visit'],
          notes: `Client decision drafted from ${playbook.label} playbook. Do not order materials, change price, or commit scope until the decision is confirmed and approved where required.`
        });
      }
    }

    if (playbook.requiresRfi && !detail.rfis.length) {
      addAction('rfi', `${playbook.label} hidden scope RFI`, {
        title: 'Hidden condition / client decision RFI',
        status: 'open',
        question: 'Confirm hidden conditions, selections, and scope assumptions before field reliance.',
        responsible: payload.responsible || 'Robert',
        dueAt
      });
    } else if (playbook.requiresRfi && detail.rfis.length) {
      addSkipped('rfi', 'Hidden scope RFI', 'rfi_exists');
    }

    if (!detail.qualityChecks.length) {
      addAction('quality_check', `${playbook.label} quality checklist`, {
        title: `${playbook.label} quality checklist`,
        status: 'open',
        result: 'pending',
        defects: [],
        checklist: playbook.qualityChecks,
        notes: `Quality checklist from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('quality_check', 'Quality check', 'quality_check_exists');
    }

    if (!detail.aftercare.length) {
      addAction('aftercare', `${playbook.label} aftercare`, {
        title: `${playbook.label} aftercare follow-up`,
        type: 'aftercare_follow_up',
        status: 'open',
        dueAt: futureIsoDate(7),
        notes: `Aftercare reminder from ${playbook.label} playbook.`
      });
    } else {
      addSkipped('aftercare', 'Aftercare', 'aftercare_exists');
    }

    if (playbook.recurring && !detail.recurringPlans.length) {
      addAction('recurring_plan', `${playbook.label} recurring plan`, {
        service: playbook.recurring.service,
        status: 'draft',
        intervalRule: playbook.recurring.intervalRule,
        nextDueAt: futureIsoDate(playbook.recurring.nextDueDays || 30),
        notes: `Recurring service proposal from ${playbook.label} playbook. Approval is required before booking.`
      });
    } else if (playbook.recurring && detail.recurringPlans.length) {
      addSkipped('recurring_plan', 'Recurring plan', 'recurring_plan_exists');
    }

    return {
      jobId,
      playbook: {
        key: playbook.key,
        label: playbook.label
      },
      mode: 'preview',
      actions,
      skipped,
      summary: {
        create: actions.length,
        skip: skipped.length,
        approvalSafe: true,
        externalCommitments: 0
      }
    };
  }

  applyJobPlaybook(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const preview = this.buildJobPlaybookPlan(jobId, payload);
      const created = [];
      const addCreated = (type, record) => {
        created.push({
          type,
          id: record?.id || null,
          status: record?.status || null,
          approvalId: record?.approvalId || record?.approval?.id || null
        });
      };

      for (const action of preview.actions) {
        const data = action.payload || {};
        if (action.type === 'task') addCreated(action.type, this.addTask(jobId, data, { actor }));
        if (action.type === 'tool_reservation') addCreated(action.type, this.reserveTool(jobId, data, { actor }));
        if (action.type === 'material_requirement') addCreated(action.type, this.addMaterialRequirement(jobId, data, { actor }));
        if (action.type === 'quote') addCreated(action.type, this.createQuote(jobId, data, { actor }));
        if (action.type === 'site_visit') addCreated(action.type, this.createSiteVisit(jobId, data, { actor }));
        if (action.type === 'route_plan') addCreated(action.type, this.createRoutePlan(jobId, data, { actor }));
        if (action.type === 'loading_plan') addCreated(action.type, this.createLoadingPlan(jobId, data, { actor }));
        if (action.type === 'field_report') addCreated(action.type, this.createFieldReport(jobId, data, { actor }));
        if (action.type === 'safety_meeting') addCreated(action.type, this.createSafetyMeeting(jobId, data, { actor }));
        if (action.type === 'jha') addCreated(action.type, this.createJhaRecord(jobId, data, { actor }));
        if (action.type === 'sds_sheet') addCreated(action.type, this.createSdsSheet(jobId, data, { actor }));
        if (action.type === 'site_access') addCreated(action.type, this.createSiteAccessLog(jobId, data, { actor }));
        if (action.type === 'worker_instruction') addCreated(action.type, this.createWorkerInstruction(jobId, data, { actor }));
        if (action.type === 'budget_line') addCreated(action.type, this.createBudgetLine(jobId, data, { actor }));
        if (action.type === 'client_selection') addCreated(action.type, this.createClientSelection(jobId, data, { actor }));
        if (action.type === 'rfi') addCreated(action.type, this.createRfi(jobId, data, { actor }));
        if (action.type === 'quality_check') addCreated(action.type, this.addQualityCheck(jobId, data, { actor }));
        if (action.type === 'aftercare') addCreated(action.type, this.addAftercareItem(jobId, data, { actor }));
        if (action.type === 'recurring_plan') addCreated(action.type, this.createRecurringPlan(jobId, data, { actor }));
      }

      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'apply_job_playbook',
        actor,
        after: {
          playbook: preview.playbook,
          created,
          skipped: preview.skipped,
          externalCommitments: 0
        },
        metadata: { source: 'job_operating_playbook' }
      });

      return {
        ...preview,
        mode: 'applied',
        created,
        summary: {
          ...preview.summary,
          created: created.length,
          skipped: preview.skipped.length
        },
        job: this.getJobDetail(jobId, { includeAudit: true })
      };
    });
  }

  createQuote(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const id = makeId('quote');
      const lineItems = Array.isArray(payload.lineItems) && payload.lineItems.length
        ? payload.lineItems.map(item => ({
          description: normalizeText(item.description || item.title || item.name, 'Contractor work'),
          quantity: normalizeNumber(item.quantity, 1),
          unitPrice: normalizeNumber(item.unitPrice || item.unit_price || item.price || item.amount, 0),
          costCode: item.costCode || item.cost_code || null
        }))
        : [{
          description: job.title,
          quantity: 1,
          unitPrice: normalizeNumber(payload.subtotal || job.estimated_cost || job.estimatedCost || 0),
          costCode: 'contract'
        }];
      const calculatedSubtotal = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      const subtotal = normalizeNumber(payload.subtotal, calculatedSubtotal);
      const taxRate = normalizeNumber(payload.taxRate || payload.tax_rate, 21);
      const taxAmount = normalizeNumber(payload.taxAmount || payload.tax_amount, subtotal * (taxRate / 100));
      const total = normalizeNumber(payload.total, subtotal + taxAmount);
      const status = normalizeStatus(payload.status, 'draft');

      this.db.prepare(`
        INSERT INTO quotes (id, job_id, status, currency, subtotal, tax_rate, tax_amount, total, valid_until, line_items_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        status,
        normalizeText(payload.currency, 'EUR').toUpperCase(),
        subtotal,
        taxRate,
        taxAmount,
        total,
        payload.validUntil || payload.valid_until || null,
        toJson(lineItems, []),
        toJson({ notes: payload.notes || null }),
        timestamp,
        timestamp
      );

      const approval = this.createApproval({
        targetType: 'quote',
        targetId: id,
        jobId,
        approvalType: 'quote_issue',
        summary: `Approve quote ${id} for ${total.toFixed(2)} ${normalizeText(payload.currency, 'EUR').toUpperCase()}`,
        reason: 'Quotes must be approved before sending externally.',
        data: { total, taxRate, lineItems }
      }, { actor, audit: false });
      this.db.prepare('UPDATE quotes SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);

      const quote = this.mapQuote(this.db.prepare('SELECT * FROM quotes WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'quote', entityId: id, jobId, action: 'create_quote', actor, after: quote });
      }
      return quote;
    });
  }

  createSiteVisit(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const id = makeId('visit');
      const requestedStatus = normalizeStatus(payload.status, 'scheduled');
      const approvalStatuses = ['confirmed', 'client_confirmed', 'committed', 'approved', 'sent'];
      const requiresApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus));
      const status = requiresApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;
      const checklist = normalizeList(payload.checklist).length
        ? normalizeList(payload.checklist)
        : this.defaultSiteVisitChecklist(job);
      const photos = normalizeList(payload.photos || payload.photoRefs || payload.photo_refs);

      this.db.prepare(`
        INSERT INTO site_visits (id, job_id, visit_type, status, scheduled_at, completed_at, assignee, findings, checklist_json, photos_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeStatus(payload.visitType || payload.visit_type, 'site_survey'),
        status,
        payload.scheduledAt || payload.scheduled_at || payload.date || null,
        payload.completedAt || payload.completed_at || null,
        payload.assignee || payload.assignedTo || payload.assigned_to || null,
        payload.findings || payload.notes || null,
        toJson(checklist, []),
        toJson(photos, []),
        toJson({
          notes: payload.notes || null,
          source: payload.source || null,
          requestedStatus,
          requiresApproval
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'site_visit',
          targetId: id,
          jobId,
          approvalType: 'site_visit_commitment',
          summary: `Approve site visit for ${job.title}`,
          reason: 'Client-facing appointments and crew commitments require approval before confirmation.',
          data: {
            visitType: normalizeStatus(payload.visitType || payload.visit_type, 'site_survey'),
            scheduledAt: payload.scheduledAt || payload.scheduled_at || payload.date || null,
            assignee: payload.assignee || payload.assignedTo || payload.assigned_to || null,
            requestedStatus,
            checklist
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE site_visits SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const siteVisit = this.mapSiteVisit(this.db.prepare('SELECT * FROM site_visits WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({
          entityType: 'site_visit',
          entityId: id,
          jobId,
          action: 'create_site_visit',
          actor,
          after: siteVisit,
          metadata: { approvalId: approval?.id || null }
        });
      }
      return siteVisit;
    });
  }

  createChangeOrder(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const id = makeId('change');
      let quoteId = payload.quoteId || payload.quote_id || null;
      if (quoteId) {
        const quote = this.db.prepare('SELECT id FROM quotes WHERE id = ? AND job_id = ?').get(quoteId, jobId);
        if (!quote) {
          const error = new Error('Change order quote does not belong to this job');
          error.statusCode = 400;
          throw error;
        }
      } else {
        const quote = this.db.prepare('SELECT id FROM quotes WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').get(jobId);
        quoteId = quote?.id || null;
      }

      const rawLineItems = Array.isArray(payload.lineItems) && payload.lineItems.length ? payload.lineItems : [];
      const lineItems = rawLineItems.length
        ? rawLineItems.map(item => ({
          description: normalizeText(item.description || item.title || item.name, 'Scope change'),
          quantity: normalizeNumber(item.quantity, 1),
          unitPrice: normalizeNumber(item.unitPrice || item.unit_price || item.price || item.amount, 0),
          costCode: item.costCode || item.cost_code || 'change_order'
        }))
        : [{
          description: normalizeText(payload.title || payload.scopeDelta || payload.scope_delta, 'Scope change'),
          quantity: 1,
          unitPrice: normalizeNumber(payload.amount || payload.subtotal, 0),
          costCode: 'change_order'
        }];
      const calculatedAmount = lineItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
      const amount = normalizeNumber(payload.amount || payload.subtotal, calculatedAmount);
      const taxRate = normalizeNumber(payload.taxRate || payload.tax_rate, 21);
      const taxAmount = normalizeNumber(payload.taxAmount || payload.tax_amount, amount * (taxRate / 100));
      const total = normalizeNumber(payload.total, amount + taxAmount);
      const scheduleDeltaDays = normalizeNumber(payload.scheduleDeltaDays || payload.schedule_delta_days, 0);
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const commitmentStatuses = ['sent', 'submitted', 'approved', 'accepted', 'committed', 'issued'];
      const hasImpact = Math.abs(total) > 0 || Math.abs(scheduleDeltaDays) > 0 || Boolean(normalizeText(payload.scopeDelta || payload.scope_delta, ''));
      const requiresApproval = normalizeBoolean(payload.requiresApproval, hasImpact || commitmentStatuses.includes(requestedStatus));
      const status = requiresApproval && commitmentStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO change_orders (id, job_id, quote_id, title, status, scope_delta, currency, amount, tax_rate, tax_amount, total, schedule_delta_days, line_items_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        quoteId,
        normalizeText(payload.title, 'Scope change'),
        status,
        payload.scopeDelta || payload.scope_delta || payload.description || null,
        normalizeText(payload.currency, 'EUR').toUpperCase(),
        amount,
        taxRate,
        taxAmount,
        total,
        scheduleDeltaDays,
        toJson(lineItems, []),
        toJson({
          notes: payload.notes || null,
          source: payload.source || null,
          requestedStatus,
          requiresApproval
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'change_order',
          targetId: id,
          jobId,
          approvalType: 'scope_change',
          summary: `Approve change order ${id} for ${total.toFixed(2)} ${normalizeText(payload.currency, 'EUR').toUpperCase()}`,
          reason: 'Scope, price, or schedule changes require approval before client commitment.',
          data: {
            quoteId,
            amount,
            taxRate,
            taxAmount,
            total,
            scheduleDeltaDays,
            requestedStatus,
            lineItems
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE change_orders SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const changeOrder = this.mapChangeOrder(this.db.prepare('SELECT * FROM change_orders WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({
          entityType: 'change_order',
          entityId: id,
          jobId,
          action: 'create_change_order',
          actor,
          after: changeOrder,
          metadata: { approvalId: approval?.id || null }
        });
      }
      return changeOrder;
    });
  }

  createFieldReport(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const id = makeId('field');
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const approvalStatuses = ['submitted', 'published', 'client_visible', 'approved', 'sent'];
      const requiresApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus) || normalizeBoolean(payload.clientVisible, false));
      const status = requiresApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;
      const blockers = normalizeList(payload.blockers);
      const photos = normalizeList(payload.photos || payload.photoRefs || payload.photo_refs);

      this.db.prepare(`
        INSERT INTO field_reports (id, job_id, report_date, status, weather, manpower, work_completed, blockers_json, photos_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        payload.reportDate || payload.report_date || nowIso().slice(0, 10),
        status,
        payload.weather || null,
        normalizeNumber(payload.manpower, 0),
        payload.workCompleted || payload.work_completed || payload.notes || null,
        toJson(blockers, []),
        toJson(photos, []),
        toJson({
          notes: payload.notes || null,
          source: payload.source || null,
          entryKey: payload.entryKey || payload.entry_key || null,
          entryFingerprint: payload.entryFingerprint || payload.entry_fingerprint || null,
          workerId: payload.workerId || payload.worker_id || null,
          workerName: payload.workerName || payload.worker_name || null,
          safetyStatus: payload.safetyStatus || payload.safety_status || null,
          requestedStatus,
          requiresApproval,
          clientVisible: normalizeBoolean(payload.clientVisible, false),
          jobTitle: job.title
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'field_report',
          targetId: id,
          jobId,
          approvalType: 'field_report_submission',
          summary: `Approve field report for ${job.title}`,
          reason: 'Client-visible or submitted field reports require approval before they become official evidence.',
          data: {
            reportDate: payload.reportDate || payload.report_date || nowIso().slice(0, 10),
            requestedStatus,
            blockers,
            photos
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE field_reports SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const fieldReport = this.mapFieldReport(this.db.prepare('SELECT * FROM field_reports WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({
          entityType: 'field_report',
          entityId: id,
          jobId,
          action: 'create_field_report',
          actor,
          after: fieldReport,
          metadata: { approvalId: approval?.id || null }
        });
      }
      return fieldReport;
    });
  }

  createRfi(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const id = makeId('rfi');
      const requestedStatus = normalizeStatus(payload.status, 'open');
      const approvalStatuses = ['answered', 'closed', 'resolved', 'issued', 'sent', 'approved'];
      const response = payload.response || payload.answer || null;
      const requiresApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus) || Boolean(response));
      const status = requiresApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO rfi_records (id, job_id, title, status, question, response, responsible, due_at, answered_at, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.title || payload.subject, 'Field question'),
        status,
        payload.question || payload.body || payload.notes || null,
        response,
        payload.responsible || payload.assignee || payload.owner || null,
        payload.dueAt || payload.due_at || null,
        payload.answeredAt || payload.answered_at || null,
        toJson({
          notes: payload.notes || null,
          source: payload.source || null,
          requestedStatus,
          requiresApproval,
          discipline: payload.discipline || null,
          jobTitle: job.title
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'rfi_record',
          targetId: id,
          jobId,
          approvalType: 'rfi_response',
          summary: `Approve RFI response for ${job.title}`,
          reason: 'RFI responses can change scope, quality, schedule, or client expectations and require approval before closure.',
          data: {
            title: normalizeText(payload.title || payload.subject, 'Field question'),
            requestedStatus,
            question: payload.question || payload.body || payload.notes || null,
            response
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE rfi_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const rfi = this.mapRfi(this.db.prepare('SELECT * FROM rfi_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({
          entityType: 'rfi_record',
          entityId: id,
          jobId,
          action: 'create_rfi',
          actor,
          after: rfi,
          metadata: { approvalId: approval?.id || null }
        });
      }
      return rfi;
    });
  }

  createSubmittalRecord(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('submittal');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const approvalStatuses = ['approved', 'accepted', 'issued', 'sent', 'closed', 'client_visible'];
      const attachments = normalizeList(payload.attachments || payload.documents || payload.files);
      const requiresApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus) || normalizeBoolean(payload.clientVisible, false));
      const status = requiresApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO submittal_records (id, job_id, title, package_name, status, responsible, reviewer, due_at, submitted_at, approved_at, approval_id, attachments_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.title, 'Material submittal package'),
        payload.packageName || payload.package_name || payload.package || null,
        status,
        payload.responsible || payload.assignee || payload.owner || 'Project team',
        payload.reviewer || 'Robert',
        payload.dueAt || payload.due_at || futureIsoDate(7),
        payload.submittedAt || payload.submitted_at || null,
        payload.approvedAt || payload.approved_at || null,
        null,
        toJson(attachments, []),
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          material: payload.material || null,
          specification: payload.specification || payload.spec || null,
          clientVisible: normalizeBoolean(payload.clientVisible, false),
          source: payload.source || null,
          jobTitle: job.title
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'submittal_record',
          targetId: id,
          jobId,
          approvalType: 'submittal_approval',
          summary: `Approve submittal ${normalizeText(payload.title, 'material package')}`,
          reason: 'Approved or issued submittals can drive procurement, installation, and client-visible commitments. Approval is required before reliance.',
          data: { requestedStatus, attachments, packageName: payload.packageName || payload.package_name || payload.package || null }
        }, { actor, audit: false });
        this.db.prepare('UPDATE submittal_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const submittal = this.mapSubmittal(this.db.prepare('SELECT * FROM submittal_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'submittal_record', entityId: id, jobId, action: 'create_submittal', actor, after: submittal });
      }
      return { ...submittal, approval };
    });
  }

  createClientSelection(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('selection');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'pending_client');
      const approvalStatuses = ['approved', 'accepted', 'client_confirmed', 'locked', 'selected', 'ordered'];
      const optionsList = Array.isArray(payload.options) ? payload.options : normalizeList(payload.options);
      const value = normalizeNumber(payload.value || payload.amount, 0);
      const requiresApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus) || value >= 1000);
      const status = requiresApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO client_selections (id, job_id, title, category, status, client_name, currency, value, due_at, decided_at, approval_id, options_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.title, 'Client selection decision'),
        normalizeStatus(payload.category, 'selection'),
        status,
        payload.clientName || payload.client_name || job.client_name || null,
        normalizeText(payload.currency, 'EUR').toUpperCase(),
        value,
        payload.dueAt || payload.due_at || futureIsoDate(3),
        payload.decidedAt || payload.decided_at || null,
        null,
        toJson(optionsList, []),
        toJson({
          requestedStatus,
          selectedOption: payload.selectedOption || payload.selected_option || null,
          notes: payload.notes || payload.note || null,
          clientVisible: normalizeBoolean(payload.clientVisible, true),
          source: payload.source || null,
          jobTitle: job.title
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'client_selection',
          targetId: id,
          jobId,
          approvalType: 'client_selection_approval',
          summary: `Approve client selection ${normalizeText(payload.title, 'decision')}`,
          reason: 'Client selections can affect scope, procurement, price, and commitments. Approval is required before locking or ordering.',
          data: { requestedStatus, value, selectedOption: payload.selectedOption || payload.selected_option || null }
        }, { actor, audit: false });
        this.db.prepare('UPDATE client_selections SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const selection = this.mapClientSelection(this.db.prepare('SELECT * FROM client_selections WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'client_selection', entityId: id, jobId, action: 'create_client_selection', actor, after: selection });
      }
      return { ...selection, approval };
    });
  }

  createPermitRecord(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const id = makeId('permit');
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const approvalStatuses = ['active', 'approved', 'issued', 'submitted'];
      const requiresApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus));
      const status = requiresApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO permit_records (id, job_id, permit_type, title, status, holder, location, issued_at, expires_at, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeStatus(payload.permitType || payload.permit_type, 'site_access'),
        normalizeText(payload.title, 'Permit review'),
        status,
        payload.holder || payload.assignee || 'Project team',
        payload.location || job.address || job.city || null,
        payload.issuedAt || payload.issued_at || null,
        payload.expiresAt || payload.expires_at || payload.expiry || null,
        toJson({
          notes: payload.notes || null,
          source: payload.source || null,
          requestedStatus,
          requiresApproval,
          authority: payload.authority || null,
          jobTitle: job.title
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'permit_record',
          targetId: id,
          jobId,
          approvalType: 'permit_activation',
          summary: `Approve permit ${id} for ${job.title}`,
          reason: 'Active permits and compliance commitments require approval before field reliance.',
          data: {
            permitType: normalizeStatus(payload.permitType || payload.permit_type, 'site_access'),
            requestedStatus,
            holder: payload.holder || payload.assignee || 'Project team',
            location: payload.location || job.address || job.city || null,
            expiresAt: payload.expiresAt || payload.expires_at || payload.expiry || null
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE permit_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const permit = this.mapPermit(this.db.prepare('SELECT * FROM permit_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({
          entityType: 'permit_record',
          entityId: id,
          jobId,
          action: 'create_permit_record',
          actor,
          after: permit,
          metadata: { approvalId: approval?.id || null }
        });
      }
      return permit;
    });
  }

  addTask(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const id = makeId('task');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO job_tasks (id, job_id, title, description, status, priority, assignee_id, due_at, completed_at, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      normalizeText(payload.title, 'Job task'),
      payload.description || null,
      normalizeStatus(payload.status, 'open'),
      normalizePriority(payload.priority),
      payload.assigneeId || payload.assignee_id || null,
      payload.dueAt || payload.due_at || payload.dueDate || null,
      payload.completedAt || payload.completed_at || null,
      toJson({ source: payload.source || null }),
      timestamp,
      timestamp
    );
    const task = this.mapTask(this.db.prepare('SELECT * FROM job_tasks WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'task', entityId: id, jobId, action: 'create_task', actor: options.actor || 'Contractor.AI', after: task });
    }
    return task;
  }

  addAssignment(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || payload.actor || 'Contractor.AI';
      let worker = null;
      if (payload.workerId) {
        worker = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(payload.workerId);
      }
      if (!worker && payload.workerName) {
        worker = this.db.prepare('SELECT * FROM workers WHERE lower(name) = lower(?) LIMIT 1').get(payload.workerName);
      }
      if (!worker && options.optional !== false) {
        worker = this.db.prepare("SELECT * FROM workers WHERE status IN ('available', 'offline') ORDER BY status = 'available' DESC, created_at ASC LIMIT 1").get();
      }
      if (!worker && options.optional) {
        return null;
      }
      if (!worker) {
        const error = new Error('No ledger worker is available for assignment');
        error.statusCode = 409;
        error.code = 'worker_unavailable';
        throw error;
      }
      const workerStatus = normalizeStatus(worker.status, 'available');
      if (workerStatus === 'retired') {
        const error = new Error('Retired workers cannot be assigned to new work');
        error.statusCode = 409;
        error.code = 'worker_retired';
        throw error;
      }
      const pendingRetirement = this.db.prepare(`
        SELECT id FROM approvals
        WHERE target_type = 'worker_retirement' AND target_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(worker.id);
      if (pendingRetirement) {
        const error = new Error('This worker has a pending retirement decision and cannot receive new assignments');
        error.statusCode = 409;
        error.code = 'worker_retirement_pending';
        error.details = { workerId: worker.id, approvalId: pendingRetirement.id };
        throw error;
      }

      const requestedStatus = normalizeStatus(payload.status, 'planned');
      if (['released', 'cancelled', 'completed', 'closed', 'rejected'].includes(requestedStatus)) {
        const error = new Error('Use the release endpoint to close a worker assignment');
        error.statusCode = 400;
        throw error;
      }
      const approvedStatus = ['planned', 'scheduled', 'active', 'in_progress', 'approved'].includes(requestedStatus)
        ? requestedStatus
        : 'planned';
      const window = this.normalizeAssignmentWindow(job, payload);
      const conflicts = this.findAssignmentConflicts({
        workerId: worker.id,
        scheduledStart: window.scheduledStart,
        scheduledEnd: window.scheduledEnd
      });
      const approvalReasons = this.assignmentApprovalReasons(worker, payload, conflicts);
      const requiresApproval = approvalReasons.length > 0;
      const id = makeId('assign');
      const timestamp = nowIso();
      const assignmentData = {
        workerName: worker.name,
        requestedStatus: approvedStatus,
        requestedBy: actor,
        notes: payload.notes || payload.reason || null,
        conflicts,
        conflictCount: conflicts.length,
        requiresApproval,
        approvalReasons
      };
      this.db.prepare(`
        INSERT INTO assignments (id, job_id, worker_id, role, status, scheduled_start, scheduled_end, allocation_hours, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        worker.id,
        payload.role || worker.role || 'Contractor',
        requiresApproval ? 'pending_approval' : approvedStatus,
        window.scheduledStart,
        window.scheduledEnd,
        normalizeNumber(payload.allocationHours || payload.allocation_hours, 0),
        toJson(assignmentData),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'assignment',
          targetId: id,
          jobId,
          approvalType: 'worker_assignment',
          summary: `Approve assignment of ${worker.name} to ${job.title}`,
          reason: approvalReasons.map(item => item.detail).join(' '),
          data: {
            assignmentId: id,
            workerId: worker.id,
            workerName: worker.name,
            requestedStatus: approvedStatus,
            scheduledStart: window.scheduledStart,
            scheduledEnd: window.scheduledEnd,
            conflicts,
            approvalReasons
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE assignments SET data_json = ?, updated_at = ? WHERE id = ?')
          .run(toJson({ ...assignmentData, approvalId: approval.id }), nowIso(), id);
      } else {
        this.db.prepare("UPDATE jobs SET phase = CASE WHEN phase = 'intake' THEN 'planned' ELSE phase END, updated_at = ? WHERE id = ?").run(nowIso(), jobId);
      }

      const assignment = this.mapAssignment(this.db.prepare('SELECT assignments.*, workers.name AS worker_name FROM assignments LEFT JOIN workers ON workers.id = assignments.worker_id WHERE assignments.id = ?').get(id));
      if (options.audit !== false) {
        this.audit({
          entityType: 'assignment',
          entityId: id,
          jobId,
          action: requiresApproval ? 'propose_assignment' : 'create_assignment',
          actor,
          after: assignment,
          metadata: { approvalId: approval?.id || null, conflicts: conflicts.length }
        });
      }
      return {
        ...assignment,
        approval,
        conflicts,
        requiresApproval
      };
    });
  }

  normalizeAssignmentWindow(job, payload = {}) {
    const scheduledStart = this.normalizeReservationDate(
      payload.scheduledStart || payload.scheduled_start || payload.startAt || payload.start_at || job.scheduled_start,
      'scheduledStart'
    );
    const scheduledEnd = this.normalizeReservationDate(
      payload.scheduledEnd || payload.scheduled_end || payload.endAt || payload.end_at || job.scheduled_end || job.target_completion,
      'scheduledEnd'
    );
    if (scheduledStart && scheduledEnd && Date.parse(scheduledStart) > Date.parse(scheduledEnd)) {
      const error = new Error('scheduledEnd must be after scheduledStart');
      error.statusCode = 400;
      throw error;
    }
    return { scheduledStart, scheduledEnd };
  }

  activeAssignmentStatus(status) {
    return !ASSIGNMENT_CLOSED_STATUSES.has(normalizeStatus(status, 'planned'));
  }

  crewEvidenceIdentity(record = {}) {
    const data = record?.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? record.data
      : fromJson(record?.data_json, {});
    return {
      assignmentId: record?.assignmentId || record?.assignment_id || data.assignmentId || data.assignment_id || null,
      workerId: record?.workerId || record?.worker_id || data.workerId || data.worker_id || null,
      workerName: normalizeText(
        record?.workerName || record?.worker_name || data.workerName || data.worker_name,
        ''
      ) || null
    };
  }

  crewEvidenceIdentityMatches(left = {}, right = {}) {
    const leftIdentity = this.crewEvidenceIdentity(left);
    const rightIdentity = this.crewEvidenceIdentity(right);
    if (leftIdentity.assignmentId && rightIdentity.assignmentId) {
      return String(leftIdentity.assignmentId) === String(rightIdentity.assignmentId);
    }
    if (leftIdentity.workerId && rightIdentity.workerId) {
      return String(leftIdentity.workerId) === String(rightIdentity.workerId);
    }
    if (!leftIdentity.workerName || !rightIdentity.workerName) return false;
    return leftIdentity.workerName.toLowerCase() === rightIdentity.workerName.toLowerCase();
  }

  resolveCrewAssignment(jobId, payload = {}) {
    const rows = this.db.prepare(`
      SELECT assignments.*, workers.name AS worker_name
      FROM assignments
      LEFT JOIN workers ON workers.id = assignments.worker_id
      WHERE assignments.job_id = ?
      ORDER BY assignments.created_at DESC
    `).all(jobId).map(row => this.mapAssignment(row));
    const assignmentId = payload.assignmentId || payload.assignment_id || null;
    if (assignmentId) {
      const assignment = rows.find(candidate => String(candidate.id) === String(assignmentId));
      if (!assignment) {
        const error = new Error('Worker assignment not found for this job');
        error.statusCode = 400;
        throw error;
      }
      return assignment;
    }

    const activeAssignments = rows.filter(assignment => this.activeAssignmentStatus(assignment.status));
    const workerId = payload.workerId || payload.worker_id || null;
    if (workerId) {
      const assignment = activeAssignments.find(candidate => String(candidate.workerId || '') === String(workerId));
      if (assignment) return assignment;
      return null;
    }
    const workerName = normalizeText(payload.workerName || payload.worker_name || payload.worker, '');
    if (workerName && workerName.toLowerCase() !== 'crew member') {
      const assignment = activeAssignments.find(candidate => (
        normalizeText(candidate.workerName, '').toLowerCase() === workerName.toLowerCase()
      ));
      if (assignment) return assignment;
      return null;
    }
    return activeAssignments[0] || null;
  }

  resolveSiteAccessOrientation(jobId, accessRecord = {}) {
    const orientationId = accessRecord.orientationId || accessRecord.orientation_id || null;
    if (orientationId) {
      const orientation = this.db.prepare('SELECT * FROM worker_orientations WHERE id = ? AND job_id = ?').get(orientationId, jobId);
      return orientation && this.crewEvidenceIdentityMatches(accessRecord, orientation) ? orientation : null;
    }
    return this.db.prepare(`
      SELECT * FROM worker_orientations
      WHERE job_id = ?
      ORDER BY completed_at DESC, updated_at DESC
    `).all(jobId).find(orientation => this.crewEvidenceIdentityMatches(accessRecord, orientation)) || null;
  }

  invalidateAssignmentCrewEvidence(jobId, assignment = {}, options = {}) {
    const identity = {
      assignmentId: assignment.id,
      workerId: assignment.workerId || assignment.worker_id || null,
      workerName: assignment.workerName || assignment.worker_name || null
    };
    const instructions = this.db.prepare('SELECT * FROM worker_instructions WHERE job_id = ?').all(jobId)
      .filter(record => this.crewEvidenceIdentityMatches(record, identity));
    const orientations = this.db.prepare('SELECT * FROM worker_orientations WHERE job_id = ?').all(jobId)
      .filter(record => this.crewEvidenceIdentityMatches(record, identity));
    const accessLogs = this.db.prepare('SELECT * FROM site_access_logs WHERE job_id = ?').all(jobId)
      .filter(record => this.crewEvidenceIdentityMatches(record, identity));
    const timestamp = options.timestamp || nowIso();
    const actor = options.actor || 'dashboard';
    const targetIds = [
      ...instructions.map(record => record.id),
      ...orientations.map(record => record.id),
      ...accessLogs.map(record => record.id)
    ];

    for (const record of instructions) {
      this.db.prepare(`
        UPDATE worker_instructions SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status NOT IN ('cancelled', 'rejected')
      `).run(timestamp, record.id);
    }
    for (const record of orientations) {
      this.db.prepare(`
        UPDATE worker_orientations SET status = 'expired', updated_at = ?
        WHERE id = ? AND status NOT IN ('expired', 'rejected')
      `).run(timestamp, record.id);
    }
    for (const record of accessLogs) {
      this.db.prepare(`
        UPDATE site_access_logs
        SET status = 'checked_out', orientation_valid = 0, checked_out_at = COALESCE(checked_out_at, ?), updated_at = ?
        WHERE id = ? AND status NOT IN ('checked_out', 'denied')
      `).run(timestamp, timestamp, record.id);
    }
    for (const targetId of targetIds) {
      this.db.prepare(`
        UPDATE approvals
        SET status = 'rejected', resolved_by = ?, resolved_at = ?, reason = ?, updated_at = ?
        WHERE target_id = ? AND status = 'pending'
          AND target_type IN ('worker_instruction', 'worker_orientation', 'site_access_log')
      `).run(actor, timestamp, 'Crew assignment was released before this evidence approval was resolved.', timestamp, targetId);
    }
    return {
      instructions: instructions.length,
      orientations: orientations.length,
      siteAccess: accessLogs.length,
      approvalTargets: targetIds.length
    };
  }

  assignmentWindowsOverlap(leftStart, leftEnd, rightStart, rightEnd) {
    if (!leftStart || !leftEnd || !rightStart || !rightEnd) {
      return Boolean((leftStart || leftEnd) && (rightStart || rightEnd));
    }
    const leftStartMs = Date.parse(leftStart);
    const leftEndMs = Date.parse(leftEnd);
    const rightStartMs = Date.parse(rightStart);
    const rightEndMs = Date.parse(rightEnd);
    if (![leftStartMs, leftEndMs, rightStartMs, rightEndMs].every(Number.isFinite)) {
      return true;
    }
    return leftStartMs <= rightEndMs && leftEndMs >= rightStartMs;
  }

  findAssignmentConflicts({ workerId = null, scheduledStart = null, scheduledEnd = null, excludeAssignmentId = null } = {}) {
    if (!workerId) {
      return [];
    }
    const rows = this.db.prepare(`
      SELECT assignments.*, workers.name AS worker_name, jobs.title AS job_title, jobs.status AS job_status
      FROM assignments
      LEFT JOIN workers ON workers.id = assignments.worker_id
      LEFT JOIN jobs ON jobs.id = assignments.job_id
      WHERE assignments.worker_id = ?
        AND ${this.operationalJobStatusSql('jobs')}
      ORDER BY assignments.created_at ASC
    `).all(workerId);
    return rows
      .filter(row => !excludeAssignmentId || row.id !== excludeAssignmentId)
      .filter(row => this.activeAssignmentStatus(row.status))
      .filter(row => this.assignmentWindowsOverlap(scheduledStart, scheduledEnd, row.scheduled_start, row.scheduled_end))
      .map(row => ({
        assignmentId: row.id,
        jobId: row.job_id,
        jobTitle: row.job_title || row.job_id,
        jobStatus: row.job_status || null,
        workerId: row.worker_id,
        workerName: row.worker_name || fromJson(row.data_json).workerName || row.worker_id,
        status: row.status,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end
      }));
  }

  detectAssignmentConflicts(limit = 25) {
    const rows = this.db.prepare(`
      SELECT assignments.*, workers.name AS worker_name, jobs.title AS job_title, jobs.status AS job_status
      FROM assignments
      LEFT JOIN workers ON workers.id = assignments.worker_id
      LEFT JOIN jobs ON jobs.id = assignments.job_id
      WHERE assignments.worker_id IS NOT NULL
        AND assignments.status NOT IN ('released', 'cancelled', 'completed', 'closed', 'rejected', 'declined', 'offline')
        AND (jobs.id IS NULL OR jobs.status NOT IN ('archived', 'pending_archive_approval', 'cancelled', 'canceled', 'rejected', 'deleted', 'void'))
      ORDER BY assignments.created_at ASC
    `).all();
    const conflicts = [];
    for (let index = 0; index < rows.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < rows.length; compareIndex += 1) {
        const current = rows[index];
        const candidate = rows[compareIndex];
        if (String(current.worker_id) !== String(candidate.worker_id)) {
          continue;
        }
        if (!this.assignmentWindowsOverlap(current.scheduled_start, current.scheduled_end, candidate.scheduled_start, candidate.scheduled_end)) {
          continue;
        }
        conflicts.push({
          assignmentId: current.id,
          conflictingAssignmentId: candidate.id,
          jobId: current.job_id,
          conflictingJobId: candidate.job_id,
          jobTitle: current.job_title || current.job_id,
          conflictingJobTitle: candidate.job_title || candidate.job_id,
          workerId: current.worker_id,
          workerName: current.worker_name || fromJson(current.data_json).workerName || current.worker_id,
          status: current.status,
          conflictingStatus: candidate.status,
          scheduledStart: current.scheduled_start,
          scheduledEnd: current.scheduled_end,
          conflictingScheduledStart: candidate.scheduled_start,
          conflictingScheduledEnd: candidate.scheduled_end
        });
        if (conflicts.length >= limit) {
          return conflicts;
        }
      }
    }
    return conflicts;
  }

  assignmentApprovalReasons(worker, payload = {}, conflicts = []) {
    const requestedApproval = normalizeBoolean(payload.requiresApproval, false);
    const clientCommitment = normalizeBoolean(payload.clientCommitment ?? payload.client_commitment ?? payload.committedToClient, false);
    const status = normalizeStatus(payload.status, 'planned');
    const reasons = [];
    if (conflicts.length) {
      reasons.push({
        type: 'worker_conflict',
        detail: `${conflicts.length} active assignment conflict(s) need review before this worker is committed.`
      });
    }
    if (clientCommitment) {
      reasons.push({ type: 'client_commitment', detail: 'This assignment affects a client or worker commitment.' });
    }
    if (status === 'active' || status === 'in_progress') {
      reasons.push({ type: 'immediate_field_commitment', detail: 'Starting or activating field work requires review.' });
    }
    if (requestedApproval) {
      reasons.push({ type: 'manual_approval_requested', detail: 'The assignment was explicitly submitted for approval.' });
    }
    const workerStatus = normalizeStatus(worker?.status, 'available');
    if (worker && workerStatus !== 'available') {
      reasons.push({
        type: workerStatus === 'offline' ? 'worker_offline' : 'worker_unavailable',
        detail: `${worker.name} is currently marked ${workerStatus.replace(/_/g, ' ')}.`
      });
    }
    return reasons;
  }

  releaseAssignment(jobId, assignmentId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId, { allowInactive: true });
      const row = this.db.prepare('SELECT assignments.*, workers.name AS worker_name FROM assignments LEFT JOIN workers ON workers.id = assignments.worker_id WHERE assignments.id = ? AND assignments.job_id = ?').get(assignmentId, jobId);
      if (!row) {
        const error = new Error('Assignment not found');
        error.statusCode = 404;
        throw error;
      }
      const status = normalizeStatus(payload.status, 'released');
      if (!['released', 'completed', 'cancelled'].includes(status)) {
        const error = new Error('Assignment release status must be released, completed, or cancelled');
        error.statusCode = 400;
        throw error;
      }
      const timestamp = nowIso();
      const before = this.mapAssignment(row);
      const data = fromJson(row.data_json, {});
      this.db.prepare(`
        UPDATE assignments
        SET status = ?, data_json = ?, updated_at = ?
        WHERE id = ? AND job_id = ?
      `).run(
        status,
        toJson({
          ...data,
          releasedAt: payload.releasedAt || timestamp,
          releasedBy: payload.releasedBy || payload.actor || options.actor || 'dashboard',
          releaseReason: payload.reason || payload.notes || null
        }),
        timestamp,
        assignmentId,
        jobId
      );
      const invalidatedCrewEvidence = ['released', 'cancelled'].includes(status)
        ? this.invalidateAssignmentCrewEvidence(jobId, before, {
            timestamp,
            actor: options.actor || payload.actor || 'dashboard'
          })
        : { instructions: 0, orientations: 0, siteAccess: 0, approvalTargets: 0 };
      const after = this.mapAssignment(this.db.prepare('SELECT assignments.*, workers.name AS worker_name FROM assignments LEFT JOIN workers ON workers.id = assignments.worker_id WHERE assignments.id = ?').get(assignmentId));
      if (options.audit !== false) {
        this.audit({
          entityType: 'assignment',
          entityId: assignmentId,
          jobId,
          action: 'release_assignment',
          actor: options.actor || payload.actor || 'dashboard',
          before,
          after,
          metadata: { invalidatedCrewEvidence }
        });
      }
      return { ...after, invalidatedCrewEvidence };
    });
  }

  normalizeReservationDate(value, label) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) {
      const error = new Error(`${label} must be a valid date/time`);
      error.statusCode = 400;
      throw error;
    }
    return new Date(milliseconds).toISOString();
  }

  normalizeToolReservationWindow(job, payload = {}) {
    const neededFrom = this.normalizeReservationDate(
      payload.neededFrom || payload.needed_from || payload.scheduledStart || payload.scheduled_start || job.scheduled_start,
      'neededFrom'
    );
    const neededUntil = this.normalizeReservationDate(
      payload.neededUntil || payload.needed_until || payload.scheduledEnd || payload.scheduled_end || job.scheduled_end || job.target_completion,
      'neededUntil'
    );
    if (neededFrom && neededUntil && Date.parse(neededFrom) > Date.parse(neededUntil)) {
      const error = new Error('neededUntil must be after neededFrom');
      error.statusCode = 400;
      throw error;
    }
    return { neededFrom, neededUntil };
  }

  activeToolReservationStatus(status) {
    return !['released', 'returned', 'cancelled', 'rejected', 'declined', 'completed', 'closed', 'lost', 'retired']
      .includes(normalizeStatus(status, 'reserved'));
  }

  toolReservationsMatch(row, toolId, toolName) {
    const normalizedToolName = normalizeText(toolName, '').toLowerCase();
    if (toolId && row.tool_id && String(row.tool_id) === String(toolId)) {
      return true;
    }
    return normalizedToolName && normalizeText(row.tool_name, '').toLowerCase() === normalizedToolName;
  }

  toolReservationWindowsOverlap(leftFrom, leftUntil, rightFrom, rightUntil) {
    if (!leftFrom || !leftUntil || !rightFrom || !rightUntil) {
      return true;
    }
    const leftStart = Date.parse(leftFrom);
    const leftEnd = Date.parse(leftUntil);
    const rightStart = Date.parse(rightFrom);
    const rightEnd = Date.parse(rightUntil);
    if (![leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)) {
      return true;
    }
    return leftStart <= rightEnd && leftEnd >= rightStart;
  }

  findToolReservationConflicts({ toolId = null, toolName = '', neededFrom = null, neededUntil = null, excludeReservationId = null } = {}) {
    const rows = this.db.prepare(`
      SELECT tool_reservations.*, jobs.title AS job_title, jobs.status AS job_status
      FROM tool_reservations
      LEFT JOIN jobs ON jobs.id = tool_reservations.job_id
      WHERE ${this.operationalJobStatusSql('jobs')}
      ORDER BY tool_reservations.created_at ASC
    `).all();
    return rows
      .filter(row => !excludeReservationId || row.id !== excludeReservationId)
      .filter(row => this.activeToolReservationStatus(row.status))
      .filter(row => this.toolReservationsMatch(row, toolId, toolName))
      .filter(row => this.toolReservationWindowsOverlap(neededFrom, neededUntil, row.needed_from, row.needed_until))
      .map(row => ({
        reservationId: row.id,
        jobId: row.job_id,
        jobTitle: row.job_title || row.job_id,
        jobStatus: row.job_status || null,
        toolId: row.tool_id,
        toolName: row.tool_name,
        status: row.status,
        neededFrom: row.needed_from,
        neededUntil: row.needed_until
      }));
  }

  detectToolReservationConflicts(limit = 25) {
    const rows = this.db.prepare(`
      SELECT tool_reservations.*, jobs.title AS job_title, jobs.status AS job_status
      FROM tool_reservations
      LEFT JOIN jobs ON jobs.id = tool_reservations.job_id
      WHERE tool_reservations.status NOT IN ('released', 'returned', 'cancelled', 'rejected', 'declined', 'completed', 'closed', 'lost', 'retired')
        AND (jobs.id IS NULL OR jobs.status NOT IN ('archived', 'pending_archive_approval', 'cancelled', 'canceled', 'rejected', 'deleted', 'void'))
      ORDER BY tool_reservations.created_at ASC
    `).all();
    const conflicts = [];
    for (let index = 0; index < rows.length; index += 1) {
      for (let compareIndex = index + 1; compareIndex < rows.length; compareIndex += 1) {
        const current = rows[index];
        const candidate = rows[compareIndex];
        if (!this.toolReservationsMatch(candidate, current.tool_id, current.tool_name)) {
          continue;
        }
        if (!this.toolReservationWindowsOverlap(current.needed_from, current.needed_until, candidate.needed_from, candidate.needed_until)) {
          continue;
        }
        conflicts.push({
          reservationId: current.id,
          conflictingReservationId: candidate.id,
          jobId: current.job_id,
          conflictingJobId: candidate.job_id,
          jobTitle: current.job_title || current.job_id,
          conflictingJobTitle: candidate.job_title || candidate.job_id,
          toolId: current.tool_id || candidate.tool_id || null,
          toolName: current.tool_name || candidate.tool_name,
          status: current.status,
          conflictingStatus: candidate.status,
          neededFrom: current.needed_from,
          neededUntil: current.needed_until,
          conflictingNeededFrom: candidate.needed_from,
          conflictingNeededUntil: candidate.needed_until
        });
        if (conflicts.length >= limit) {
          return conflicts;
        }
      }
    }
    return conflicts;
  }

  toolReservationApprovalReasons(tool, payload = {}, conflicts = []) {
    const toolData = fromJson(tool?.data_json, {});
    const requestedApproval = normalizeBoolean(payload.requiresApproval, false);
    const scarce = normalizeBoolean(payload.scarce ?? payload.isScarce ?? toolData.scarce ?? toolData.critical, false);
    const rentalRequired = normalizeBoolean(payload.rentalRequired ?? payload.rental_required ?? toolData.rentalRequired, false);
    const depositAmount = normalizeNumber(payload.depositAmount ?? payload.deposit_amount ?? payload.deposit, 0);
    const replacementValue = normalizeNumber(payload.replacementValue ?? payload.replacement_value ?? payload.value ?? toolData.replacementValue, 0);
    const reasons = [];
    if (conflicts.length) {
      reasons.push({
        type: 'tool_conflict',
        detail: `${conflicts.length} active reservation conflict(s) need review before this tool is committed.`
      });
    }
    if (scarce) {
      reasons.push({ type: 'scarce_tool', detail: 'This is marked as scarce or critical equipment.' });
    }
    if (rentalRequired) {
      reasons.push({ type: 'rental_tool', detail: 'This reservation requires a rental or external equipment commitment.' });
    }
    if (depositAmount >= 250 || replacementValue >= 500) {
      reasons.push({ type: 'high_value_tool', detail: 'This tool reservation has enough value or deposit risk to require review.' });
    }
    if (requestedApproval) {
      reasons.push({ type: 'manual_approval_requested', detail: 'The reservation was explicitly submitted for approval.' });
    }
    return reasons;
  }

  reserveTool(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const toolName = normalizeText(payload.toolName || payload.name, 'Tool');
      let tool = null;
      if (payload.toolId) {
        tool = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(payload.toolId);
      }
      if (!tool) {
        tool = this.db.prepare('SELECT * FROM tools WHERE lower(name) = lower(?) LIMIT 1').get(toolName);
      }
      if (tool) {
        const toolStatus = normalizeStatus(tool.status, 'available');
        if (toolStatus === 'retired') {
          const error = new Error('Retired equipment cannot be reserved for new work');
          error.statusCode = 409;
          error.code = 'tool_retired';
          throw error;
        }
        const pendingRetirement = this.db.prepare(`
          SELECT id FROM approvals
          WHERE target_type = 'tool_retirement' AND target_id = ? AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
        `).get(tool.id);
        if (pendingRetirement) {
          const error = new Error('This equipment has a pending retirement decision and cannot receive new reservations');
          error.statusCode = 409;
          error.code = 'tool_retirement_pending';
          error.details = { toolId: tool.id, approvalId: pendingRetirement.id };
          throw error;
        }
        const inspection = this.assessToolInspection(this.mapTool(tool));
        if (inspection.blocksReservation) {
          const codeByStatus = {
            overdue: 'tool_inspection_overdue',
            failed: 'tool_inspection_failed',
            limited: 'tool_inspection_limited',
            reinspection_required: 'tool_reinspection_required',
            invalid: 'tool_inspection_invalid',
            not_recorded: 'tool_inspection_missing'
          };
          const error = new Error(`Equipment inspection is ${inspection.status.replace(/_/g, ' ')} and must be resolved before reservation`);
          error.statusCode = 409;
          error.code = codeByStatus[inspection.status] || 'tool_inspection_blocked';
          error.details = {
            toolId: tool.id,
            inspectionStatus: inspection.status,
            inspectionDueAt: inspection.dueAt,
            lastInspectionId: inspection.latestInspection?.id || null
          };
          throw error;
        }
        if (toolStatus !== 'available') {
          const error = new Error(`Equipment marked ${toolStatus.replace(/_/g, ' ')} cannot be reserved until it is available`);
          error.statusCode = 409;
          error.code = 'tool_unavailable';
          error.details = { toolId: tool.id, status: toolStatus };
          throw error;
        }
      }
      const requestedStatus = normalizeStatus(payload.status, 'reserved');
      if (['released', 'returned', 'cancelled', 'rejected', 'declined', 'completed', 'closed'].includes(requestedStatus)) {
        const error = new Error('Use the release endpoint to close a tool reservation');
        error.statusCode = 400;
        throw error;
      }
      const approvedStatus = ['reserved', 'in_use', 'scheduled', 'planned', 'approved'].includes(requestedStatus)
        ? requestedStatus
        : 'reserved';
      const { neededFrom, neededUntil } = this.normalizeToolReservationWindow(job, payload);
      const resolvedToolId = tool?.id || payload.toolId || null;
      const resolvedToolName = tool?.name || toolName;
      const conflicts = this.findToolReservationConflicts({
        toolId: resolvedToolId,
        toolName: resolvedToolName,
        neededFrom,
        neededUntil
      });
      const approvalReasons = this.toolReservationApprovalReasons(tool, payload, conflicts);
      const requiresApproval = approvalReasons.length > 0;
      const id = makeId('toolres');
      const timestamp = nowIso();
      const reservationData = {
        requestedCategory: payload.category || tool?.category || null,
        requestedStatus: approvedStatus,
        requestedBy: actor,
        notes: payload.notes || payload.reason || null,
        conflicts,
        conflictCount: conflicts.length,
        requiresApproval,
        approvalReasons
      };
      this.db.prepare(`
        INSERT INTO tool_reservations (id, job_id, tool_id, tool_name, status, needed_from, needed_until, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        resolvedToolId,
        resolvedToolName,
        requiresApproval ? 'pending_approval' : approvedStatus,
        neededFrom,
        neededUntil,
        toJson(reservationData),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'tool_reservation',
          targetId: id,
          jobId,
          approvalType: 'tool_reservation',
          summary: `Approve tool reservation for ${resolvedToolName}`,
          reason: approvalReasons.map(item => item.detail).join(' '),
          data: {
            reservationId: id,
            toolId: resolvedToolId,
            toolName: resolvedToolName,
            requestedStatus: approvedStatus,
            neededFrom,
            neededUntil,
            conflicts,
            approvalReasons
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE tool_reservations SET data_json = ?, updated_at = ? WHERE id = ?')
          .run(toJson({ ...reservationData, approvalId: approval.id }), nowIso(), id);
      }

      const reservation = this.mapToolReservation(this.db.prepare('SELECT * FROM tool_reservations WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({
          entityType: 'tool_reservation',
          entityId: id,
          jobId,
          action: requiresApproval ? 'propose_tool_reservation' : 'reserve_tool',
          actor,
          after: reservation,
          metadata: { approvalId: approval?.id || null, conflicts: conflicts.length }
        });
      }
      return {
        ...reservation,
        approval,
        conflicts,
        requiresApproval
      };
    });
  }

  releaseToolReservation(jobId, reservationId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId, { allowInactive: true });
      const actor = options.actor || payload.actor || 'dashboard';
      const row = this.db.prepare('SELECT * FROM tool_reservations WHERE id = ? AND job_id = ?').get(reservationId, jobId);
      if (!row) {
        const error = new Error('Tool reservation not found');
        error.statusCode = 404;
        throw error;
      }
      const status = normalizeStatus(payload.status, 'released');
      if (!['released', 'returned', 'cancelled'].includes(status)) {
        const error = new Error('Tool release status must be released, returned, or cancelled');
        error.statusCode = 400;
        throw error;
      }
      const timestamp = nowIso();
      const before = this.mapToolReservation(row);
      const data = fromJson(row.data_json, {});
      this.db.prepare(`
        UPDATE tool_reservations
        SET status = ?, data_json = ?, updated_at = ?
        WHERE id = ? AND job_id = ?
      `).run(
        status,
        toJson({
          ...data,
          releasedAt: payload.releasedAt || timestamp,
          releasedBy: actor,
          releaseReason: payload.reason || payload.notes || null
        }),
        timestamp,
        reservationId,
        jobId
      );
      const after = this.mapToolReservation(this.db.prepare('SELECT * FROM tool_reservations WHERE id = ?').get(reservationId));
      if (options.audit !== false) {
        this.audit({
          entityType: 'tool_reservation',
          entityId: reservationId,
          jobId,
          action: 'release_tool_reservation',
          actor,
          before,
          after
        });
      }
      return after;
    });
  }

  addMaterialRequirement(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const name = normalizeText(payload.name || payload.materialName || payload.material, 'Material');
    let material = null;
    if (payload.materialId) {
      material = this.db.prepare('SELECT * FROM materials WHERE id = ?').get(payload.materialId);
    }
    if (!material) {
      material = this.db.prepare('SELECT * FROM materials WHERE lower(name) = lower(?) LIMIT 1').get(name);
    }
    const id = makeId('matreq');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO material_requirements (id, job_id, material_id, name, quantity, unit, status, supplier, cost, needed_by, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      material?.id || null,
      material?.name || name,
      normalizeNumber(payload.quantity, 1),
      normalizeText(payload.unit || material?.unit, 'unit'),
      normalizeStatus(payload.status, 'needed'),
      payload.supplier || material?.supplier || null,
      normalizeNumber(payload.cost || payload.amount, 0),
      payload.neededBy || payload.needed_by || null,
      toJson({ sku: payload.sku || material?.sku || null }),
      timestamp,
      timestamp
    );
    const requirement = this.mapMaterialRequirement(this.db.prepare('SELECT * FROM material_requirements WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'material_requirement', entityId: id, jobId, action: 'create_material_requirement', actor: options.actor || 'Contractor.AI', after: requirement });
    }
    return requirement;
  }

  updateMaterialRequirementStatus(jobId, materialRequirementId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const allowedStatuses = new Set([
      'needed',
      'low_stock',
      'received',
      'available',
      'allocated',
      'loaded',
      'used',
      'cancelled'
    ]);
    const evidenceStatuses = new Set(['received', 'available', 'allocated', 'loaded', 'used']);
    const status = normalizeStatus(payload.status, '');
    const notes = normalizeText(payload.notes || payload.note, '');
    const verificationReference = normalizeText(
      payload.verificationReference || payload.verification_reference || payload.reference,
      ''
    );
    const availableQuantity = normalizeNumber(
      payload.availableQuantity ?? payload.available_quantity ?? payload.quantity,
      NaN
    );

    if (!allowedStatuses.has(status)) {
      const error = new Error('Unsupported internal material status');
      error.statusCode = 400;
      throw error;
    }
    if (!notes) {
      const error = new Error('Material status evidence is required');
      error.statusCode = 400;
      throw error;
    }
    if (evidenceStatuses.has(status) && !verificationReference) {
      const error = new Error('A material verification reference is required for this status');
      error.statusCode = 400;
      throw error;
    }
    if (Number.isFinite(availableQuantity) && availableQuantity < 0) {
      const error = new Error('Available material quantity cannot be negative');
      error.statusCode = 400;
      throw error;
    }

    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM material_requirements WHERE id = ? AND job_id = ?')
        .get(materialRequirementId, jobId);
      if (!row) {
        const error = new Error('Material requirement not found for this job');
        error.statusCode = 404;
        throw error;
      }

      const before = this.mapMaterialRequirement(row);
      const timestamp = nowIso();
      const existingData = fromJson(row.data_json, {});
      const effectiveQuantity = Number.isFinite(availableQuantity)
        ? availableQuantity
        : normalizeNumber(row.quantity, 0);
      if (evidenceStatuses.has(status) && !(effectiveQuantity > 0)) {
        const error = new Error('A positive verified material quantity is required for this status');
        error.statusCode = 400;
        throw error;
      }
      const history = Array.isArray(existingData.statusHistory) ? existingData.statusHistory.slice(-49) : [];
      const transition = {
        from: normalizeStatus(row.status, 'needed'),
        to: status,
        availableQuantity: effectiveQuantity,
        location: normalizeText(payload.location || existingData.location, '') || null,
        verificationReference: verificationReference || null,
        notes,
        recordedBy: options.actor || payload.actor || 'dashboard',
        recordedAt: timestamp,
        externalCommitments: 0
      };
      const data = {
        ...existingData,
        availableQuantity: effectiveQuantity,
        location: transition.location,
        verificationReference: transition.verificationReference,
        notes,
        lastStatusTransition: transition,
        statusHistory: [...history, transition]
      };

      this.db.prepare(`
        UPDATE material_requirements
        SET status = ?, data_json = ?, updated_at = ?
        WHERE id = ? AND job_id = ?
      `).run(status, toJson(data), timestamp, materialRequirementId, jobId);

      const after = this.mapMaterialRequirement(
        this.db.prepare('SELECT * FROM material_requirements WHERE id = ?').get(materialRequirementId)
      );
      if (options.audit !== false) {
        this.audit({
          entityType: 'material_requirement',
          entityId: materialRequirementId,
          jobId,
          action: 'record_material_status',
          actor: options.actor || payload.actor || 'dashboard',
          before,
          after,
          metadata: { status, verificationReference: verificationReference || null, externalCommitments: 0 }
        });
      }
      return after;
    });
  }

  defaultLoadItems(jobId) {
    const tools = this.db.prepare(`
      SELECT * FROM tool_reservations
      WHERE job_id = ?
        AND status NOT IN ('cancelled', 'released', 'returned', 'rejected', 'declined', 'completed', 'closed')
      ORDER BY created_at ASC
    `).all(jobId)
      .map(row => ({
        type: 'tool',
        name: row.tool_name,
        quantity: 1,
        status: row.status,
        sourceId: row.id,
        neededFrom: row.needed_from,
        neededUntil: row.needed_until
      }));
    const materials = this.db.prepare(`
      SELECT * FROM material_requirements
      WHERE job_id = ?
        AND status NOT IN ('cancelled', 'released', 'returned', 'rejected', 'declined', 'completed', 'closed')
      ORDER BY created_at ASC
    `).all(jobId)
      .map(row => ({
        type: 'material',
        name: row.name,
        quantity: normalizeNumber(row.quantity, 1),
        unit: row.unit,
        status: row.status,
        sourceId: row.id,
        supplier: row.supplier,
        neededBy: row.needed_by
      }));
    return [...tools, ...materials];
  }

  buildLoadingPlanPack(job, payload = {}) {
    const providedItems = normalizeList(payload.loadItems || payload.load_items || payload.items)
      .map(item => typeof item === 'string' ? { type: 'item', name: item, quantity: 1 } : item)
      .filter(item => item && item.name);
    const ledgerItems = this.defaultLoadItems(job.id);
    const loadItems = [];
    const seen = new Set();
    for (const item of [...providedItems, ...ledgerItems]) {
      const key = `${normalizeText(item.type, 'item').toLowerCase()}::${normalizeText(item.name, '').toLowerCase()}`;
      if (!item.name || seen.has(key)) continue;
      seen.add(key);
      loadItems.push(item);
    }

    const trailerInput = payload.trailerRequired ?? payload.trailer_required;
    const trailerRequired = trailerInput === undefined || trailerInput === null
      ? this.inferTrailerRequired(job, loadItems)
      : normalizeBoolean(trailerInput, false);
    const suppliedChecklist = normalizeList(payload.checklist || payload.checklistItems || payload.checklist_items);
    const checklist = suppliedChecklist.length
      ? suppliedChecklist
      : this.defaultLoadingChecklist(loadItems, trailerRequired);
    const toolCount = loadItems.filter(item => item.type === 'tool').length;
    const materialCount = loadItems.filter(item => item.type === 'material').length;
    const customCount = loadItems.length - toolCount - materialCount;
    const unresolvedMaterialCount = loadItems.filter(item =>
      item.type === 'material' && ['needed', 'low_stock', 'missing', 'backordered'].includes(normalizeStatus(item.status, 'needed'))
    ).length;
    const pendingApprovalCount = loadItems.filter(item => normalizeStatus(item.status, '') === 'pending_approval').length;
    const suppliers = [...new Set(loadItems.map(item => item.supplier).filter(Boolean))];

    return {
      loadItems,
      checklist,
      trailerRequired,
      readiness: {
        generatedFrom: ledgerItems.length ? 'tools_materials_ledger' : 'manual_payload',
        itemCounts: { tools: toolCount, materials: materialCount, custom: customCount, total: loadItems.length },
        unresolvedMaterialCount,
        pendingApprovalCount,
        suppliers,
        trailerRequired,
        approvalSafe: true,
        externalCommitments: 0,
        safetyChecks: checklist.filter(item => /ppe|vca|first-aid|trailer|strap|spill|safety/i.test(String(item))).length
      }
    };
  }

  inferTrailerRequired(job, loadItems = []) {
    const jobData = fromJson(job.data_json, {});
    const text = [
      job.title,
      job.description,
      job.city,
      job.region,
      jobData.service,
      jobData.jobType,
      jobData.category,
      ...loadItems.map(item => item.name)
    ].filter(Boolean).join(' ');
    if (/trailer|ladder|scaffold|steiger|compactor|plate|mixer|wheelbarrow|paving|fenc|renovat|demolition|debris|waste|soil|sand|gravel|tiles|timber|wood|green waste/i.test(text)) {
      return true;
    }
    return loadItems.length >= 4;
  }

  defaultLoadingChecklist(loadItems = [], trailerRequired = false) {
    const checklist = [
      'Confirm vehicle fuel or charge',
      'Check PPE, first-aid kit, and VCA-relevant safety gear',
      'Load required tools and charged batteries',
      'Load required materials and receipts folder',
      'Confirm waste bags, straps, and site protection'
    ];
    const tools = loadItems.filter(item => item.type === 'tool').slice(0, 8);
    const materials = loadItems.filter(item => item.type === 'material').slice(0, 8);
    for (const item of tools) {
      checklist.push(`Load reserved tool: ${item.name}`);
    }
    for (const item of materials) {
      const quantity = normalizeNumber(item.quantity, 1);
      const unit = item.unit || 'unit';
      checklist.push(`Confirm material: ${quantity} ${unit} ${item.name}`);
    }
    if (materials.some(item => ['needed', 'low_stock', 'missing', 'backordered'].includes(normalizeStatus(item.status, 'needed')))) {
      checklist.push('Confirm supplier pickup or delivery before departure');
    }
    if (trailerRequired) {
      checklist.push('Check trailer lights, coupling, brakes, license plate, straps, and load balance');
    }
    return [...new Set(checklist)];
  }

  defaultProcurementItems(jobId) {
    return this.db.prepare("SELECT * FROM material_requirements WHERE job_id = ? AND status IN ('needed', 'low_stock', 'ordered') ORDER BY created_at ASC")
      .all(jobId)
      .map(row => ({
        materialRequirementId: row.id,
        name: row.name,
        quantity: normalizeNumber(row.quantity, 1),
        unit: row.unit,
        supplier: row.supplier,
        cost: normalizeNumber(row.cost, 0)
      }));
  }

  createRoutePlan(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('route');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const routeRisk = normalizeStatus(payload.routeRisk || payload.riskLevel || payload.risk_level, 'normal');
      const needsApproval = payload.requiresApproval === true
        || ['high', 'critical'].includes(routeRisk)
        || ['approved', 'committed', 'dispatched'].includes(requestedStatus);
      const status = needsApproval && ['approved', 'committed', 'dispatched'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;
      const origin = payload.origin || payload.start || 'Depot / warehouse';
      const destination = normalizeText(payload.destination || payload.address || job.address || job.city || job.region, 'Job site');
      const waypoints = normalizeList(payload.waypoints || payload.stops)
        .map(item => typeof item === 'string' ? { label: item } : item);

      this.db.prepare(`
        INSERT INTO route_plans (id, job_id, origin, destination, waypoints_json, distance_km, duration_minutes, route_risk, status, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        origin,
        destination,
        toJson(waypoints, []),
        normalizeNumber(payload.distanceKm || payload.distance_km, 0),
        normalizeNumber(payload.durationMinutes || payload.duration_minutes, 0),
        routeRisk,
        status,
        toJson({
          notes: payload.notes || payload.note || null,
          mapProvider: payload.mapProvider || 'manual',
          accessWindow: payload.accessWindow || payload.access_window || null,
          parking: payload.parking || null,
          lowEmissionZone: normalizeBoolean(payload.lowEmissionZone || payload.low_emission_zone, false)
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'route_plan',
          targetId: id,
          jobId,
          approvalType: 'dispatch_route',
          summary: `Approve dispatch route for ${job.title}`,
          reason: ['high', 'critical'].includes(routeRisk)
            ? 'High-risk routing, access, or site logistics need human review before dispatch.'
            : 'Committed dispatch routing needs approval before it affects the crew or client plan.',
          data: { routeRisk, destination, requestedStatus }
        }, { actor, audit: false });
        this.db.prepare('UPDATE route_plans SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const routePlan = this.mapRoutePlan(this.db.prepare('SELECT * FROM route_plans WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'route_plan', entityId: id, jobId, action: 'create_route_plan', actor, after: routePlan });
      }
      return { ...routePlan, approval };
    });
  }

  createLoadingPlan(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('load');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const { loadItems, checklist, trailerRequired, readiness } = this.buildLoadingPlanPack(job, payload);
      const needsApproval = payload.requiresApproval === true
        || ['approved', 'dispatched'].includes(requestedStatus)
        || normalizeBoolean(payload.rentedVehicle || payload.rented_vehicle, false);
      const status = needsApproval && ['approved', 'dispatched'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO loading_plans (id, job_id, vehicle, trailer_required, checklist_json, load_items_json, status, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        payload.vehicle || payload.vehicleName || null,
        trailerRequired ? 1 : 0,
        toJson(checklist, []),
        toJson(loadItems, []),
        status,
        toJson({
          ...(payload.data && typeof payload.data === 'object' ? payload.data : {}),
          notes: payload.notes || payload.note || null,
          loadOwner: payload.loadOwner || payload.owner || actor,
          departureAt: payload.departureAt || payload.departure_at || job.scheduled_start || null,
          rentedVehicle: normalizeBoolean(payload.rentedVehicle || payload.rented_vehicle, false),
          readiness
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'loading_plan',
          targetId: id,
          jobId,
          approvalType: 'dispatch_loading',
          summary: `Approve loading plan for ${job.title}`,
          reason: 'Dispatching or renting vehicles/equipment needs human review before the crew plan is committed.',
          data: { trailerRequired, vehicle: payload.vehicle || null, requestedStatus }
        }, { actor, audit: false });
        this.db.prepare('UPDATE loading_plans SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const loadingPlan = this.mapLoadingPlan(this.db.prepare('SELECT * FROM loading_plans WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'loading_plan', entityId: id, jobId, action: 'create_loading_plan', actor, after: loadingPlan });
      }
      return { ...loadingPlan, approval };
    });
  }

  createProcurementOrder(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('procure');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const items = normalizeList(payload.items || payload.procurementItems || payload.materials)
        .map(item => typeof item === 'string' ? { name: item, quantity: 1, unit: 'unit' } : item);
      const procurementItems = items.length ? items : this.defaultProcurementItems(jobId);
      const inferredAmount = procurementItems.reduce((sum, item) => {
        const quantity = normalizeNumber(item.quantity, 1);
        const unitCost = normalizeNumber(item.unitCost || item.unit_cost || item.cost || item.amount, 0);
        return sum + (quantity * unitCost);
      }, 0);
      const amount = normalizeNumber(payload.amount || payload.total || payload.estimatedTotal || payload.estimated_total, inferredAmount);
      const currency = normalizeText(payload.currency, 'EUR').toUpperCase();
      const approvalThreshold = normalizeNumber(payload.approvalThreshold || payload.approval_threshold, 250);
      const commitmentStatus = ['approved', 'ordered', 'submitted', 'sent', 'ready_to_order'].includes(requestedStatus);
      const needsApproval = payload.requiresApproval === true
        || commitmentStatus
        || amount >= approvalThreshold;
      const status = needsApproval && commitmentStatus ? 'pending_approval' : requestedStatus;
      const suppliedName = payload.supplier || payload.vendor || procurementItems.find(item => item.supplier)?.supplier || null;
      const tradePartner = this.resolveTradePartnerForSpend(payload, suppliedName);
      const supplier = tradePartner?.name || suppliedName;
      const partnerSnapshot = this.tradePartnerComplianceSnapshot(tradePartner);

      this.db.prepare(`
        INSERT INTO procurement_orders (id, job_id, supplier, status, currency, amount, required_by, approval_id, items_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        supplier,
        status,
        currency,
        amount,
        payload.requiredBy || payload.required_by || payload.neededBy || payload.needed_by || job.scheduled_start || null,
        null,
        toJson(procurementItems, []),
        toJson({
          notes: payload.notes || payload.note || null,
          purchaseMode: payload.purchaseMode || payload.purchase_mode || 'manual_purchase',
          orderReference: payload.orderReference || payload.order_reference || null,
          approvalThreshold,
          tradePartnerId: tradePartner?.id || null,
          partnerComplianceRequired: true,
          partnerComplianceSnapshot: partnerSnapshot
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'procurement_order',
          targetId: id,
          jobId,
          approvalType: 'procurement_spend',
          summary: `Approve procurement ${id} for ${amount.toFixed(2)} ${currency}`,
          reason: 'Material spending and purchase orders require approval before order placement or supplier commitment.',
          data: {
            requestedStatus,
            previousStatus: 'draft',
            amount,
            currency,
            supplier,
            tradePartnerId: tradePartner?.id || null,
            partnerCompliance: partnerSnapshot
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE procurement_orders SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const procurementOrder = this.mapProcurementOrder(this.db.prepare('SELECT * FROM procurement_orders WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'procurement_order', entityId: id, jobId, action: 'create_procurement_order', actor, after: procurementOrder });
      }
      return { ...procurementOrder, approval };
    });
  }

  requestProcurementApproval(jobId, procurementOrderId, payload = {}, options = {}) {
    const job = this.requireJob(jobId);
    const actor = options.actor || 'Contractor.AI';
    return this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM procurement_orders WHERE id = ? AND job_id = ?').get(procurementOrderId, jobId);
      if (!row) {
        const error = new Error('Procurement order not found for this job');
        error.statusCode = 404;
        throw error;
      }
      const currentStatus = normalizeStatus(row.status, 'draft');
      if (!['draft', 'pending', 'needs_review', 'pending_approval'].includes(currentStatus)) {
        const error = new Error('Only a retained procurement draft can be submitted for approval');
        error.statusCode = 409;
        throw error;
      }

      const pending = this.db.prepare(`
        SELECT * FROM approvals
        WHERE target_type = 'procurement_order' AND target_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(procurementOrderId);
      if (pending) {
        return {
          procurementOrder: this.mapProcurementOrder(row),
          approval: this.mapApproval(pending),
          approvalRequired: true,
          reused: true
        };
      }

      const requestedSupplier = normalizeText(payload.supplier || payload.vendor || row.supplier, '');
      const existingData = fromJson(row.data_json, {});
      const tradePartner = this.resolveTradePartnerForSpend({ ...existingData, ...payload }, requestedSupplier);
      if (!tradePartner) {
        const error = new Error('Select a retained trade partner before requesting procurement approval');
        error.statusCode = 400;
        error.code = 'trade_partner_required';
        throw error;
      }
      const supplier = tradePartner.name;
      const partnerSnapshot = this.tradePartnerComplianceSnapshot(tradePartner);
      const amount = normalizeNumber(payload.amount ?? payload.total, row.amount);
      const requiredBy = payload.requiredBy || payload.required_by || row.required_by;
      const items = payload.items || payload.materials
        ? normalizeList(payload.items || payload.materials).map(item => typeof item === 'string' ? { name: item, quantity: 1, unit: 'unit' } : item)
        : fromJson(row.items_json, []);
      const notes = normalizeText(payload.notes || payload.note, '');
      if (!supplier || !(amount > 0) || !requiredBy || !items.length || !notes) {
        const error = new Error('Supplier, positive amount, required-by date, retained items, and approval evidence are required');
        error.statusCode = 400;
        throw error;
      }

      const timestamp = nowIso();
      const requestedStatus = 'ready_to_order';
      const approval = this.createApproval({
        targetType: 'procurement_order',
        targetId: procurementOrderId,
        jobId,
        approvalType: 'procurement_spend',
        summary: `Approve procurement ${procurementOrderId} for ${amount.toFixed(2)} ${normalizeText(row.currency, 'EUR').toUpperCase()}`,
        reason: 'Material spending and supplier commitment require explicit approval before order placement.',
        data: {
          requestedStatus,
          previousStatus: currentStatus === 'pending_approval' ? 'draft' : currentStatus,
          amount,
          currency: normalizeText(row.currency, 'EUR').toUpperCase(),
          supplier,
          tradePartnerId: tradePartner.id,
          partnerCompliance: partnerSnapshot,
          notes
        }
      }, { actor, audit: false });
      const nextData = {
        ...existingData,
        requestedStatus,
        tradePartnerId: tradePartner.id,
        partnerComplianceRequired: true,
        partnerComplianceSnapshot: partnerSnapshot,
        approvalRequest: {
          supplier,
          amount,
          requiredBy,
          notes,
          requestedBy: actor,
          requestedAt: timestamp
        }
      };
      this.db.prepare(`
        UPDATE procurement_orders
        SET supplier = ?, status = 'pending_approval', amount = ?, required_by = ?, approval_id = ?, items_json = ?, data_json = ?, updated_at = ?
        WHERE id = ? AND job_id = ?
      `).run(supplier, amount, requiredBy, approval.id, toJson(items, []), toJson(nextData), timestamp, procurementOrderId, jobId);
      const procurementOrder = this.mapProcurementOrder(this.db.prepare('SELECT * FROM procurement_orders WHERE id = ?').get(procurementOrderId));
      this.audit({
        entityType: 'procurement_order',
        entityId: procurementOrderId,
        jobId,
        action: 'request_procurement_approval',
        actor,
        before: this.mapProcurementOrder(row),
        after: procurementOrder,
        metadata: { approvalId: approval.id, externalCommitments: 0, jobTitle: job.title }
      });
      return { procurementOrder, approval, approvalRequired: true, reused: false };
    });
  }

  createWorkerInstruction(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('instruction');
      const timestamp = nowIso();
      const assignment = this.resolveCrewAssignment(jobId, payload);
      const audience = normalizeStatus(payload.audience, 'crew');
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const externalAudience = ['client', 'external', 'subcontractor', 'supplier'].includes(audience);
      const commitmentStatus = ['approved', 'sent', 'published', 'dispatched'].includes(requestedStatus);
      const needsApproval = payload.requiresApproval === true || externalAudience || commitmentStatus;
      const status = needsApproval && commitmentStatus ? 'pending_approval' : requestedStatus;
      const defaultBody = [
        `Job: ${job.title}`,
        `Location: ${job.address || job.city || 'confirm location'}`,
        `Scope: ${job.description || 'review job scope before departure'}`,
        'Confirm tools, materials, photos, safety controls, and client access before starting.'
      ].join('\n');

      this.db.prepare(`
        INSERT INTO worker_instructions (id, job_id, assignment_id, audience, channel, title, body, status, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        assignment?.id || null,
        audience,
        normalizeStatus(payload.channel, 'app'),
        normalizeText(payload.title || payload.subject, `Dispatch instructions: ${job.title}`),
        payload.body || payload.message || defaultBody,
        status,
        toJson({
          notes: payload.notes || payload.note || null,
          language: payload.language || 'nl',
          safetyNotes: payload.safetyNotes || payload.safety_notes || null,
          arrivalWindow: payload.arrivalWindow || payload.arrival_window || null,
          assignmentId: assignment?.id || null,
          workerId: assignment?.workerId || payload.workerId || payload.worker_id || null,
          workerName: assignment?.workerName || payload.workerName || payload.worker_name || null
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'worker_instruction',
          targetId: id,
          jobId,
          approvalType: externalAudience ? 'external_instruction' : 'dispatch_instruction',
          summary: `Approve instruction "${normalizeText(payload.title || payload.subject, job.title)}"`,
          reason: externalAudience
            ? 'Instructions for external audiences can create commitments and need approval before publishing.'
            : 'Published crew instructions need approval before they affect the committed dispatch plan.',
          data: {
            audience,
            requestedStatus,
            assignmentId: assignment?.id || null,
            workerId: assignment?.workerId || payload.workerId || payload.worker_id || null
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE worker_instructions SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const instruction = this.mapWorkerInstruction(this.db.prepare('SELECT * FROM worker_instructions WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'worker_instruction', entityId: id, jobId, action: 'create_worker_instruction', actor, after: instruction });
      }
      return { ...instruction, approval };
    });
  }

  createDispatchPack(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const job = this.requireJob(jobId);
      const routePlan = this.createRoutePlan(jobId, {
        origin: payload.origin || payload.dispatchOrigin || 'Depot / warehouse',
        destination: payload.destination || job.address || job.city || 'Job site',
        waypoints: payload.waypoints || payload.stops || [],
        distanceKm: payload.distanceKm || payload.distance_km,
        durationMinutes: payload.durationMinutes || payload.duration_minutes,
        routeRisk: payload.routeRisk || payload.riskLevel || 'normal',
        status: payload.routeStatus || 'draft',
        notes: payload.routeNotes || payload.notes || 'Dispatch route drafted from the job operating ledger.'
      }, { actor, audit: false });
      const loadingPlan = this.createLoadingPlan(jobId, {
        vehicle: payload.vehicle || payload.vehicleName || 'Work van',
        trailerRequired: payload.trailerRequired || payload.trailer_required || false,
        loadItems: payload.loadItems || payload.load_items,
        checklist: payload.checklist,
        status: payload.loadingStatus || 'draft',
        departureAt: payload.departureAt || payload.departure_at,
        notes: payload.loadingNotes || payload.notes || 'Load plan drafted from tools and material needs.'
      }, { actor, audit: false });
      const procurementOrder = this.createProcurementOrder(jobId, {
        supplier: payload.procurementSupplier || payload.supplier,
        status: payload.procurementStatus || 'draft',
        amount: payload.procurementAmount || payload.amount,
        currency: payload.currency || 'EUR',
        requiredBy: payload.requiredBy || payload.required_by || job.scheduled_start,
        items: payload.procurementItems || payload.items,
        notes: payload.procurementNotes || 'Procurement draft created from material requirements. No order has been placed.'
      }, { actor, audit: false });
      const workerInstruction = this.createWorkerInstruction(jobId, {
        assignmentId: payload.assignmentId || payload.assignment_id,
        audience: payload.audience || 'crew',
        channel: payload.channel || 'app',
        status: payload.workerInstructionStatus || payload.instructionStatus || 'draft',
        title: payload.workerInstructionTitle || payload.instructionTitle || `Dispatch brief: ${job.title}`,
        body: payload.workerInstructionBody || payload.instructionBody,
        notes: payload.instructionNotes || payload.notes || 'Generated as part of the dispatch pack.'
      }, { actor, audit: false });

      let weather = null;
      const hasWeather = this.db.prepare('SELECT id FROM schedule_weather WHERE job_id = ? LIMIT 1').get(jobId);
      if (!hasWeather && payload.createWeatherCheck !== false) {
        const weatherId = makeId('weather');
        this.db.prepare(`
          INSERT INTO schedule_weather (id, job_id, location, forecast_at, condition, precipitation_percent, recommendation, data_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          weatherId,
          jobId,
          job.city || job.region || job.address || 'Netherlands',
          job.scheduled_start || nowIso(),
          payload.weatherCondition || 'planning_required',
          normalizeNumber(payload.precipitationPercent || payload.precipitation_percent, 20),
          payload.weatherRecommendation || 'Confirm weather and access before field start.',
          toJson({ source: 'dispatch_pack' }),
          nowIso()
        );
        weather = this.mapWeather(this.db.prepare('SELECT * FROM schedule_weather WHERE id = ?').get(weatherId));
      }

      const dispatchPack = {
        jobId,
        routePlan,
        loadingPlan,
        procurementOrder,
        workerInstruction,
        weather
      };
      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'create_dispatch_pack',
        actor,
        after: {
          routePlanId: routePlan.id,
          loadingPlanId: loadingPlan.id,
          procurementOrderId: procurementOrder.id,
          workerInstructionId: workerInstruction.id,
          weatherId: weather?.id || null
        },
        metadata: { source: 'dispatch_pack' }
      });
      return dispatchPack;
    });
  }

  prepareScheduleDispatch(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      this.requireJob(jobId);
      const detail = this.getJobDetail(jobId, { includeAudit: false });
      const recommendationBefore = this.recommendSchedule(jobId, payload, { actor, audit: false });
      const actionTypes = new Set((recommendationBefore.nextActions || []).map(action => action.type));
      const missing = new Set(recommendationBefore.missing || []);
      const inactiveStatuses = new Set(['cancelled', 'canceled', 'rejected', 'declined', 'void', 'deleted']);
      const hasUsable = records => Array.isArray(records)
        && records.some(record => record && !inactiveStatuses.has(normalizeStatus(record.status, 'draft')));
      const created = [];
      const skipped = [];
      const approvals = [];
      const plannedStart = payload.plannedStart || payload.planned_start || recommendationBefore.plannedStart || detail.scheduledStart || futureIsoDate(1);
      const activeAssignments = (detail.assignments || []).filter(assignment => this.activeAssignmentStatus(assignment.status));
      const crewEvidence = this.crewEvidenceReadiness(detail);
      const materialRequirements = detail.materials || [];
      const primaryMaterial = materialRequirements.find(Boolean);
      const shouldPrepareSafety = actionTypes.has('prepare_safety_pack')
        || actionTypes.has('complete_safety_pack')
        || missing.has('safety_pack');
      const shouldPrepareSiteAccess = actionTypes.has('prepare_site_access')
        || actionTypes.has('complete_site_orientation')
        || actionTypes.has('clear_site_access')
        || missing.has('site_access');

      const addCreated = (type, record) => {
        const approvalId = record?.approvalId || record?.approval?.id || null;
        created.push({
          type,
          id: record.id,
          status: record.status,
          approvalId
        });
        if (record?.approval?.id) {
          approvals.push(record.approval);
        } else if (approvalId) {
          const approvalRow = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
          if (approvalRow) {
            approvals.push(this.mapApproval(approvalRow));
          }
        }
      };
      const addSkipped = (type, reason) => skipped.push({ type, reason });

      if (actionTypes.has('create_route_plan') || missing.has('route_plan')) {
        if (hasUsable(detail.routePlans)) {
          addSkipped('route_plan', 'active_record_exists');
        } else {
          const routePlan = this.createRoutePlan(jobId, {
            origin: payload.origin || payload.dispatchOrigin || 'Depot / warehouse',
            destination: payload.destination || detail.address || detail.city || 'Job site',
            routeRisk: payload.routeRisk || payload.riskLevel || detail.riskLevel || 'normal',
            status: 'draft',
            notes: 'Schedule-prep draft route. Confirm live route, parking, access windows, and LEZ constraints before dispatch.'
          }, { actor, audit: false });
          addCreated('route_plan', routePlan);
        }
      }

      if (actionTypes.has('create_loading_plan') || missing.has('loading_plan')) {
        if (hasUsable(detail.loadingPlans)) {
          addSkipped('loading_plan', 'active_record_exists');
        } else {
          const loadingPlan = this.createLoadingPlan(jobId, {
            vehicle: payload.vehicle || payload.vehicleName || 'Work van',
            trailerRequired: normalizeBoolean(
              payload.trailerRequired ?? payload.trailer_required,
              /garden|pav|fence|waste|renovation|construction/i.test(`${detail.jobType} ${detail.title} ${detail.description}`)
                || materialRequirements.length >= 3
            ),
            status: 'draft',
            departureAt: payload.departureAt || payload.departure_at || plannedStart,
            notes: 'Schedule-prep loading draft from reserved tools and material requirements.'
          }, { actor, audit: false });
          addCreated('loading_plan', loadingPlan);
        }
      }

      if (actionTypes.has('plan_procurement') || missing.has('procurement_plan')) {
        if (hasUsable(detail.procurementOrders) || hasUsable(detail.purchaseOrders)) {
          addSkipped('procurement_order', 'active_record_exists');
        } else if (!materialRequirements.length) {
          addSkipped('procurement_order', 'no_material_requirements');
        } else {
          const procurementOrder = this.createProcurementOrder(jobId, {
            supplier: payload.supplier || payload.procurementSupplier || primaryMaterial?.supplier || null,
            status: 'draft',
            requiredBy: payload.requiredBy || payload.required_by || plannedStart,
            approvalThreshold: Number.MAX_SAFE_INTEGER,
            notes: 'Schedule-prep procurement draft. No supplier order, spend, or external commitment has been made.'
          }, { actor, audit: false });
          addCreated('procurement_order', procurementOrder);
        }
      }

      if (actionTypes.has('draft_worker_instruction') || missing.has('worker_instruction')) {
        if (!activeAssignments.length) {
          addSkipped('worker_instruction', 'active_assignment_required');
        } else {
          for (const item of crewEvidence.items) {
            if (item.instruction) {
              addSkipped('worker_instruction', 'current_assignment_record_exists');
              continue;
            }
            const instructionBody = [
              `Job: ${detail.title}`,
              `Location: ${detail.address || detail.city || 'confirm location'}`,
              `Assigned worker: ${item.workerName}`,
              `Planned start: ${plannedStart || 'confirm start'}`,
              `Scope: ${detail.description || 'review job scope before departure'}`,
              'Before leaving: confirm route, load list, materials, PPE, access gate, and photo evidence plan.',
              'Do not promise extra work, client timing, or material ordering without Robert approval.'
            ].join('\n');
            const instruction = this.createWorkerInstruction(jobId, {
              assignmentId: item.assignmentId,
              workerId: item.workerId,
              audience: 'crew',
              channel: 'app',
              status: 'draft',
              title: `Schedule-prep dispatch brief: ${detail.title}`,
              body: instructionBody,
              notes: 'Internal draft generated from the schedule recommendation.'
            }, { actor, audit: false });
            addCreated('worker_instruction', instruction);
          }
        }
      }

      if (shouldPrepareSafety) {
        if (hasUsable(detail.safetyMeetings)) {
          addSkipped('safety_meeting', 'active_record_exists');
        } else {
          const safetyMeeting = this.createSafetyMeeting(jobId, {
            status: 'scheduled',
            meetingType: 'pre_task_talk',
            title: 'Schedule-prep toolbox talk',
            scheduledAt: plannedStart,
            topics: ['Work method', 'PPE and VCA controls', 'Site access', 'Stop-work triggers'],
            notes: 'Internal safety talk draft. Record attendees, site-specific risks, stop-work triggers, and approve completion after the talk.'
          }, { actor, audit: false });
          addCreated('safety_meeting', safetyMeeting);
        }

        if (hasUsable(detail.jhas)) {
          addSkipped('jha_record', 'active_record_exists');
        } else {
          const jha = this.createJhaRecord(jobId, {
            status: 'draft',
            title: 'Schedule-prep job hazard analysis',
            riskLevel: detail.riskLevel || 'medium',
            assignee: actor,
            dueAt: plannedStart,
            hazards: ['Site access constraints', 'Manual handling', 'Tool and material handling'],
            controls: ['Confirm method before work', 'Brief crew before start', 'Stop work on changed conditions'],
            notes: 'Internal JHA draft. Approval is required before field reliance.'
          }, { actor, audit: false });
          addCreated('jha_record', jha);
        }

        if (materialRequirements.length && !hasUsable(detail.sdsSheets)) {
          const sdsSheet = this.createSdsSheet(jobId, {
            status: 'requested',
            material: primaryMaterial?.name || 'Site materials SDS register',
            supplier: primaryMaterial?.supplier || null,
            notes: 'SDS requested during schedule prep for planned job materials.'
          }, { actor, audit: false });
          addCreated('sds_sheet', sdsSheet);
        } else if (!materialRequirements.length) {
          addSkipped('sds_sheet', 'no_material_requirements');
        } else {
          addSkipped('sds_sheet', 'active_record_exists');
        }
      }

      if (shouldPrepareSiteAccess) {
        if (!activeAssignments.length) {
          addSkipped('worker_orientation', 'active_assignment_required');
          addSkipped('site_access_log', 'active_assignment_required');
        } else {
          for (const item of crewEvidence.items) {
            let orientation = item.orientation;
            if (orientation) {
              addSkipped('worker_orientation', 'current_assignment_record_exists');
            } else {
              orientation = this.createWorkerOrientation(jobId, {
                assignmentId: item.assignmentId,
                workerId: item.workerId,
                status: 'scheduled',
                workerName: item.workerName,
                company: 'Internal crew',
                language: 'nl',
                dueAt: plannedStart,
                topics: ['Site rules', 'PPE and VCA controls', 'Emergency contacts', 'Access boundaries'],
                notes: 'Internal orientation draft. Complete site rules, PPE/VCA controls, emergency contacts, and approval before clearing site access.'
              }, { actor, audit: false });
              addCreated('worker_orientation', orientation);
            }

            if (item.siteAccess) {
              addSkipped('site_access_log', 'current_assignment_record_exists');
            } else {
              const siteAccess = this.createSiteAccessLog(jobId, {
                assignmentId: item.assignmentId,
                workerId: item.workerId,
                orientationId: orientation?.id || null,
                workerName: item.workerName,
                company: orientation?.company || 'Internal crew',
                status: 'blocked',
                orientationValid: false,
                accessPoint: payload.accessPoint || payload.access_point || 'Main site access',
                notes: 'Internal access gate. Remains blocked until orientation is completed and site access is approved.'
              }, { actor, audit: false });
              addCreated('site_access_log', siteAccess);
            }
          }
        }
      }

      const recommendationAfter = this.recommendSchedule(jobId, payload, { actor, audit: false });
      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'prepare_schedule_dispatch',
        actor,
        after: {
          recommendationStatusBefore: recommendationBefore.status,
          recommendationStatusAfter: recommendationAfter.status,
          created,
          skipped
        },
        metadata: { source: 'schedule_recommendation' }
      });

      return {
        jobId,
        recommendationBefore,
        recommendationAfter,
        created,
        skipped,
        approvals,
        job: this.getJobDetail(jobId, { includeAudit: true })
      };
    });
  }

  requestScheduleApproval(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const detail = this.getJobDetail(jobId, { includeAudit: false });
      const recommendation = this.recommendSchedule(jobId, payload, { actor, audit: false });
      if (!recommendation.plannedStart || !recommendation.plannedEnd) {
        const error = new Error('plannedStart is required before requesting schedule approval');
        error.statusCode = 400;
        throw error;
      }
      const activeAssignments = (detail.assignments || []).filter(assignment => this.activeAssignmentStatus(assignment.status));
      const includeWorkerAssignment = payload.includeWorkerAssignment !== false
        && payload.include_worker_assignment !== false
        && activeAssignments.length === 0
        && recommendation.recommendedWorker?.id;
      const proposedAssignment = includeWorkerAssignment
        ? {
            workerId: recommendation.recommendedWorker.id,
            workerName: recommendation.recommendedWorker.name,
            role: recommendation.recommendedWorker.role || 'Contractor',
            status: 'planned',
            scheduledStart: recommendation.plannedStart,
            scheduledEnd: recommendation.plannedEnd,
            allocationHours: recommendation.estimatedHours
          }
        : null;

      const currentStatus = normalizeStatus(detail.status, 'planned');
      const currentPhase = normalizeStatus(detail.phase, currentStatus);
      const patch = {
        scheduledStart: recommendation.plannedStart,
        scheduledEnd: recommendation.plannedEnd,
        approvalState: 'schedule_pending_approval'
      };
      if (!['in_progress', 'completed', 'closed', 'cancelled'].includes(currentStatus)) {
        patch.status = 'scheduled';
      }
      if (!['in_progress', 'closeout', 'closed'].includes(currentPhase)) {
        patch.phase = 'scheduled';
      }

      const existing = this.db.prepare(`
        SELECT * FROM approvals
        WHERE job_id = ?
          AND target_type = 'schedule_commitment'
          AND status = 'pending'
        ORDER BY created_at DESC
      `).all(jobId).find(row => {
        const data = fromJson(row.data_json, {});
        return data?.patch?.scheduledStart === patch.scheduledStart
          && data?.patch?.scheduledEnd === patch.scheduledEnd;
      });
      if (existing) {
        return {
          status: 'existing',
          requiresApproval: true,
          approval: this.mapApproval(existing),
          recommendation,
          proposedPatch: patch,
          proposedAssignment: fromJson(existing.data_json, {}).proposedAssignment || null,
          job: this.getJobDetail(jobId, { includeAudit: true })
        };
      }

      const approvalId = makeId('approval');
      const readiness = recommendation.readiness || {};
      const gateSummary = [
        readiness.approvals?.status && readiness.approvals.status !== 'ready' ? `approvals: ${readiness.approvals.status}` : null,
        readiness.procurement?.status && !['ready', 'not_required'].includes(readiness.procurement.status) ? `procurement: ${readiness.procurement.status}` : null,
        readiness.siteAccess?.status && !['ready', 'not_required'].includes(readiness.siteAccess.status) ? `site access: ${readiness.siteAccess.status}` : null,
        readiness.safety?.status && !['ready', 'not_required'].includes(readiness.safety.status) ? `safety: ${readiness.safety.status}` : null,
        readiness.weather?.status && !['checked', 'not_required'].includes(readiness.weather.status) ? `weather: ${readiness.weather.status}` : null
      ].filter(Boolean);
      const approval = this.createApproval({
        id: approvalId,
        targetType: 'schedule_commitment',
        targetId: approvalId,
        jobId,
        approvalType: 'schedule_commitment',
        summary: `Approve schedule for ${detail.title}`,
        reason: [
          `Proposed window: ${recommendation.plannedStart} to ${recommendation.plannedEnd}.`,
          proposedAssignment?.workerName
            ? `Approval also creates an internal planned assignment for ${proposedAssignment.workerName}.`
            : recommendation.recommendedWorker?.name
              ? `Recommended worker: ${recommendation.recommendedWorker.name}.`
              : null,
          gateSummary.length ? `Open gates remain: ${gateSummary.join(', ')}.` : 'No open readiness gates were detected.',
          'Procurement, access, safety, and external communication approvals remain separate.'
        ].filter(Boolean).join(' '),
        data: {
          jobId,
          patch,
          proposedAssignment,
          recommendation,
          blockers: recommendation.blockers || [],
          warnings: recommendation.warnings || [],
          nextActions: recommendation.nextActions || [],
          requestedBy: actor,
          requestedReason: payload.reason || payload.notes || null
        }
      }, { actor, audit: false });

      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'request_schedule_approval',
        actor,
        before: detail,
        after: { approvalId: approval.id, patch, proposedAssignment, recommendationStatus: recommendation.status },
        metadata: { approvalId: approval.id }
      });

      return {
        status: 'approval_requested',
        requiresApproval: true,
        approval,
        recommendation,
        proposedPatch: patch,
        proposedAssignment,
        job: this.getJobDetail(jobId, { includeAudit: true })
      };
    });
  }

  addProgressUpdate(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const before = this.requireJob(jobId);
      const timestamp = nowIso();
      const progressPercent = Math.max(0, Math.min(100, normalizeNumber(payload.progressPercent ?? payload.progress_percent, before.progress_percent || 0)));
      const status = normalizeStatus(payload.status, before.status || 'note');
      const note = normalizeText(payload.note || payload.notes, '');
      const weather = normalizeText(payload.weather, '');
      const blockers = normalizeList(payload.blockers);
      const photos = normalizeList(payload.photos);
      const entryKey = normalizeText(payload.entryKey || payload.entry_key, '');
      if (entryKey && !/^[A-Za-z0-9._:-]{8,200}$/.test(entryKey)) {
        const error = new Error('Progress entry key must contain 8 to 200 safe characters');
        error.statusCode = 400;
        error.code = 'progress_entry_key_invalid';
        throw error;
      }
      const entryFingerprint = entryKey
        ? crypto.createHash('sha256').update(JSON.stringify({ status, progressPercent, note, weather, blockers, photos })).digest('hex')
        : null;

      if (entryKey) {
        const existing = this.db.prepare('SELECT * FROM progress_updates WHERE job_id = ? ORDER BY created_at DESC')
          .all(jobId)
          .map(row => this.mapProgress(row))
          .find(update => update.data?.entryKey === entryKey);
        if (existing) {
          if (existing.data?.entryFingerprint !== entryFingerprint) {
            const error = new Error('Progress entry key was already used for different content');
            error.statusCode = 409;
            error.code = 'progress_entry_key_reused';
            throw error;
          }
          return { ...existing, replayed: true };
        }
      }

      const id = makeId('progress');
      this.db.prepare(`
        INSERT INTO progress_updates (id, job_id, status, progress_percent, note, weather, blockers_json, photos_json, created_by, data_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        status,
        progressPercent,
        note || null,
        weather || null,
        toJson(blockers, []),
        toJson(photos, []),
        payload.createdBy || payload.created_by || options.actor || 'Contractor.AI',
        toJson({
          source: payload.source || 'manual',
          entryKey: entryKey || null,
          entryFingerprint
        }),
        timestamp
      );
      const nextJobStatus = ['intake', 'planned', 'scheduled', 'in_progress', 'blocked', 'completed'].includes(status) ? status : before.status;
      this.db.prepare('UPDATE jobs SET status = ?, phase = ?, progress_percent = ?, updated_at = ? WHERE id = ?')
        .run(nextJobStatus, nextJobStatus === 'completed' ? 'closeout' : nextJobStatus, progressPercent, timestamp, jobId);
      const update = this.mapProgress(this.db.prepare('SELECT * FROM progress_updates WHERE id = ?').get(id));
      if (options.audit !== false) {
        const after = this.getJobRow(jobId);
        this.audit({
          entityType: 'progress_update',
          entityId: id,
          jobId,
          action: 'record_progress',
          actor: options.actor || 'Contractor.AI',
          before: this.mapJob(before),
          after: { job: this.mapJob(after), update },
          metadata: { entryKey: entryKey || null, externalCommitments: 0 }
        });
      }
      return { ...update, replayed: false };
    });
  }

  updateJob(jobId, payload = {}, options = {}) {
    const before = this.requireJob(jobId, { allowInactive: options.allowInactive === true });
    const actor = options.actor || 'Contractor.AI';
    const timestamp = nowIso();
    const currentData = fromJson(before.data_json);
    const progressPercent = Math.max(0, Math.min(100, normalizeNumber(
      payload.progressPercent ?? payload.progress_percentage ?? payload.progress ?? before.progress_percent,
      before.progress_percent
    )));
    const nextStatus = payload.status !== undefined
      ? normalizeStatus(payload.status, before.status)
      : before.status;
    const nextPhase = payload.phase !== undefined
      ? normalizeStatus(payload.phase, before.phase)
      : nextStatus !== before.status
        ? (nextStatus === 'completed' ? 'closeout' : nextStatus)
        : before.phase;
    const nextData = {
      ...currentData,
      ...(payload.data || {}),
      legacyId: payload.legacyId ?? payload.legacy_id ?? currentData.legacyId ?? null,
      legacyUpdatedAt: payload.legacyUpdatedAt ?? currentData.legacyUpdatedAt ?? null
    };

    this.db.prepare(`
      UPDATE jobs
      SET title = ?, job_type = ?, description = ?, address = ?, city = ?, region = ?, country = ?, priority = ?, status = ?, phase = ?,
        risk_level = ?, estimated_hours = ?, estimated_cost = ?, contract_value = ?, margin_target_percent = ?, progress_percent = ?,
        scheduled_start = ?, scheduled_end = ?, target_completion = ?, approval_state = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      normalizeText(payload.title ?? before.title, before.title),
      normalizeText(payload.jobType ?? payload.job_type ?? payload.service ?? before.job_type, 'general'),
      payload.description ?? before.description,
      payload.address ?? payload.location ?? before.address,
      payload.city ?? before.city,
      payload.region ?? payload.province ?? before.region,
      normalizeText(payload.country ?? before.country, 'NL'),
      normalizePriority(payload.priority ?? before.priority),
      nextStatus,
      nextPhase,
      normalizeText(payload.riskLevel ?? payload.risk_level ?? before.risk_level, 'normal'),
      normalizeNumber(payload.estimatedHours ?? payload.estimated_hours ?? before.estimated_hours, 0),
      normalizeNumber(payload.estimatedCost ?? payload.estimated_cost ?? before.estimated_cost, 0),
      normalizeNumber(payload.contractValue ?? payload.contract_value ?? payload.value ?? before.contract_value, 0),
      normalizeNumber(payload.marginTargetPercent ?? payload.margin_target_percent ?? before.margin_target_percent, 20),
      progressPercent,
      rowDate(payload.scheduledStart ?? payload.scheduled_start ?? payload.startDate ?? before.scheduled_start),
      rowDate(payload.scheduledEnd ?? payload.scheduled_end ?? payload.estimatedCompletion ?? before.scheduled_end),
      rowDate(payload.targetCompletion ?? payload.target_completion ?? payload.estimatedCompletion ?? before.target_completion),
      normalizeStatus(payload.approvalState ?? payload.approval_state ?? before.approval_state, 'pending'),
      toJson(nextData),
      timestamp,
      jobId
    );

    const after = this.getJobDetail(jobId, { includeAudit: false });
    if (options.audit !== false) {
      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'update_job',
        actor,
        before: this.mapJob(before),
        after: after.job
      });
    }
    return after;
  }

  buildJobUpdatePatch(payload = {}) {
    const patch = {};
    const read = (...keys) => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          return payload[key];
        }
      }
      return undefined;
    };
    const assign = (field, keys) => {
      const value = read(...keys);
      if (value !== undefined) {
        patch[field] = value;
      }
    };

    assign('title', ['title']);
    assign('jobType', ['jobType', 'job_type', 'service']);
    assign('description', ['description', 'scope']);
    assign('address', ['address', 'location']);
    assign('city', ['city']);
    assign('region', ['region', 'province']);
    assign('country', ['country']);
    assign('priority', ['priority']);
    assign('status', ['status']);
    assign('phase', ['phase']);
    assign('riskLevel', ['riskLevel', 'risk_level']);
    assign('estimatedHours', ['estimatedHours', 'estimated_hours']);
    assign('estimatedCost', ['estimatedCost', 'estimated_cost']);
    assign('contractValue', ['contractValue', 'contract_value', 'value']);
    assign('marginTargetPercent', ['marginTargetPercent', 'margin_target_percent']);
    assign('progressPercent', ['progressPercent', 'progress_percentage', 'progress']);
    assign('scheduledStart', ['scheduledStart', 'scheduled_start', 'plannedStart', 'planned_start', 'startDate']);
    assign('scheduledEnd', ['scheduledEnd', 'scheduled_end', 'plannedEnd', 'planned_end']);
    assign('targetCompletion', ['targetCompletion', 'target_completion', 'estimatedCompletion']);
    assign('approvalState', ['approvalState', 'approval_state']);

    if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
      patch.data = payload.data;
    }

    return patch;
  }

  jobUpdateApprovalReasons(before, patch = {}, payload = {}) {
    const reasons = [];
    const addReason = (type, detail) => {
      if (!reasons.some(reason => reason.type === type)) {
        reasons.push({ type, detail });
      }
    };
    const has = field => Object.prototype.hasOwnProperty.call(patch, field);
    const differentText = (field, current) => has(field) && String(patch[field] ?? '') !== String(current ?? '');
    const differentNumber = (field, current) => has(field) && normalizeNumber(patch[field], current) !== normalizeNumber(current, 0);

    if (normalizeBoolean(payload.requiresApproval, false)) {
      addReason('requested_approval', 'The caller explicitly requested a human approval gate.');
    }

    if (has('status')) {
      const nextStatus = normalizeStatus(patch.status, before.status);
      if (nextStatus !== before.status) {
        if (['scheduled', 'in_progress', 'completed', 'cancelled', 'accepted', 'closed'].includes(nextStatus)) {
          addReason('lifecycle_commitment', `Status would change from ${before.status} to ${nextStatus}.`);
        } else if (['scheduled', 'in_progress'].includes(before.status)) {
          addReason('active_job_status_change', `Active job status would change from ${before.status} to ${nextStatus}.`);
        }
      }
    }

    if (
      differentText('scheduledStart', before.scheduled_start)
      || differentText('scheduledEnd', before.scheduled_end)
      || differentText('targetCompletion', before.target_completion)
    ) {
      addReason('schedule_commitment', 'The proposed update changes a planned or promised date.');
    }

    if (
      differentText('description', before.description)
      || differentText('jobType', before.job_type)
      || differentText('address', before.address)
    ) {
      addReason('scope_or_site_change', 'The proposed update changes scope, service type, or job-site location.');
    }

    if (
      differentNumber('estimatedCost', before.estimated_cost)
      || differentNumber('contractValue', before.contract_value)
      || differentNumber('estimatedHours', before.estimated_hours)
      || differentNumber('marginTargetPercent', before.margin_target_percent)
    ) {
      addReason('commercial_change', 'The proposed update changes labor, estimate, margin, or contract value.');
    }

    if (has('progressPercent')) {
      const nextProgress = Math.max(0, Math.min(100, normalizeNumber(patch.progressPercent, before.progress_percent)));
      if (nextProgress >= 100 && normalizeNumber(before.progress_percent, 0) < 100) {
        addReason('completion_progress', 'The proposed update marks the job as fully complete.');
      }
    }

    return reasons;
  }

  updateJobWithApproval(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const before = this.requireJob(jobId, { allowInactive: true });
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const patch = this.buildJobUpdatePatch(payload);
      const patchKeys = Object.keys(patch).filter(key => patch[key] !== undefined);
      if (!patchKeys.length) {
        const error = new Error('No supported job update fields were provided');
        error.statusCode = 400;
        throw error;
      }

      const currentStatus = normalizeStatus(before.status, 'intake');
      const requestedStatus = Object.prototype.hasOwnProperty.call(patch, 'status')
        ? normalizeStatus(patch.status, currentStatus)
        : currentStatus;
      const requestedPhase = Object.prototype.hasOwnProperty.call(patch, 'phase')
        ? normalizeStatus(patch.phase, before.phase || currentStatus)
        : normalizeStatus(before.phase, currentStatus);
      if (['archived', 'pending_archive_approval'].includes(requestedStatus) || requestedPhase === 'archived') {
        const error = new Error('Use the dedicated job archive request so retention safeguards and approval evidence are recorded.');
        error.statusCode = 400;
        error.code = 'job_archive_route_required';
        throw error;
      }
      if (
        ['archived', 'pending_archive_approval'].includes(currentStatus)
        && (requestedStatus !== currentStatus || requestedPhase !== normalizeStatus(before.phase, currentStatus))
      ) {
        const error = new Error('Use the dedicated job restore request so the retained pre-archive state is recovered through approval.');
        error.statusCode = 400;
        error.code = 'job_restore_route_required';
        throw error;
      }

      const reasons = this.jobUpdateApprovalReasons(before, patch, payload);
      if (!reasons.length) {
        const job = this.updateJob(jobId, patch, { actor });
        return {
          status: 'updated',
          requiresApproval: false,
          reasons,
          proposedPatch: patch,
          job
        };
      }

      const approvalId = makeId('approval');
      const approval = this.createApproval({
        id: approvalId,
        targetType: 'job_update',
        targetId: approvalId,
        jobId,
        approvalType: 'job_update',
        summary: `Approve job update for ${before.title}`,
        reason: reasons.map(item => item.detail).join(' '),
        data: {
          jobId,
          patch,
          reasons,
          before: this.mapJob(before),
          requestedBy: actor,
          requestedReason: payload.reason || payload.notes || null
        }
      }, { actor, audit: false });

      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'propose_job_update',
        actor,
        before: this.mapJob(before),
        after: { approvalId: approval.id, patch, reasons },
        metadata: { approvalId: approval.id }
      });

      return {
        status: 'pending_approval',
        requiresApproval: true,
        reasons,
        proposedPatch: patch,
        approval,
        job: this.getJobDetail(jobId, { includeAudit: false })
      };
    });
  }

  requestJobArchive(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const before = this.requireJob(jobId, { allowInactive: true });
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const reason = normalizeText(payload.reason || payload.notes, '');
      if (reason.length < 8) {
        const error = new Error('A specific archive reason of at least 8 characters is required.');
        error.statusCode = 400;
        error.code = 'job_archive_reason_required';
        throw error;
      }

      const currentStatus = normalizeStatus(before.status, 'intake');
      if (['archived', 'pending_archive_approval'].includes(currentStatus)) {
        const error = new Error('This job is already archived. Use the restore workflow to return it to its retained state.');
        error.statusCode = 409;
        error.code = 'job_already_archived';
        throw error;
      }

      const pending = this.db.prepare(`
        SELECT * FROM approvals
        WHERE job_id = ? AND status = 'pending'
        ORDER BY created_at ASC
      `).all(jobId);
      const existing = pending.find(row => row.target_type === 'job_archive');
      if (existing) {
        return {
          status: 'pending_approval',
          requiresApproval: true,
          replayed: true,
          externalCommitments: 0,
          approval: this.mapApproval(existing),
          job: this.getJobDetail(jobId, { includeAudit: false })
        };
      }
      const blockers = pending.filter(row => !['job_archive', 'job_restore'].includes(row.target_type));
      if (blockers.length) {
        const error = new Error(`Resolve ${blockers.length} pending job approval${blockers.length === 1 ? '' : 's'} before requesting archive.`);
        error.statusCode = 409;
        error.code = 'job_archive_blocked_by_approvals';
        error.details = {
          blockerCount: blockers.length,
          blockers: blockers.slice(0, 20).map(row => ({ id: row.id, targetType: row.target_type, summary: row.summary }))
        };
        throw error;
      }
      if (pending.some(row => row.target_type === 'job_restore')) {
        const error = new Error('A restore decision is already pending for this job.');
        error.statusCode = 409;
        error.code = 'job_lifecycle_conflict';
        throw error;
      }

      const approvalId = makeId('approval');
      const requestedAt = nowIso();
      const activePortalAccess = this.activeClientPortalAccess(jobId);
      const approval = this.createApproval({
        id: approvalId,
        targetType: 'job_archive',
        targetId: approvalId,
        jobId,
        approvalType: 'job_archive',
        summary: `Archive job: ${before.title}`,
        reason,
        data: {
          operation: 'archive',
          jobId,
          jobTitle: before.title,
          reason,
          previousStatus: currentStatus,
          previousPhase: normalizeStatus(before.phase, currentStatus),
          activePortalAccessCount: activePortalAccess.length,
          activePortalAccessIds: activePortalAccess.map(access => access.id),
          requestedAt,
          requestedBy: actor,
          externalCommitments: 0
        }
      }, { actor, audit: false });

      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'request_job_archive',
        actor,
        before: this.mapJob(before),
        after: { approvalId: approval.id, status: 'pending_approval', reason },
        metadata: { approvalId: approval.id, externalCommitments: 0 }
      });

      return {
        status: 'pending_approval',
        requiresApproval: true,
        replayed: false,
        externalCommitments: 0,
        approval,
        job: this.getJobDetail(jobId, { includeAudit: false })
      };
    });
  }

  requestJobRestore(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const before = this.requireJob(jobId, { allowInactive: true });
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const reason = normalizeText(payload.reason || payload.notes, '');
      if (reason.length < 8) {
        const error = new Error('A specific restore reason of at least 8 characters is required.');
        error.statusCode = 400;
        error.code = 'job_restore_reason_required';
        throw error;
      }

      const currentStatus = normalizeStatus(before.status, 'intake');
      if (!['archived', 'pending_archive_approval'].includes(currentStatus)) {
        const error = new Error('Only an archived job can be restored.');
        error.statusCode = 409;
        error.code = 'job_not_archived';
        throw error;
      }

      const pending = this.db.prepare(`
        SELECT * FROM approvals
        WHERE job_id = ? AND status = 'pending'
        ORDER BY created_at ASC
      `).all(jobId);
      const existing = pending.find(row => row.target_type === 'job_restore');
      if (existing) {
        return {
          status: 'pending_approval',
          requiresApproval: true,
          replayed: true,
          externalCommitments: 0,
          approval: this.mapApproval(existing),
          job: this.getJobDetail(jobId, { includeAudit: false })
        };
      }
      const blockers = pending.filter(row => !['job_archive', 'job_restore'].includes(row.target_type));
      if (blockers.length || pending.some(row => row.target_type === 'job_archive')) {
        const count = blockers.length + (pending.some(row => row.target_type === 'job_archive') ? 1 : 0);
        const error = new Error(`Resolve ${count} pending job lifecycle decision${count === 1 ? '' : 's'} before requesting restore.`);
        error.statusCode = 409;
        error.code = 'job_restore_blocked_by_approvals';
        error.details = {
          blockerCount: count,
          blockers: pending.slice(0, 20).map(row => ({ id: row.id, targetType: row.target_type, summary: row.summary }))
        };
        throw error;
      }

      const jobData = fromJson(before.data_json, {});
      const archive = jobData.archive && typeof jobData.archive === 'object' && !Array.isArray(jobData.archive)
        ? jobData.archive
        : {};
      const allowedStatuses = new Set(['intake', 'planning', 'planned', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled', 'canceled']);
      const retainedStatus = normalizeStatus(archive.previousStatus, 'intake');
      const restoreStatus = allowedStatuses.has(retainedStatus) ? retainedStatus : 'intake';
      const retainedPhase = normalizeStatus(archive.previousPhase, restoreStatus);
      const restorePhase = ['archived', 'pending_archive_approval'].includes(retainedPhase) ? restoreStatus : retainedPhase;
      const approvalId = makeId('approval');
      const requestedAt = nowIso();
      const approval = this.createApproval({
        id: approvalId,
        targetType: 'job_restore',
        targetId: approvalId,
        jobId,
        approvalType: 'job_restore',
        summary: `Restore job: ${before.title}`,
        reason,
        data: {
          operation: 'restore',
          jobId,
          jobTitle: before.title,
          reason,
          restoreStatus,
          restorePhase,
          archivedAt: archive.approvedAt || archive.archivedAt || before.updated_at,
          archiveApprovalId: archive.approvalId || null,
          requestedAt,
          requestedBy: actor,
          externalCommitments: 0
        }
      }, { actor, audit: false });

      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'request_job_restore',
        actor,
        before: this.mapJob(before),
        after: { approvalId: approval.id, status: 'pending_approval', restoreStatus, restorePhase, reason },
        metadata: { approvalId: approval.id, archiveApprovalId: archive.approvalId || null, externalCommitments: 0 }
      });

      return {
        status: 'pending_approval',
        requiresApproval: true,
        replayed: false,
        externalCommitments: 0,
        approval,
        job: this.getJobDetail(jobId, { includeAudit: false })
      };
    });
  }

  addCommunication(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const id = makeId('comm');
      const actor = options.actor || 'Contractor.AI';
      const timestamp = nowIso();
      const direction = normalizeStatus(payload.direction, 'outbound');
      const status = normalizeStatus(payload.status, direction === 'outbound' ? 'draft' : 'received');
      const requiresApproval = payload.requiresApproval !== false && direction === 'outbound' && !['approved', 'sent'].includes(status);
      const communicationData = {
        ...(payload.data || {}),
        recipient: payload.recipient || null,
        expectsReply: normalizeBoolean(payload.expectsReply ?? payload.expects_reply ?? payload.replyRequired ?? payload.reply_required, false),
        replyBy: payload.replyBy || payload.reply_by || payload.dueAt || payload.due_at || null,
        followUpFor: payload.followUpFor || payload.follow_up_for || null,
        followUpSource: payload.followUpSource || payload.follow_up_source || null
      };
      this.db.prepare(`
        INSERT INTO communication_records (id, job_id, client_id, channel, direction, subject, body, status, sent_at, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        payload.clientId || payload.client_id || job.client_id,
        normalizeText(payload.channel, 'portal'),
        direction,
        payload.subject || null,
        payload.body || payload.message || null,
        status,
        payload.sentAt || payload.sent_at || null,
        toJson(communicationData),
        timestamp,
        timestamp
      );

      let approval = null;
      if (requiresApproval) {
        approval = this.createApproval({
          targetType: 'communication',
          targetId: id,
          jobId,
          approvalType: 'external_communication',
          summary: `Approve ${payload.channel || 'portal'} update before sending`,
          reason: 'External communication must be approved before it can be sent.',
          data: { subject: payload.subject || null, channel: payload.channel || 'portal' }
        }, { actor, audit: false });
        this.db.prepare('UPDATE communication_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const communication = this.mapCommunication(this.db.prepare('SELECT * FROM communication_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'communication', entityId: id, jobId, action: 'create_communication', actor, after: communication });
      }
      return { ...communication, approval };
    });
  }

  recordCommunicationDelivery(communicationId, payload = {}, options = {}) {
    const row = this.db.prepare('SELECT * FROM communication_records WHERE id = ?').get(String(communicationId || ''));
    if (!row) {
      const error = new Error('Communication record not found');
      error.statusCode = 404;
      throw error;
    }
    if (normalizeStatus(row.direction, '') !== 'outbound') {
      const error = new Error('Only outbound communications can receive a delivery receipt.');
      error.statusCode = 409;
      throw error;
    }
    const approval = row.approval_id
      ? this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(row.approval_id)
      : null;
    if (!approval || normalizeStatus(approval.status, '') !== 'approved') {
      const error = new Error('The communication approval must be resolved before external delivery is recorded.');
      error.statusCode = 409;
      error.code = 'communication_approval_required';
      throw error;
    }

    const existing = this.mapCommunication(row);
    if (['sent', 'delivered'].includes(normalizeStatus(existing.status, ''))) return existing;

    const integration = normalizeText(payload.integration, '');
    if (!integration) {
      const error = new Error('A verified integration identifier is required.');
      error.statusCode = 400;
      throw error;
    }
    const sentAt = payload.sentAt || payload.sent_at || nowIso();
    const data = {
      ...(existing.data || {}),
      deliveryReceipt: {
        integration,
        providerMessageId: payload.providerMessageId || payload.provider_message_id || null,
        receivedAt: nowIso(),
        receipt: payload.receipt || null
      }
    };
    this.db.prepare(`
      UPDATE communication_records
      SET status = 'sent', sent_at = ?, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(sentAt, toJson(data), nowIso(), row.id);
    const communication = this.mapCommunication(this.db.prepare('SELECT * FROM communication_records WHERE id = ?').get(row.id));
    this.audit({
      entityType: 'communication',
      entityId: row.id,
      jobId: row.job_id,
      action: 'record_communication_delivery',
      actor: options.actor || 'verified_integration',
      before: existing,
      after: communication,
      metadata: { integration, providerMessageId: data.deliveryReceipt.providerMessageId }
    });
    return communication;
  }

  addDocument(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const id = makeId('doc');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO documents (id, job_id, type, title, filename, mime_type, size_bytes, storage_ref, status, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      normalizeText(payload.type, 'document'),
      normalizeText(payload.title || payload.filename || payload.name, 'Document'),
      payload.filename || payload.name || null,
      payload.mimeType || payload.mime_type || null,
      Math.max(0, Math.round(normalizeNumber(payload.sizeBytes || payload.size_bytes || payload.size, 0))),
      payload.storageRef || payload.storage_ref || payload.url || null,
      normalizeStatus(payload.status, 'stored'),
      toJson({ tags: payload.tags || [], analysis: payload.analysis || null }),
      timestamp,
      timestamp
    );
    const document = this.mapDocument(this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'document', entityId: id, jobId, action: 'store_document', actor: options.actor || 'Contractor.AI', after: document });
    }
    return document;
  }

  getDocument(documentId) {
    const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(String(documentId || ''));
    if (!row) {
      const error = new Error('Document not found');
      error.statusCode = 404;
      throw error;
    }
    return this.mapDocument(row);
  }

  addTimeLog(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const hours = normalizeNumber(payload.hours, 0);
    const rate = normalizeNumber(payload.rate || payload.hourlyRate || payload.hourly_rate, 0);
    if (!(hours > 0 && hours <= 24)) {
      const error = new Error('Time log hours must be greater than zero and no more than 24');
      error.statusCode = 400;
      throw error;
    }
    if (rate < 0) {
      const error = new Error('Time log rate cannot be negative');
      error.statusCode = 400;
      throw error;
    }
    const id = makeId('time');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO time_logs (id, job_id, worker_id, work_date, hours, billable, rate, status, notes, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      payload.workerId || payload.worker_id || null,
      payload.workDate || payload.work_date || nowIso().slice(0, 10),
      hours,
      payload.billable === false ? 0 : 1,
      rate,
      normalizeStatus(payload.status, 'submitted'),
      payload.notes || null,
      toJson({
        costCode: payload.costCode || payload.cost_code || null,
        workerName: payload.workerName || payload.worker_name || null,
        verificationReference: payload.verificationReference || payload.verification_reference || payload.reference || null,
        source: payload.source || null,
        entryKey: payload.entryKey || payload.entry_key || null,
        entryFingerprint: payload.entryFingerprint || payload.entry_fingerprint || null
      }),
      timestamp,
      timestamp
    );
    const timeLog = this.mapTimeLog(this.db.prepare('SELECT * FROM time_logs WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'time_log', entityId: id, jobId, action: 'record_time', actor: options.actor || 'Contractor.AI', after: timeLog });
    }
    return timeLog;
  }

  recordFieldDailyLog(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const workDate = normalizeText(payload.workDate || payload.work_date, nowIso().slice(0, 10));
      const parsedWorkDate = Date.parse(`${workDate}T00:00:00.000Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !Number.isFinite(parsedWorkDate)
        || new Date(parsedWorkDate).toISOString().slice(0, 10) !== workDate) {
        const error = new Error('Daily site log work date must be a valid calendar date');
        error.statusCode = 400;
        error.code = 'daily_log_work_date_invalid';
        throw error;
      }

      const hours = normalizeNumber(payload.hours, 0);
      if (!(hours > 0 && hours <= 24)) {
        const error = new Error('Daily site log hours must be greater than zero and no more than 24');
        error.statusCode = 400;
        error.code = 'daily_log_hours_invalid';
        throw error;
      }
      const workCompleted = normalizeText(payload.workCompleted || payload.work_completed || payload.notes, '');
      if (workCompleted.length < 3) {
        const error = new Error('Daily site log completed work must contain at least three characters');
        error.statusCode = 400;
        error.code = 'daily_log_work_required';
        throw error;
      }

      const manpower = Math.round(normalizeNumber(payload.manpower, 1));
      if (!(manpower > 0 && manpower <= 500)) {
        const error = new Error('Daily site log manpower must be between 1 and 500');
        error.statusCode = 400;
        error.code = 'daily_log_manpower_invalid';
        throw error;
      }

      const workerId = normalizeText(payload.workerId || payload.worker_id, '') || null;
      const worker = workerId ? this.getWorker(workerId) : null;
      if (worker?.status === 'retired') {
        const error = new Error('Retired workers cannot submit new daily site logs');
        error.statusCode = 409;
        error.code = 'daily_log_worker_retired';
        throw error;
      }
      const workerName = normalizeText(payload.workerName || payload.worker_name || worker?.name, 'Field worker');
      const blockers = normalizeList(payload.blockers);
      const safetyConcern = normalizeBoolean(payload.safetyConcern ?? payload.safety_concern, false)
        || ['concern', 'unsafe', 'incident'].includes(normalizeStatus(payload.safetyStatus || payload.safety_status, 'clear'));
      const safetyNotes = normalizeText(payload.safetyNotes || payload.safety_notes, '');
      if (safetyConcern && safetyNotes.length < 5) {
        const error = new Error('Describe the safety concern before submitting the daily site log');
        error.statusCode = 400;
        error.code = 'daily_log_safety_notes_required';
        throw error;
      }
      const safetyRiskLevel = safetyConcern
        ? normalizePriority(payload.safetyRiskLevel || payload.safety_risk_level || 'high')
        : 'normal';
      const weather = normalizeText(payload.weather, 'clear');
      const entryKey = normalizeText(payload.entryKey || payload.entry_key, makeId('daily'));
      if (!/^[A-Za-z0-9._:-]{8,200}$/.test(entryKey)) {
        const error = new Error('Daily site log entry key must contain 8 to 200 safe characters');
        error.statusCode = 400;
        error.code = 'daily_log_entry_key_invalid';
        throw error;
      }
      const entryFingerprint = crypto.createHash('sha256').update(JSON.stringify({
        workerId,
        workDate,
        hours,
        manpower,
        weather,
        workCompleted,
        blockers,
        safetyConcern,
        safetyRiskLevel,
        safetyNotes
      })).digest('hex');

      const existingDetail = this.getJobDetail(jobId);
      const existingFieldReport = existingDetail.fieldReports.find(report => report.data?.entryKey === entryKey);
      if (existingFieldReport) {
        if (existingFieldReport.data?.entryFingerprint !== entryFingerprint) {
          const error = new Error('Daily site log entry key was already used for different content');
          error.statusCode = 409;
          error.code = 'daily_log_entry_key_reused';
          throw error;
        }
        const existingTimeLog = existingDetail.timeLogs.find(log => log.data?.entryKey === entryKey);
        const existingSafetyCheck = existingDetail.safetyChecks.find(check => check.data?.entryKey === entryKey);
        if (!existingTimeLog || !existingSafetyCheck) {
          const error = new Error('Daily site log replay evidence is incomplete and requires operator review');
          error.statusCode = 409;
          error.code = 'daily_log_replay_incomplete';
          throw error;
        }
        return {
          entryKey,
          jobId: job.id,
          fieldReport: existingFieldReport,
          timeLog: existingTimeLog,
          safetyCheck: existingSafetyCheck,
          approvals: [existingFieldReport.approvalId, existingSafetyCheck.approvalId].filter(Boolean),
          externalCommitments: 0,
          replayed: true
        };
      }

      const fieldReport = this.createFieldReport(jobId, {
        reportDate: workDate,
        status: 'submitted',
        requiresApproval: true,
        source: 'daily_site_log',
        entryKey,
        entryFingerprint,
        workerId,
        workerName,
        weather,
        manpower,
        workCompleted,
        blockers,
        notes: safetyConcern ? `Safety concern recorded: ${safetyNotes}` : 'Daily field safety state recorded as clear.',
        safetyStatus: safetyConcern ? 'concern' : 'clear'
      }, { actor, audit: false });
      const timeLog = this.addTimeLog(jobId, {
        workerId,
        workerName,
        workDate,
        hours,
        rate: normalizeNumber(payload.rate || payload.hourlyRate || payload.hourly_rate || worker?.hourlyRate, 0),
        billable: payload.billable !== false,
        status: 'submitted',
        costCode: payload.costCode || payload.cost_code || 'labor',
        source: 'daily_site_log',
        entryKey,
        entryFingerprint,
        notes: workCompleted
      }, { actor, audit: false });
      const safetyCheck = this.addSafetyCheck(jobId, {
        checkType: 'daily_site_safety',
        title: `Daily safety check: ${workDate}`,
        status: safetyConcern ? 'pending_review' : 'recorded',
        riskLevel: safetyRiskLevel,
        requiresApproval: safetyConcern,
        assignee: workerName,
        notes: safetyConcern ? safetyNotes : 'No safety concern reported in the daily site log.',
        hazards: safetyConcern ? normalizeList(payload.hazards || safetyNotes) : [],
        source: 'daily_site_log',
        entryKey,
        entryFingerprint,
        workDate
      }, { actor, audit: false });

      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'record_field_daily_log',
        actor,
        after: {
          entryKey,
          workDate,
          workerId,
          workerName,
          fieldReportId: fieldReport.id,
          fieldReportApprovalId: fieldReport.approvalId || null,
          timeLogId: timeLog.id,
          safetyCheckId: safetyCheck.id,
          safetyApprovalId: safetyCheck.approval?.id || null,
          safetyConcern,
          externalCommitments: 0
        }
      });

      return {
        entryKey,
        jobId: job.id,
        fieldReport,
        timeLog,
        safetyCheck,
        approvals: [fieldReport.approvalId, safetyCheck.approval?.id].filter(Boolean),
        externalCommitments: 0,
        replayed: false
      };
    });
  }

  addExpense(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const amount = normalizeNumber(payload.amount, 0);
    const status = normalizeStatus(payload.status, 'submitted');
    if (!(amount > 0) && status !== 'draft') {
      const error = new Error('Expense amount must be greater than zero');
      error.statusCode = 400;
      throw error;
    }
    const id = makeId('expense');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO expenses (id, job_id, category, amount, currency, vendor, receipt_ref, status, notes, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      normalizeText(payload.category, 'general'),
      amount,
      normalizeText(payload.currency, 'EUR').toUpperCase(),
      payload.vendor || null,
      payload.receiptRef || payload.receipt_ref || null,
      status,
      payload.notes || null,
      toJson({ costCode: payload.costCode || payload.cost_code || null }),
      timestamp,
      timestamp
    );
    const expense = this.mapExpense(this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'expense', entityId: id, jobId, action: 'record_expense', actor: options.actor || 'Contractor.AI', after: expense });
    }
    return expense;
  }

  recordJobCosts(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const actor = options.actor || payload.actor || 'Contractor.AI';
    const timePayload = payload.timeLog || payload.time || {};
    const expensePayload = payload.expense || {};
    const hasTime = normalizeNumber(timePayload.hours, 0) > 0;
    const hasExpense = normalizeNumber(expensePayload.amount, 0) > 0;
    if (!hasTime && !hasExpense) {
      const error = new Error('Record at least one positive time or expense amount');
      error.statusCode = 400;
      throw error;
    }

    return this.transaction(() => {
      const timeLog = hasTime ? this.addTimeLog(jobId, timePayload, { actor, audit: false }) : null;
      const expense = hasExpense ? this.addExpense(jobId, expensePayload, { actor, audit: false }) : null;
      const result = { timeLog, expense };
      if (options.audit !== false) {
        this.audit({
          entityType: 'job',
          entityId: jobId,
          jobId,
          action: 'record_finance_costs',
          actor,
          after: {
            timeLogId: timeLog?.id || null,
            expenseId: expense?.id || null,
            hours: timeLog?.hours || 0,
            expenseAmount: expense?.amount || 0
          }
        });
      }
      return result;
    });
  }

  createInvoice(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const quote = payload.quoteId || payload.quote_id
        ? this.db.prepare('SELECT * FROM quotes WHERE id = ? AND job_id = ?').get(payload.quoteId || payload.quote_id, jobId)
        : this.db.prepare("SELECT * FROM quotes WHERE job_id = ? ORDER BY created_at DESC LIMIT 1").get(jobId);
      const amount = normalizeNumber(payload.amount, quote?.subtotal || 0);
      const taxAmount = normalizeNumber(payload.taxAmount || payload.tax_amount, quote?.tax_amount || amount * 0.21);
      const total = normalizeNumber(payload.total, quote?.total || amount + taxAmount);
      const id = makeId('invoice');
      const timestamp = nowIso();
      this.db.prepare(`
        INSERT INTO invoices (id, job_id, quote_id, status, currency, amount, tax_amount, total, due_at, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        quote?.id || null,
        normalizeStatus(payload.status, 'draft'),
        normalizeText(payload.currency || quote?.currency, 'EUR').toUpperCase(),
        amount,
        taxAmount,
        total,
        payload.dueAt || payload.due_at || null,
        toJson({ peppolReady: payload.peppolReady === true, notes: payload.notes || null }),
        timestamp,
        timestamp
      );
      const approval = this.createApproval({
        targetType: 'invoice',
        targetId: id,
        jobId,
        approvalType: 'invoice_issue',
        summary: `Approve invoice ${id} for ${total.toFixed(2)} ${normalizeText(payload.currency || quote?.currency, 'EUR').toUpperCase()}`,
        reason: 'Invoices and Peppol/UBL submissions require approval before issue.',
        data: { total, quoteId: quote?.id || null }
      }, { actor: options.actor || 'Contractor.AI', audit: false });
      this.db.prepare('UPDATE invoices SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      const invoice = this.mapInvoice(this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'invoice', entityId: id, jobId, action: 'create_invoice', actor: options.actor || 'Contractor.AI', after: invoice });
      }
      return invoice;
    });
  }

  rankedLearningItems(rows = [], keySelector, valueBuilder, max = 8) {
    const counts = new Map();
    for (const row of rows) {
      const key = normalizeText(typeof keySelector === 'function' ? keySelector(row) : row?.[keySelector], '').toLowerCase();
      if (!key) continue;
      const current = counts.get(key) || { count: 0, item: typeof valueBuilder === 'function' ? valueBuilder(row) : { name: key } };
      current.count += 1;
      counts.set(key, current);
    }
    return [...counts.values()]
      .sort((left, right) => right.count - left.count || String(left.item.title || left.item.name || '').localeCompare(String(right.item.title || right.item.name || '')))
      .slice(0, max)
      .map(entry => ({ ...entry.item, frequency: entry.count }));
  }

  learningJobTypesNeedingRefresh(limit = 10) {
    return this.db.prepare(`
      SELECT jobs.job_type AS job_type, COUNT(jobs.id) AS sample_count, MAX(jobs.updated_at) AS latest_job_update, MAX(profiles.updated_at) AS profile_updated_at
      FROM jobs
      LEFT JOIN job_learning_profiles profiles ON profiles.job_type = jobs.job_type
      WHERE jobs.status IN ('completed', 'closed')
      GROUP BY jobs.job_type
      HAVING COUNT(jobs.id) > 0
        AND (MAX(profiles.updated_at) IS NULL OR MAX(jobs.updated_at) > MAX(profiles.updated_at))
      ORDER BY latest_job_update DESC
      LIMIT ?
    `).all(safeLimit(limit, 10, 50));
  }

  rebuildLearningProfile(jobType, options = {}) {
    const actor = options.actor || 'Contractor.AI';
    const normalizedType = normalizeStatus(jobType, 'general');
    const timestamp = nowIso();
    const jobs = this.db.prepare(`
      SELECT * FROM jobs
      WHERE job_type = ?
        AND status IN ('completed', 'closed')
      ORDER BY updated_at DESC
      LIMIT 100
    `).all(normalizedType);

    if (!jobs.length) {
      const error = new Error(`No completed jobs are available for ${normalizedType}`);
      error.statusCode = 404;
      throw error;
    }

    const jobIds = jobs.map(job => job.id);
    const placeholders = jobIds.map(() => '?').join(',');
    const sumByJob = (rows, idKey, valueKey) => {
      const map = new Map();
      for (const row of rows) {
        map.set(row[idKey], normalizeNumber(row[valueKey], 0));
      }
      return map;
    };
    const average = values => {
      const valid = values.map(value => normalizeNumber(value, 0)).filter(value => value > 0);
      return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
    };

    const tasks = this.db.prepare(`SELECT * FROM job_tasks WHERE job_id IN (${placeholders})`).all(...jobIds);
    const tools = this.db.prepare(`SELECT * FROM tool_reservations WHERE job_id IN (${placeholders}) AND status NOT IN ('cancelled', 'released')`).all(...jobIds);
    const materials = this.db.prepare(`SELECT * FROM material_requirements WHERE job_id IN (${placeholders}) AND status NOT IN ('cancelled')`).all(...jobIds);
    const quotes = this.db.prepare(`SELECT * FROM quotes WHERE job_id IN (${placeholders}) AND status NOT IN ('cancelled', 'rejected')`).all(...jobIds);
    const timeRows = this.db.prepare(`
      SELECT job_id, SUM(hours) AS hours
      FROM time_logs
      WHERE job_id IN (${placeholders})
        AND status NOT IN ('cancelled', 'rejected')
      GROUP BY job_id
    `).all(...jobIds);
    const expenseRows = this.db.prepare(`
      SELECT job_id, SUM(amount) AS amount
      FROM expenses
      WHERE job_id IN (${placeholders})
        AND status NOT IN ('cancelled', 'rejected')
      GROUP BY job_id
    `).all(...jobIds);
    const invoiceRows = this.db.prepare(`
      SELECT job_id, SUM(total) AS total
      FROM invoices
      WHERE job_id IN (${placeholders})
        AND status NOT IN ('cancelled', 'rejected')
      GROUP BY job_id
    `).all(...jobIds);
    const assignmentRows = this.db.prepare(`
      SELECT assignments.worker_id, workers.name AS worker_name, COUNT(assignments.id) AS assignment_count
      FROM assignments
      LEFT JOIN workers ON workers.id = assignments.worker_id
      WHERE assignments.job_id IN (${placeholders})
        AND assignments.status NOT IN ('cancelled', 'rejected', 'declined')
      GROUP BY assignments.worker_id, workers.name
      ORDER BY assignment_count DESC
      LIMIT 8
    `).all(...jobIds);

    const actualHoursByJob = sumByJob(timeRows, 'job_id', 'hours');
    const actualCostByJob = sumByJob(expenseRows, 'job_id', 'amount');
    const invoiceByJob = sumByJob(invoiceRows, 'job_id', 'total');
    const quoteTotals = quotes.map(quote => normalizeNumber(quote.total, 0));
    const quoteLineItems = quotes.flatMap(quote => fromJson(quote.line_items_json, []));
    const confidence = jobs.length >= 5 ? 'high' : jobs.length >= 2 ? 'medium' : 'low';
    const profile = {
      jobType: normalizedType,
      sampleCount: jobs.length,
      completedCount: jobs.filter(job => ['completed', 'closed'].includes(job.status)).length,
      avgEstimatedHours: average(jobs.map(job => job.estimated_hours)),
      avgActualHours: average(jobIds.map(id => actualHoursByJob.get(id) || 0)),
      avgEstimatedCost: average(jobs.map(job => job.estimated_cost)),
      avgActualCost: average(jobIds.map(id => actualCostByJob.get(id) || 0)),
      avgQuoteTotal: average(quoteTotals),
      avgInvoiceTotal: average(jobIds.map(id => invoiceByJob.get(id) || 0)),
      confidence,
      tasks: this.rankedLearningItems(tasks, row => row.title, row => ({ title: row.title, priority: row.priority || 'medium' }), 10),
      tools: this.rankedLearningItems(tools, row => row.tool_name, row => ({ toolName: row.tool_name }), 10),
      materials: this.rankedLearningItems(materials, row => row.name, row => ({ name: row.name, unit: row.unit || 'unit', supplier: row.supplier || null }), 10),
      quoteItems: this.rankedLearningItems(quoteLineItems, row => row.description || row.title || row.name, row => ({
        description: row.description || row.title || row.name,
        quantity: normalizeNumber(row.quantity, 1),
        unitPrice: normalizeNumber(row.unitPrice || row.unit_price || row.price || row.amount, 0),
        costCode: row.costCode || row.cost_code || null
      }), 10),
      workerSignals: assignmentRows.map(row => ({
        workerId: row.worker_id || null,
        workerName: row.worker_name || 'Unassigned',
        frequency: normalizeNumber(row.assignment_count, 0)
      })),
      evidence: {
        jobIds: jobIds.slice(0, 25),
        latestJobUpdate: jobs[0]?.updated_at || timestamp,
        quoteSamples: quotes.length,
        timeLogSamples: timeRows.length,
        expenseSamples: expenseRows.length,
        invoiceSamples: invoiceRows.length
      },
      data: {
        source: 'completed_job_ledger',
        explanation: `Learned from ${jobs.length} completed ${normalizedType} job(s). Recommendations are internal suggestions and require separate approval before being applied to committed scope, quotes, purchases, or external messages.`
      },
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const existing = this.db.prepare('SELECT * FROM job_learning_profiles WHERE job_type = ?').get(normalizedType);
    this.db.prepare(`
      INSERT INTO job_learning_profiles (
        job_type, sample_count, completed_count, avg_estimated_hours, avg_actual_hours, avg_estimated_cost, avg_actual_cost,
        avg_quote_total, avg_invoice_total, confidence, tasks_json, tools_json, materials_json, quote_items_json,
        worker_signals_json, evidence_json, data_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_type) DO UPDATE SET
        sample_count = excluded.sample_count,
        completed_count = excluded.completed_count,
        avg_estimated_hours = excluded.avg_estimated_hours,
        avg_actual_hours = excluded.avg_actual_hours,
        avg_estimated_cost = excluded.avg_estimated_cost,
        avg_actual_cost = excluded.avg_actual_cost,
        avg_quote_total = excluded.avg_quote_total,
        avg_invoice_total = excluded.avg_invoice_total,
        confidence = excluded.confidence,
        tasks_json = excluded.tasks_json,
        tools_json = excluded.tools_json,
        materials_json = excluded.materials_json,
        quote_items_json = excluded.quote_items_json,
        worker_signals_json = excluded.worker_signals_json,
        evidence_json = excluded.evidence_json,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `).run(
      profile.jobType,
      profile.sampleCount,
      profile.completedCount,
      profile.avgEstimatedHours,
      profile.avgActualHours,
      profile.avgEstimatedCost,
      profile.avgActualCost,
      profile.avgQuoteTotal,
      profile.avgInvoiceTotal,
      profile.confidence,
      toJson(profile.tasks, []),
      toJson(profile.tools, []),
      toJson(profile.materials, []),
      toJson(profile.quoteItems, []),
      toJson(profile.workerSignals, []),
      toJson(profile.evidence, {}),
      toJson(profile.data, {}),
      existing?.created_at || timestamp,
      timestamp
    );

    const saved = this.mapLearningProfile(this.db.prepare('SELECT * FROM job_learning_profiles WHERE job_type = ?').get(normalizedType));
    if (options.audit !== false) {
      this.audit({
        entityType: 'job_learning_profile',
        entityId: normalizedType,
        action: existing ? 'refresh_learning_profile' : 'create_learning_profile',
        actor,
        before: existing ? this.mapLearningProfile(existing) : null,
        after: saved,
        metadata: { sampleCount: saved.sampleCount, confidence: saved.confidence }
      });
    }
    return saved;
  }

  listLearningProfiles(query = {}) {
    const limit = safeLimit(query.limit, 50, 200);
    const rows = this.db.prepare(`
      SELECT * FROM job_learning_profiles
      ORDER BY CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT ?
    `).all(limit);
    return rows.map(row => this.mapLearningProfile(row));
  }

  recommendFromLearning(payload = {}) {
    const jobType = normalizeStatus(payload.jobType || payload.job_type || payload.service || payload.title, 'general');
    let profile = this.mapLearningProfile(this.db.prepare('SELECT * FROM job_learning_profiles WHERE job_type = ?').get(jobType));
    if (!profile && payload.rebuild !== false) {
      try {
        profile = this.rebuildLearningProfile(jobType, { actor: payload.actor || 'Contractor.AI', audit: false });
      } catch {
        profile = null;
      }
    }
    if (!profile) {
      return {
        jobType,
        available: false,
        confidence: 'none',
        recommendation: null,
        explanation: `No completed ${jobType} jobs are available yet for learning.`
      };
    }
    const estimatedHours = profile.avgActualHours || profile.avgEstimatedHours || normalizeNumber(payload.estimatedHours || payload.estimated_hours, 0);
    const estimatedCost = profile.avgActualCost || profile.avgEstimatedCost || normalizeNumber(payload.estimatedCost || payload.estimated_cost, 0);
    const quoteSubtotal = profile.avgQuoteTotal ? profile.avgQuoteTotal / 1.21 : estimatedCost;
    const recommendation = {
      title: payload.title || `${profile.jobType.replace(/_/g, ' ')} job`,
      jobType: profile.jobType,
      estimatedHours,
      estimatedCost,
      tasks: profile.tasks.map(task => ({ title: task.title, priority: task.priority || 'medium' })),
      tools: profile.tools.map(tool => ({ toolName: tool.toolName || tool.name })),
      materials: profile.materials.map(material => ({ name: material.name, unit: material.unit || 'unit', supplier: material.supplier || null })),
      quote: {
        currency: 'EUR',
        taxRate: 21,
        subtotal: quoteSubtotal,
        total: profile.avgQuoteTotal || quoteSubtotal * 1.21,
        lineItems: profile.quoteItems.length ? profile.quoteItems.map(item => ({
          description: item.description,
          quantity: normalizeNumber(item.quantity, 1),
          unitPrice: normalizeNumber(item.unitPrice, 0),
          costCode: item.costCode || null
        })) : [{ description: profile.jobType.replace(/_/g, ' '), quantity: 1, unitPrice: quoteSubtotal, costCode: 'learned_template' }]
      },
      workerSignals: profile.workerSignals
    };
    return {
      jobType,
      available: true,
      confidence: profile.confidence,
      sampleCount: profile.sampleCount,
      recommendation,
      evidence: profile.evidence,
      explanation: profile.data?.explanation || `Learned from ${profile.sampleCount} completed job(s). Approval is still required before applying learned quote, procurement, or external communication changes.`
    };
  }

  addQualityCheck(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('quality');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'pending_review');
      const result = normalizeStatus(payload.result, requestedStatus === 'passed' ? 'passed' : 'pending');
      const needsApproval = payload.requiresApproval === true
        || ['passed', 'approved'].includes(requestedStatus)
        || ['passed', 'approved'].includes(result)
        || normalizeNumber(payload.defectsOpen, 0) > 0;
      const status = needsApproval && ['passed', 'approved'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;
      const defects = Array.isArray(payload.defects)
        ? payload.defects
        : normalizeNumber(payload.defectsOpen, 0) > 0
          ? [{ title: 'Open defect review', count: normalizeNumber(payload.defectsOpen, 0) }]
          : [];

      this.db.prepare(`
        INSERT INTO quality_checks (id, job_id, check_type, title, status, result, inspector, checked_at, defects_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.checkType || payload.check_type, 'final_quality'),
        normalizeText(payload.title, 'Final quality review'),
        status,
        result,
        payload.inspector || payload.owner || actor,
        payload.checkedAt || payload.checked_at || null,
        toJson(defects, []),
        toJson({
          notes: payload.notes || payload.note || null,
          defectsOpen: normalizeNumber(payload.defectsOpen, defects.length),
          wkbEvidence: payload.wkbEvidence === true,
          photos: payload.photos || []
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'quality_check',
          targetId: id,
          jobId,
          approvalType: 'quality_signoff',
          summary: `Approve quality sign-off for ${normalizeText(payload.title, 'final quality review')}`,
          reason: defects.length
            ? 'Quality check has open defects and needs human review before client-impacting closeout.'
            : 'Quality sign-off needs human approval before the job can be treated as accepted.',
          data: { result, defects }
        }, { actor, audit: false });
        this.db.prepare('UPDATE quality_checks SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const qualityCheck = this.mapQualityCheck(this.db.prepare('SELECT * FROM quality_checks WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'quality_check', entityId: id, jobId, action: 'record_quality_check', actor, after: qualityCheck });
      }
      return { ...qualityCheck, approval };
    });
  }

  addSafetyCheck(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('safety');
      const timestamp = nowIso();
      const riskLevel = normalizeText(payload.riskLevel || payload.risk_level, 'normal').toLowerCase();
      const requestedStatus = normalizeStatus(payload.status, riskLevel === 'high' ? 'pending_review' : 'open');
      const needsApproval = payload.requiresApproval === true
        || ['high', 'critical'].includes(riskLevel)
        || ['approved', 'closed', 'completed'].includes(requestedStatus);
      const status = needsApproval && ['approved', 'closed', 'completed'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO safety_checks (id, job_id, check_type, title, status, risk_level, assignee, due_at, completed_at, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.checkType || payload.check_type, 'site_safety'),
        normalizeText(payload.title, 'Site safety check'),
        status,
        riskLevel,
        payload.assignee || payload.owner || actor,
        payload.dueAt || payload.due_at || futureIsoDate(1),
        payload.completedAt || payload.completed_at || null,
        toJson({
          notes: payload.notes || payload.note || null,
          hazards: payload.hazards || [],
          vcaRequired: payload.vcaRequired !== false,
          source: payload.source || null,
          entryKey: payload.entryKey || payload.entry_key || null,
          entryFingerprint: payload.entryFingerprint || payload.entry_fingerprint || null,
          workDate: payload.workDate || payload.work_date || null
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'safety_check',
          targetId: id,
          jobId,
          approvalType: 'safety_signoff',
          summary: `Review safety check ${normalizeText(payload.title, 'site safety check')}`,
          reason: ['high', 'critical'].includes(riskLevel)
            ? 'High-risk safety items require explicit human review before work continues or closes.'
            : 'Safety sign-off needs human approval before closeout.',
          data: { riskLevel, hazards: payload.hazards || [] }
        }, { actor, audit: false });
        this.db.prepare('UPDATE safety_checks SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const safetyCheck = this.mapSafetyCheck(this.db.prepare('SELECT * FROM safety_checks WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'safety_check', entityId: id, jobId, action: 'record_safety_check', actor, after: safetyCheck });
      }
      return { ...safetyCheck, approval };
    });
  }

  createInspectionRecord(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('inspection');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'scheduled');
      const result = normalizeStatus(payload.result, 'pending');
      const defects = normalizeList(payload.defects || payload.defectList || payload.defect_list);
      const needsApproval = payload.requiresApproval === true
        || payload.clientVisible === true
        || ['completed', 'passed', 'failed', 'approved', 'closed'].includes(requestedStatus)
        || ['passed', 'failed', 'approved', 'rejected'].includes(result)
        || defects.length > 0;
      const status = needsApproval
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO inspection_records (id, job_id, inspection_type, title, status, result, inspector, scheduled_at, completed_at, defects_json, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.inspectionType || payload.inspection_type, 'site_inspection'),
        normalizeText(payload.title, 'Site inspection'),
        status,
        result,
        payload.inspector || payload.owner || actor,
        payload.scheduledAt || payload.scheduled_at || null,
        payload.completedAt || payload.completed_at || null,
        toJson(defects, []),
        null,
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          checklist: normalizeList(payload.checklist),
          photos: normalizeList(payload.photos),
          wkbEvidence: payload.wkbEvidence === true,
          clientVisible: payload.clientVisible === true
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'inspection_record',
          targetId: id,
          jobId,
          approvalType: 'inspection_signoff',
          summary: `Approve inspection ${normalizeText(payload.title, 'site inspection')}`,
          reason: defects.length
            ? 'Inspection has defect evidence and needs human review before closeout or client reliance.'
            : 'Completed or client-visible inspection evidence requires approval before it becomes an accepted record.',
          data: { requestedStatus, result, defects }
        }, { actor, audit: false });
        this.db.prepare('UPDATE inspection_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const inspection = this.mapInspection(this.db.prepare('SELECT * FROM inspection_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'inspection_record', entityId: id, jobId, action: 'record_inspection', actor, after: inspection });
      }
      return { ...inspection, approval };
    });
  }

  createObservationRecord(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('observation');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'open');
      const severity = normalizePriority(payload.severity || payload.riskLevel || payload.risk_level || 'medium');
      const needsApproval = payload.requiresApproval === true
        || payload.clientVisible === true
        || ['critical', 'high'].includes(severity)
        || ['closed', 'resolved', 'approved', 'client_visible'].includes(requestedStatus);
      const status = needsApproval && ['closed', 'resolved', 'approved', 'client_visible'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO observation_records (id, job_id, category, title, status, severity, responsible, due_at, closed_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeStatus(payload.category, 'quality'),
        normalizeText(payload.title, 'Field observation'),
        status,
        severity,
        payload.responsible || payload.owner || actor,
        payload.dueAt || payload.due_at || futureIsoDate(2),
        payload.closedAt || payload.closed_at || null,
        null,
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          correctiveAction: payload.correctiveAction || payload.corrective_action || null,
          photos: normalizeList(payload.photos),
          clientVisible: payload.clientVisible === true
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'observation_record',
          targetId: id,
          jobId,
          approvalType: 'observation_review',
          summary: `Review observation ${normalizeText(payload.title, 'field observation')}`,
          reason: ['critical', 'high'].includes(severity)
            ? 'High-severity safety or quality observations require human review before work continues or closes.'
            : 'Closing or exposing observations can affect client expectations and requires approval.',
          data: { requestedStatus, severity }
        }, { actor, audit: false });
        this.db.prepare('UPDATE observation_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const observation = this.mapObservation(this.db.prepare('SELECT * FROM observation_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'observation_record', entityId: id, jobId, action: 'record_observation', actor, after: observation });
      }
      return { ...observation, approval };
    });
  }

  createIncidentRecord(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('incident');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'reported');
      const severity = normalizePriority(payload.severity || payload.riskLevel || payload.risk_level || 'high');
      const needsApproval = payload.requiresApproval === true
        || ['critical', 'high'].includes(severity)
        || ['closed', 'resolved', 'approved', 'reportable', 'escalated'].includes(requestedStatus);
      const status = needsApproval && ['closed', 'resolved', 'approved', 'reportable', 'escalated'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO incident_records (id, job_id, incident_type, title, status, severity, reported_by, occurred_at, resolved_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeStatus(payload.incidentType || payload.incident_type, 'near_miss'),
        normalizeText(payload.title, 'Safety incident'),
        status,
        severity,
        payload.reportedBy || payload.reported_by || actor,
        payload.occurredAt || payload.occurred_at || timestamp,
        payload.resolvedAt || payload.resolved_at || null,
        null,
        toJson({
          requestedStatus,
          description: payload.description || payload.notes || null,
          immediateAction: payload.immediateAction || payload.immediate_action || null,
          correctiveAction: payload.correctiveAction || payload.corrective_action || null,
          witnesses: normalizeList(payload.witnesses),
          photos: normalizeList(payload.photos),
          reportable: payload.reportable === true
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'incident_record',
          targetId: id,
          jobId,
          approvalType: 'incident_review',
          summary: `Review incident ${normalizeText(payload.title, 'safety incident')}`,
          reason: ['critical', 'high'].includes(severity)
            ? 'High-severity incidents require explicit human review and an audit trail before work continues or closes.'
            : 'Incident escalation or closure requires approval before the record is treated as resolved.',
          data: { requestedStatus, severity, reportable: payload.reportable === true }
        }, { actor, audit: false });
        this.db.prepare('UPDATE incident_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const incident = this.mapIncident(this.db.prepare('SELECT * FROM incident_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'incident_record', entityId: id, jobId, action: 'record_incident', actor, after: incident });
      }
      return { ...incident, approval };
    });
  }

  createSafetyMeeting(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('safety_talk');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'scheduled');
      const attendees = normalizeList(payload.attendees);
      const topics = normalizeList(payload.topics);
      const needsApproval = payload.requiresApproval === true
        || payload.clientVisible === true
        || ['completed', 'approved', 'client_visible'].includes(requestedStatus);
      const status = needsApproval && ['completed', 'approved', 'client_visible'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO safety_meetings (id, job_id, meeting_type, title, status, facilitator, scheduled_at, completed_at, attendees_json, topics_json, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeStatus(payload.meetingType || payload.meeting_type, 'toolbox_talk'),
        normalizeText(payload.title, 'Toolbox talk'),
        status,
        payload.facilitator || payload.owner || actor,
        payload.scheduledAt || payload.scheduled_at || futureIsoDate(1),
        payload.completedAt || payload.completed_at || null,
        toJson(attendees, []),
        toJson(topics, []),
        null,
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          vcaRelevant: payload.vcaRelevant !== false,
          clientVisible: payload.clientVisible === true
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'safety_meeting',
          targetId: id,
          jobId,
          approvalType: 'safety_meeting_signoff',
          summary: `Approve safety talk ${normalizeText(payload.title, 'toolbox talk')}`,
          reason: 'Completed safety meeting evidence can affect VCA/Wkb compliance records and requires approval before sign-off.',
          data: { requestedStatus, attendees, topics }
        }, { actor, audit: false });
        this.db.prepare('UPDATE safety_meetings SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const meeting = this.mapSafetyMeeting(this.db.prepare('SELECT * FROM safety_meetings WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'safety_meeting', entityId: id, jobId, action: 'record_safety_meeting', actor, after: meeting });
      }
      return { ...meeting, approval };
    });
  }

  createWorkerOrientation(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('orientation');
      const timestamp = nowIso();
      const assignment = this.resolveCrewAssignment(jobId, payload);
      const workerId = assignment?.workerId || payload.workerId || payload.worker_id || null;
      const workerName = normalizeText(
        assignment?.workerName || payload.workerName || payload.worker_name || payload.worker,
        'Crew member'
      );
      const requestedStatus = normalizeStatus(payload.status, 'scheduled');
      const completionStatuses = ['completed', 'approved', 'cleared', 'valid'];
      const needsApproval = normalizeBoolean(
        payload.requiresApproval,
        completionStatuses.includes(requestedStatus) || normalizeBoolean(payload.grantsAccess || payload.grants_access, false)
      );
      const status = needsApproval && completionStatuses.includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO worker_orientations (id, job_id, worker_name, company, status, language, due_at, completed_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        workerName,
        normalizeText(payload.company, 'Internal crew'),
        status,
        normalizeText(payload.language, 'nl'),
        payload.dueAt || payload.due_at || futureIsoDate(1),
        payload.completedAt || payload.completed_at || null,
        null,
        toJson({
          requestedStatus,
          assignmentId: assignment?.id || null,
          workerId,
          topics: normalizeList(payload.topics),
          documents: normalizeList(payload.documents),
          notes: payload.notes || payload.note || null,
          source: payload.source || null,
          verificationReference: payload.verificationReference || payload.verification_reference || null,
          validUntil: payload.validUntil || payload.valid_until || null,
          grantsAccess: normalizeBoolean(payload.grantsAccess || payload.grants_access, completionStatuses.includes(requestedStatus))
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'worker_orientation',
          targetId: id,
          jobId,
          approvalType: 'worker_orientation_completion',
          summary: `Approve orientation for ${workerName}`,
          reason: 'Completed worker orientation affects site-access eligibility and VCA/Wkb evidence. Approval is required before the record can grant access.',
          data: { requestedStatus, workerName, workerId, assignmentId: assignment?.id || null }
        }, { actor, audit: false });
        this.db.prepare('UPDATE worker_orientations SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const orientation = this.mapWorkerOrientation(this.db.prepare('SELECT * FROM worker_orientations WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'worker_orientation', entityId: id, jobId, action: 'record_worker_orientation', actor, after: orientation });
      }
      return { ...orientation, approval };
    });
  }

  createJhaRecord(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('jha');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const riskLevel = normalizePriority(payload.riskLevel || payload.risk_level || payload.severity);
      const hazards = normalizeList(payload.hazards);
      const controls = normalizeList(payload.controls || payload.mitigations);
      const approvalStatuses = ['approved', 'issued', 'accepted', 'completed', 'signed_off', 'client_visible'];
      const needsApproval = normalizeBoolean(
        payload.requiresApproval,
        approvalStatuses.includes(requestedStatus) || ['high', 'critical'].includes(riskLevel)
      );
      const status = needsApproval && approvalStatuses.includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO jha_records (id, job_id, title, status, risk_level, assignee, due_at, approved_at, hazards_json, controls_json, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.title, 'Job hazard analysis'),
        status,
        riskLevel,
        payload.assignee || payload.owner || actor,
        payload.dueAt || payload.due_at || futureIsoDate(1),
        payload.approvedAt || payload.approved_at || null,
        toJson(hazards, []),
        toJson(controls, []),
        null,
        toJson({
          requestedStatus,
          workMethod: payload.workMethod || payload.work_method || null,
          ppe: normalizeList(payload.ppe),
          notes: payload.notes || payload.note || null,
          stopWorkTriggers: normalizeList(payload.stopWorkTriggers || payload.stop_work_triggers)
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'jha_record',
          targetId: id,
          jobId,
          approvalType: 'jha_approval',
          summary: `Approve JHA ${normalizeText(payload.title, 'job hazard analysis')}`,
          reason: ['high', 'critical'].includes(riskLevel)
            ? 'High-risk hazard analyses require human review before field reliance.'
            : 'Approved JHAs affect worker instructions, safety controls, and compliance records.',
          data: { requestedStatus, riskLevel, hazards, controls }
        }, { actor, audit: false });
        this.db.prepare('UPDATE jha_records SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const jha = this.mapJha(this.db.prepare('SELECT * FROM jha_records WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'jha_record', entityId: id, jobId, action: 'record_jha', actor, after: jha });
      }
      return { ...jha, approval };
    });
  }

  createSdsSheet(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('sds');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'missing');
      const approvalStatuses = ['current', 'approved', 'accepted', 'active'];
      const needsApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus));
      const status = needsApproval && approvalStatuses.includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO sds_sheets (id, job_id, material, supplier, status, expires_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.material || payload.title || payload.name, 'Site material'),
        payload.supplier || null,
        status,
        payload.expiresAt || payload.expires_at || null,
        null,
        toJson({
          requestedStatus,
          documentRef: payload.documentRef || payload.document_ref || payload.file || null,
          hazardClass: payload.hazardClass || payload.hazard_class || null,
          storage: payload.storage || null,
          notes: payload.notes || payload.note || null
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'sds_sheet',
          targetId: id,
          jobId,
          approvalType: 'sds_current_review',
          summary: `Approve SDS for ${normalizeText(payload.material || payload.title || payload.name, 'site material')}`,
          reason: 'Marking an SDS sheet current affects hazardous-material handling and site compliance. Approval is required before relying on it.',
          data: { requestedStatus, material: payload.material || payload.title || payload.name || null }
        }, { actor, audit: false });
        this.db.prepare('UPDATE sds_sheets SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const sdsSheet = this.mapSdsSheet(this.db.prepare('SELECT * FROM sds_sheets WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'sds_sheet', entityId: id, jobId, action: 'record_sds_sheet', actor, after: sdsSheet });
      }
      return { ...sdsSheet, approval };
    });
  }

  prepareFieldAssurancePack(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const detail = this.getJobDetail(jobId, { includeAudit: false });
      const retainedRecord = (records, excluded = []) => records.find(record => (
        !excluded.includes(normalizeStatus(record.status, 'open'))
      )) || null;
      const scheduledAt = payload.scheduledAt || payload.scheduled_at || detail.scheduledStart || futureIsoDate(1);
      const dueAt = payload.dueAt || payload.due_at || detail.scheduledStart || futureIsoDate(1);
      const assignedWorker = (detail.assignments || []).find(assignment => this.activeAssignmentStatus(assignment.status));
      const crewEvidence = this.crewEvidenceReadiness(detail);
      const assignedCrewEvidence = crewEvidence.items.find(item => item.assignmentId === assignedWorker?.id) || crewEvidence.items[0] || null;

      const existingMeeting = retainedRecord(detail.safetyMeetings || [], ['cancelled', 'canceled', 'rejected']);
      const existingJha = retainedRecord(detail.jhas || [], ['cancelled', 'canceled', 'rejected', 'expired']);
      const existingSds = retainedRecord(detail.sdsSheets || [], ['cancelled', 'canceled', 'rejected', 'expired']);
      const existingOrientation = assignedCrewEvidence?.orientation
        || (!assignedWorker ? retainedRecord(detail.orientations || [], ['cancelled', 'canceled', 'rejected', 'expired']) : null);

      const safetyMeeting = existingMeeting || this.createSafetyMeeting(jobId, {
        title: `${detail.title} pre-task safety talk`,
        meetingType: 'pre_task_talk',
        status: 'scheduled',
        scheduledAt,
        facilitator: payload.facilitator || actor,
        topics: normalizeList(payload.topics).length
          ? normalizeList(payload.topics)
          : ['Scope and access', 'Task hazards and stop-work triggers', 'PPE and emergency controls'],
        notes: 'Internal safety briefing draft. Completion and publication require retained evidence and approval where applicable.'
      }, { actor, audit: false });
      const jha = existingJha || this.createJhaRecord(jobId, {
        title: `${detail.title} job hazard analysis`,
        status: 'draft',
        riskLevel: detail.riskLevel || 'medium',
        dueAt,
        assignee: payload.assignee || assignedWorker?.workerName || actor,
        hazards: normalizeList(payload.hazards).length
          ? normalizeList(payload.hazards)
          : ['Site access and public interface', 'Task-specific equipment and material hazards', 'Changing field conditions'],
        controls: normalizeList(payload.controls).length
          ? normalizeList(payload.controls)
          : ['Confirm controls before work starts', 'Use required PPE and isolation', 'Stop work and record changed conditions'],
        ppe: normalizeList(payload.ppe).length
          ? normalizeList(payload.ppe)
          : ['Safety shoes', 'Gloves', 'Eye protection'],
        notes: 'Internal JHA draft. It does not authorize field reliance until required approvals are resolved.'
      }, { actor, audit: false });
      const sdsSheet = existingSds || this.createSdsSheet(jobId, {
        material: payload.material || `${detail.jobType || 'Job'} material register`,
        status: 'requested',
        supplier: payload.supplier || null,
        notes: 'Internal SDS request placeholder. Current supplier evidence must be attached and approved before hazardous-material reliance.'
      }, { actor, audit: false });
      const orientation = existingOrientation || this.createWorkerOrientation(jobId, {
        assignmentId: assignedWorker?.id || null,
        workerId: assignedWorker?.workerId || null,
        workerName: payload.workerName || payload.worker_name || assignedWorker?.workerName || 'Assigned crew',
        company: payload.company || 'Internal crew',
        status: 'scheduled',
        dueAt,
        language: payload.language || 'nl',
        topics: ['Site rules', 'Emergency arrangements', 'Access restrictions', 'Task-specific controls'],
        grantsAccess: false,
        notes: 'Internal orientation plan. This record does not grant site access.'
      }, { actor, audit: false });

      const reused = {
        safetyMeeting: Boolean(existingMeeting),
        jha: Boolean(existingJha),
        sdsSheet: Boolean(existingSds),
        orientation: Boolean(existingOrientation)
      };
      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'prepare_field_assurance_pack',
        actor,
        after: {
          safetyMeetingId: safetyMeeting.id,
          jhaId: jha.id,
          sdsSheetId: sdsSheet.id,
          orientationId: orientation.id,
          reused,
          externalCommitments: 0
        },
        metadata: { source: 'field_assurance_workspace' }
      });

      return {
        safetyMeeting,
        jha,
        sdsSheet,
        orientation,
        reused,
        approvalRequired: Boolean(safetyMeeting.approvalId || jha.approvalId || sdsSheet.approvalId || orientation.approvalId),
        externalCommitments: 0,
        job: this.getJobDetail(jobId, { includeAudit: true })
      };
    });
  }

  createSiteAccessLog(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('site_access');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'blocked');
      const assignment = this.resolveCrewAssignment(jobId, payload);
      const orientationId = payload.orientationId || payload.orientation_id || null;
      let orientation = orientationId
        ? this.db.prepare('SELECT * FROM worker_orientations WHERE id = ? AND job_id = ?').get(orientationId, jobId)
        : null;
      if (orientationId && !orientation) {
        const error = new Error('Worker orientation not found for this job');
        error.statusCode = 400;
        throw error;
      }
      const assignmentIdentity = assignment ? {
        assignmentId: assignment.id,
        workerId: assignment.workerId,
        workerName: assignment.workerName
      } : null;
      if (orientation && assignmentIdentity && !this.crewEvidenceIdentityMatches(orientation, assignmentIdentity)) {
        const error = new Error('Worker orientation belongs to a different crew assignment');
        error.statusCode = 409;
        throw error;
      }
      if (!orientation) {
        const orientationRows = this.db.prepare(`
          SELECT * FROM worker_orientations
          WHERE job_id = ?
          ORDER BY completed_at DESC, created_at DESC
        `).all(jobId);
        orientation = assignmentIdentity
          ? orientationRows.find(record => this.crewEvidenceIdentityMatches(record, assignmentIdentity)) || null
          : orientationRows.find(record => (
              normalizeText(record.worker_name, '').toLowerCase()
              === normalizeText(payload.workerName || payload.worker_name || payload.worker, '').toLowerCase()
            )) || null;
      }
      const orientationIdentity = this.crewEvidenceIdentity(orientation || {});
      const workerId = assignment?.workerId || orientationIdentity.workerId || payload.workerId || payload.worker_id || null;
      const assignmentId = assignment?.id || orientationIdentity.assignmentId || null;
      const workerName = normalizeText(
        assignment?.workerName || orientation?.worker_name || payload.workerName || payload.worker_name || payload.worker,
        'Crew member'
      );
      const orientationValid = normalizeBoolean(
        payload.orientationValid || payload.orientation_valid,
        Boolean(orientation && ['completed', 'approved', 'cleared', 'valid'].includes(orientation.status))
      );
      const accessStatuses = ['checked_in', 'cleared', 'approved', 'granted'];
      const checkedOut = requestedStatus === 'checked_out';
      const needsApproval = orientationValid && normalizeBoolean(
        payload.requiresApproval,
        accessStatuses.includes(requestedStatus) || normalizeBoolean(payload.grantsAccess || payload.grants_access, false)
      );
      const status = !orientationValid && accessStatuses.includes(requestedStatus)
        ? 'blocked'
        : needsApproval && accessStatuses.includes(requestedStatus)
          ? 'pending_approval'
          : requestedStatus;

      this.db.prepare(`
        INSERT INTO site_access_logs (id, job_id, orientation_id, worker_name, company, status, orientation_valid, checked_in_at, checked_out_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        orientation?.id || orientationId || null,
        workerName,
        normalizeText(payload.company, orientation?.company || 'Internal crew'),
        status,
        orientationValid ? 1 : 0,
        payload.checkedInAt || payload.checked_in_at || (requestedStatus === 'checked_in' && !needsApproval && orientationValid ? timestamp : null),
        payload.checkedOutAt || payload.checked_out_at || (checkedOut ? timestamp : null),
        null,
        toJson({
          requestedStatus,
          assignmentId,
          workerId,
          accessPoint: payload.accessPoint || payload.access_point || null,
          location: payload.location || null,
          blockedReason: !orientationValid ? (payload.blockedReason || payload.blocked_reason || 'Valid orientation is required before site access.') : null,
          notes: payload.notes || payload.note || null,
          source: payload.source || null
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'site_access_log',
          targetId: id,
          jobId,
          approvalType: 'site_access_clearance',
          summary: `Approve site access for ${workerName}`,
          reason: 'Clearing site access lets a worker enter the jobsite and depends on valid orientation evidence. Approval is required before access is relied on.',
          data: {
            requestedStatus,
            workerName,
            workerId,
            assignmentId,
            orientationId: orientation?.id || orientationId || null
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE site_access_logs SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const siteAccess = this.mapSiteAccessLog(this.db.prepare('SELECT * FROM site_access_logs WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'site_access_log', entityId: id, jobId, action: 'record_site_access', actor, after: siteAccess });
      }
      return { ...siteAccess, approval };
    });
  }

  recordPayment(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const invoice = payload.invoiceId || payload.invoice_id
        ? this.db.prepare('SELECT * FROM invoices WHERE id = ? AND job_id = ?').get(payload.invoiceId || payload.invoice_id, jobId)
        : this.db.prepare('SELECT * FROM invoices WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').get(jobId);
      const id = makeId('payment');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, invoice?.status === 'approved' ? 'awaiting_payment' : 'awaiting_invoice_approval');
      const needsApproval = payload.requiresApproval === true || ['paid', 'received', 'settled', 'written_off'].includes(requestedStatus);
      const status = needsApproval ? 'pending_confirmation' : requestedStatus;
      const amount = normalizeNumber(payload.amount, invoice?.total || 0);
      const reference = normalizeText(payload.reference || payload.paymentReference || payload.payment_reference, '');
      if (!(amount > 0)) {
        const error = new Error('Payment amount must be greater than zero');
        error.statusCode = 400;
        throw error;
      }
      if (needsApproval && !reference) {
        const error = new Error('Payment confirmation requires a retained payment reference');
        error.statusCode = 400;
        throw error;
      }

      this.db.prepare(`
        INSERT INTO payments (id, job_id, invoice_id, status, currency, amount, due_at, paid_at, method, reference, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        invoice?.id || payload.invoiceId || payload.invoice_id || null,
        status,
        normalizeText(payload.currency || invoice?.currency, 'EUR').toUpperCase(),
        amount,
        payload.dueAt || payload.due_at || invoice?.due_at || futureIsoDate(14),
        payload.paidAt || payload.paid_at || null,
        payload.method || null,
        reference || null,
        toJson({
          notes: payload.notes || null,
          followUpChannel: payload.followUpChannel || 'portal',
          reminderSentAt: payload.reminderSentAt || null,
          nextFollowUpAt: payload.nextFollowUpAt || payload.next_follow_up_at || payload.dueAt || payload.due_at || invoice?.due_at || null,
          followUpHistory: [],
          externalDelivery: false,
          requestedStatus
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'payment',
          targetId: id,
          jobId,
          approvalType: 'payment_confirmation',
          summary: `Confirm payment status ${requestedStatus} for ${amount.toFixed(2)} ${normalizeText(payload.currency || invoice?.currency, 'EUR').toUpperCase()}`,
          reason: 'Payment state changes affect financial records and require human confirmation.',
          data: { requestedStatus, amount, invoiceId: invoice?.id || null }
        }, { actor, audit: false });
        this.db.prepare('UPDATE payments SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const payment = this.mapPayment(this.db.prepare('SELECT * FROM payments WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'payment', entityId: id, jobId, action: 'record_payment_followup', actor, after: payment });
      }
      return { ...payment, approval };
    });
  }

  recordPaymentFollowUp(jobId, paymentId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const actor = options.actor || payload.actor || 'Contractor.AI';
    const requestedStatus = normalizeStatus(payload.status || payload.outcome, 'follow_up_recorded');
    const allowedStatuses = new Set(['follow_up_recorded', 'awaiting_payment', 'disputed', 'paid', 'received', 'settled', 'written_off']);
    if (!allowedStatuses.has(requestedStatus)) {
      const error = new Error('Unsupported payment follow-up outcome');
      error.statusCode = 400;
      throw error;
    }
    const notes = normalizeText(payload.notes || payload.note, '');
    if (!notes) {
      const error = new Error('Payment follow-up notes are required');
      error.statusCode = 400;
      throw error;
    }
    const confirmation = ['paid', 'received', 'settled', 'written_off'].includes(requestedStatus);
    const reference = normalizeText(payload.reference || payload.paymentReference || payload.payment_reference, '');
    if (confirmation && !reference) {
      const error = new Error('Payment confirmation requires a retained payment reference');
      error.statusCode = 400;
      throw error;
    }
    const timestamp = nowIso();
    const nextFollowUpAt = payload.nextFollowUpAt || payload.next_follow_up_at || payload.dueAt || payload.due_at || futureIsoDate(7);

    return this.transaction(() => {
      let row = paymentId
        ? this.db.prepare('SELECT * FROM payments WHERE id = ? AND job_id = ?').get(paymentId, jobId)
        : this.db.prepare(`
          SELECT * FROM payments
          WHERE job_id = ? AND status NOT IN ('paid', 'received', 'settled', 'cancelled', 'canceled', 'rejected', 'void', 'written_off')
          ORDER BY due_at ASC, created_at DESC
          LIMIT 1
        `).get(jobId);

      if (!row) {
        const created = this.recordPayment(jobId, {
          invoiceId: payload.invoiceId || payload.invoice_id || null,
          status: confirmation ? requestedStatus : 'awaiting_payment',
          amount: payload.amount,
          dueAt: nextFollowUpAt,
          paidAt: payload.paidAt || payload.paid_at || null,
          method: payload.method || null,
          reference: reference || null,
          notes,
          followUpChannel: payload.followUpChannel || payload.follow_up_channel || 'internal',
          reminderSentAt: null,
          nextFollowUpAt
        }, { actor, audit: false });
        row = this.db.prepare('SELECT * FROM payments WHERE id = ?').get(created.id);
        const initialData = fromJson(row.data_json, {});
        const followUpHistory = [{
          recordedAt: timestamp,
          actor,
          outcome: requestedStatus,
          notes,
          channel: payload.followUpChannel || payload.follow_up_channel || 'internal',
          reference: reference || null,
          externalDelivery: false
        }];
        this.db.prepare('UPDATE payments SET data_json = ?, updated_at = ? WHERE id = ?')
          .run(toJson({ ...initialData, followUpRecordedAt: timestamp, nextFollowUpAt, followUpHistory, externalDelivery: false }), timestamp, row.id);
        const payment = this.mapPayment(this.db.prepare('SELECT * FROM payments WHERE id = ?').get(row.id));
        if (options.audit !== false) {
          this.audit({ entityType: 'payment', entityId: row.id, jobId, action: 'record_payment_followup', actor, after: payment });
        }
        return { ...payment, approval: created.approval || null, created: true, reused: false };
      }

      if (['paid', 'received', 'settled', 'cancelled', 'canceled', 'rejected', 'void', 'written_off'].includes(normalizeStatus(row.status, ''))) {
        const error = new Error('Closed payment records cannot receive another follow-up');
        error.statusCode = 409;
        throw error;
      }

      const pendingApproval = row.approval_id
        ? this.db.prepare("SELECT * FROM approvals WHERE id = ? AND status = 'pending'").get(row.approval_id)
        : null;
      if (pendingApproval) {
        return {
          ...this.mapPayment(row),
          approval: this.mapApproval(pendingApproval),
          created: false,
          reused: true
        };
      }

      const data = fromJson(row.data_json, {});
      const followUpHistory = Array.isArray(data.followUpHistory) ? data.followUpHistory.slice(-19) : [];
      followUpHistory.push({
        recordedAt: timestamp,
        actor,
        outcome: requestedStatus,
        notes,
        channel: payload.followUpChannel || payload.follow_up_channel || 'internal',
        reference: reference || null,
        externalDelivery: false
      });
      const nextData = {
        ...data,
        notes,
        followUpChannel: payload.followUpChannel || payload.follow_up_channel || data.followUpChannel || 'internal',
        followUpRecordedAt: timestamp,
        nextFollowUpAt,
        followUpHistory,
        externalDelivery: false,
        ...(confirmation ? { requestedStatus } : {})
      };

      let approval = null;
      let status = requestedStatus === 'follow_up_recorded' ? row.status : requestedStatus;
      if (confirmation) {
        status = 'pending_confirmation';
        approval = this.createApproval({
          targetType: 'payment',
          targetId: row.id,
          jobId,
          approvalType: 'payment_confirmation',
          summary: `Confirm payment status ${requestedStatus} for ${normalizeNumber(row.amount, 0).toFixed(2)} ${row.currency}`,
          reason: 'Payment state changes affect financial records and require human confirmation.',
          data: { requestedStatus, amount: normalizeNumber(row.amount, 0), invoiceId: row.invoice_id || null, reference }
        }, { actor, audit: false });
      }

      this.db.prepare(`
        UPDATE payments
        SET status = ?, due_at = ?, method = ?, reference = ?, approval_id = ?, data_json = ?, updated_at = ?
        WHERE id = ? AND job_id = ?
      `).run(
        status,
        confirmation ? row.due_at : nextFollowUpAt,
        payload.method || row.method,
        reference || row.reference,
        approval?.id || row.approval_id,
        toJson(nextData),
        timestamp,
        row.id,
        jobId
      );

      const payment = this.mapPayment(this.db.prepare('SELECT * FROM payments WHERE id = ?').get(row.id));
      if (options.audit !== false) {
        this.audit({ entityType: 'payment', entityId: row.id, jobId, action: confirmation ? 'request_payment_confirmation' : 'record_payment_followup', actor, before: this.mapPayment(row), after: payment });
      }
      return { ...payment, approval, created: false, reused: false };
    });
  }

  createBudgetLine(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('budget');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const budgetAmount = normalizeNumber(payload.budgetAmount || payload.budget_amount || payload.amount, 0);
      const committedAmount = normalizeNumber(payload.committedAmount || payload.committed_amount, 0);
      const actualAmount = normalizeNumber(payload.actualAmount || payload.actual_amount, 0);
      const forecastAmount = normalizeNumber(payload.forecastAmount || payload.forecast_amount, budgetAmount || committedAmount + actualAmount);
      if (!(budgetAmount > 0)) {
        const error = new Error('Budget amount must be greater than zero');
        error.statusCode = 400;
        throw error;
      }
      const overBudget = budgetAmount > 0 && forecastAmount > budgetAmount * 1.05;
      const needsApproval = payload.requiresApproval === true
        || ['approved', 'locked', 'baseline'].includes(requestedStatus)
        || overBudget;
      const status = needsApproval && ['approved', 'locked', 'baseline'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO budget_lines (id, job_id, cost_code, description, category, status, currency, budget_amount, committed_amount, actual_amount, forecast_amount, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.costCode || payload.cost_code, '00-000'),
        normalizeText(payload.description || payload.title, 'Job budget line'),
        normalizeStatus(payload.category, 'general'),
        status,
        normalizeText(payload.currency, 'EUR').toUpperCase(),
        budgetAmount,
        committedAmount,
        actualAmount,
        forecastAmount,
        null,
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          overBudget
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'budget_line',
          targetId: id,
          jobId,
          approvalType: 'budget_control',
          summary: `Approve budget line ${normalizeText(payload.costCode || payload.cost_code, '00-000')}`,
          reason: overBudget
            ? 'Forecast exceeds the approved budget tolerance and needs human review.'
            : 'Budget baselines and locked cost controls affect finance reporting and require approval.',
          data: { requestedStatus, budgetAmount, committedAmount, actualAmount, forecastAmount, overBudget }
        }, { actor, audit: false });
        this.db.prepare('UPDATE budget_lines SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const budgetLine = this.mapBudgetLine(this.db.prepare('SELECT * FROM budget_lines WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'budget_line', entityId: id, jobId, action: 'create_budget_line', actor, after: budgetLine });
      }
      return { ...budgetLine, approval };
    });
  }

  createPurchaseOrder(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('po');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const items = normalizeList(payload.items || payload.lineItems || payload.line_items || payload.materials)
        .map(item => typeof item === 'string' ? { name: item, quantity: 1, unit: 'unit' } : item);
      const amount = normalizeNumber(payload.amount || payload.total, items.reduce((sum, item) => {
        const quantity = normalizeNumber(item.quantity, 1);
        const unitCost = normalizeNumber(item.unitCost || item.unit_cost || item.cost || item.amount, 0);
        return sum + (quantity * unitCost);
      }, 0));
      const currency = normalizeText(payload.currency, 'EUR').toUpperCase();
      const approvalThreshold = normalizeNumber(payload.approvalThreshold || payload.approval_threshold, 250);
      const commitmentStatus = ['approved', 'ready_to_order', 'ordered', 'sent', 'submitted', 'issued'].includes(requestedStatus);
      const needsApproval = payload.requiresApproval === true || commitmentStatus || amount >= approvalThreshold;
      const status = needsApproval && commitmentStatus ? 'pending_approval' : requestedStatus;
      const suppliedName = payload.supplier || payload.vendor || null;
      const tradePartner = this.resolveTradePartnerForSpend(payload, suppliedName);
      const supplier = tradePartner?.name || suppliedName;
      const partnerSnapshot = this.tradePartnerComplianceSnapshot(tradePartner);

      this.db.prepare(`
        INSERT INTO purchase_orders (id, job_id, budget_line_id, supplier, status, currency, amount, required_by, approval_id, items_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        payload.budgetLineId || payload.budget_line_id || null,
        supplier,
        status,
        currency,
        amount,
        payload.requiredBy || payload.required_by || payload.neededBy || payload.needed_by || null,
        null,
        toJson(items, []),
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          orderReference: payload.orderReference || payload.order_reference || null,
          approvalThreshold,
          procurementOrderId: payload.procurementOrderId || payload.procurement_order_id || null,
          tradePartnerId: tradePartner?.id || null,
          partnerComplianceRequired: true,
          partnerComplianceSnapshot: partnerSnapshot
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'purchase_order',
          targetId: id,
          jobId,
          approvalType: 'purchase_commitment',
          summary: `Approve purchase order ${id} for ${amount.toFixed(2)} ${currency}`,
          reason: 'Purchase orders can commit Robert to supplier spend and require approval before ordering or sending.',
          data: {
            requestedStatus,
            amount,
            currency,
            supplier,
            tradePartnerId: tradePartner?.id || null,
            partnerCompliance: partnerSnapshot
          }
        }, { actor, audit: false });
        this.db.prepare('UPDATE purchase_orders SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const purchaseOrder = this.mapPurchaseOrder(this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'purchase_order', entityId: id, jobId, action: 'create_purchase_order', actor, after: purchaseOrder });
      }
      return { ...purchaseOrder, approval };
    });
  }

  createDrawRequest(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const invoice = payload.invoiceId || payload.invoice_id
        ? this.db.prepare('SELECT * FROM invoices WHERE id = ? AND job_id = ?').get(payload.invoiceId || payload.invoice_id, jobId)
        : this.db.prepare('SELECT * FROM invoices WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').get(jobId);
      const id = makeId('draw');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const requestedAmount = normalizeNumber(payload.requestedAmount || payload.requested_amount || payload.amount, invoice?.total || 0);
      const approvedAmount = normalizeNumber(payload.approvedAmount || payload.approved_amount, requestedStatus === 'approved' ? requestedAmount : 0);
      const currency = normalizeText(payload.currency || invoice?.currency, 'EUR').toUpperCase();
      if (!(requestedAmount > 0)) {
        const error = new Error('Draw request amount must be greater than zero');
        error.statusCode = 400;
        throw error;
      }
      const needsApproval = payload.requiresApproval === true
        || ['submitted', 'approved', 'approved_for_funding', 'funded', 'sent'].includes(requestedStatus)
        || requestedAmount > 0;
      const status = needsApproval && requestedStatus !== 'draft' ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO draw_requests (id, job_id, invoice_id, title, status, currency, requested_amount, approved_amount, due_at, funded_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        invoice?.id || payload.invoiceId || payload.invoice_id || null,
        normalizeText(payload.title, `Draw request for ${invoice?.id || 'job finance'}`),
        status,
        currency,
        requestedAmount,
        approvedAmount,
        payload.dueAt || payload.due_at || futureIsoDate(7),
        payload.fundedAt || payload.funded_at || null,
        null,
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          percentComplete: normalizeNumber(payload.percentComplete || payload.percent_complete, 0),
          retainagePercent: normalizeNumber(payload.retainagePercent || payload.retainage_percent, 0)
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'draw_request',
          targetId: id,
          jobId,
          approvalType: 'draw_request_submission',
          summary: `Approve draw request ${id} for ${requestedAmount.toFixed(2)} ${currency}`,
          reason: 'Draw requests affect funding, invoicing, and client/payment expectations and require approval before submission or funding.',
          data: { requestedStatus, requestedAmount, approvedAmount, invoiceId: invoice?.id || null }
        }, { actor, audit: false });
        this.db.prepare('UPDATE draw_requests SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const drawRequest = this.mapDrawRequest(this.db.prepare('SELECT * FROM draw_requests WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'draw_request', entityId: id, jobId, action: 'create_draw_request', actor, after: drawRequest });
      }
      return { ...drawRequest, approval };
    });
  }

  createLienWaiver(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const payment = payload.paymentId || payload.payment_id
        ? this.db.prepare('SELECT * FROM payments WHERE id = ? AND job_id = ?').get(payload.paymentId || payload.payment_id, jobId)
        : this.db.prepare('SELECT * FROM payments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1').get(jobId);
      const id = makeId('waiver');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'requested');
      const waiverType = normalizeStatus(payload.waiverType || payload.waiver_type, 'conditional');
      const amount = normalizeNumber(payload.amount, payment?.amount || 0);
      const currency = normalizeText(payload.currency || payment?.currency, 'EUR').toUpperCase();
      const documentRef = normalizeText(payload.documentRef || payload.document_ref, '');
      if (!(amount > 0)) {
        const error = new Error('Lien waiver amount must be greater than zero');
        error.statusCode = 400;
        throw error;
      }
      if (['received', 'approved', 'released', 'waived'].includes(requestedStatus) && !documentRef) {
        const error = new Error('Lien waiver evidence reference is required for received or released status');
        error.statusCode = 400;
        throw error;
      }
      const needsApproval = payload.requiresApproval === true
        || waiverType === 'unconditional'
        || ['received', 'approved', 'released', 'waived'].includes(requestedStatus);
      const status = needsApproval && ['received', 'approved', 'released', 'waived'].includes(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;

      this.db.prepare(`
        INSERT INTO lien_waivers (id, job_id, payment_id, supplier, waiver_type, status, currency, amount, due_at, received_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        payment?.id || payload.paymentId || payload.payment_id || null,
        payload.supplier || payload.vendor || fromJson(payment?.data_json, {}).vendor || null,
        waiverType,
        status,
        currency,
        amount,
        payload.dueAt || payload.due_at || payment?.due_at || futureIsoDate(7),
        payload.receivedAt || payload.received_at || null,
        null,
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          documentRef: documentRef || null
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'lien_waiver',
          targetId: id,
          jobId,
          approvalType: 'lien_waiver_release',
          summary: `Approve lien waiver ${id}`,
          reason: 'Lien waivers and payment-release evidence affect financial risk and require human review before release or acceptance.',
          data: { requestedStatus, waiverType, amount, paymentId: payment?.id || null }
        }, { actor, audit: false });
        this.db.prepare('UPDATE lien_waivers SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const lienWaiver = this.mapLienWaiver(this.db.prepare('SELECT * FROM lien_waivers WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'lien_waiver', entityId: id, jobId, action: 'create_lien_waiver', actor, after: lienWaiver });
      }
      return { ...lienWaiver, approval };
    });
  }

  createFinanceHandoff(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const detail = this.getJobDetail(jobId, { includeAudit: false });
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('handoff');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'draft');
      const packageType = normalizeStatus(payload.packageType || payload.package_type, 'job_finance');
      const currency = normalizeText(payload.currency, 'EUR').toUpperCase();
      const amount = normalizeNumber(payload.amount, [
        ...(detail.invoices || []),
        ...(detail.payments || []),
        ...(detail.purchaseOrders || [])
      ].reduce((sum, item) => sum + normalizeNumber(item.total || item.amount || item.requestedAmount, 0), 0));
      const payloadPackage = {
        job: { id: detail.id, title: detail.title, clientName: detail.client?.name || detail.clientName || null },
        budgetLines: detail.budgetLines || [],
        purchaseOrders: detail.purchaseOrders || [],
        expenses: detail.expenses || [],
        invoices: detail.invoices || [],
        payments: detail.payments || [],
        drawRequests: detail.drawRequests || [],
        lienWaivers: detail.lienWaivers || []
      };
      const needsApproval = payload.requiresApproval === true
        || ['ready', 'approved', 'submitted', 'sent', 'exported'].includes(requestedStatus)
        || payload.submit === true;
      const status = needsApproval && requestedStatus !== 'draft' ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO finance_handoffs (id, job_id, target_system, package_type, status, currency, amount, approval_id, payload_json, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.targetSystem || payload.target_system, 'FAB'),
        packageType,
        status,
        currency,
        amount,
        null,
        toJson(payload.package || payloadPackage),
        toJson({
          requestedStatus,
          notes: payload.notes || payload.note || null,
          exportFormat: payload.exportFormat || payload.export_format || 'json'
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'finance_handoff',
          targetId: id,
          jobId,
          approvalType: 'finance_handoff',
          summary: `Approve finance handoff ${id} to ${normalizeText(payload.targetSystem || payload.target_system, 'FAB')}`,
          reason: 'Finance handoff packages can expose client/job financial data and require approval before export or submission.',
          data: { requestedStatus, amount, packageType }
        }, { actor, audit: false });
        this.db.prepare('UPDATE finance_handoffs SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const handoff = this.mapFinanceHandoff(this.db.prepare('SELECT * FROM finance_handoffs WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'finance_handoff', entityId: id, jobId, action: 'create_finance_handoff', actor, after: handoff });
      }
      return { ...handoff, approval };
    });
  }

  prepareFinanceHandoff(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const actor = options.actor || payload.actor || 'Contractor.AI';

    return this.transaction(() => {
      const existing = this.db.prepare(`
        SELECT * FROM finance_handoffs
        WHERE job_id = ? AND status IN ('draft', 'ready', 'pending_approval')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(jobId);

      if (!existing) {
        const created = this.createFinanceHandoff(jobId, {
          ...payload,
          status: 'approved',
          requiresApproval: true
        }, { actor, audit: false });
        if (options.audit !== false) {
          this.audit({ entityType: 'finance_handoff', entityId: created.id, jobId, action: 'prepare_finance_handoff', actor, after: created });
        }
        return { ...created, created: true, reused: false };
      }

      const pendingApproval = existing.approval_id
        ? this.db.prepare("SELECT * FROM approvals WHERE id = ? AND status = 'pending'").get(existing.approval_id)
        : null;
      if (pendingApproval) {
        return {
          ...this.mapFinanceHandoff(existing),
          approval: this.mapApproval(pendingApproval),
          created: false,
          reused: true
        };
      }

      const detail = this.getJobDetail(jobId, { includeAudit: false });
      const timestamp = nowIso();
      const targetSystem = normalizeText(payload.targetSystem || payload.target_system, existing.target_system || 'FAB');
      const packageType = normalizeStatus(payload.packageType || payload.package_type, existing.package_type || 'job_finance');
      const exportFormat = payload.exportFormat || payload.export_format || fromJson(existing.data_json, {}).exportFormat || 'json';
      const packagePayload = {
        job: { id: detail.id, title: detail.title, clientName: detail.client?.name || detail.clientName || null },
        budgetLines: detail.budgetLines || [],
        purchaseOrders: detail.purchaseOrders || [],
        expenses: detail.expenses || [],
        invoices: detail.invoices || [],
        payments: detail.payments || [],
        drawRequests: detail.drawRequests || [],
        lienWaivers: detail.lienWaivers || []
      };
      const amount = [
        ...packagePayload.invoices,
        ...packagePayload.payments,
        ...packagePayload.purchaseOrders
      ].reduce((sum, item) => sum + normalizeNumber(item.total || item.amount || item.requestedAmount, 0), 0);
      const approval = this.createApproval({
        targetType: 'finance_handoff',
        targetId: existing.id,
        jobId,
        approvalType: 'finance_handoff',
        summary: `Approve finance handoff ${existing.id} to ${targetSystem}`,
        reason: 'Finance handoff packages can expose client/job financial data and require approval before export or submission.',
        data: { requestedStatus: 'approved', amount, packageType }
      }, { actor, audit: false });
      const data = {
        ...fromJson(existing.data_json, {}),
        requestedStatus: 'approved',
        notes: payload.notes || payload.note || fromJson(existing.data_json, {}).notes || null,
        exportFormat,
        externalDelivery: false
      };
      this.db.prepare(`
        UPDATE finance_handoffs
        SET target_system = ?, package_type = ?, status = 'pending_approval', amount = ?, approval_id = ?, payload_json = ?, data_json = ?, updated_at = ?
        WHERE id = ? AND job_id = ?
      `).run(targetSystem, packageType, amount, approval.id, toJson(packagePayload), toJson(data), timestamp, existing.id, jobId);

      const handoff = this.mapFinanceHandoff(this.db.prepare('SELECT * FROM finance_handoffs WHERE id = ?').get(existing.id));
      if (options.audit !== false) {
        this.audit({ entityType: 'finance_handoff', entityId: existing.id, jobId, action: 'prepare_finance_handoff', actor, before: this.mapFinanceHandoff(existing), after: handoff });
      }
      return { ...handoff, approval, created: false, reused: false };
    });
  }

  createPunchItem(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('punch');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'open');
      const severity = normalizePriority(payload.severity || payload.priority);
      const approvalStatuses = ['closed', 'resolved', 'accepted', 'verified', 'client_visible'];
      const needsApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus) || normalizeBoolean(payload.clientVisible, false));
      const status = needsApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO punch_items (id, job_id, title, status, severity, assignee, due_at, closed_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.title, 'Punch item'),
        status,
        severity,
        payload.assignee || payload.owner || actor,
        payload.dueAt || payload.due_at || futureIsoDate(3),
        payload.closedAt || payload.closed_at || null,
        null,
        toJson({
          requestedStatus,
          description: payload.description || payload.notes || null,
          location: payload.location || null,
          photos: normalizeList(payload.photos),
          clientVisible: normalizeBoolean(payload.clientVisible, false)
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'punch_item',
          targetId: id,
          jobId,
          approvalType: 'punch_item_closeout',
          summary: `Approve punch item ${normalizeText(payload.title, 'closeout')}`,
          reason: 'Closing or client-publishing punch items can affect final acceptance and requires human review.',
          data: { requestedStatus, severity }
        }, { actor, audit: false });
        this.db.prepare('UPDATE punch_items SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const punchItem = this.mapPunchItem(this.db.prepare('SELECT * FROM punch_items WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'punch_item', entityId: id, jobId, action: 'create_punch_item', actor, after: punchItem });
      }
      return { ...punchItem, approval };
    });
  }

  createWarrantyClaim(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const actor = options.actor || 'Contractor.AI';
      const id = makeId('warranty');
      const timestamp = nowIso();
      const requestedStatus = normalizeStatus(payload.status, 'open');
      const severity = normalizePriority(payload.severity || payload.priority);
      const approvalStatuses = ['closed', 'resolved', 'accepted', 'rejected', 'client_visible'];
      const needsApproval = normalizeBoolean(payload.requiresApproval, approvalStatuses.includes(requestedStatus));
      const status = needsApproval && approvalStatuses.includes(requestedStatus) ? 'pending_approval' : requestedStatus;

      this.db.prepare(`
        INSERT INTO warranty_claims (id, job_id, title, status, client_name, severity, due_at, resolved_at, approval_id, data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        normalizeText(payload.title, 'Warranty claim'),
        status,
        payload.clientName || payload.client_name || job.client_name || null,
        severity,
        payload.dueAt || payload.due_at || futureIsoDate(7),
        payload.resolvedAt || payload.resolved_at || null,
        null,
        toJson({
          requestedStatus,
          issue: payload.issue || payload.description || payload.notes || null,
          resolution: payload.resolution || null,
          photos: normalizeList(payload.photos),
          warrantyType: payload.warrantyType || payload.warranty_type || 'workmanship',
          source: payload.source || null
        }),
        timestamp,
        timestamp
      );

      let approval = null;
      if (needsApproval) {
        approval = this.createApproval({
          targetType: 'warranty_claim',
          targetId: id,
          jobId,
          approvalType: 'warranty_claim_resolution',
          summary: `Approve warranty claim ${normalizeText(payload.title, 'resolution')}`,
          reason: 'Warranty claim resolution can affect service obligations, client expectations, and aftercare records. Approval is required before closure or rejection.',
          data: { requestedStatus, severity, warrantyType: payload.warrantyType || payload.warranty_type || 'workmanship' }
        }, { actor, audit: false });
        this.db.prepare('UPDATE warranty_claims SET approval_id = ?, updated_at = ? WHERE id = ?').run(approval.id, nowIso(), id);
      }

      const warrantyClaim = this.mapWarrantyClaim(this.db.prepare('SELECT * FROM warranty_claims WHERE id = ?').get(id));
      if (options.audit !== false) {
        this.audit({ entityType: 'warranty_claim', entityId: id, jobId, action: 'create_warranty_claim', actor, after: warrantyClaim });
      }
      return { ...warrantyClaim, approval };
    });
  }

  addAftercareItem(jobId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const actor = options.actor || 'Contractor.AI';
    const id = makeId('aftercare');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO aftercare_items (id, job_id, type, title, status, owner, due_at, completed_at, notes, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      normalizeText(payload.type, 'client_follow_up'),
      normalizeText(payload.title, 'Client aftercare follow-up'),
      normalizeStatus(payload.status, 'open'),
      payload.owner || actor,
      payload.dueAt || payload.due_at || futureIsoDate(7),
      payload.completedAt || payload.completed_at || null,
      payload.notes || payload.note || null,
      toJson({
        channel: payload.channel || 'portal',
        warranty: payload.warranty === true,
        maintenanceOffer: payload.maintenanceOffer === true
      }),
      timestamp,
      timestamp
    );
    const aftercare = this.mapAftercareItem(this.db.prepare('SELECT * FROM aftercare_items WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'aftercare_item', entityId: id, jobId, action: 'create_aftercare_item', actor, after: aftercare });
    }
    return aftercare;
  }

  transitionLifecycleRecord(jobId, recordType, recordId, payload = {}, options = {}) {
    this.requireJob(jobId);
    const actor = options.actor || 'Contractor.AI';
    const normalizedType = normalizeStatus(recordType, '');
    const config = {
      task: {
        table: 'job_tasks',
        targetType: null,
        entityType: 'task',
        map: row => this.mapTask(row),
        label: 'task',
        allowedStatuses: new Set(['open', 'in_progress', 'blocked', 'completed', 'cancelled']),
        approvalStatuses: new Set(),
        terminalStatuses: new Set(['completed', 'cancelled']),
        validate(row, requestedStatus) {
          if (['blocked', 'completed', 'cancelled'].includes(requestedStatus) && !normalizeText(payload.notes || payload.note, '')) {
            const error = new Error(`Task ${requestedStatus} evidence is required`);
            error.statusCode = 400;
            error.code = 'task_transition_evidence_required';
            throw error;
          }
        },
        update(row, next) {
          const completed = next.data.requestedStatus === 'completed';
          return {
            status: next.status,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            description: payload.description !== undefined ? normalizeText(payload.description, '') || null : row.description,
            priority: normalizePriority(payload.priority || row.priority),
            assigneeId: payload.assigneeId !== undefined || payload.assignee_id !== undefined
              ? (payload.assigneeId || payload.assignee_id || null)
              : row.assignee_id,
            dueAt: payload.dueAt !== undefined || payload.due_at !== undefined
              ? (payload.dueAt || payload.due_at || null)
              : row.due_at,
            completedAt: completed ? next.closedAt : null
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE job_tasks
            SET title = ?, description = ?, status = ?, priority = ?, assignee_id = ?, due_at = ?, completed_at = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(
            values.title,
            values.description,
            values.status,
            values.priority,
            values.assigneeId,
            values.dueAt,
            values.completedAt,
            toJson(values.data),
            timestamp,
            recordId,
            jobId
          );
        }
      },
      rfi: {
        table: 'rfi_records',
        targetType: 'rfi_record',
        map: row => this.mapRfi(row),
        label: 'RFI',
        allowedStatuses: new Set(['open', 'in_progress', 'answered', 'resolved', 'closed']),
        approvalStatuses: new Set(['answered', 'resolved', 'closed']),
        terminalStatuses: new Set(['answered', 'resolved', 'closed']),
        validate(row, requestedStatus) {
          const response = payload.response || payload.answer || payload.resolution || payload.notes || payload.note || row.response;
          if (this.terminalStatuses.has(requestedStatus) && !normalizeText(response, '')) {
            const error = new Error('RFI response evidence is required before resolution');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            response: payload.response || payload.answer || payload.resolution || payload.notes || payload.note || row.response,
            responsible: payload.responsible || payload.owner || payload.assignee || row.responsible,
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            answeredAt: next.closedAt
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE rfi_records
            SET title = ?, status = ?, response = ?, responsible = ?, due_at = ?, answered_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.status, values.response, values.responsible, values.dueAt, values.answeredAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      submittal: {
        table: 'submittal_records',
        targetType: 'submittal_record',
        map: row => this.mapSubmittal(row),
        label: 'submittal',
        allowedStatuses: new Set(['draft', 'submitted', 'pending_review', 'revise_resubmit', 'approved', 'rejected', 'closed']),
        approvalStatuses: new Set(['approved', 'rejected', 'closed']),
        terminalStatuses: new Set(['approved', 'rejected', 'closed']),
        update(row, next) {
          const requestedStatus = next.data.requestedStatus;
          const submittedStatuses = new Set(['submitted', 'pending_review', 'revise_resubmit', 'approved', 'rejected', 'closed']);
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            packageName: payload.packageName || payload.package_name || row.package_name,
            responsible: payload.responsible || payload.owner || payload.assignee || row.responsible,
            reviewer: payload.reviewer || row.reviewer,
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            submittedAt: payload.submittedAt || payload.submitted_at || row.submitted_at || (submittedStatuses.has(requestedStatus) ? next.closedAt : null),
            approvedAt: payload.approvedAt || payload.approved_at || row.approved_at || (['approved', 'closed'].includes(requestedStatus) ? next.closedAt : null),
            attachments: payload.attachments || payload.documents || payload.files
              ? normalizeList(payload.attachments || payload.documents || payload.files)
              : fromJson(row.attachments_json, [])
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE submittal_records
            SET title = ?, package_name = ?, status = ?, responsible = ?, reviewer = ?, due_at = ?, submitted_at = ?, approved_at = ?, approval_id = ?, attachments_json = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.packageName, values.status, values.responsible, values.reviewer, values.dueAt, values.submittedAt, values.approvedAt, values.approvalId, toJson(values.attachments, []), toJson(values.data), timestamp, recordId, jobId);
        }
      },
      document: {
        table: 'documents',
        targetType: 'document',
        map: row => this.mapDocument(row),
        label: 'document review',
        allowedStatuses: new Set(['stored', 'draft', 'needs_review', 'needs_update', 'approved', 'rejected', 'expired', 'archived']),
        approvalStatuses: new Set(['approved']),
        terminalStatuses: new Set(['approved', 'rejected', 'archived']),
        validate(row, requestedStatus) {
          if (requestedStatus !== 'approved') return;
          const reference = payload.verificationReference || payload.verification_reference || payload.reference;
          if (!normalizeText(reference, '') || !normalizeText(payload.notes || payload.note, '')) {
            const error = new Error('Document review reference and evidence are required before approval');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          const existingData = fromJson(row.data_json, {});
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: {
              ...next.data,
              tags: normalizeList(existingData.tags),
              analysis: existingData.analysis || null,
              verificationReference: payload.verificationReference || payload.verification_reference || payload.reference || existingData.verificationReference || null,
              reviewedBy: payload.reviewedBy || payload.reviewed_by || actor
            },
            type: normalizeStatus(payload.documentType || payload.document_type, row.type),
            title: normalizeText(payload.title, row.title)
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE documents
            SET type = ?, title = ?, status = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.type, values.title, values.status, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      permit: {
        table: 'permit_records',
        targetType: 'permit_record',
        map: row => this.mapPermit(row),
        label: 'permit',
        allowedStatuses: new Set(['draft', 'pending', 'needs_renewal', 'submitted', 'active', 'approved', 'expired', 'closed']),
        approvalStatuses: new Set(['submitted', 'active', 'approved']),
        terminalStatuses: new Set(['active', 'approved', 'expired', 'closed']),
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            permitType: normalizeStatus(payload.permitType || payload.permit_type, row.permit_type),
            title: normalizeText(payload.title, row.title),
            holder: payload.holder || payload.owner || row.holder,
            location: payload.location || row.location,
            issuedAt: payload.issuedAt || payload.issued_at || row.issued_at || (['submitted', 'active', 'approved'].includes(next.data.requestedStatus) ? next.closedAt : null),
            expiresAt: payload.expiresAt || payload.expires_at || payload.expiry || row.expires_at
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE permit_records
            SET permit_type = ?, title = ?, status = ?, holder = ?, location = ?, issued_at = ?, expires_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.permitType, values.title, values.status, values.holder, values.location, values.issuedAt, values.expiresAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      inspection: {
        table: 'inspection_records',
        targetType: 'inspection_record',
        map: row => this.mapInspection(row),
        label: 'inspection',
        allowedStatuses: new Set(['scheduled', 'in_progress', 'pending_review', 'failed', 'passed', 'completed', 'closed']),
        approvalStatuses: new Set(['failed', 'passed', 'completed', 'closed']),
        terminalStatuses: new Set(['failed', 'passed', 'completed', 'closed']),
        update(row, next) {
          const requestedStatus = next.data.requestedStatus;
          const result = payload.result || (requestedStatus === 'passed' ? 'passed' : requestedStatus === 'failed' ? 'failed' : row.result);
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            inspectionType: normalizeStatus(payload.inspectionType || payload.inspection_type, row.inspection_type),
            title: normalizeText(payload.title, row.title),
            result: normalizeStatus(result, 'pending'),
            inspector: payload.inspector || payload.owner || row.inspector,
            scheduledAt: payload.scheduledAt || payload.scheduled_at || row.scheduled_at,
            completedAt: payload.completedAt || payload.completed_at || row.completed_at || next.closedAt,
            defects: payload.defects || payload.defectList || payload.defect_list
              ? normalizeList(payload.defects || payload.defectList || payload.defect_list)
              : fromJson(row.defects_json, [])
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE inspection_records
            SET inspection_type = ?, title = ?, status = ?, result = ?, inspector = ?, scheduled_at = ?, completed_at = ?, defects_json = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.inspectionType, values.title, values.status, values.result, values.inspector, values.scheduledAt, values.completedAt, toJson(values.defects, []), values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      safety_meeting: {
        table: 'safety_meetings',
        targetType: 'safety_meeting',
        map: row => this.mapSafetyMeeting(row),
        label: 'safety meeting',
        allowedStatuses: new Set(['scheduled', 'in_progress', 'completed', 'approved', 'client_visible', 'cancelled']),
        approvalStatuses: new Set(['completed', 'approved', 'client_visible']),
        terminalStatuses: new Set(['completed', 'approved', 'client_visible', 'cancelled']),
        validate(row, requestedStatus) {
          if (this.approvalStatuses.has(requestedStatus) && !normalizeText(payload.notes || payload.note, '')) {
            const error = new Error('Safety meeting evidence is required before sign-off');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            meetingType: normalizeStatus(payload.meetingType || payload.meeting_type, row.meeting_type),
            title: normalizeText(payload.title, row.title),
            facilitator: payload.facilitator || payload.owner || row.facilitator,
            scheduledAt: payload.scheduledAt || payload.scheduled_at || row.scheduled_at,
            completedAt: payload.completedAt || payload.completed_at || row.completed_at || next.closedAt,
            attendees: payload.attendees ? normalizeList(payload.attendees) : fromJson(row.attendees_json, []),
            topics: payload.topics ? normalizeList(payload.topics) : fromJson(row.topics_json, [])
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE safety_meetings
            SET meeting_type = ?, title = ?, status = ?, facilitator = ?, scheduled_at = ?, completed_at = ?, attendees_json = ?, topics_json = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.meetingType, values.title, values.status, values.facilitator, values.scheduledAt, values.completedAt, toJson(values.attendees, []), toJson(values.topics, []), values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      worker_instruction: {
        table: 'worker_instructions',
        targetType: 'worker_instruction',
        map: row => this.mapWorkerInstruction(row),
        label: 'worker instruction',
        allowedStatuses: new Set(['draft', 'in_review', 'published', 'approved', 'sent', 'dispatched', 'cancelled', 'rejected']),
        approvalStatuses: new Set(['published', 'approved', 'sent', 'dispatched']),
        terminalStatuses: new Set(['published', 'approved', 'sent', 'dispatched', 'cancelled', 'rejected']),
        validate(row, requestedStatus) {
          if (this.approvalStatuses.has(requestedStatus) && !normalizeText(payload.notes || payload.note, '')) {
            const error = new Error('Worker instruction review evidence is required before publication approval');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: {
              ...next.data,
              reviewedBy: payload.reviewedBy || payload.reviewed_by || actor,
              deliveryConfirmed: false
            },
            title: normalizeText(payload.title, row.title),
            body: payload.body !== undefined ? normalizeText(payload.body, '') : row.body
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE worker_instructions
            SET title = ?, body = ?, status = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.body, values.status, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      orientation: {
        table: 'worker_orientations',
        targetType: 'worker_orientation',
        map: row => this.mapWorkerOrientation(row),
        label: 'worker orientation',
        allowedStatuses: new Set(['scheduled', 'in_progress', 'completed', 'approved', 'cleared', 'valid', 'expired', 'rejected']),
        approvalStatuses: new Set(['completed', 'approved', 'cleared', 'valid']),
        terminalStatuses: new Set(['completed', 'approved', 'cleared', 'valid', 'expired', 'rejected']),
        validate(row, requestedStatus) {
          if (this.approvalStatuses.has(requestedStatus) && !normalizeText(payload.notes || payload.note, '')) {
            const error = new Error('Orientation completion evidence is required before clearance');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: {
              ...next.data,
              verificationReference: payload.verificationReference || payload.verification_reference || fromJson(row.data_json, {}).verificationReference || null,
              grantsAccess: false
            },
            workerName: normalizeText(payload.workerName || payload.worker_name, row.worker_name || 'Crew member'),
            company: normalizeText(payload.company, row.company || 'Internal crew'),
            language: normalizeText(payload.language, row.language || 'nl'),
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            completedAt: payload.completedAt || payload.completed_at || row.completed_at || next.closedAt
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE worker_orientations
            SET worker_name = ?, company = ?, status = ?, language = ?, due_at = ?, completed_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.workerName, values.company, values.status, values.language, values.dueAt, values.completedAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      jha: {
        table: 'jha_records',
        targetType: 'jha_record',
        map: row => this.mapJha(row),
        label: 'JHA',
        allowedStatuses: new Set(['draft', 'in_review', 'approved', 'issued', 'accepted', 'completed', 'signed_off', 'client_visible']),
        approvalStatuses: new Set(['approved', 'issued', 'accepted', 'completed', 'signed_off', 'client_visible']),
        terminalStatuses: new Set(['approved', 'issued', 'accepted', 'completed', 'signed_off', 'client_visible']),
        validate(row, requestedStatus) {
          const hazards = payload.hazards ? normalizeList(payload.hazards) : fromJson(row.hazards_json, []);
          const controls = payload.controls ? normalizeList(payload.controls) : fromJson(row.controls_json, []);
          if (this.approvalStatuses.has(requestedStatus) && (!hazards.length || !controls.length || !normalizeText(payload.notes || payload.note, ''))) {
            const error = new Error('JHA hazards, controls, and review evidence are required before approval');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            riskLevel: normalizePriority(payload.riskLevel || payload.risk_level || row.risk_level),
            assignee: payload.assignee || payload.owner || row.assignee,
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            approvedAt: payload.approvedAt || payload.approved_at || row.approved_at || next.closedAt,
            hazards: payload.hazards ? normalizeList(payload.hazards) : fromJson(row.hazards_json, []),
            controls: payload.controls ? normalizeList(payload.controls) : fromJson(row.controls_json, [])
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE jha_records
            SET title = ?, status = ?, risk_level = ?, assignee = ?, due_at = ?, approved_at = ?, hazards_json = ?, controls_json = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.status, values.riskLevel, values.assignee, values.dueAt, values.approvedAt, toJson(values.hazards, []), toJson(values.controls, []), values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      sds: {
        table: 'sds_sheets',
        targetType: 'sds_sheet',
        map: row => this.mapSdsSheet(row),
        label: 'SDS sheet',
        allowedStatuses: new Set(['missing', 'requested', 'pending_review', 'current', 'approved', 'accepted', 'active', 'expired']),
        approvalStatuses: new Set(['current', 'approved', 'accepted', 'active']),
        terminalStatuses: new Set(['current', 'approved', 'accepted', 'active', 'expired']),
        validate(row, requestedStatus) {
          const existingData = fromJson(row.data_json, {});
          const documentRef = payload.documentRef || payload.document_ref || normalizeList(payload.evidence)[0] || existingData.documentRef;
          if (this.approvalStatuses.has(requestedStatus) && (!normalizeText(documentRef, '') || !normalizeText(payload.notes || payload.note, ''))) {
            const error = new Error('SDS document reference and review evidence are required before current status');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          const existingData = fromJson(row.data_json, {});
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: {
              ...next.data,
              documentRef: payload.documentRef || payload.document_ref || normalizeList(payload.evidence)[0] || existingData.documentRef || null,
              hazardClass: payload.hazardClass || payload.hazard_class || existingData.hazardClass || null,
              storage: payload.storage || existingData.storage || null
            },
            material: normalizeText(payload.material || payload.title || payload.name, row.material),
            supplier: payload.supplier || row.supplier,
            expiresAt: payload.expiresAt || payload.expires_at || row.expires_at
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE sds_sheets
            SET material = ?, supplier = ?, status = ?, expires_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.material, values.supplier, values.status, values.expiresAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      site_access: {
        table: 'site_access_logs',
        targetType: 'site_access_log',
        map: row => this.mapSiteAccessLog(row),
        label: 'site access',
        allowedStatuses: new Set(['requested', 'blocked', 'pending_approval', 'cleared', 'approved', 'granted', 'checked_in', 'checked_out', 'denied']),
        approvalStatuses: new Set(['cleared', 'approved', 'granted', 'checked_in']),
        terminalStatuses: new Set(['checked_out', 'denied']),
        validate: (row, requestedStatus) => {
          if (!['cleared', 'approved', 'granted', 'checked_in'].includes(requestedStatus)) return;
          const orientation = this.resolveSiteAccessOrientation(jobId, row);
          if (!orientation || !['completed', 'approved', 'cleared', 'valid'].includes(normalizeStatus(orientation.status, 'scheduled'))) {
            const error = new Error('Completed orientation approval is required before site access clearance');
            error.statusCode = 409;
            throw error;
          }
        },
        update: (row, next) => {
          const orientation = this.resolveSiteAccessOrientation(jobId, row);
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            orientationId: orientation?.id || row.orientation_id,
            workerName: normalizeText(payload.workerName || payload.worker_name, row.worker_name || orientation?.worker_name || 'Crew member'),
            company: normalizeText(payload.company, row.company || orientation?.company || 'Internal crew'),
            orientationValid: Boolean(orientation && ['completed', 'approved', 'cleared', 'valid'].includes(normalizeStatus(orientation.status, 'scheduled'))),
            checkedInAt: payload.checkedInAt || payload.checked_in_at || row.checked_in_at,
            checkedOutAt: payload.checkedOutAt || payload.checked_out_at || row.checked_out_at || (next.data.requestedStatus === 'checked_out' ? next.closedAt : null)
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE site_access_logs
            SET orientation_id = ?, worker_name = ?, company = ?, status = ?, orientation_valid = ?, checked_in_at = ?, checked_out_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.orientationId, values.workerName, values.company, values.status, values.orientationValid ? 1 : 0, values.checkedInAt, values.checkedOutAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      quality_check: {
        table: 'quality_checks',
        targetType: 'quality_check',
        map: row => this.mapQualityCheck(row),
        label: 'quality check',
        allowedStatuses: new Set(['pending_review', 'in_progress', 'passed', 'approved', 'rejected', 'closed']),
        approvalStatuses: new Set(['passed', 'approved', 'closed']),
        terminalStatuses: new Set(['passed', 'approved', 'rejected', 'closed']),
        validate(row, requestedStatus) {
          const defects = payload.defects !== undefined ? normalizeList(payload.defects) : fromJson(row.defects_json, []);
          if (this.approvalStatuses.has(requestedStatus) && (defects.length || !normalizeText(payload.notes || payload.note, ''))) {
            const error = new Error('Quality defects must be explicitly cleared with sign-off evidence');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          const defects = payload.defects !== undefined ? normalizeList(payload.defects) : fromJson(row.defects_json, []);
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: { ...next.data, defectsOpen: defects.length },
            checkType: normalizeStatus(payload.checkType || payload.check_type, row.check_type),
            title: normalizeText(payload.title, row.title),
            result: normalizeStatus(payload.result || (['passed', 'approved', 'closed'].includes(next.data.requestedStatus) ? 'passed' : row.result), 'pending'),
            inspector: payload.inspector || payload.owner || row.inspector,
            checkedAt: payload.checkedAt || payload.checked_at || row.checked_at || next.closedAt,
            defects
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE quality_checks
            SET check_type = ?, title = ?, status = ?, result = ?, inspector = ?, checked_at = ?, defects_json = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.checkType, values.title, values.status, values.result, values.inspector, values.checkedAt, toJson(values.defects, []), values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      safety_check: {
        table: 'safety_checks',
        targetType: 'safety_check',
        map: row => this.mapSafetyCheck(row),
        label: 'safety check',
        allowedStatuses: new Set(['open', 'pending_review', 'in_progress', 'completed', 'approved', 'closed']),
        approvalStatuses: new Set(['completed', 'approved', 'closed']),
        terminalStatuses: new Set(['completed', 'approved', 'closed']),
        validate(row, requestedStatus) {
          if (this.approvalStatuses.has(requestedStatus) && !normalizeText(payload.notes || payload.note, '')) {
            const error = new Error('Safety check evidence is required before sign-off');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: {
              ...next.data,
              hazards: payload.hazards ? normalizeList(payload.hazards) : normalizeList(fromJson(row.data_json, {}).hazards)
            },
            checkType: normalizeStatus(payload.checkType || payload.check_type, row.check_type),
            title: normalizeText(payload.title, row.title),
            riskLevel: normalizeStatus(payload.riskLevel || payload.risk_level, row.risk_level),
            assignee: payload.assignee || payload.owner || row.assignee,
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            completedAt: payload.completedAt || payload.completed_at || row.completed_at || next.closedAt
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE safety_checks
            SET check_type = ?, title = ?, status = ?, risk_level = ?, assignee = ?, due_at = ?, completed_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.checkType, values.title, values.status, values.riskLevel, values.assignee, values.dueAt, values.completedAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      observation: {
        table: 'observation_records',
        targetType: 'observation_record',
        map: row => this.mapObservation(row),
        label: 'observation',
        allowedStatuses: new Set(['open', 'in_progress', 'resolved', 'closed']),
        approvalStatuses: new Set(['resolved', 'closed']),
        approvalForHighRisk: true,
        terminalStatuses: new Set(['resolved', 'closed']),
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            responsible: payload.responsible || payload.owner || row.responsible,
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            closedAt: next.closedAt
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE observation_records
            SET title = ?, status = ?, responsible = ?, due_at = ?, closed_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.status, values.responsible, values.dueAt, values.closedAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      incident: {
        table: 'incident_records',
        targetType: 'incident_record',
        map: row => this.mapIncident(row),
        label: 'incident',
        allowedStatuses: new Set(['reported', 'under_review', 'escalated', 'resolved', 'closed']),
        approvalStatuses: new Set(['escalated', 'resolved', 'closed']),
        approvalForHighRisk: true,
        terminalStatuses: new Set(['resolved', 'closed']),
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            resolvedAt: next.closedAt
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE incident_records
            SET title = ?, status = ?, resolved_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.status, values.resolvedAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      selection: {
        table: 'client_selections',
        targetType: 'client_selection',
        map: row => this.mapClientSelection(row),
        label: 'client selection',
        allowedStatuses: new Set(['pending_client', 'client_confirmed', 'selected', 'accepted', 'approved', 'locked', 'cancelled', 'rejected']),
        approvalStatuses: new Set(['client_confirmed', 'selected', 'accepted', 'approved', 'locked']),
        terminalStatuses: new Set(['client_confirmed', 'selected', 'accepted', 'approved', 'locked', 'cancelled', 'rejected']),
        validate(row, requestedStatus) {
          if (!this.approvalStatuses.has(requestedStatus)) return;
          const selectedOption = normalizeText(payload.selectedOption || payload.selected_option, '');
          const verificationReference = normalizeText(
            payload.verificationReference || payload.verification_reference || payload.reference,
            ''
          );
          const options = fromJson(row.options_json, []);
          if (!selectedOption || !verificationReference || !normalizeText(payload.notes || payload.note, '')) {
            const error = new Error('Selected option, client confirmation reference, and decision evidence are required');
            error.statusCode = 400;
            throw error;
          }
          if (options.length && !options.some(option => String(option).trim() === selectedOption)) {
            const error = new Error('Selected option must match a retained client-selection option');
            error.statusCode = 400;
            throw error;
          }
        },
        update(row, next) {
          const existingData = fromJson(row.data_json, {});
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: {
              ...next.data,
              selectedOption: payload.selectedOption || payload.selected_option || existingData.selectedOption || null,
              verificationReference: payload.verificationReference || payload.verification_reference || payload.reference || existingData.verificationReference || null,
              clientConfirmed: normalizeBoolean(payload.clientConfirmed ?? payload.client_confirmed, true),
              source: payload.source || existingData.source || 'operator_confirmation'
            },
            title: normalizeText(payload.title, row.title),
            category: normalizeStatus(payload.category, row.category),
            clientName: payload.clientName || payload.client_name || row.client_name,
            currency: normalizeText(payload.currency, row.currency || 'EUR').toUpperCase(),
            value: normalizeNumber(payload.value ?? payload.amount, row.value),
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            decidedAt: payload.decidedAt || payload.decided_at || row.decided_at || next.closedAt,
            options: fromJson(row.options_json, [])
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE client_selections
            SET title = ?, category = ?, status = ?, client_name = ?, currency = ?, value = ?, due_at = ?, decided_at = ?, approval_id = ?, options_json = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.category, values.status, values.clientName, values.currency, values.value, values.dueAt, values.decidedAt, values.approvalId, toJson(values.options, []), toJson(values.data), timestamp, recordId, jobId);
        }
      },
      punch_item: {
        table: 'punch_items',
        targetType: 'punch_item',
        map: row => this.mapPunchItem(row),
        label: 'punch item',
        allowedStatuses: new Set(['open', 'in_progress', 'resolved', 'verified', 'closed']),
        approvalStatuses: new Set(['resolved', 'verified', 'closed']),
        terminalStatuses: new Set(['resolved', 'verified', 'closed']),
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            assignee: payload.assignee || payload.owner || row.assignee,
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            closedAt: next.closedAt
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE punch_items
            SET title = ?, status = ?, assignee = ?, due_at = ?, closed_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.status, values.assignee, values.dueAt, values.closedAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      warranty_claim: {
        table: 'warranty_claims',
        targetType: 'warranty_claim',
        map: row => this.mapWarrantyClaim(row),
        label: 'warranty claim',
        allowedStatuses: new Set(['open', 'under_review', 'resolved', 'rejected', 'closed']),
        approvalStatuses: new Set(['resolved', 'rejected', 'closed']),
        terminalStatuses: new Set(['resolved', 'rejected', 'closed']),
        update(row, next) {
          return {
            status: next.status,
            approvalId: next.approvalId,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            resolvedAt: next.closedAt
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE warranty_claims
            SET title = ?, status = ?, due_at = ?, resolved_at = ?, approval_id = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.status, values.dueAt, values.resolvedAt, values.approvalId, toJson(values.data), timestamp, recordId, jobId);
        }
      },
      aftercare: {
        table: 'aftercare_items',
        targetType: null,
        map: row => this.mapAftercareItem(row),
        label: 'aftercare item',
        allowedStatuses: new Set(['open', 'in_progress', 'completed', 'closed']),
        approvalStatuses: new Set(),
        terminalStatuses: new Set(['completed', 'closed']),
        update(row, next) {
          return {
            status: next.status,
            data: next.data,
            title: normalizeText(payload.title, row.title),
            owner: payload.owner || payload.assignee || row.owner,
            dueAt: payload.dueAt || payload.due_at || row.due_at,
            completedAt: next.closedAt,
            notes: payload.notes || payload.note || row.notes
          };
        },
        save(recordId, values, timestamp) {
          this.db.prepare(`
            UPDATE aftercare_items
            SET title = ?, status = ?, owner = ?, due_at = ?, completed_at = ?, notes = ?, data_json = ?, updated_at = ?
            WHERE id = ? AND job_id = ?
          `).run(values.title, values.status, values.owner, values.dueAt, values.completedAt, values.notes, toJson(values.data), timestamp, recordId, jobId);
        }
      }
    }[normalizedType];

    if (!config) {
      const error = new Error('Unsupported lifecycle record type');
      error.statusCode = 400;
      throw error;
    }

    return this.transaction(() => {
      const row = this.db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND job_id = ?`).get(recordId, jobId);
      if (!row) {
        const error = new Error(`${config.label} not found for this job`);
        error.statusCode = 404;
        throw error;
      }

      const requestedStatus = normalizeStatus(payload.status, row.status);
      if (!config.allowedStatuses.has(requestedStatus)) {
        const error = new Error(`Unsupported ${config.label} status`);
        error.statusCode = 400;
        throw error;
      }
      if (config.validate) config.validate.call(config, row, requestedStatus);

      const before = config.map(row);
      const timestamp = nowIso();
      const highRiskTransition = config.approvalForHighRisk === true
        && ['high', 'critical'].includes(normalizePriority(row.severity));
      const needsApproval = Boolean(config.targetType) && (
        config.approvalStatuses.has(requestedStatus)
        || highRiskTransition
        || normalizeBoolean(payload.requiresApproval, false)
      );
      const existingData = fromJson(row.data_json, {});
      const transition = {
        requestedStatus,
        previousStatus: normalizeStatus(row.status, 'open'),
        note: payload.notes || payload.note || null,
        correctiveAction: payload.correctiveAction || payload.corrective_action || null,
        resolution: payload.resolution || null,
        evidence: normalizeList(payload.evidence || payload.photos),
        requestedBy: actor,
        requestedAt: timestamp
      };
      const nextData = {
        ...existingData,
        requestedStatus,
        lifecycleTransition: transition
      };
      const storedStatus = needsApproval && config.approvalStatuses.has(requestedStatus)
        ? 'pending_approval'
        : requestedStatus;
      const next = {
        status: storedStatus,
        approvalId: row.approval_id || null,
        data: nextData,
        closedAt: config.terminalStatuses.has(requestedStatus) && !needsApproval
          ? (payload.closedAt || payload.closed_at || payload.resolvedAt || payload.resolved_at || timestamp)
          : null
      };

      let approval = null;
      if (needsApproval && config.targetType) {
        const pending = this.db.prepare(`
          SELECT * FROM approvals
          WHERE target_type = ? AND target_id = ? AND status = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
        `).get(config.targetType, recordId);
        if (pending) {
          this.db.prepare(`
            UPDATE approvals
            SET summary = ?, reason = ?, data_json = ?, updated_at = ?
            WHERE id = ?
          `).run(
            `Approve ${config.label} transition to ${requestedStatus}`,
            `Changing this ${config.label} to ${requestedStatus} can affect safety, closeout, or client commitments and requires explicit review.`,
            toJson({ requestedStatus, transition }),
            timestamp,
            pending.id
          );
          approval = this.mapApproval(this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(pending.id));
        } else {
          approval = this.createApproval({
            targetType: config.targetType,
            targetId: recordId,
            jobId,
            approvalType: `${normalizedType}_lifecycle_transition`,
            summary: `Approve ${config.label} transition to ${requestedStatus}`,
            reason: `Changing this ${config.label} to ${requestedStatus} can affect safety, closeout, or client commitments and requires explicit review.`,
            data: { requestedStatus, transition }
          }, { actor, audit: false });
        }
        next.approvalId = approval.id;
      }

      const values = config.update(row, next);
      config.save.call(this, recordId, values, timestamp);
      const afterRow = this.db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(recordId);
      const record = config.map(afterRow);
      this.audit({
        entityType: config.entityType || config.targetType || 'aftercare_item',
        entityId: recordId,
        jobId,
        action: `transition_${normalizedType}`,
        actor,
        before,
        after: record,
        metadata: {
          requestedStatus,
          approvalId: approval?.id || null,
          approvalRequired: Boolean(approval)
        }
      });
      return { record, approval, approvalRequired: Boolean(approval) };
    });
  }

  createRecurringPlan(jobId, payload = {}, options = {}) {
    const job = this.requireJob(jobId);
    const actor = options.actor || 'Contractor.AI';
    const id = makeId('recurring');
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO recurring_plans (id, job_id, client_id, service, status, interval_rule, next_due_at, last_created_job_id, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      job.client_id,
      normalizeText(payload.service || job.job_type, 'maintenance'),
      normalizeStatus(payload.status, 'active'),
      normalizeText(payload.intervalRule || payload.interval_rule || payload.interval, 'monthly'),
      payload.nextDueAt || payload.next_due_at || futureIsoDate(30),
      payload.lastCreatedJobId || payload.last_created_job_id || null,
      toJson({
        notes: payload.notes || null,
        templateJobTitle: payload.templateJobTitle || job.title,
        approvalRequiredBeforeBooking: payload.approvalRequiredBeforeBooking !== false
      }),
      timestamp,
      timestamp
    );
    const plan = this.mapRecurringPlan(this.db.prepare('SELECT * FROM recurring_plans WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'recurring_plan', entityId: id, jobId, action: 'create_recurring_plan', actor, after: plan });
    }
    return plan;
  }

  prepareRecurringServiceJob(recurringPlanId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const planRow = this.db.prepare('SELECT * FROM recurring_plans WHERE id = ?').get(recurringPlanId);
      if (!planRow) return null;
      const sourceJob = this.requireJob(planRow.job_id);
      const client = this.mapClient(this.db.prepare('SELECT * FROM clients WHERE id = ?').get(planRow.client_id || sourceJob.client_id));
      const planData = fromJson(planRow.data_json);
      const dueAt = payload.nextDueAt || payload.next_due_at || planRow.next_due_at || futureIsoDate(7);
      const nextDueAt = nextRecurringDueDate(dueAt, planRow.interval_rule);
      const service = normalizeText(payload.service || planRow.service || sourceJob.job_type, 'recurring service');
      const jobTitle = normalizeText(
        payload.title || payload.jobTitle || `Recurring ${service}: ${client.name}`,
        `Recurring ${service}: ${client.name}`
      );

      const followUp = this.createIntake({
        client: {
          id: client.id,
          name: client.name,
          company: client.company,
          email: client.email,
          phone: client.phone,
          address: client.address,
          city: client.city,
          country: client.country,
          preferredLanguage: client.preferredLanguage
        },
        sourceChannel: 'recurring_plan',
        service,
        title: jobTitle,
        description: payload.description || planData.notes || `Prepared from recurring plan ${planRow.id}. Confirm scope, access, weather, crew, tools, and client availability before booking.`,
        address: payload.address || sourceJob.address || client.address || '',
        city: payload.city || sourceJob.city || client.city || '',
        region: payload.region || sourceJob.region || '',
        country: payload.country || sourceJob.country || client.country || 'NL',
        priority: payload.priority || 'medium',
        status: payload.status || 'intake',
        targetCompletion: dueAt,
        estimatedHours: payload.estimatedHours || sourceJob.estimated_hours || 4,
        estimatedCost: payload.estimatedCost || sourceJob.estimated_cost || 0,
        contractValue: payload.contractValue || sourceJob.contract_value || sourceJob.estimated_cost || 0,
        assignAutomatically: false,
        tasks: [
          { title: `Confirm recurring ${service} scope with client`, priority: 'medium', dueAt },
          { title: 'Check access, parking, weather, and field constraints', priority: 'medium', dueAt },
          { title: 'Review crew, tools, materials, quote, and invoice assumptions before booking', priority: 'medium', dueAt }
        ],
        tools: [],
        materials: []
      }, { actor, audit: false });

      const timestamp = nowIso();
      this.db.prepare(`
        UPDATE recurring_plans
        SET last_created_job_id = ?, next_due_at = ?, updated_at = ?
        WHERE id = ?
      `).run(followUp.id, nextDueAt, timestamp, recurringPlanId);

      const updatedPlan = this.mapRecurringPlan(this.db.prepare('SELECT * FROM recurring_plans WHERE id = ?').get(recurringPlanId));
      this.audit({
        entityType: 'recurring_plan',
        entityId: recurringPlanId,
        jobId: sourceJob.id,
        action: 'prepare_recurring_service_job',
        actor,
        after: {
          recurringPlan: updatedPlan,
          recurringJobId: followUp.id,
          sourceJobId: sourceJob.id,
          nextDueAt
        },
        metadata: {
          recurringJobId: followUp.id,
          sourceJobId: sourceJob.id,
          nextDueAt
        }
      });
      this.audit({
        entityType: 'job',
        entityId: followUp.id,
        jobId: followUp.id,
        action: 'create_recurring_service_job',
        actor,
        after: {
          recurringPlanId,
          sourceJobId: sourceJob.id,
          nextDueAt
        }
      });

      return {
        recurringPlan: updatedPlan,
        recurringJob: followUp,
        nextDueAt
      };
    });
  }

  createCloseoutPackage(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const job = this.requireJob(jobId);
      const detail = this.getJobDetail(jobId, { includeAudit: false });
      let completion = null;
      if (payload.markCompleted !== false && job.status !== 'completed') {
        completion = this.updateJobWithApproval(jobId, {
          status: 'completed',
          progressPercent: 100,
          reason: payload.completionNote || 'Closeout package requested completed job status.'
        }, { actor });
      }

      const existingQuality = detail.qualityChecks?.[0] || null;
      const quality = existingQuality || this.addQualityCheck(jobId, {
        title: payload.qualityTitle || `Final quality review: ${job.title}`,
        status: payload.qualityStatus || 'pending_review',
        result: payload.qualityResult || 'pending',
        defects: payload.defects || [],
        defectsOpen: payload.defectsOpen || 0,
        notes: payload.qualityNotes || 'Confirm workmanship, client-visible defects, photos, and Wkb evidence before final acceptance.'
      }, { actor, audit: false });
      const safetyTitle = payload.safetyTitle || `Final safety closeout: ${job.title}`;
      const existingSafety = (detail.safetyChecks || []).find(check =>
        String(check.title || '').toLowerCase() === safetyTitle.toLowerCase()
      ) || null;
      const safety = existingSafety || this.addSafetyCheck(jobId, {
        title: safetyTitle,
        status: payload.safetyStatus || 'open',
        riskLevel: payload.riskLevel || 'normal',
        dueAt: payload.safetyDueAt || futureIsoDate(1),
        notes: payload.safetyNotes || 'Confirm site is safe, tools are removed, and access is restored.'
      }, { actor, audit: false });
      const existingAftercare = detail.aftercare?.[0] || null;
      const aftercare = existingAftercare || this.addAftercareItem(jobId, {
        title: payload.aftercareTitle || `Aftercare follow-up: ${job.title}`,
        dueAt: payload.aftercareDueAt || futureIsoDate(7),
        notes: payload.aftercareNotes || 'Check client satisfaction, warranty issues, maintenance opportunity, and review request.'
      }, { actor, audit: false });

      const existingInvoice = detail.invoices?.[0] || null;
      const invoice = existingInvoice
        ? existingInvoice
        : this.createInvoice(jobId, {
          amount: normalizeNumber(payload.amount, job.contract_value || job.estimated_cost || 0),
          taxAmount: normalizeNumber(payload.taxAmount || payload.tax_amount, normalizeNumber(payload.amount, job.contract_value || job.estimated_cost || 0) * 0.21),
          total: normalizeNumber(payload.total, normalizeNumber(payload.amount, job.contract_value || job.estimated_cost || 0) * 1.21),
          dueAt: payload.invoiceDueAt || futureIsoDate(14),
          notes: 'Created from job closeout package.'
        }, { actor, audit: false });
      const existingPayment = (detail.payments || []).find(record => record.invoiceId === invoice.id) || null;
      const payment = existingPayment || this.recordPayment(jobId, {
        invoiceId: invoice.id,
        amount: invoice.total,
        dueAt: payload.paymentDueAt || invoice.dueAt || futureIsoDate(14),
        status: invoice.status === 'approved' ? 'awaiting_payment' : 'awaiting_invoice_approval',
        notes: 'Payment follow-up created from closeout package.'
      }, { actor, audit: false });
      const existingCommunication = (detail.communications || []).find(message => {
        const content = `${message.subject || ''} ${message.body || ''}`.toLowerCase();
        return normalizeStatus(message.direction, '') === 'outbound'
          && (content.includes('closeout') || content.includes('completion') || content.includes('aftercare') || content.includes('handover'));
      }) || null;
      const communication = existingCommunication || this.addCommunication(jobId, {
        channel: payload.channel || 'portal',
        direction: 'outbound',
        subject: payload.subject || `Closeout and next steps: ${job.title}`,
        body: payload.message || 'Draft client closeout update: confirm completion, share invoice timing, and schedule aftercare follow-up.',
        status: 'draft',
        requiresApproval: true
      }, { actor, audit: false });

      let recurringPlan = null;
      if (payload.createRecurringPlan === true) {
        recurringPlan = (detail.recurringPlans || []).find(plan =>
          !['cancelled', 'canceled', 'inactive', 'closed'].includes(normalizeStatus(plan.status, 'draft'))
        ) || this.createRecurringPlan(jobId, {
          service: payload.recurringService || job.job_type,
          intervalRule: payload.intervalRule || 'monthly',
          nextDueAt: payload.nextDueAt || futureIsoDate(30),
          notes: payload.recurringNotes || 'Recurring maintenance plan proposed from closeout.'
        }, { actor, audit: false });
      }

      const packageSummary = {
        jobId,
        completion,
        quality,
        safety,
        aftercare,
        invoice,
        payment,
        communication,
        recurringPlan,
        reused: {
          quality: Boolean(existingQuality),
          safety: Boolean(existingSafety),
          aftercare: Boolean(existingAftercare),
          invoice: Boolean(existingInvoice),
          payment: Boolean(existingPayment),
          communication: Boolean(existingCommunication),
          recurringPlan: Boolean(payload.createRecurringPlan && recurringPlan && detail.recurringPlans?.some(plan => plan.id === recurringPlan.id))
        }
      };
      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'create_closeout_package',
        actor,
        after: {
          qualityId: quality.id,
          safetyId: safety.id,
          aftercareId: aftercare.id,
          invoiceId: invoice.id,
          paymentId: payment.id,
          communicationId: communication.id,
          completionApprovalId: completion?.approval?.id || null,
          recurringPlanId: recurringPlan?.id || null,
          reused: packageSummary.reused
        }
      });
      return packageSummary;
    });
  }

  assessWeather(jobId, payload = {}, options = {}) {
    const job = this.requireJob(jobId);
    const timestamp = nowIso();
    const precipitation = Math.max(0, Math.min(100, normalizeNumber(payload.precipitationPercent ?? payload.precipitation_percent, 35)));
    const condition = normalizeText(payload.condition, precipitation >= 60 ? 'rain_risk' : 'workable');
    const isOutdoor = payload.weatherSensitive === true
      || payload.weather_sensitive === true
      || /garden|pav|roof|fence|outside|outdoor|painting|clean/i.test(`${job.job_type} ${job.title} ${job.description}`);
    const recommendation = payload.recommendation || (isOutdoor && precipitation >= 60
      ? 'Outdoor work has material weather risk. Draft a reschedule or indoor-work fallback for approval.'
      : isOutdoor
        ? 'Weather is workable, but keep a same-day check before dispatch.'
        : 'Weather is not a primary constraint for this job.');
    const id = makeId('weather');

    this.db.prepare(`
      INSERT INTO schedule_weather (id, job_id, location, forecast_at, condition, precipitation_percent, recommendation, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      jobId,
      payload.location || job.address || job.city || 'Netherlands',
      payload.forecastAt || payload.forecast_at || timestamp,
      condition,
      precipitation,
      recommendation,
      toJson({
        weatherSensitive: isOutdoor,
        source: payload.source || 'local_assessment',
        windKph: payload.windKph ?? payload.wind_kph ?? null,
        windGustKph: payload.windGustKph ?? payload.wind_gust_kph ?? null,
        temperatureC: payload.temperatureC ?? payload.temperature_c ?? null,
        weatherCode: payload.weatherCode ?? payload.weather_code ?? null,
        weatherDescription: payload.weatherDescription ?? payload.weather_description ?? null,
        provider: payload.provider || null,
        fetchedAt: payload.fetchedAt ?? payload.fetched_at ?? null,
        latitude: payload.latitude ?? payload.lat ?? null,
        longitude: payload.longitude ?? payload.lng ?? payload.lon ?? null
      }),
      timestamp
    );

    const weather = this.mapWeather(this.db.prepare('SELECT * FROM schedule_weather WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'weather_assessment', entityId: id, jobId, action: 'assess_weather', actor: options.actor || 'Contractor.AI', after: weather });
    }
    return weather;
  }

  weatherOverview() {
    const row = this.db.prepare(`
      SELECT schedule_weather.*, jobs.title AS job_title
      FROM schedule_weather
      JOIN jobs ON jobs.id = schedule_weather.job_id
      WHERE jobs.status NOT IN ('completed', 'cancelled', 'canceled', 'rejected', 'archived', 'pending_archive_approval')
      ORDER BY schedule_weather.created_at DESC
      LIMIT 1
    `).get();
    if (!row) {
      return {
        status: 'not_assessed',
        location: 'No assessed location',
        condition: 'assessment_required',
        temperature: null,
        precipitation: null,
        recommendation: 'Record a job weather assessment before committing outdoor work.',
        source: 'not_assessed',
        jobTitle: null,
        forecastAt: null
      };
    }
    const weather = this.mapWeather(row);
    return {
      status: ['rain_risk', 'wind_risk', 'storm_risk', 'visibility_risk'].includes(weather.condition) || weather.precipitationPercent >= 60 ? 'risk' : 'workable',
      location: weather.location,
      condition: weather.data?.weatherDescription || weather.condition,
      temperature: weather.data?.temperatureC ?? null,
      precipitation: weather.precipitationPercent,
      windKph: weather.data?.windKph ?? null,
      windGustKph: weather.data?.windGustKph ?? null,
      recommendation: weather.recommendation,
      source: weather.data?.source || 'local_assessment',
      provider: weather.data?.provider?.name || null,
      jobId: weather.jobId,
      jobTitle: row.job_title,
      forecastAt: weather.forecastAt,
      assessedAt: weather.createdAt
    };
  }

  scheduleRecommendationWindow(job = {}, payload = {}) {
    const plannedStart = this.normalizeReservationDate(
      payload.plannedStart || payload.planned_start || payload.scheduledStart || payload.scheduled_start || job.scheduledStart,
      'plannedStart'
    );
    let plannedEnd = this.normalizeReservationDate(
      payload.plannedEnd || payload.planned_end || payload.scheduledEnd || payload.scheduled_end || job.scheduledEnd || job.targetCompletion,
      'plannedEnd'
    );
    const estimatedHours = Math.max(1, normalizeNumber(payload.estimatedHours || payload.estimated_hours || job.estimatedHours, 4));
    if (plannedStart && !plannedEnd) {
      plannedEnd = new Date(Date.parse(plannedStart) + estimatedHours * 60 * 60 * 1000).toISOString();
    }
    if (plannedStart && plannedEnd && Date.parse(plannedStart) > Date.parse(plannedEnd)) {
      const error = new Error('plannedEnd must be after plannedStart');
      error.statusCode = 400;
      throw error;
    }
    return { plannedStart, plannedEnd, estimatedHours };
  }

  workerScheduleCandidates(job = {}, plannedStart = null, plannedEnd = null, jobId = null) {
    const jobText = normalizeText(`${job.title || ''} ${job.jobType || ''} ${job.description || ''} ${job.city || ''} ${job.region || ''}`, '').toLowerCase();
    const jobTerms = new Set(jobText.split(/[^a-z0-9]+/i).filter(term => term.length >= 4));
    const unavailableStatuses = new Set(['offline', 'on_leave', 'on_hold', 'inactive', 'unavailable', 'blocked', 'sick', 'retired']);
    return this.listWorkers({ limit: 250 })
      .filter(worker => normalizeStatus(worker.status, '') !== 'retired')
      .map(worker => {
        const status = normalizeStatus(worker.status, 'available');
        const skills = Array.isArray(worker.skills) ? worker.skills : [];
        const matchedSkills = skills.filter(skill => {
          const terms = normalizeText(skill, '').toLowerCase().split(/[^a-z0-9]+/i).filter(term => term.length >= 4);
          return terms.some(term => jobTerms.has(term) || jobText.includes(term));
        });
        const conflicts = this.findAssignmentConflicts({
          workerId: worker.id,
          scheduledStart: plannedStart,
          scheduledEnd: plannedEnd
        }).filter(conflict => String(conflict.jobId) !== String(jobId));
        const region = normalizeText(worker.homeRegion, '').toLowerCase();
        const regionMatch = region && [job.city, job.region, job.address].some(value => normalizeText(value, '').toLowerCase().includes(region));
        const data = worker.data || {};
        const rating = normalizeNumber(data.rating || data.averageRating || data.qualityRating, 0);
        let score = 50;
        if (['available', 'idle', 'standby'].includes(status)) score += 25;
        if (['active', 'busy', 'on_job', 'traveling'].includes(status)) score -= 30;
        if (status === 'offline') score -= 60;
        score += Math.min(30, matchedSkills.length * 10);
        if (regionMatch) score += 8;
        if (rating) score += Math.min(10, rating * 2);
        if (conflicts.length) score -= 70;
        return {
          worker: {
            id: worker.id,
            name: worker.name,
            role: worker.role,
            status: worker.status,
            homeRegion: worker.homeRegion,
            skills,
            hourlyRate: worker.hourlyRate
          },
          score: Math.max(0, Math.round(score)),
          matchedSkills,
          conflicts,
          available: !conflicts.length && !unavailableStatuses.has(status)
        };
      })
      .sort((left, right) => right.score - left.score || left.worker.name.localeCompare(right.worker.name));
  }

  scheduleToolConflicts(jobId, detail = {}, plannedStart = null, plannedEnd = null) {
    const conflicts = [];
    for (const reservation of detail.tools || []) {
      const reservationConflicts = this.findToolReservationConflicts({
        toolId: reservation.toolId,
        toolName: reservation.toolName,
        neededFrom: plannedStart || reservation.neededFrom,
        neededUntil: plannedEnd || reservation.neededUntil,
        excludeReservationId: reservation.id
      }).filter(conflict => String(conflict.jobId) !== String(jobId));
      for (const conflict of reservationConflicts) {
        conflicts.push({
          reservationId: reservation.id,
          toolId: reservation.toolId,
          toolName: reservation.toolName,
          conflictingReservationId: conflict.reservationId,
          conflictingJobId: conflict.jobId,
          conflictingJobTitle: conflict.jobTitle,
          neededFrom: conflict.neededFrom,
          neededUntil: conflict.neededUntil
        });
      }
    }
    return conflicts;
  }

  workerAssignmentReadiness(assignments = [], { jobId = null, plannedStart = null, plannedEnd = null } = {}) {
    const activeAssignments = (assignments || []).filter(assignment => this.activeAssignmentStatus(assignment.status));
    const unavailableStatuses = new Set(['offline', 'on_leave', 'on_hold', 'inactive', 'unavailable', 'blocked', 'sick', 'retired']);
    const warningStatuses = new Set(['busy', 'traveling']);
    const items = [];
    const blockers = [];
    const warnings = [];
    const nextActions = [];

    for (const assignment of activeAssignments) {
      const assignmentName = assignment.workerName || assignment.workerId || 'Assigned crew member';
      if (!assignment.workerId) {
        const blocker = {
          type: 'worker_record_missing',
          severity: 'high',
          assignmentId: assignment.id,
          workerId: null,
          workerName: assignmentName,
          message: `${assignmentName} has no canonical worker record for live readiness checks.`
        };
        blockers.push(blocker);
        items.push({ assignmentId: assignment.id, workerId: null, workerName: assignmentName, status: 'missing_record', blocked: true });
        continue;
      }

      const row = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(assignment.workerId);
      if (!row) {
        const blocker = {
          type: 'worker_record_missing',
          severity: 'high',
          assignmentId: assignment.id,
          workerId: assignment.workerId,
          workerName: assignmentName,
          message: `${assignmentName} no longer resolves to a retained worker record.`
        };
        blockers.push(blocker);
        items.push({ assignmentId: assignment.id, workerId: assignment.workerId, workerName: assignmentName, status: 'missing_record', blocked: true });
        continue;
      }

      const worker = this.mapWorker(row);
      const workerStatus = normalizeStatus(worker.status, 'available');
      const pendingRetirement = this.db.prepare(`
        SELECT id FROM approvals
        WHERE target_type = 'worker_retirement' AND target_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(worker.id);
      const conflicts = this.findAssignmentConflicts({
        workerId: worker.id,
        scheduledStart: plannedStart || assignment.scheduledStart,
        scheduledEnd: plannedEnd || assignment.scheduledEnd,
        excludeAssignmentId: assignment.id
      }).filter(conflict => String(conflict.jobId) !== String(jobId || assignment.jobId));

      let blocker = null;
      if (pendingRetirement) {
        blocker = {
          type: 'worker_retirement_pending',
          severity: 'high',
          message: `${worker.name} has a pending retirement decision and cannot be treated as dispatch-ready.`,
          approvalId: pendingRetirement.id
        };
      } else if (unavailableStatuses.has(workerStatus)) {
        blocker = {
          type: 'worker_unavailable',
          severity: 'high',
          message: `${worker.name} is marked ${workerStatus.replace(/_/g, ' ')} and blocks dispatch.`,
          workerStatus
        };
      } else if (conflicts.length) {
        blocker = {
          type: 'worker_conflict',
          severity: 'high',
          message: `${worker.name} has ${conflicts.length} conflicting assignment(s) in the dispatch window.`,
          conflicts
        };
      }

      if (blocker) {
        const enrichedBlocker = {
          ...blocker,
          assignmentId: assignment.id,
          workerId: worker.id,
          workerName: worker.name
        };
        blockers.push(enrichedBlocker);
        items.push({
          assignmentId: assignment.id,
          workerId: worker.id,
          workerName: worker.name,
          workerStatus,
          status: blocker.type,
          conflicts: conflicts.length,
          blocked: true
        });
      } else {
        if (warningStatuses.has(workerStatus)) {
          warnings.push(`${worker.name} is marked ${workerStatus}; confirm the retained assignment matches the dispatch window.`);
        }
        items.push({
          assignmentId: assignment.id,
          workerId: worker.id,
          workerName: worker.name,
          workerStatus,
          status: warningStatuses.has(workerStatus) ? 'review' : 'ready',
          conflicts: 0,
          blocked: false
        });
      }
    }

    for (const blocker of blockers.slice(0, 3)) {
      nextActions.push({
        type: 'review_workforce_readiness',
        assignmentId: blocker.assignmentId,
        workerId: blocker.workerId,
        workerName: blocker.workerName,
        message: blocker.message,
        requiresApproval: false
      });
    }

    return {
      status: blockers.length ? 'blocked' : warnings.length ? 'review' : activeAssignments.length ? 'ready' : 'missing',
      assignments: activeAssignments.length,
      blocked: blockers.length,
      warnings: warnings.length,
      conflicts: blockers.filter(blocker => blocker.type === 'worker_conflict').length,
      items,
      blockers,
      warningMessages: warnings,
      nextActions
    };
  }

  crewEvidenceReadiness(detail = {}) {
    const activeAssignments = (detail.assignments || []).filter(assignment => this.activeAssignmentStatus(assignment.status));
    const inactiveStatuses = new Set(['cancelled', 'canceled', 'rejected', 'declined', 'void', 'deleted', 'expired', 'denied', 'checked_out']);
    const readyInstructionStatuses = new Set(['approved', 'sent', 'published', 'dispatched']);
    const readyOrientationStatuses = new Set(['completed', 'approved', 'cleared', 'valid']);
    const readyAccessStatuses = new Set(['cleared', 'approved', 'granted', 'checked_in']);
    const nameCounts = new Map();
    for (const assignment of activeAssignments) {
      const name = normalizeText(assignment.workerName, '').toLowerCase();
      if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }

    const activeRecords = records => (records || []).filter(record => (
      !inactiveStatuses.has(normalizeStatus(record?.status, 'draft'))
    ));
    const allInstructions = detail.workerInstructions || [];
    const allOrientations = detail.orientations || [];
    const allSiteAccessLogs = detail.siteAccessLogs || [];
    const instructions = activeRecords(allInstructions);
    const orientations = activeRecords(allOrientations);
    const siteAccessLogs = activeRecords(allSiteAccessLogs);
    const matchesAssignment = (record, assignment) => {
      const identity = this.crewEvidenceIdentity(record);
      if (identity.assignmentId) return String(identity.assignmentId) === String(assignment.id);
      if (identity.workerId) return Boolean(assignment.workerId) && String(identity.workerId) === String(assignment.workerId);
      const assignmentName = normalizeText(assignment.workerName, '').toLowerCase();
      return Boolean(identity.workerName)
        && Boolean(assignmentName)
        && identity.workerName.toLowerCase() === assignmentName
        && nameCounts.get(assignmentName) === 1;
    };
    const latest = records => [...records].sort((left, right) => (
      Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0)
    ))[0] || null;
    const orientationIsReady = orientation => {
      if (!orientation || !readyOrientationStatuses.has(normalizeStatus(orientation.status, 'scheduled'))) return false;
      const validUntil = orientation.data?.validUntil || null;
      return !validUntil || !Number.isFinite(Date.parse(validUntil)) || Date.parse(validUntil) >= Date.now();
    };
    const accessIsReady = (access, orientationReady) => Boolean(
      access
      && orientationReady
      && access.orientationValid !== false
      && readyAccessStatuses.has(normalizeStatus(access.status, 'requested'))
    );

    const items = activeAssignments.map(assignment => {
      const matchedInstructions = instructions.filter(record => matchesAssignment(record, assignment));
      const matchedOrientations = orientations.filter(record => matchesAssignment(record, assignment));
      const matchedAccessLogs = siteAccessLogs.filter(record => matchesAssignment(record, assignment));
      const instruction = latest(matchedInstructions);
      const orientation = latest(matchedOrientations);
      const siteAccess = latest(matchedAccessLogs);
      const instructionReady = Boolean(instruction && readyInstructionStatuses.has(normalizeStatus(instruction.status, 'draft')));
      const orientationReady = orientationIsReady(orientation);
      const siteAccessReady = accessIsReady(siteAccess, orientationReady);
      return {
        assignmentId: assignment.id,
        workerId: assignment.workerId || null,
        workerName: assignment.workerName || 'Assigned crew member',
        instruction,
        instructionReady,
        instructionStatus: instructionReady ? 'ready' : instruction ? normalizeStatus(instruction.status, 'draft') : 'missing',
        orientation,
        orientationReady,
        orientationStatus: orientationReady ? 'ready' : orientation ? normalizeStatus(orientation.status, 'scheduled') : 'missing',
        siteAccess,
        siteAccessReady,
        siteAccessStatus: siteAccessReady ? 'ready' : siteAccess ? normalizeStatus(siteAccess.status, 'requested') : 'missing'
      };
    });
    const uniqueRecords = (records, key) => {
      const seen = new Set();
      return records.filter(record => {
        if (!record || seen.has(record[key])) return false;
        seen.add(record[key]);
        return true;
      });
    };
    const currentInstructions = uniqueRecords(items.map(item => item.instruction).filter(Boolean), 'id');
    const currentOrientations = uniqueRecords(items.map(item => item.orientation).filter(Boolean), 'id');
    const currentSiteAccessLogs = uniqueRecords(items.map(item => item.siteAccess).filter(Boolean), 'id');
    const recordIsCurrent = record => activeAssignments.some(assignment => matchesAssignment(record, assignment));

    return {
      assignments: activeAssignments,
      items,
      currentInstructions,
      currentOrientations,
      currentSiteAccessLogs,
      instructionsReady: activeAssignments.length > 0 && items.every(item => item.instructionReady),
      orientationsReady: activeAssignments.length > 0 && items.every(item => item.orientationReady),
      siteAccessReady: activeAssignments.length > 0 && items.every(item => item.siteAccessReady),
      missingInstructions: items.filter(item => !item.instruction).length,
      draftInstructions: items.filter(item => item.instruction && !item.instructionReady).length,
      missingOrientations: items.filter(item => !item.orientation).length,
      openOrientations: items.filter(item => item.orientation && !item.orientationReady).length,
      missingSiteAccess: items.filter(item => !item.siteAccess).length,
      blockedSiteAccess: items.filter(item => item.siteAccess && !item.siteAccessReady).length,
      staleRecords: {
        instructions: allInstructions.filter(record => !recordIsCurrent(record)).length,
        orientations: allOrientations.filter(record => !recordIsCurrent(record)).length,
        siteAccess: allSiteAccessLogs.filter(record => !recordIsCurrent(record)).length
      }
    };
  }

  toolReservationReadiness(reservations = []) {
    const activeReservations = (reservations || []).filter(reservation => (
      !TOOL_RESERVATION_CLOSED_STATUSES.has(normalizeStatus(reservation.status, 'reserved'))
    ));
    const items = [];
    const blockers = [];
    const warnings = [];
    const nextActions = [];
    for (const reservation of activeReservations) {
      if (!reservation.toolId) {
        const blocker = {
          type: 'tool_record_missing',
          severity: 'high',
          reservationId: reservation.id,
          toolId: null,
          toolName: reservation.toolName || 'Unregistered equipment',
          message: `${reservation.toolName || 'Reserved equipment'} has no canonical equipment record for live readiness checks.`
        };
        blockers.push(blocker);
        items.push({ reservationId: reservation.id, toolId: null, toolName: blocker.toolName, status: 'missing_record', blocked: true });
        continue;
      }
      const row = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(reservation.toolId);
      if (!row) {
        const blocker = {
          type: 'tool_record_missing',
          severity: 'high',
          reservationId: reservation.id,
          toolId: reservation.toolId,
          toolName: reservation.toolName || reservation.toolId,
          message: `${reservation.toolName || 'Reserved equipment'} no longer resolves to a retained equipment record.`
        };
        blockers.push(blocker);
        items.push({ reservationId: reservation.id, toolId: reservation.toolId, toolName: blocker.toolName, status: 'missing_record', blocked: true });
        continue;
      }
      const tool = this.mapTool(row);
      const inspection = this.assessToolInspection(tool);
      const pendingRetirement = this.db.prepare(`
        SELECT id FROM approvals
        WHERE target_type = 'tool_retirement' AND target_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(tool.id);
      let blocker = null;
      if (pendingRetirement) {
        blocker = {
          type: 'tool_retirement_pending',
          severity: 'high',
          message: `${tool.name} has a pending retirement decision and cannot be treated as dispatch-ready.`,
          approvalId: pendingRetirement.id
        };
      } else if (inspection.blocksReservation) {
        blocker = {
          type: 'tool_inspection_readiness',
          severity: 'high',
          message: `${tool.name} inspection is ${inspection.status.replace(/_/g, ' ')} and blocks dispatch.`,
          inspectionStatus: inspection.status,
          inspectionDueAt: inspection.dueAt
        };
      } else if (!['available', 'in_use', 'reserved'].includes(normalizeStatus(tool.status, 'available'))) {
        blocker = {
          type: 'tool_unavailable',
          severity: 'high',
          message: `${tool.name} is marked ${normalizeStatus(tool.status, 'available').replace(/_/g, ' ')} and blocks dispatch.`,
          toolStatus: tool.status
        };
      }
      if (blocker) {
        const enrichedBlocker = {
          ...blocker,
          reservationId: reservation.id,
          toolId: tool.id,
          toolName: tool.name
        };
        blockers.push(enrichedBlocker);
        items.push({
          reservationId: reservation.id,
          toolId: tool.id,
          toolName: tool.name,
          status: blocker.type,
          inspectionStatus: inspection.status,
          blocked: true
        });
      } else {
        if (inspection.status === 'due_soon') {
          warnings.push(`${tool.name} inspection is due ${inspection.dueAt || 'soon'}; confirm it remains current for the field window.`);
        }
        items.push({
          reservationId: reservation.id,
          toolId: tool.id,
          toolName: tool.name,
          status: inspection.status === 'due_soon' ? 'due_soon' : 'ready',
          inspectionStatus: inspection.status,
          blocked: false
        });
      }
    }
    for (const blocker of blockers.slice(0, 3)) {
      nextActions.push({
        type: 'review_equipment_readiness',
        toolId: blocker.toolId,
        toolName: blocker.toolName,
        reservationId: blocker.reservationId,
        message: blocker.message,
        requiresApproval: false
      });
    }
    return {
      status: blockers.length ? 'blocked' : warnings.length ? 'due_soon' : activeReservations.length ? 'ready' : 'missing',
      reservations: activeReservations.length,
      blocked: blockers.length,
      warnings: warnings.length,
      items,
      blockers,
      warningMessages: warnings,
      nextActions
    };
  }

  scheduleDispatchReadiness(detail = {}, { hasWorker = false, jobId = null, plannedStart = null, plannedEnd = null } = {}) {
    const activeStatuses = new Set(['open', 'draft', 'pending', 'pending_approval', 'needs_review', 'review', 'blocked', 'missing', 'overdue', 'expired', 'rejected', 'revise_resubmit']);
    const closedStatuses = new Set(['approved', 'completed', 'closed', 'cancelled', 'current', 'passed', 'resolved', 'submitted', 'received', 'funded', 'paid', 'cleared', 'checked_in', 'ready', 'ordered']);
    const statusOf = (record, fallback = 'open') => normalizeStatus(record?.status, fallback);
    const isActive = record => {
      const status = statusOf(record);
      return activeStatuses.has(status) || !closedStatuses.has(status);
    };

    const crewEvidence = this.crewEvidenceReadiness(detail);
    const currentCrewApprovalTargets = new Map([
      ['assignment', new Set(crewEvidence.assignments.map(record => String(record.id)))],
      ['worker_assignment', new Set(crewEvidence.assignments.map(record => String(record.id)))],
      ['worker_instruction', new Set(crewEvidence.currentInstructions.map(record => String(record.id)))],
      ['worker_orientation', new Set(crewEvidence.currentOrientations.map(record => String(record.id)))],
      ['site_access_log', new Set(crewEvidence.currentSiteAccessLogs.map(record => String(record.id)))]
    ]);
    const pendingApprovals = (detail.approvals || []).filter(approval => {
      if (statusOf(approval, 'pending') !== 'pending') return false;
      const scopedTargets = currentCrewApprovalTargets.get(normalizeStatus(approval.targetType, ''));
      return !scopedTargets || scopedTargets.has(String(approval.targetId || ''));
    });
    const hasPendingApproval = (targetType, targetId) => pendingApprovals.some(approval => (
      normalizeStatus(approval.targetType, '') === targetType && String(approval.targetId || '') === String(targetId || '')
    ));
    const procurementOrders = detail.procurementOrders || [];
    const purchaseOrders = detail.purchaseOrders || [];
    const materialRequirements = detail.materials || [];
    const materialReadyStatuses = new Set(['available', 'received', 'allocated', 'loaded', 'used', 'delivered']);
    const unresolvedMaterialRequirements = materialRequirements.filter(material => !materialReadyStatuses.has(statusOf(material, 'needed')));
    const pendingProcurementStatuses = new Set(['draft', 'pending', 'pending_approval', 'ready_to_order', 'needs_review', 'approved', 'ordered', 'submitted', 'sent']);
    const pendingProcurement = unresolvedMaterialRequirements.length
      ? procurementOrders.filter(order => pendingProcurementStatuses.has(statusOf(order, 'draft')))
      : [];
    const pendingPurchaseOrders = unresolvedMaterialRequirements.length
      ? purchaseOrders.filter(order => pendingProcurementStatuses.has(statusOf(order, 'draft')))
      : [];
    const committedProcurement = procurementOrders.filter(order => statusOf(order, 'draft') === 'received');
    const committedPurchaseOrders = purchaseOrders.filter(order => statusOf(order, 'draft') === 'received');
    const procurementMissing = unresolvedMaterialRequirements.length > 0 && !procurementOrders.length && !purchaseOrders.length;
    const procurementDraft = pendingProcurement.find(order => (
      ['draft', 'pending', 'needs_review'].includes(statusOf(order, 'draft'))
      && !hasPendingApproval('procurement_order', order.id)
    )) || null;
    const procurementMaterial = unresolvedMaterialRequirements[0] || null;
    const workforceReadiness = this.workerAssignmentReadiness(detail.assignments || [], {
      jobId: jobId || detail.id,
      plannedStart,
      plannedEnd
    });
    const toolReadiness = this.toolReservationReadiness(detail.tools || []);
    const accessGaps = crewEvidence.items.filter(item => !item.siteAccessReady);
    const blockedAccess = accessGaps.filter(item => item.siteAccess).map(item => item.siteAccess);
    const missingAccessItems = accessGaps.filter(item => !item.siteAccess);
    const siteAccessStatus = blockedAccess.length
      ? 'blocked'
      : missingAccessItems.length || (hasWorker && !crewEvidence.items.length)
          ? 'missing'
          : crewEvidence.items.length
            ? 'ready'
            : 'not_required';
    const primaryAccessGap = accessGaps[0] || null;
    const primaryBlockedAccess = primaryAccessGap?.siteAccess || null;
    const linkedOrientation = primaryAccessGap?.orientation || null;
    const orientationReady = primaryAccessGap?.orientationReady === true;
    let accessControlRecord = null;
    if (primaryAccessGap) {
      if (linkedOrientation && !orientationReady && statusOf(linkedOrientation, 'scheduled') !== 'pending_approval') {
        accessControlRecord = {
          recordType: 'orientation',
          recordId: linkedOrientation.id,
          recordTitle: normalizeText(linkedOrientation.workerName, 'Crew orientation'),
          recordStatus: statusOf(linkedOrientation, 'scheduled'),
          targetStatus: 'completed',
          actionLabel: 'Complete site orientation',
          record: linkedOrientation
        };
      } else if (primaryBlockedAccess && orientationReady && statusOf(primaryBlockedAccess, 'requested') !== 'pending_approval') {
        accessControlRecord = {
          recordType: 'site_access',
          recordId: primaryBlockedAccess.id,
          recordTitle: normalizeText(primaryBlockedAccess.workerName, 'Site access'),
          recordStatus: statusOf(primaryBlockedAccess, 'requested'),
          targetStatus: 'cleared',
          actionLabel: 'Clear site access',
          record: primaryBlockedAccess
        };
      }
    }

    const safetyRecords = [
      ...(detail.safetyChecks || []),
      ...(detail.safetyMeetings || []),
      ...crewEvidence.currentOrientations,
      ...(detail.jhas || []),
      ...(detail.sdsSheets || [])
    ];
    const openIncidents = (detail.incidents || []).filter(isActive);
    const openObservations = (detail.observations || []).filter(observation => {
      const severity = normalizeStatus(observation.severity || observation.riskLevel, 'medium');
      return isActive(observation) && ['high', 'critical', 'medium'].includes(severity);
    });
    const safetyReviewStatuses = new Set(['open', 'draft', 'scheduled', 'pending_approval', 'missing', 'expired', 'overdue', 'needs_review', 'requested']);
    const safetyControlCandidates = [
      ...openIncidents.map(record => ({ recordType: 'incident', recordId: record.id, recordTitle: normalizeText(record.title, 'Incident'), recordStatus: statusOf(record, 'reported'), targetStatus: 'resolved', actionLabel: 'Resolve incident', record })),
      ...openObservations.map(record => ({ recordType: 'observation', recordId: record.id, recordTitle: normalizeText(record.title, 'Safety observation'), recordStatus: statusOf(record), targetStatus: 'resolved', actionLabel: 'Resolve safety observation', record })),
      ...(detail.safetyChecks || []).filter(record => safetyReviewStatuses.has(statusOf(record))).map(record => ({ recordType: 'safety_check', recordId: record.id, recordTitle: normalizeText(record.title, 'Safety check'), recordStatus: statusOf(record), targetStatus: 'completed', actionLabel: 'Complete safety check', record })),
      ...(detail.jhas || []).filter(record => safetyReviewStatuses.has(statusOf(record))).map(record => ({ recordType: 'jha', recordId: record.id, recordTitle: normalizeText(record.title, 'JHA'), recordStatus: statusOf(record), targetStatus: 'approved', actionLabel: 'Approve JHA', record })),
      ...(detail.sdsSheets || []).filter(record => safetyReviewStatuses.has(statusOf(record))).map(record => ({ recordType: 'sds', recordId: record.id, recordTitle: normalizeText(record.material, 'SDS'), recordStatus: statusOf(record), targetStatus: 'current', actionLabel: 'Approve SDS', record })),
      ...(detail.safetyMeetings || []).filter(record => safetyReviewStatuses.has(statusOf(record))).map(record => ({ recordType: 'safety_meeting', recordId: record.id, recordTitle: normalizeText(record.title, 'Safety talk'), recordStatus: statusOf(record), targetStatus: 'completed', actionLabel: 'Complete safety talk', record })),
      ...crewEvidence.currentOrientations.filter(record => safetyReviewStatuses.has(statusOf(record))).map(record => ({ recordType: 'orientation', recordId: record.id, recordTitle: normalizeText(record.workerName, 'Crew orientation'), recordStatus: statusOf(record), targetStatus: 'completed', actionLabel: 'Complete crew orientation', record }))
    ];
    const openSafetyRecords = safetyControlCandidates
      .filter(candidate => !['incident', 'observation'].includes(candidate.recordType))
      .map(candidate => candidate.record);
    const actionableSafetyRecord = safetyControlCandidates.find(candidate => (
      candidate.recordStatus !== 'pending_approval'
      && candidate.recordId !== accessControlRecord?.recordId
    )) || null;
    const safetyStatus = openIncidents.length || openObservations.length || openSafetyRecords.length
      ? 'review'
      : safetyRecords.length || (detail.inspections || []).length
        ? 'ready'
        : hasWorker
          ? 'missing'
          : 'not_required';

    const designRecordCandidates = [
      ...(detail.rfis || []).filter(record => !['answered', 'resolved', 'closed'].includes(statusOf(record))).map(record => ({
        recordType: 'rfi',
        recordId: record.id,
        recordTitle: normalizeText(record.title, 'RFI'),
        recordStatus: statusOf(record),
        targetStatus: 'answered',
        actionLabel: 'Answer RFI',
        record
      })),
      ...(detail.permits || []).filter(record => !['submitted', 'active', 'approved', 'closed'].includes(statusOf(record))).map(record => ({
        recordType: 'permit',
        recordId: record.id,
        recordTitle: normalizeText(record.title, 'Permit review'),
        recordStatus: statusOf(record),
        targetStatus: 'submitted',
        actionLabel: 'Submit permit review',
        record
      })),
      ...(detail.documents || [])
        .filter(document => ['needs_review', 'needs_update', 'draft', 'pending_approval', 'expired'].includes(statusOf(document, 'current')))
        .map(record => ({
          recordType: 'document',
          recordId: record.id,
          recordTitle: normalizeText(record.title, 'Document review'),
          recordStatus: statusOf(record),
          targetStatus: 'approved',
          actionLabel: 'Approve document review',
          record
        })),
      ...(detail.submittals || []).filter(record => !['approved', 'rejected', 'closed'].includes(statusOf(record))).map(record => ({
        recordType: 'submittal',
        recordId: record.id,
        recordTitle: normalizeText(record.title, 'Submittal'),
        recordStatus: statusOf(record),
        targetStatus: 'approved',
        actionLabel: 'Approve submittal',
        record
      })),
      ...(detail.clientSelections || []).filter(record => !['client_confirmed', 'selected', 'accepted', 'approved', 'locked', 'cancelled', 'rejected'].includes(statusOf(record))).map(record => ({
        recordType: 'selection',
        recordId: record.id,
        recordTitle: normalizeText(record.title, 'Client selection'),
        recordStatus: statusOf(record),
        targetStatus: 'selected',
        actionLabel: 'Record client selection',
        record
      }))
    ];
    const openDesignRecords = designRecordCandidates;
    const actionableDesignRecord = designRecordCandidates.find(record => record.recordStatus !== 'pending_approval') || null;
    const designEvidenceCount = (detail.rfis || []).length
      + (detail.submittals || []).length
      + (detail.clientSelections || []).length
      + (detail.permits || []).length
      + (detail.documents || []).length;
    const designStatus = openDesignRecords.length ? 'review' : designEvidenceCount ? 'ready' : 'not_required';

    const readiness = {
      approvals: { status: pendingApprovals.length ? 'approval' : 'ready', pending: pendingApprovals.length },
      procurement: {
        status: procurementMissing
          ? 'missing'
          : pendingProcurement.length || pendingPurchaseOrders.length
            ? 'approval'
            : unresolvedMaterialRequirements.length === 0 || committedProcurement.length || committedPurchaseOrders.length
              ? (materialRequirements.length ? 'ready' : 'not_required')
              : 'not_required',
        requirements: materialRequirements.length,
        unresolvedRequirements: unresolvedMaterialRequirements.length,
        pendingOrders: pendingProcurement.length + pendingPurchaseOrders.length,
        committedOrders: committedProcurement.length + committedPurchaseOrders.length,
        purchaseOrders: purchaseOrders.length
      },
      siteAccess: {
        status: siteAccessStatus,
        required: crewEvidence.items.length,
        blocked: blockedAccess.length,
        missing: missingAccessItems.length,
        records: crewEvidence.currentSiteAccessLogs.length,
        staleRecords: crewEvidence.staleRecords.siteAccess
      },
      crewEvidence: {
        assignments: crewEvidence.items.length,
        instructionsReady: crewEvidence.items.filter(item => item.instructionReady).length,
        orientationsReady: crewEvidence.items.filter(item => item.orientationReady).length,
        siteAccessReady: crewEvidence.items.filter(item => item.siteAccessReady).length,
        staleRecords: crewEvidence.staleRecords
      },
      safety: {
        status: safetyStatus,
        openSafetyRecords: openSafetyRecords.length,
        incidents: openIncidents.length,
        observations: openObservations.length
      },
      design: { status: designStatus, openRecords: openDesignRecords.length, evidenceRecords: designEvidenceCount },
      workforce: workforceReadiness,
      tools: toolReadiness
    };

    const missing = [];
    const warnings = [];
    const blockers = [];
    const nextActions = [];

    if (workforceReadiness.blockers.length) {
      blockers.push(...workforceReadiness.blockers);
      nextActions.push(...workforceReadiness.nextActions);
    }
    if (workforceReadiness.warningMessages.length) {
      warnings.push(...workforceReadiness.warningMessages);
    }
    if (pendingApprovals.length) {
      blockers.push({ type: 'approval_gate', severity: 'medium', message: `${pendingApprovals.length} pending approval(s) should be resolved before schedule commitment.` });
      nextActions.push({ type: 'review_pending_approvals', message: 'Review pending approvals before committing the schedule.', requiresApproval: true });
    }
    if (toolReadiness.blockers.length) {
      blockers.push(...toolReadiness.blockers);
      nextActions.push(...toolReadiness.nextActions);
    }
    if (toolReadiness.warningMessages.length) {
      warnings.push(...toolReadiness.warningMessages);
    }
    if (procurementMissing) {
      missing.push('procurement_plan');
      warnings.push('Material requirements exist without a procurement order or purchase order.');
      nextActions.push({ type: 'plan_procurement', message: 'Create procurement or purchase-order plan for required materials.', requiresApproval: false });
    } else if (pendingProcurement.length || pendingPurchaseOrders.length) {
      const pendingOrderCount = pendingProcurement.length + pendingPurchaseOrders.length;
      blockers.push({ type: 'procurement_gate', severity: 'medium', message: `${pendingOrderCount} procurement order(s) still need approval or verified material availability.` });
      if (procurementDraft) {
        nextActions.push({
          type: 'review_procurement',
          message: `Request approval for the retained ${procurementDraft.supplier || 'supplier'} procurement draft.`,
          requiresApproval: true,
          recordType: 'procurement_order',
          recordId: procurementDraft.id,
          recordTitle: procurementDraft.supplier || 'Procurement draft',
          recordStatus: statusOf(procurementDraft, 'draft'),
          actionLabel: 'Request procurement approval',
          record: procurementDraft
        });
      } else if (procurementMaterial && !pendingProcurement.some(order => statusOf(order, 'draft') === 'pending_approval')) {
        nextActions.push({
          type: 'confirm_material_availability',
          message: `Confirm retained availability for ${procurementMaterial.name || 'required material'}.`,
          requiresApproval: false,
          recordType: 'material_requirement',
          recordId: procurementMaterial.id,
          recordTitle: procurementMaterial.name || 'Required material',
          recordStatus: statusOf(procurementMaterial, 'needed'),
          actionLabel: 'Confirm material availability',
          record: procurementMaterial
        });
      }
    }
    if (blockedAccess.length) {
      blockers.push({ type: 'site_access_blocked', severity: 'high', message: `${blockedAccess.length} site-access record(s) block or require clearance.` });
      if (accessControlRecord) {
        nextActions.push({
          type: accessControlRecord.recordType === 'orientation' ? 'complete_site_orientation' : 'clear_site_access',
          message: `${accessControlRecord.actionLabel}: ${accessControlRecord.recordTitle}.`,
          requiresApproval: true,
          ...accessControlRecord
        });
      } else if (!linkedOrientation) {
        missing.push('site_access');
        nextActions.push({ type: 'prepare_site_access', message: 'Prepare assignment-scoped orientation evidence before clearing this access gate.', requiresApproval: false });
      }
    }
    if (siteAccessStatus === 'missing' || missingAccessItems.length) {
      missing.push('site_access');
      warnings.push('No site-access or orientation clearance is recorded for the assigned/recommended crew.');
      nextActions.push({ type: 'prepare_site_access', message: 'Prepare site-access and orientation clearance for the crew.', requiresApproval: false });
    }
    if (safetyStatus === 'review') {
      blockers.push({ type: 'safety_readiness', severity: openIncidents.length ? 'high' : 'medium', message: 'Safety, JHA, SDS, observation, or incident records need review before dispatch.' });
      if (actionableSafetyRecord) {
        nextActions.push({
          type: 'complete_safety_pack',
          message: `${actionableSafetyRecord.actionLabel}: ${actionableSafetyRecord.recordTitle}.`,
          requiresApproval: true,
          ...actionableSafetyRecord
        });
      }
    } else if (safetyStatus === 'missing') {
      missing.push('safety_pack');
      warnings.push('No safety readiness evidence is recorded for this crewed job.');
      nextActions.push({ type: 'prepare_safety_pack', message: 'Prepare safety talk, JHA, SDS, or checklist evidence before dispatch.', requiresApproval: false });
    }
    if (designStatus === 'review') {
      blockers.push({ type: 'design_readiness', severity: 'medium', message: `${openDesignRecords.length} RFI, submittal, selection, permit, or document record(s) need review.` });
      if (actionableDesignRecord) {
        nextActions.push({
          type: 'resolve_design_documents',
          message: `${actionableDesignRecord.actionLabel}: ${actionableDesignRecord.recordTitle}.`,
          requiresApproval: true,
          ...actionableDesignRecord
        });
      }
    }

    return { readiness, missing, warnings, blockers, nextActions };
  }

  recommendSchedule(jobId, payload = {}, options = {}) {
    const detail = this.getJobDetail(jobId, { includeAudit: false });
    const job = detail;
    const { plannedStart, plannedEnd, estimatedHours } = this.scheduleRecommendationWindow(job, payload);
    const activeAssignments = (detail.assignments || []).filter(assignment => this.activeAssignmentStatus(assignment.status));
    const assignedWorkerIds = new Set(activeAssignments.map(assignment => assignment.workerId).filter(Boolean));
    const workerCandidates = this.workerScheduleCandidates(job, plannedStart, plannedEnd, jobId);
    const assignedCandidate = workerCandidates.find(candidate => assignedWorkerIds.has(candidate.worker.id));
    const bestAvailableCandidate = workerCandidates.find(candidate => candidate.available && candidate.score >= 40);
    const recommendedWorker = assignedCandidate?.available
      ? assignedCandidate
      : bestAvailableCandidate || assignedCandidate || null;
    const toolConflicts = this.scheduleToolConflicts(jobId, detail, plannedStart, plannedEnd);
    const latestWeather = detail.weather[0] || null;
    const isOutdoor = /garden|pav|roof|fence|outside|outdoor|painting|clean/i.test(`${job.jobType} ${job.title} ${job.description}`);
    const weatherRisk = latestWeather && normalizeNumber(latestWeather.precipitationPercent, 0) >= 60;
    const routeReady = (detail.routePlans || []).some(item => !['cancelled', 'rejected', 'declined'].includes(normalizeStatus(item.status, 'draft')));
    const loadingReady = (detail.loadingPlans || []).some(item => !['cancelled', 'rejected', 'declined'].includes(normalizeStatus(item.status, 'draft')));
    const crewEvidence = this.crewEvidenceReadiness(detail);
    const instructionGap = crewEvidence.items.find(item => !item.instructionReady) || null;
    const instructionsReady = crewEvidence.instructionsReady;
    const dispatchReadiness = this.scheduleDispatchReadiness(detail, {
      hasWorker: Boolean(activeAssignments.length || recommendedWorker),
      jobId,
      plannedStart,
      plannedEnd
    });
    const missing = [];
    const warnings = [];
    const blockers = [];
    if (!plannedStart) {
      missing.push('planned_start');
      blockers.push({ type: 'planned_start_missing', severity: 'high', message: 'No proposed or stored start time exists for this job.' });
    }
    if (!activeAssignments.length && !recommendedWorker) {
      missing.push('worker_assignment');
      blockers.push({ type: 'worker_assignment_missing', severity: 'high', message: 'No available worker can be recommended for this schedule window.' });
    }
    if (!detail.tools.length) {
      warnings.push('No tool reservation is attached yet.');
    }
    if (toolConflicts.length) {
      blockers.push({ type: 'tool_conflict', severity: 'high', message: `${toolConflicts.length} tool reservation conflict(s) affect the proposed window.` });
    }
    if (!detail.materials.length) {
      warnings.push('No material requirement is attached yet.');
    }
    if (!routeReady) {
      missing.push('route_plan');
    }
    if ((detail.tools.length || detail.materials.length) && !loadingReady) {
      missing.push('loading_plan');
    }
    if ((activeAssignments.length || recommendedWorker) && !instructionsReady) {
      missing.push('worker_instruction');
    }
    if (!latestWeather) {
      const message = isOutdoor ? 'Outdoor job has no weather assessment yet.' : 'No weather assessment is recorded for this job.';
      warnings.push(message);
      if (isOutdoor) missing.push('weather_assessment');
    } else if (weatherRisk) {
      warnings.push(latestWeather.recommendation);
      blockers.push({ type: 'weather_risk', severity: 'medium', message: latestWeather.recommendation });
    }
    missing.push(...dispatchReadiness.missing.filter(item => !missing.includes(item)));
    warnings.push(...dispatchReadiness.warnings);
    blockers.push(...dispatchReadiness.blockers);
    const priority = normalizePriority(job.priority);
    const requiresApproval = normalizeBoolean(payload.clientCommitment ?? payload.client_commitment ?? payload.committedToClient, false)
      || blockers.some(blocker => [
        'tool_conflict',
        'worker_conflict',
        'weather_risk',
        'approval_gate',
        'procurement_gate',
        'site_access_blocked',
        'safety_readiness'
      ].includes(blocker.type));
    const recommendedStatus = blockers.some(blocker => ['planned_start_missing', 'worker_assignment_missing'].includes(blocker.type))
      ? 'needs_planning'
      : blockers.some(blocker => ['worker_record_missing', 'worker_retirement_pending', 'worker_unavailable', 'worker_conflict', 'tool_record_missing', 'tool_retirement_pending', 'tool_inspection_readiness', 'tool_unavailable'].includes(blocker.type))
        ? 'blocked'
      : requiresApproval
        ? 'needs_approval'
        : missing.length || warnings.length
          ? 'ready_with_warnings'
          : 'ready_to_schedule';
    const nextActions = [];
    if (!activeAssignments.length && recommendedWorker) {
      nextActions.push({
        type: 'assign_worker',
        workerId: recommendedWorker.worker.id,
        workerName: recommendedWorker.worker.name,
        message: `Assign ${recommendedWorker.worker.name} for ${job.title}.`,
        requiresApproval: normalizeBoolean(payload.clientCommitment ?? payload.client_commitment ?? payload.committedToClient, false)
      });
    }
    if (!latestWeather && isOutdoor) {
      nextActions.push({ type: 'assess_weather', message: 'Record weather assessment before committing outdoor work.', requiresApproval: false });
    }
    if (!routeReady) {
      nextActions.push({ type: 'create_route_plan', message: 'Create route/access plan before dispatch.', requiresApproval: false });
    }
    if ((detail.tools.length || detail.materials.length) && !loadingReady) {
      nextActions.push({ type: 'create_loading_plan', message: 'Create loading checklist from reserved tools and materials.', requiresApproval: false });
    }
    if (activeAssignments.length && !instructionsReady) {
      if (instructionGap?.instruction && normalizeStatus(instructionGap.instruction.status, 'draft') !== 'pending_approval') {
        nextActions.push({
          type: 'review_worker_instruction',
          message: `Request publication approval for ${instructionGap.workerName}'s retained crew instructions.`,
          requiresApproval: true,
          recordType: 'worker_instruction',
          recordId: instructionGap.instruction.id,
          recordTitle: instructionGap.instruction.title,
          recordStatus: normalizeStatus(instructionGap.instruction.status, 'draft'),
          targetStatus: 'published',
          actionLabel: 'Request instruction approval',
          record: instructionGap.instruction
        });
      } else if (!instructionGap?.instruction) {
        nextActions.push({
          type: 'draft_worker_instruction',
          assignmentId: instructionGap?.assignmentId || activeAssignments[0]?.id || null,
          workerId: instructionGap?.workerId || activeAssignments[0]?.workerId || null,
          message: `Draft worker instructions for ${instructionGap?.workerName || 'the assigned crew'} before dispatch.`,
          requiresApproval: false
        });
      }
    }
    nextActions.push(...dispatchReadiness.nextActions);
    if (requiresApproval) {
      nextActions.push({ type: 'request_schedule_approval', message: 'Ask Robert to approve this schedule recommendation before client or crew commitment.', requiresApproval: true });
    }
    const recommendation = {
      jobId,
      status: recommendedStatus,
      priority,
      plannedStart,
      plannedEnd,
      estimatedHours,
      missing,
      warnings,
      blockers,
      readiness: {
        worker: recommendedWorker
          ? { status: recommendedWorker.available ? 'recommended' : 'review', score: recommendedWorker.score, name: recommendedWorker.worker.name }
          : { status: 'missing' },
        tools: { status: toolConflicts.length ? 'conflict' : detail.tools.length ? 'ready' : 'missing', reservations: detail.tools.length, conflicts: toolConflicts.length },
        materials: { status: detail.materials.length ? 'ready' : 'missing', requirements: detail.materials.length },
        weather: latestWeather
          ? { status: weatherRisk ? 'risk' : 'checked', condition: latestWeather.condition, precipitationPercent: latestWeather.precipitationPercent, recommendation: latestWeather.recommendation }
          : { status: isOutdoor ? 'missing' : 'not_required' },
        route: { status: routeReady ? 'ready' : 'missing' },
        loading: { status: loadingReady ? 'ready' : (detail.tools.length || detail.materials.length) ? 'missing' : 'not_required' },
        instructions: {
          status: instructionsReady ? 'ready' : activeAssignments.length ? (instructionGap?.instruction ? 'review' : 'missing') : recommendedWorker ? 'assignment_required' : 'not_required',
          required: crewEvidence.items.length,
          ready: crewEvidence.items.filter(item => item.instructionReady).length,
          drafts: crewEvidence.draftInstructions,
          missing: crewEvidence.missingInstructions,
          staleRecords: crewEvidence.staleRecords.instructions
        },
        ...dispatchReadiness.readiness
      },
      recommendedWorker: recommendedWorker ? {
        ...recommendedWorker.worker,
        score: recommendedWorker.score,
        matchedSkills: recommendedWorker.matchedSkills,
        conflicts: recommendedWorker.conflicts
      } : null,
      workerCandidates: workerCandidates.slice(0, 5).map(candidate => ({
        id: candidate.worker.id,
        name: candidate.worker.name,
        status: candidate.worker.status,
        role: candidate.worker.role,
        score: candidate.score,
        matchedSkills: candidate.matchedSkills,
        conflicts: candidate.conflicts.length,
        available: candidate.available
      })),
      toolConflicts,
      nextActions,
      nextAction: nextActions[0]?.message || (recommendedStatus === 'ready_to_schedule'
        ? 'Confirm the schedule internally, then draft the client update for approval.'
        : 'Review missing planning evidence before committing this schedule.'),
      requiresApproval
    };
    if (options.audit !== false) {
      this.audit({ entityType: 'job', entityId: jobId, jobId, action: 'recommend_schedule', actor: options.actor || 'Contractor.AI', after: recommendation });
    }
    return recommendation;
  }

  createApproval(payload = {}, options = {}) {
    const id = normalizeText(payload.id || payload.approvalId || payload.approval_id, '') || makeId('approval');
    const targetType = normalizeText(payload.targetType || payload.target_type, 'record');
    const jobId = payload.jobId || payload.job_id || null;
    if (jobId && !['job_archive', 'job_restore'].includes(targetType) && options.allowInactive !== true) {
      this.requireJob(jobId);
    }
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO approvals (id, target_type, target_id, job_id, approval_type, status, requested_by, summary, reason, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      targetType,
      normalizeText(payload.targetId || payload.target_id, ''),
      jobId,
      normalizeText(payload.approvalType || payload.approval_type, 'approval'),
      normalizeStatus(payload.status, 'pending'),
      payload.requestedBy || payload.requested_by || options.actor || 'Contractor.AI',
      payload.summary || null,
      payload.reason || null,
      toJson(payload.data || {}),
      timestamp,
      timestamp
    );
    const approval = this.mapApproval(this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id));
    if (options.audit !== false) {
      this.audit({ entityType: 'approval', entityId: id, jobId: approval.jobId, action: 'create_approval', actor: options.actor || 'Contractor.AI', after: approval });
    }
    return approval;
  }

  restoreRejectedLifecycleTarget(approvalRow, resolutionStatus, options = {}) {
    const targets = {
      rfi_record: { table: 'rfi_records', fallbackStatus: 'open' },
      submittal_record: { table: 'submittal_records', fallbackStatus: 'pending_review' },
      document: { table: 'documents', fallbackStatus: 'needs_review' },
      permit_record: { table: 'permit_records', fallbackStatus: 'pending' },
      inspection_record: { table: 'inspection_records', fallbackStatus: 'pending_review' },
      safety_meeting: { table: 'safety_meetings', fallbackStatus: 'scheduled' },
      worker_instruction: { table: 'worker_instructions', fallbackStatus: 'draft' },
      worker_orientation: { table: 'worker_orientations', fallbackStatus: 'scheduled' },
      jha_record: { table: 'jha_records', fallbackStatus: 'draft' },
      sds_sheet: { table: 'sds_sheets', fallbackStatus: 'draft' },
      site_access_log: { table: 'site_access_logs', fallbackStatus: 'requested' },
      quality_check: { table: 'quality_checks', fallbackStatus: 'pending' },
      safety_check: { table: 'safety_checks', fallbackStatus: 'pending' },
      observation_record: { table: 'observation_records', fallbackStatus: 'open' },
      incident_record: { table: 'incident_records', fallbackStatus: 'under_review' },
      client_selection: { table: 'client_selections', fallbackStatus: 'pending_client' },
      punch_item: { table: 'punch_items', fallbackStatus: 'open' },
      warranty_claim: { table: 'warranty_claims', fallbackStatus: 'open' }
    };
    const target = targets[normalizeStatus(approvalRow?.target_type, '')];
    if (!target || !approvalRow?.target_id) return null;

    const row = this.db.prepare(`SELECT status, data_json FROM ${target.table} WHERE id = ?`).get(approvalRow.target_id);
    if (!row) return null;
    const timestamp = options.timestamp || nowIso();
    const approvalData = fromJson(approvalRow.data_json, {});
    const data = fromJson(row.data_json, {});
    const transition = approvalData.transition || data.lifecycleTransition || {};
    const retainedStatus = normalizeStatus(transition.previousStatus, target.fallbackStatus);
    const restoredStatus = retainedStatus === 'pending_approval' ? target.fallbackStatus : retainedStatus;
    const nextData = {
      ...data,
      lifecycleTransition: {
        ...(data.lifecycleTransition || transition),
        approvalResolution: resolutionStatus,
        approvalResolvedAt: timestamp,
        approvalResolutionReason: options.reason || null
      }
    };
    this.db.prepare(`
      UPDATE ${target.table}
      SET status = ?, approval_id = NULL, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(restoredStatus, toJson(nextData), timestamp, approvalRow.target_id);
    this.audit({
      entityType: approvalRow.target_type,
      entityId: approvalRow.target_id,
      jobId: approvalRow.job_id || null,
      action: `restore_${resolutionStatus}_lifecycle_transition`,
      actor: options.actor || 'approval',
      before: { status: row.status, approvalId: approvalRow.id },
      after: { status: restoredStatus, approvalId: null },
      metadata: { approvalId: approvalRow.id, requestedStatus: approvalData.requestedStatus || transition.requestedStatus || null }
    });
    return { status: restoredStatus };
  }

  restoreRejectedProcurementTarget(approvalRow, resolutionStatus, options = {}) {
    if (normalizeStatus(approvalRow?.target_type, '') !== 'procurement_order' || !approvalRow?.target_id) return null;
    const row = this.db.prepare('SELECT * FROM procurement_orders WHERE id = ?').get(approvalRow.target_id);
    if (!row) return null;
    const timestamp = options.timestamp || nowIso();
    const approvalData = fromJson(approvalRow.data_json, {});
    const currentData = fromJson(row.data_json, {});
    const previousStatus = normalizeStatus(approvalData.previousStatus, 'draft');
    const restoredStatus = previousStatus === 'pending_approval' ? 'draft' : previousStatus;
    const nextData = {
      ...currentData,
      approvalResolution: {
        status: resolutionStatus,
        approvalId: approvalRow.id,
        resolvedAt: timestamp,
        reason: options.reason || null
      }
    };
    this.db.prepare(`
      UPDATE procurement_orders
      SET status = ?, approval_id = NULL, data_json = ?, updated_at = ?
      WHERE id = ?
    `).run(restoredStatus, toJson(nextData), timestamp, approvalRow.target_id);
    this.audit({
      entityType: 'procurement_order',
      entityId: approvalRow.target_id,
      jobId: approvalRow.job_id || row.job_id || null,
      action: `restore_${resolutionStatus}_procurement_approval`,
      actor: options.actor || 'approval',
      before: this.mapProcurementOrder(row),
      after: this.mapProcurementOrder(this.db.prepare('SELECT * FROM procurement_orders WHERE id = ?').get(approvalRow.target_id)),
      metadata: { approvalId: approvalRow.id, externalCommitments: 0 }
    });
    return { status: restoredStatus };
  }

  applyJobArchiveApproval(approval) {
    if (!approval) return null;
    const approvalData = fromJson(approval.data_json, {});
    const jobId = approval.job_id || approvalData.jobId;
    if (!jobId) return null;
    const before = this.requireJob(jobId, { allowInactive: true });
    const currentData = fromJson(before.data_json, {});
    const history = Array.isArray(currentData.archiveHistory) ? currentData.archiveHistory : [];
    const priorEvent = history.find(event => event?.operation === 'archive' && event?.approvalId === approval.id);
    if (priorEvent && normalizeStatus(before.status, '') === 'archived') {
      return this.getJobDetail(jobId, { includeAudit: false });
    }

    const currentStatus = normalizeStatus(before.status, 'intake');
    const currentPhase = normalizeStatus(before.phase, currentStatus);
    if (['archived', 'pending_archive_approval'].includes(currentStatus)) {
      const error = new Error('The job was archived through another lifecycle decision.');
      error.statusCode = 409;
      error.code = 'job_archive_state_conflict';
      throw error;
    }
    if (
      normalizeStatus(approvalData.previousStatus, currentStatus) !== currentStatus
      || normalizeStatus(approvalData.previousPhase, currentPhase) !== currentPhase
    ) {
      const error = new Error('The job lifecycle changed after this archive request. Reject it and submit a new archive decision from the current state.');
      error.statusCode = 409;
      error.code = 'job_archive_state_changed';
      throw error;
    }

    const blockers = this.db.prepare(`
      SELECT id, target_type, summary FROM approvals
      WHERE job_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).all(jobId);
    if (blockers.length) {
      const error = new Error(`Resolve ${blockers.length} newer pending job approval${blockers.length === 1 ? '' : 's'} before approving archive.`);
      error.statusCode = 409;
      error.code = 'job_archive_blocked_by_approvals';
      error.details = { blockerCount: blockers.length, blockers };
      throw error;
    }

    const timestamp = nowIso();
    const actor = approval.resolved_by || approval.requested_by || 'approval';
    const revokedPortalAccess = this.activeClientPortalAccess(jobId).map(access => this.revokeClientPortalAccess(access.id, {
      actor,
      reason: `Job archived through approval ${approval.id}. A new portal link requires approval after restore.`
    }));
    const archive = {
      active: true,
      previousStatus: currentStatus,
      previousPhase: currentPhase,
      requestedAt: approvalData.requestedAt || approval.created_at,
      approvedAt: timestamp,
      archivedAt: timestamp,
      requestedBy: approvalData.requestedBy || approval.requested_by || null,
      approvedBy: actor,
      approvalId: approval.id,
      reason: approvalData.reason || approval.reason || null,
      revokedPortalAccessIds: revokedPortalAccess.map(access => access.id)
    };
    const archiveHistory = [
      ...history,
      {
        operation: 'archive',
        approvalId: approval.id,
        at: timestamp,
        actor,
        reason: archive.reason,
        previousStatus: currentStatus,
        previousPhase: currentPhase,
        revokedPortalAccessIds: archive.revokedPortalAccessIds
      }
    ];
    const after = this.updateJob(jobId, {
      status: 'archived',
      phase: 'archived',
      approvalState: 'archive_approved',
      data: { archive, archiveHistory }
    }, { actor, audit: false });
    this.audit({
      entityType: 'job',
      entityId: jobId,
      jobId,
      action: 'apply_job_archive',
      actor,
      before: this.mapJob(before),
      after: this.mapJob(this.getJobRow(jobId)),
      metadata: {
        approvalId: approval.id,
        externalCommitments: 0,
        retainedRecords: true,
        revokedPortalAccessIds: archive.revokedPortalAccessIds
      }
    });
    return after;
  }

  applyJobRestoreApproval(approval) {
    if (!approval) return null;
    const approvalData = fromJson(approval.data_json, {});
    const jobId = approval.job_id || approvalData.jobId;
    if (!jobId) return null;
    const before = this.requireJob(jobId, { allowInactive: true });
    const currentData = fromJson(before.data_json, {});
    const history = Array.isArray(currentData.archiveHistory) ? currentData.archiveHistory : [];
    const priorEvent = history.find(event => event?.operation === 'restore' && event?.approvalId === approval.id);
    if (priorEvent && !['archived', 'pending_archive_approval'].includes(normalizeStatus(before.status, ''))) {
      return this.getJobDetail(jobId, { includeAudit: false });
    }
    if (!['archived', 'pending_archive_approval'].includes(normalizeStatus(before.status, ''))) {
      const error = new Error('The job is no longer archived, so this restore decision cannot be applied.');
      error.statusCode = 409;
      error.code = 'job_restore_state_conflict';
      throw error;
    }

    const blockers = this.db.prepare(`
      SELECT id, target_type, summary FROM approvals
      WHERE job_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).all(jobId);
    if (blockers.length) {
      const error = new Error(`Resolve ${blockers.length} newer pending job approval${blockers.length === 1 ? '' : 's'} before approving restore.`);
      error.statusCode = 409;
      error.code = 'job_restore_blocked_by_approvals';
      error.details = { blockerCount: blockers.length, blockers };
      throw error;
    }

    const allowedStatuses = new Set(['intake', 'planning', 'planned', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled', 'canceled']);
    const retainedStatus = normalizeStatus(approvalData.restoreStatus, 'intake');
    const restoreStatus = allowedStatuses.has(retainedStatus) ? retainedStatus : 'intake';
    const retainedPhase = normalizeStatus(approvalData.restorePhase, restoreStatus);
    const restorePhase = ['archived', 'pending_archive_approval'].includes(retainedPhase) ? restoreStatus : retainedPhase;
    const timestamp = nowIso();
    const actor = approval.resolved_by || approval.requested_by || 'approval';
    const archive = currentData.archive && typeof currentData.archive === 'object' && !Array.isArray(currentData.archive)
      ? currentData.archive
      : {};
    const restoredArchive = {
      ...archive,
      active: false,
      restoredAt: timestamp,
      restoredBy: actor,
      restoreApprovalId: approval.id,
      restoreReason: approvalData.reason || approval.reason || null
    };
    const archiveHistory = [
      ...history,
      {
        operation: 'restore',
        approvalId: approval.id,
        at: timestamp,
        actor,
        reason: restoredArchive.restoreReason,
        restoredStatus: restoreStatus,
        restoredPhase: restorePhase
      }
    ];
    const after = this.updateJob(jobId, {
      status: restoreStatus,
      phase: restorePhase,
      approvalState: 'restore_approved',
      data: { archive: restoredArchive, archiveHistory }
    }, { actor, audit: false, allowInactive: true });
    this.audit({
      entityType: 'job',
      entityId: jobId,
      jobId,
      action: 'apply_job_restore',
      actor,
      before: this.mapJob(before),
      after: this.mapJob(this.getJobRow(jobId)),
      metadata: {
        approvalId: approval.id,
        archiveApprovalId: restoredArchive.approvalId || null,
        externalCommitments: 0,
        retainedRecords: true
      }
    });
    return after;
  }

  resolveApproval(approvalId, payload = {}, options = {}) {
    return this.transaction(() => {
      const before = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
      if (!before) {
        const error = new Error('Approval not found');
        error.statusCode = 404;
        throw error;
      }
      const status = normalizeStatus(payload.status || payload.decision, 'approved');
      if (!['approved', 'rejected', 'cancelled'].includes(status)) {
        const error = new Error('Approval status must be approved, rejected, or cancelled');
        error.statusCode = 400;
        throw error;
      }
      if (status === 'approved' && before.job_id && !['job_archive', 'job_restore'].includes(before.target_type)) {
        this.requireJob(before.job_id);
      }
      const timestamp = nowIso();
      this.db.prepare(`
        UPDATE approvals
        SET status = ?, resolved_by = ?, resolved_at = ?, reason = COALESCE(?, reason), updated_at = ?
        WHERE id = ?
      `).run(status, payload.resolvedBy || payload.actor || options.actor || 'user', timestamp, payload.reason || payload.notes || null, timestamp, approvalId);

      if (status === 'approved') {
        this.applyApprovalTarget(before.target_type, before.target_id);
      } else if (String(before.approval_type || '').endsWith('_lifecycle_transition')) {
        this.restoreRejectedLifecycleTarget(before, status, {
          timestamp,
          actor: payload.resolvedBy || payload.actor || options.actor || 'user',
          reason: payload.reason || payload.notes || null
        });
      } else if (before.target_type === 'procurement_order') {
        this.restoreRejectedProcurementTarget(before, status, {
          timestamp,
          actor: payload.resolvedBy || payload.actor || options.actor || 'user',
          reason: payload.reason || payload.notes || null
        });
      } else if (before.target_type === 'client_portal_access') {
        this.db.prepare(`
          UPDATE client_portal_access
          SET status = ?, revoked_at = COALESCE(revoked_at, ?), updated_at = ?
          WHERE id = ? AND status = 'pending_approval'
        `).run(status, timestamp, timestamp, before.target_id);
      }

      const after = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(approvalId);
      this.audit({
        entityType: 'approval',
        entityId: approvalId,
        jobId: before.job_id || null,
        action: `resolve_${status}`,
        actor: payload.resolvedBy || payload.actor || options.actor || 'user',
        before: this.mapApproval(before),
        after: this.mapApproval(after)
      });
      return this.mapApproval(after);
    });
  }

  applyApprovalTarget(targetType, targetId) {
    const timestamp = nowIso();
    if (targetType === 'quote') {
      this.db.prepare("UPDATE quotes SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, targetId);
      this.db.prepare("UPDATE jobs SET approval_state = 'quote_approved', phase = CASE WHEN phase = 'intake' THEN 'planned' ELSE phase END, updated_at = ? WHERE id = (SELECT job_id FROM quotes WHERE id = ?)")
        .run(timestamp, targetId);
    } else if (targetType === 'schedule_commitment') {
      const approval = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(targetId);
      const approvalData = fromJson(approval?.data_json, {});
      const jobId = approval?.job_id || approvalData.jobId;
      const patch = approvalData.patch && typeof approvalData.patch === 'object' && !Array.isArray(approvalData.patch)
        ? approvalData.patch
        : null;

      if (approval && jobId && patch?.scheduledStart && patch?.scheduledEnd) {
        const before = this.getJobDetail(jobId, { includeAudit: false });
        const actor = approval.resolved_by || approval.requested_by || 'approval';
        const after = this.updateJob(jobId, {
          ...patch,
          approvalState: 'schedule_approved'
        }, { actor, audit: false });
        const proposedAssignment = approvalData.proposedAssignment && typeof approvalData.proposedAssignment === 'object' && !Array.isArray(approvalData.proposedAssignment)
          ? approvalData.proposedAssignment
          : null;
        let assignment = null;
        if (proposedAssignment?.workerId) {
          const activeAssignment = this.db.prepare(`
            SELECT assignments.*, workers.name AS worker_name
            FROM assignments
            LEFT JOIN workers ON workers.id = assignments.worker_id
            WHERE assignments.job_id = ?
              AND assignments.worker_id = ?
              AND assignments.status NOT IN ('released', 'cancelled', 'completed', 'closed', 'rejected', 'declined')
            ORDER BY assignments.created_at DESC
            LIMIT 1
          `).get(jobId, proposedAssignment.workerId);
          if (activeAssignment) {
            assignment = this.mapAssignment(activeAssignment);
          } else {
            assignment = this.addAssignment(jobId, {
              workerId: proposedAssignment.workerId,
              role: proposedAssignment.role || 'Contractor',
              status: proposedAssignment.status || 'planned',
              scheduledStart: proposedAssignment.scheduledStart || patch.scheduledStart,
              scheduledEnd: proposedAssignment.scheduledEnd || patch.scheduledEnd,
              allocationHours: proposedAssignment.allocationHours || approvalData.recommendation?.estimatedHours || 0,
              notes: `Approved with schedule commitment ${approval.id}.`
            }, { actor, audit: true });
          }
        }
        this.audit({
          entityType: 'job',
          entityId: jobId,
          jobId,
          action: 'apply_schedule_commitment',
          actor,
          before,
          after,
          metadata: {
            approvalId: approval.id,
            plannedStart: patch.scheduledStart,
            plannedEnd: patch.scheduledEnd,
            recommendationStatus: approvalData.recommendation?.status || null,
            assignmentId: assignment?.id || null,
            workerId: assignment?.workerId || proposedAssignment?.workerId || null,
            workerName: assignment?.workerName || proposedAssignment?.workerName || null
          }
        });
      }
    } else if (targetType === 'job_archive') {
      const approval = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(targetId);
      this.applyJobArchiveApproval(approval);
    } else if (targetType === 'job_restore') {
      const approval = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(targetId);
      this.applyJobRestoreApproval(approval);
    } else if (targetType === 'job_update') {
      const approval = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(targetId);
      const approvalData = fromJson(approval?.data_json, {});
      const jobId = approval?.job_id || approvalData.jobId;
      const patch = approvalData.patch && typeof approvalData.patch === 'object' && !Array.isArray(approvalData.patch)
        ? approvalData.patch
        : null;

      if (approval && jobId && patch && Object.keys(patch).length) {
        const before = this.getJobDetail(jobId, { includeAudit: false });
        const actor = approval.resolved_by || approval.requested_by || 'approval';
        const after = this.updateJob(jobId, {
          ...patch,
          approvalState: patch.approvalState || 'job_update_approved'
        }, { actor, audit: false });
        this.audit({
          entityType: 'job',
          entityId: jobId,
          jobId,
          action: 'apply_job_update_approval',
          actor,
          before: before.job || before,
          after: after.job || after,
          metadata: {
            approvalId: approval.id,
            reasons: approvalData.reasons || []
          }
        });
      }
    } else if (targetType === 'site_visit') {
      this.db.prepare(`
        UPDATE site_visits
        SET status = CASE
          WHEN status = 'pending_approval' THEN 'confirmed'
          WHEN status = 'draft' THEN 'confirmed'
          ELSE status
        END,
        updated_at = ?
        WHERE id = ?
      `).run(timestamp, targetId);
      this.db.prepare("UPDATE jobs SET phase = CASE WHEN phase = 'intake' THEN 'survey' ELSE phase END, updated_at = ? WHERE id = (SELECT job_id FROM site_visits WHERE id = ?)")
        .run(timestamp, targetId);
    } else if (targetType === 'change_order') {
      const changeOrder = this.db.prepare('SELECT job_id, total FROM change_orders WHERE id = ?').get(targetId);
      this.db.prepare(`
        UPDATE change_orders
        SET status = CASE
          WHEN status = 'pending_approval' THEN 'approved'
          WHEN status = 'draft' THEN 'approved'
          ELSE status
        END,
        updated_at = ?
        WHERE id = ?
      `).run(timestamp, targetId);
      if (changeOrder) {
        this.db.prepare('UPDATE jobs SET contract_value = contract_value + ?, approval_state = ?, updated_at = ? WHERE id = ?')
          .run(normalizeNumber(changeOrder.total, 0), 'change_order_approved', timestamp, changeOrder.job_id);
      }
    } else if (targetType === 'field_report') {
      const fieldReport = this.db.prepare('SELECT data_json FROM field_reports WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(fieldReport?.data_json, {}).requestedStatus, 'submitted');
      const approvedStatus = ['submitted', 'published', 'client_visible', 'approved', 'sent'].includes(requestedStatus)
        ? requestedStatus
        : 'submitted';
      this.db.prepare('UPDATE field_reports SET status = ?, updated_at = ? WHERE id = ?').run(approvedStatus, timestamp, targetId);
    } else if (targetType === 'rfi_record') {
      const rfi = this.db.prepare('SELECT response, data_json FROM rfi_records WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(rfi?.data_json, {}).requestedStatus, 'closed');
      const approvedStatus = ['answered', 'closed', 'resolved', 'issued', 'sent', 'approved'].includes(requestedStatus)
        ? requestedStatus
        : (rfi?.response ? 'answered' : 'closed');
      this.db.prepare('UPDATE rfi_records SET status = ?, answered_at = COALESCE(answered_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'submittal_record') {
      const submittal = this.db.prepare('SELECT data_json FROM submittal_records WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(submittal?.data_json, {}).requestedStatus, 'approved');
      const approvedStatus = ['approved', 'accepted', 'issued', 'sent', 'closed', 'client_visible', 'rejected'].includes(requestedStatus)
        ? requestedStatus
        : 'approved';
      this.db.prepare(`
        UPDATE submittal_records
        SET status = ?,
          submitted_at = CASE WHEN ? IN ('issued', 'sent', 'approved', 'accepted', 'closed', 'client_visible') THEN COALESCE(submitted_at, ?) ELSE submitted_at END,
          approved_at = CASE WHEN ? IN ('approved', 'accepted', 'closed', 'client_visible') THEN COALESCE(approved_at, ?) ELSE approved_at END,
          updated_at = ?
        WHERE id = ?
      `).run(approvedStatus, approvedStatus, timestamp, approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'client_selection_response') {
      const approval = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(targetId);
      const response = fromJson(approval?.data_json, {});
      const selectionRow = response.selectionId
        ? this.db.prepare('SELECT * FROM client_selections WHERE id = ? AND job_id = ?').get(response.selectionId, approval?.job_id)
        : null;
      if (approval && selectionRow && ['accepted', 'changes_requested'].includes(response.decision)) {
        const before = this.mapClientSelection(selectionRow);
        const currentData = fromJson(selectionRow.data_json, {});
        const nextStatus = response.decision === 'accepted' ? 'client_confirmed' : 'changes_requested';
        const nextData = {
          ...currentData,
          requestedStatus: nextStatus,
          selectedOption: response.decision === 'accepted' ? response.selectedOption || null : currentData.selectedOption || null,
          clientResponse: {
            responseId: response.responseId,
            decision: response.decision,
            selectedOption: response.selectedOption || null,
            note: response.note || null,
            submittedAt: response.submittedAt || approval.created_at,
            reviewedAt: timestamp,
            reviewedBy: approval.resolved_by || 'approval',
            approvalId: approval.id,
            status: 'approved'
          }
        };
        this.db.prepare(`
          UPDATE client_selections
          SET status = ?, decided_at = COALESCE(decided_at, ?), approval_id = ?, data_json = ?, updated_at = ?
          WHERE id = ?
        `).run(nextStatus, timestamp, approval.id, toJson(nextData), timestamp, selectionRow.id);
        const after = this.mapClientSelection(this.db.prepare('SELECT * FROM client_selections WHERE id = ?').get(selectionRow.id));
        this.audit({
          entityType: 'client_selection',
          entityId: selectionRow.id,
          jobId: selectionRow.job_id,
          action: 'apply_client_selection_response',
          actor: approval.resolved_by || 'approval',
          before,
          after,
          metadata: {
            approvalId: approval.id,
            responseId: response.responseId,
            decision: response.decision,
            externalCommitments: 0
          }
        });
      }
    } else if (targetType === 'client_selection') {
      const selection = this.db.prepare('SELECT data_json FROM client_selections WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(selection?.data_json, {}).requestedStatus, 'approved');
      const approvedStatus = ['approved', 'accepted', 'client_confirmed', 'locked', 'selected', 'ordered'].includes(requestedStatus)
        ? requestedStatus
        : 'approved';
      this.db.prepare('UPDATE client_selections SET status = ?, decided_at = COALESCE(decided_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'permit_record') {
      const permit = this.db.prepare('SELECT data_json FROM permit_records WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(permit?.data_json, {}).requestedStatus, 'active');
      const approvedStatus = ['active', 'approved', 'issued', 'submitted'].includes(requestedStatus) ? requestedStatus : 'active';
      this.db.prepare('UPDATE permit_records SET status = ?, issued_at = COALESCE(issued_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'communication') {
      this.db.prepare("UPDATE communication_records SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, targetId);
    } else if (targetType === 'client_portal_access') {
      const access = this.db.prepare('SELECT * FROM client_portal_access WHERE id = ?').get(targetId);
      if (access && access.status === 'pending_approval') {
        this.db.prepare("UPDATE client_portal_access SET status = 'active', updated_at = ? WHERE id = ?")
          .run(timestamp, targetId);
        this.audit({
          entityType: 'client_portal_access',
          entityId: targetId,
          jobId: access.job_id,
          action: 'activate_client_portal_access',
          actor: 'approval',
          before: this.mapClientPortalAccess(access),
          after: this.mapClientPortalAccess(this.db.prepare('SELECT * FROM client_portal_access WHERE id = ?').get(targetId))
        });
      }
    } else if (targetType === 'assignment') {
      const assignment = this.db.prepare('SELECT data_json FROM assignments WHERE id = ?').get(targetId);
      const data = fromJson(assignment?.data_json, {});
      const requestedStatus = normalizeStatus(data.requestedStatus, 'planned');
      const approvedStatus = ['planned', 'scheduled', 'active', 'in_progress', 'approved'].includes(requestedStatus)
        ? requestedStatus
        : 'planned';
      this.db.prepare('UPDATE assignments SET status = ?, data_json = ?, updated_at = ? WHERE id = ?')
        .run(approvedStatus, toJson({ ...data, approvedAt: timestamp }), timestamp, targetId);
      this.db.prepare("UPDATE jobs SET phase = CASE WHEN phase = 'intake' THEN 'planned' ELSE phase END, updated_at = ? WHERE id = (SELECT job_id FROM assignments WHERE id = ?)")
        .run(timestamp, targetId);
    } else if (targetType === 'tool_reservation') {
      const reservation = this.db.prepare('SELECT data_json FROM tool_reservations WHERE id = ?').get(targetId);
      const data = fromJson(reservation?.data_json, {});
      const requestedStatus = normalizeStatus(data.requestedStatus, 'reserved');
      const approvedStatus = ['reserved', 'in_use', 'scheduled', 'planned', 'approved'].includes(requestedStatus)
        ? requestedStatus
        : 'reserved';
      this.db.prepare('UPDATE tool_reservations SET status = ?, data_json = ?, updated_at = ? WHERE id = ?')
        .run(approvedStatus, toJson({ ...data, approvedAt: timestamp }), timestamp, targetId);
      this.db.prepare("UPDATE jobs SET phase = CASE WHEN phase = 'intake' THEN 'planned' ELSE phase END, updated_at = ? WHERE id = (SELECT job_id FROM tool_reservations WHERE id = ?)")
        .run(timestamp, targetId);
    } else if (targetType === 'worker_retirement') {
      const before = this.db.prepare('SELECT * FROM workers WHERE id = ?').get(targetId);
      if (before) {
        const assignmentScope = this.workerAssignmentScope(targetId);
        const activeAssignments = assignmentScope.operational;
        if (activeAssignments.length) {
          const error = new Error(`Release or reassign ${activeAssignments.length} active assignment${activeAssignments.length === 1 ? '' : 's'} before approving worker retirement.`);
          error.statusCode = 409;
          error.code = 'worker_retirement_active_assignments';
          error.details = {
            workerId: targetId,
            activeAssignmentCount: activeAssignments.length,
            dormantAssignmentCount: assignmentScope.dormant.length,
            activeAssignments
          };
          throw error;
        }
        const approval = this.db.prepare(`
          SELECT * FROM approvals
          WHERE target_type = 'worker_retirement'
            AND target_id = ?
            AND status = 'approved'
          ORDER BY COALESCE(resolved_at, updated_at, created_at) DESC
          LIMIT 1
        `).get(targetId);
        const actor = approval?.resolved_by || approval?.requested_by || 'approval';
        const beforeWorker = {
          ...this.mapWorker(before),
          activeAssignmentCount: 0,
          dormantAssignmentCount: assignmentScope.dormant.length,
          retainedAssignmentCount: assignmentScope.retained.length
        };
        const releasedDormantAssignments = assignmentScope.dormant.map(assignment => this.releaseAssignment(
          assignment.jobId,
          assignment.id,
          {
            status: 'released',
            reason: `Released from inactive job because worker retirement approval ${approval?.id || 'approved'} was applied.`,
            actor
          },
          { actor }
        ));
        const data = fromJson(before.data_json, {});
        const afterData = {
          ...data,
          retiredAt: timestamp,
          retirementApprovalId: approval?.id || data.retirementApprovalId || null,
          releasedDormantAssignmentIds: releasedDormantAssignments.map(assignment => assignment.id)
        };
        this.db.prepare("UPDATE workers SET status = 'retired', data_json = ?, updated_at = ? WHERE id = ?")
          .run(toJson(afterData), timestamp, targetId);
        const after = this.getWorker(targetId);
        this.audit({
          entityType: 'worker',
          entityId: targetId,
          action: 'apply_worker_retirement',
          actor,
          before: beforeWorker,
          after,
          metadata: {
            approvalId: approval?.id || null,
            releasedDormantAssignmentIds: releasedDormantAssignments.map(assignment => assignment.id),
            externalCommitments: 0
          }
        });
      }
    } else if (targetType === 'tool_retirement') {
      const before = this.db.prepare('SELECT * FROM tools WHERE id = ?').get(targetId);
      if (before) {
        const reservationScope = this.toolReservationScope(targetId);
        const activeReservations = reservationScope.operational;
        if (activeReservations.length) {
          const error = new Error(`Release or reassign ${activeReservations.length} active equipment reservation${activeReservations.length === 1 ? '' : 's'} before approving retirement.`);
          error.statusCode = 409;
          error.code = 'tool_retirement_active_reservations';
          error.details = {
            toolId: targetId,
            activeReservationCount: activeReservations.length,
            dormantReservationCount: reservationScope.dormant.length,
            activeReservations
          };
          throw error;
        }
        const approval = this.db.prepare(`
          SELECT * FROM approvals
          WHERE target_type = 'tool_retirement'
            AND target_id = ?
            AND status = 'approved'
          ORDER BY COALESCE(resolved_at, updated_at, created_at) DESC
          LIMIT 1
        `).get(targetId);
        const actor = approval?.resolved_by || approval?.requested_by || 'approval';
        const beforeTool = {
          ...this.mapTool(before),
          activeReservationCount: 0,
          dormantReservationCount: reservationScope.dormant.length,
          retainedReservationCount: reservationScope.retained.length
        };
        const releasedDormantReservations = reservationScope.dormant.map(reservation => this.releaseToolReservation(
          reservation.jobId,
          reservation.id,
          {
            status: 'released',
            reason: `Released from inactive job because equipment retirement approval ${approval?.id || 'approved'} was applied.`,
            actor
          },
          { actor }
        ));
        const data = fromJson(before.data_json, {});
        const afterData = {
          ...data,
          retiredAt: timestamp,
          retirementApprovalId: approval?.id || data.retirementApprovalId || null,
          releasedDormantReservationIds: releasedDormantReservations.map(reservation => reservation.id)
        };
        this.db.prepare("UPDATE tools SET status = 'retired', data_json = ?, updated_at = ? WHERE id = ?")
          .run(toJson(afterData), timestamp, targetId);
        const after = this.mapTool(this.db.prepare('SELECT * FROM tools WHERE id = ?').get(targetId));
        this.audit({
          entityType: 'tool',
          entityId: targetId,
          action: 'apply_tool_retirement',
          actor,
          before: beforeTool,
          after,
          metadata: {
            approvalId: approval?.id || null,
            releasedDormantReservationIds: releasedDormantReservations.map(reservation => reservation.id),
            externalCommitments: 0
          }
        });
      }
    } else if (targetType === 'trade_partner_retirement') {
      const before = this.db.prepare('SELECT * FROM trade_partners WHERE id = ?').get(targetId);
      if (before) {
        const approval = this.db.prepare(`
          SELECT * FROM approvals
          WHERE target_type = 'trade_partner_retirement'
            AND target_id = ?
            AND status = 'approved'
          ORDER BY COALESCE(resolved_at, updated_at, created_at) DESC
          LIMIT 1
        `).get(targetId);
        const data = fromJson(before.data_json, {});
        const afterData = {
          ...data,
          retiredAt: timestamp,
          retirementApprovalId: approval?.id || data.retirementApprovalId || null
        };
        this.db.prepare("UPDATE trade_partners SET status = 'retired', data_json = ?, updated_at = ? WHERE id = ?")
          .run(toJson(afterData), timestamp, targetId);
        const after = this.getTradePartner(targetId);
        this.audit({
          entityType: 'trade_partner',
          entityId: targetId,
          action: 'apply_trade_partner_retirement',
          actor: approval?.resolved_by || approval?.requested_by || 'approval',
          before: this.mapTradePartner(before),
          after,
          metadata: { approvalId: approval?.id || null, externalCommitments: 0 }
        });
      }
    } else if (targetType === 'invoice') {
      this.db.prepare("UPDATE invoices SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, targetId);
    } else if (targetType === 'document') {
      this.db.prepare("UPDATE documents SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, targetId);
    } else if (targetType === 'quality_check') {
      this.db.prepare("UPDATE quality_checks SET status = 'approved', result = CASE WHEN result = 'pending' THEN 'passed' ELSE result END, updated_at = ? WHERE id = ?")
        .run(timestamp, targetId);
    } else if (targetType === 'safety_check') {
      this.db.prepare("UPDATE safety_checks SET status = 'approved', completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?")
        .run(timestamp, timestamp, targetId);
    } else if (targetType === 'inspection_record') {
      const inspection = this.db.prepare('SELECT data_json FROM inspection_records WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(inspection?.data_json, {}).requestedStatus, 'completed');
      const approvedStatus = ['completed', 'passed', 'failed', 'approved', 'closed'].includes(requestedStatus)
        ? requestedStatus
        : 'completed';
      this.db.prepare('UPDATE inspection_records SET status = ?, completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'observation_record') {
      const observation = this.db.prepare('SELECT data_json FROM observation_records WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(observation?.data_json, {}).requestedStatus, 'resolved');
      const approvedStatus = ['closed', 'resolved', 'approved', 'client_visible'].includes(requestedStatus)
        ? requestedStatus
        : requestedStatus;
      this.db.prepare(`
        UPDATE observation_records
        SET status = ?,
          closed_at = CASE WHEN ? IN ('closed', 'resolved', 'approved') THEN COALESCE(closed_at, ?) ELSE closed_at END,
          updated_at = ?
        WHERE id = ?
      `)
        .run(approvedStatus, approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'incident_record') {
      const incident = this.db.prepare('SELECT data_json FROM incident_records WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(incident?.data_json, {}).requestedStatus, 'resolved');
      const approvedStatus = ['closed', 'resolved', 'approved', 'reportable', 'escalated'].includes(requestedStatus)
        ? requestedStatus
        : requestedStatus;
      this.db.prepare(`
        UPDATE incident_records
        SET status = ?,
          resolved_at = CASE WHEN ? IN ('closed', 'resolved', 'approved') THEN COALESCE(resolved_at, ?) ELSE resolved_at END,
          updated_at = ?
        WHERE id = ?
      `)
        .run(approvedStatus, approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'safety_meeting') {
      const meeting = this.db.prepare('SELECT data_json FROM safety_meetings WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(meeting?.data_json, {}).requestedStatus, 'completed');
      const approvedStatus = ['completed', 'approved', 'client_visible'].includes(requestedStatus)
        ? requestedStatus
        : 'completed';
      this.db.prepare('UPDATE safety_meetings SET status = ?, completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'worker_orientation') {
      const orientation = this.db.prepare('SELECT data_json FROM worker_orientations WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(orientation?.data_json, {}).requestedStatus, 'completed');
      const approvedStatus = ['completed', 'approved', 'cleared', 'valid'].includes(requestedStatus)
        ? requestedStatus
        : 'completed';
      this.db.prepare('UPDATE worker_orientations SET status = ?, completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'jha_record') {
      const jha = this.db.prepare('SELECT data_json FROM jha_records WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(jha?.data_json, {}).requestedStatus, 'approved');
      const approvedStatus = ['approved', 'issued', 'accepted', 'completed', 'signed_off', 'client_visible'].includes(requestedStatus)
        ? requestedStatus
        : 'approved';
      this.db.prepare('UPDATE jha_records SET status = ?, approved_at = COALESCE(approved_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'sds_sheet') {
      const sds = this.db.prepare('SELECT data_json FROM sds_sheets WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(sds?.data_json, {}).requestedStatus, 'current');
      const approvedStatus = ['current', 'approved', 'accepted', 'active'].includes(requestedStatus)
        ? requestedStatus
        : 'current';
      this.db.prepare('UPDATE sds_sheets SET status = ?, updated_at = ? WHERE id = ?').run(approvedStatus, timestamp, targetId);
    } else if (targetType === 'site_access_log') {
      const access = this.db.prepare('SELECT data_json FROM site_access_logs WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(access?.data_json, {}).requestedStatus, 'checked_in');
      const approvedStatus = ['checked_in', 'checked_out', 'cleared', 'approved', 'granted'].includes(requestedStatus)
        ? requestedStatus
        : 'checked_in';
      this.db.prepare(`
        UPDATE site_access_logs
        SET status = ?,
          orientation_valid = 1,
          checked_in_at = CASE WHEN ? IN ('checked_in', 'cleared', 'approved', 'granted') THEN COALESCE(checked_in_at, ?) ELSE checked_in_at END,
          checked_out_at = CASE WHEN ? = 'checked_out' THEN COALESCE(checked_out_at, ?) ELSE checked_out_at END,
          updated_at = ?
        WHERE id = ?
      `).run(approvedStatus, approvedStatus, timestamp, approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'punch_item') {
      const punch = this.db.prepare('SELECT data_json FROM punch_items WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(punch?.data_json, {}).requestedStatus, 'closed');
      const approvedStatus = ['closed', 'resolved', 'accepted', 'verified', 'client_visible'].includes(requestedStatus)
        ? requestedStatus
        : 'closed';
      this.db.prepare('UPDATE punch_items SET status = ?, closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'warranty_claim') {
      const warranty = this.db.prepare('SELECT data_json FROM warranty_claims WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(warranty?.data_json, {}).requestedStatus, 'resolved');
      const approvedStatus = ['closed', 'resolved', 'accepted', 'rejected', 'client_visible'].includes(requestedStatus)
        ? requestedStatus
        : 'resolved';
      this.db.prepare('UPDATE warranty_claims SET status = ?, resolved_at = COALESCE(resolved_at, ?), updated_at = ? WHERE id = ?')
        .run(approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'payment') {
      const payment = this.db.prepare('SELECT data_json FROM payments WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(payment?.data_json, {}).requestedStatus, 'received');
      const approvedStatus = ['paid', 'received', 'settled', 'written_off'].includes(requestedStatus)
        ? requestedStatus
        : 'received';
      this.db.prepare(`
        UPDATE payments
        SET status = ?,
          paid_at = CASE WHEN ? IN ('paid', 'received', 'settled') THEN COALESCE(paid_at, ?) ELSE paid_at END,
          updated_at = ?
        WHERE id = ?
      `).run(approvedStatus, approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'budget_line') {
      const budgetLine = this.db.prepare('SELECT data_json FROM budget_lines WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(budgetLine?.data_json, {}).requestedStatus, 'approved');
      const approvedStatus = ['approved', 'locked', 'baseline'].includes(requestedStatus) ? requestedStatus : 'approved';
      this.db.prepare('UPDATE budget_lines SET status = ?, updated_at = ? WHERE id = ?').run(approvedStatus, timestamp, targetId);
    } else if (targetType === 'purchase_order') {
      const purchaseOrder = this.db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(targetId);
      const partner = this.assertTradePartnerReadyForCommitment(purchaseOrder, 'purchase order');
      const purchaseOrderData = fromJson(purchaseOrder?.data_json, {});
      const requestedStatus = normalizeStatus(purchaseOrderData.requestedStatus, 'ready_to_order');
      const approvedStatus = ['ordered', 'sent', 'submitted', 'issued'].includes(requestedStatus)
        ? 'ready_to_order'
        : ['approved', 'ready_to_order'].includes(requestedStatus)
          ? requestedStatus
          : 'approved';
      this.db.prepare('UPDATE purchase_orders SET supplier = ?, status = ?, data_json = ?, updated_at = ? WHERE id = ?').run(
        partner.name,
        approvedStatus,
        toJson({
          ...purchaseOrderData,
          tradePartnerId: partner.id,
          partnerComplianceRequired: true,
          partnerComplianceSnapshot: this.tradePartnerComplianceSnapshot(partner),
          approvedAt: timestamp
        }),
        timestamp,
        targetId
      );
    } else if (targetType === 'draw_request') {
      const drawRequest = this.db.prepare('SELECT data_json, requested_amount FROM draw_requests WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(drawRequest?.data_json, {}).requestedStatus, 'approved');
      const approvedStatus = ['submitted', 'approved', 'approved_for_funding', 'funded', 'sent'].includes(requestedStatus)
        ? (requestedStatus === 'funded' ? 'approved_for_funding' : requestedStatus)
        : 'approved';
      this.db.prepare(`
        UPDATE draw_requests
        SET status = ?,
          approved_amount = CASE WHEN approved_amount = 0 THEN requested_amount ELSE approved_amount END,
          funded_at = CASE WHEN ? = 'funded' THEN COALESCE(funded_at, ?) ELSE funded_at END,
          updated_at = ?
        WHERE id = ?
      `).run(approvedStatus, requestedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'lien_waiver') {
      const waiver = this.db.prepare('SELECT data_json FROM lien_waivers WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(waiver?.data_json, {}).requestedStatus, 'received');
      const approvedStatus = ['received', 'approved', 'released', 'waived'].includes(requestedStatus) ? requestedStatus : 'received';
      this.db.prepare(`
        UPDATE lien_waivers
        SET status = ?,
          received_at = CASE WHEN ? IN ('received', 'approved', 'released', 'waived') THEN COALESCE(received_at, ?) ELSE received_at END,
          updated_at = ?
        WHERE id = ?
      `).run(approvedStatus, approvedStatus, timestamp, timestamp, targetId);
    } else if (targetType === 'finance_handoff') {
      const handoff = this.db.prepare('SELECT data_json FROM finance_handoffs WHERE id = ?').get(targetId);
      const requestedStatus = normalizeStatus(fromJson(handoff?.data_json, {}).requestedStatus, 'ready');
      const approvedStatus = ['ready', 'approved', 'submitted', 'sent', 'exported'].includes(requestedStatus)
        ? (['submitted', 'sent', 'exported'].includes(requestedStatus) ? 'ready_to_export' : requestedStatus)
        : 'ready';
      this.db.prepare('UPDATE finance_handoffs SET status = ?, updated_at = ? WHERE id = ?').run(approvedStatus, timestamp, targetId);
    } else if (targetType === 'route_plan') {
      this.db.prepare("UPDATE route_plans SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, targetId);
    } else if (targetType === 'loading_plan') {
      this.db.prepare("UPDATE loading_plans SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, targetId);
    } else if (targetType === 'procurement_order') {
      const procurementOrder = this.db.prepare('SELECT * FROM procurement_orders WHERE id = ?').get(targetId);
      const partner = this.assertTradePartnerReadyForCommitment(procurementOrder, 'procurement order');
      const procurementData = fromJson(procurementOrder?.data_json, {});
      this.db.prepare(`
        UPDATE procurement_orders
        SET supplier = ?, status = CASE
          WHEN status = 'pending_approval' THEN 'ready_to_order'
          WHEN status = 'draft' THEN 'approved'
          ELSE status
        END,
        data_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        partner.name,
        toJson({
          ...procurementData,
          tradePartnerId: partner.id,
          partnerComplianceRequired: true,
          partnerComplianceSnapshot: this.tradePartnerComplianceSnapshot(partner),
          approvedAt: timestamp
        }),
        timestamp,
        targetId
      );
    } else if (targetType === 'worker_instruction') {
      this.db.prepare("UPDATE worker_instructions SET status = 'approved', updated_at = ? WHERE id = ?").run(timestamp, targetId);
    }
  }

  listJobs(filters = {}) {
    const requestedStatus = normalizeStatus(filters.status, '');
    const archiveOnly = normalizeBoolean(filters.archiveOnly ?? filters.archive_only, false)
      || ['archive', 'archives'].includes(requestedStatus);
    const status = archiveOnly || requestedStatus === 'archived' ? '' : requestedStatus;
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const includeArchived = archiveOnly || requestedStatus === 'archived'
      || normalizeBoolean(filters.includeArchived ?? filters.include_archived, false);
    const archiveStatuses = new Set(['archived', 'pending_archive_approval']);
    const inactiveStatuses = new Set(['archived', 'pending_archive_approval', 'cancelled', 'canceled', 'rejected', 'deleted', 'void']);
    const queryLimit = search || archiveOnly || !includeArchived ? 500 : limit;
    const rows = this.db.prepare(`
      SELECT jobs.*, clients.name AS client_name, clients.email AS client_email, clients.phone AS client_phone
      FROM jobs
      JOIN clients ON clients.id = jobs.client_id
      WHERE (? = '' OR jobs.status = ?)
      ORDER BY jobs.updated_at DESC
      LIMIT ?
    `).all(status, status, queryLimit);
    let mapped = rows.map(row => this.mapJob(row));
    if (archiveOnly || requestedStatus === 'archived') {
      mapped = mapped.filter(job => archiveStatuses.has(normalizeStatus(job.status, 'open')));
    } else if (!includeArchived) {
      mapped = mapped.filter(job => !inactiveStatuses.has(normalizeStatus(job.status, 'open')));
    }
    if (search) {
      mapped = mapped.filter(job => JSON.stringify(job).toLowerCase().includes(search));
    }
    return mapped.slice(0, limit);
  }

  listCommunications(filters = {}) {
    const status = normalizeText(filters.status, '');
    const includeAll = status === 'all' || filters.all === true;
    const direction = normalizeText(filters.direction, '');
    const jobId = normalizeText(filters.jobId || filters.job_id, '');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const rows = this.db.prepare(`
      SELECT
        communication_records.*,
        jobs.title AS job_title,
        jobs.status AS job_status,
        clients.name AS client_name,
        clients.email AS client_email,
        clients.phone AS client_phone
      FROM communication_records
      LEFT JOIN jobs ON jobs.id = communication_records.job_id
      LEFT JOIN clients ON clients.id = communication_records.client_id
      WHERE (? = 1 OR communication_records.status = ?)
        AND (? = '' OR communication_records.direction = ?)
        AND (? = '' OR communication_records.job_id = ?)
      ORDER BY
        CASE
          WHEN communication_records.status IN ('draft', 'pending_approval') THEN 0
          WHEN communication_records.status IN ('awaiting_client', 'client_reply_required') THEN 1
          ELSE 2
        END,
        COALESCE(communication_records.sent_at, communication_records.created_at) DESC
      LIMIT ?
    `).all(includeAll ? 1 : 0, status, direction, direction, jobId, jobId, limit);
    const communications = rows.map(row => this.mapCommunication(row));
    if (!search) return communications;
    return communications.filter(communication => JSON.stringify(communication).toLowerCase().includes(search));
  }

  communicationSummary() {
    const rows = this.db.prepare('SELECT status, direction, approval_id, data_json FROM communication_records').all();
    const summary = {
      total: rows.length,
      outboundDrafts: 0,
      pendingApproval: 0,
      waitingForReply: 0,
      inboundUnread: 0,
      followUps: 0
    };
    for (const row of rows) {
      const status = normalizeStatus(row.status, '');
      const direction = normalizeStatus(row.direction, '');
      const data = fromJson(row.data_json, {});
      if (direction === 'outbound' && ['draft', 'pending_approval'].includes(status)) summary.outboundDrafts += 1;
      if (direction === 'inbound' && ['new', 'received', 'unread'].includes(status)) summary.inboundUnread += 1;
      if (direction === 'outbound' && data.expectsReply && ['sent', 'delivered', 'awaiting_client', 'client_reply_required'].includes(status)) {
        summary.waitingForReply += 1;
      }
      if (data.followUpFor || data.followUpSource) summary.followUps += 1;
    }
    summary.pendingApproval = Number(this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM approvals
      WHERE status = 'pending'
        AND target_type = 'communication'
    `).get().count || 0);
    return summary;
  }

  mapClientPortalAccess(row) {
    if (!row) return null;
    const expiresAt = row.expires_at || null;
    return {
      id: row.id,
      jobId: row.job_id,
      clientId: row.client_id,
      status: row.status,
      approvalId: row.approval_id,
      expiresAt,
      lastAccessedAt: row.last_accessed_at || null,
      revokedAt: row.revoked_at || null,
      expired: Boolean(expiresAt && Date.parse(expiresAt) <= Date.now()),
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  portalAccessError() {
    const error = new Error('Client portal access is unavailable');
    error.statusCode = 404;
    return error;
  }

  createClientPortalAccess(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const job = this.requireJob(jobId);
      const requestedExpiry = payload.expiresAt || payload.expires_at;
      const defaultExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const expiresAt = new Date(requestedExpiry || defaultExpiry);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        const error = new Error('Client portal expiry must be a future date');
        error.statusCode = 400;
        throw error;
      }
      if (expiresAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
        const error = new Error('Client portal expiry cannot be more than one year ahead');
        error.statusCode = 400;
        throw error;
      }

      const id = makeId('portal');
      const portalToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(portalToken).digest('hex');
      const timestamp = nowIso();
      this.db.prepare(`
        INSERT INTO client_portal_access (
          id, job_id, client_id, token_hash, status, approval_id, expires_at, data_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending_approval', NULL, ?, ?, ?, ?)
      `).run(
        id,
        jobId,
        job.client_id,
        tokenHash,
        expiresAt.toISOString(),
        toJson({
          label: normalizeText(payload.label, 'Client job portal'),
          scope: 'client_job_status',
          createdFrom: payload.source || 'operator_dashboard'
        }),
        timestamp,
        timestamp
      );

      const approval = this.createApproval({
        targetType: 'client_portal_access',
        targetId: id,
        jobId,
        approvalType: 'client_portal_access',
        requestedBy: options.actor || 'Contractor.AI',
        summary: `Approve client portal access for ${normalizeText(job.title, 'job')}`,
        reason: 'A portal link exposes a restricted client-facing job view. Confirm the intended client and expiry before enabling access.',
        data: { expiresAt: expiresAt.toISOString(), label: normalizeText(payload.label, 'Client job portal') }
      }, { actor: options.actor || 'Contractor.AI' });
      this.db.prepare('UPDATE client_portal_access SET approval_id = ?, updated_at = ? WHERE id = ?')
        .run(approval.id, nowIso(), id);

      const access = this.mapClientPortalAccess(this.db.prepare('SELECT * FROM client_portal_access WHERE id = ?').get(id));
      this.audit({
        entityType: 'client_portal_access',
        entityId: id,
        jobId,
        action: 'create_client_portal_access',
        actor: options.actor || 'Contractor.AI',
        after: access,
        metadata: { approvalId: approval.id, tokenStoredAsHash: true }
      });
      return { ...access, portalToken, approval };
    });
  }

  listClientPortalAccess(jobId) {
    this.requireJob(jobId, { allowInactive: true });
    return this.db.prepare('SELECT * FROM client_portal_access WHERE job_id = ? ORDER BY created_at DESC')
      .all(jobId)
      .map(row => this.mapClientPortalAccess(row));
  }

  activeClientPortalAccess(jobId) {
    return this.db.prepare("SELECT * FROM client_portal_access WHERE job_id = ? AND status = 'active' ORDER BY created_at ASC")
      .all(jobId)
      .map(row => this.mapClientPortalAccess(row));
  }

  revokeClientPortalAccess(accessId, options = {}) {
    return this.transaction(() => {
      const beforeRow = this.db.prepare('SELECT * FROM client_portal_access WHERE id = ?').get(accessId);
      if (!beforeRow) throw this.portalAccessError();
      const before = this.mapClientPortalAccess(beforeRow);
      const timestamp = nowIso();
      const reason = normalizeText(options.reason, '');
      const data = {
        ...(before.data || {}),
        ...(reason ? {
          revocation: {
            reason,
            revokedAt: timestamp,
            revokedBy: options.actor || 'Contractor.AI'
          }
        } : {})
      };
      this.db.prepare(`
        UPDATE client_portal_access
        SET status = 'revoked', revoked_at = COALESCE(revoked_at, ?), data_json = ?, updated_at = ?
        WHERE id = ?
      `).run(timestamp, toJson(data), timestamp, accessId);
      const after = this.mapClientPortalAccess(this.db.prepare('SELECT * FROM client_portal_access WHERE id = ?').get(accessId));
      this.audit({
        entityType: 'client_portal_access',
        entityId: accessId,
        jobId: after.jobId,
        action: 'revoke_client_portal_access',
        actor: options.actor || 'Contractor.AI',
        before,
        after,
        metadata: { reason: reason || null, externalCommitments: 0 }
      });
      return after;
    });
  }

  getClientPortalSnapshot(portalToken) {
    const token = String(portalToken || '').trim();
    if (token.length < 32) throw this.portalAccessError();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = this.db.prepare(`
      SELECT * FROM client_portal_access
      WHERE token_hash = ? AND status = 'active'
      LIMIT 1
    `).get(tokenHash);
    if (!row || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
      if (row && row.status === 'active') {
        this.db.prepare("UPDATE client_portal_access SET status = 'expired', updated_at = ? WHERE id = ?")
          .run(nowIso(), row.id);
      }
      throw this.portalAccessError();
    }

    const job = this.getJobRow(row.job_id);
    if (!job || !this.jobAllowsOperations(job.status)) {
      this.revokeClientPortalAccess(row.id, {
        actor: 'inactive_job_portal_guard',
        reason: `Portal access closed because the retained job is ${normalizeStatus(job?.status, 'unavailable')}.`
      });
      throw this.portalAccessError();
    }

    this.db.prepare('UPDATE client_portal_access SET last_accessed_at = ?, updated_at = ? WHERE id = ?')
      .run(nowIso(), nowIso(), row.id);
    const detail = this.getJobDetail(row.job_id, { includeAudit: false });
    const clientVisibleMessages = detail.communications
      .filter(item => item.direction === 'outbound' && (item.status === 'client_visible' || item.data?.clientVisible === true))
      .slice(0, 20)
      .map(item => ({ subject: item.subject || 'Project update', body: item.body || '', createdAt: item.createdAt }));
    const clientVisibleDocuments = detail.documents
      .filter(item => item.data?.clientVisible === true)
      .slice(0, 20)
      .map(item => ({ id: item.id, title: item.title, type: item.type, status: item.status, createdAt: item.createdAt }));
    const selectionResponseApprovals = this.db.prepare(`
      SELECT * FROM approvals
      WHERE job_id = ? AND target_type = 'client_selection_response'
      ORDER BY created_at DESC
    `).all(row.job_id);
    const latestSelectionResponse = new Map();
    for (const approvalRow of selectionResponseApprovals) {
      const approval = this.mapApproval(approvalRow);
      const selectionId = approval.data?.selectionId;
      if (selectionId && !latestSelectionResponse.has(selectionId)) latestSelectionResponse.set(selectionId, approval);
    }
    const responseOpenStatuses = new Set(['open', 'pending', 'pending_client', 'awaiting_client', 'changes_requested']);
    const clientVisibleSelections = detail.clientSelections
      .filter(item => item.data?.clientVisible !== false)
      .slice(0, 10)
      .map(item => {
        const responseApproval = latestSelectionResponse.get(item.id) || null;
        const recordedResponse = item.data?.clientResponse || null;
        const response = responseApproval
          ? {
              status: responseApproval.status === 'pending'
                ? 'pending_review'
                : responseApproval.status === 'approved'
                  ? 'recorded'
                  : `review_${responseApproval.status}`,
              decision: responseApproval.data?.decision || null,
              selectedOption: responseApproval.data?.selectedOption || null,
              note: responseApproval.data?.note || null,
              submittedAt: responseApproval.data?.submittedAt || responseApproval.createdAt,
              reviewedAt: responseApproval.resolvedAt || null
            }
          : recordedResponse
            ? {
                status: 'recorded',
                decision: recordedResponse.decision || null,
                selectedOption: recordedResponse.selectedOption || null,
                note: recordedResponse.note || null,
                submittedAt: recordedResponse.submittedAt || null,
                reviewedAt: recordedResponse.reviewedAt || null
              }
            : null;
        const pendingResponse = responseApproval?.status === 'pending';
        return {
          id: item.id,
          title: item.title,
          status: item.status,
          dueAt: item.dueAt,
          decidedAt: item.decidedAt,
          options: (Array.isArray(item.options) ? item.options : [])
            .map(option => typeof option === 'string' ? option : option?.value || option?.label || '')
            .map(option => String(option).trim())
            .filter(Boolean),
          selectedOption: item.data?.selectedOption || recordedResponse?.selectedOption || null,
          responseAllowed: responseOpenStatuses.has(normalizeStatus(item.status, '')) && !pendingResponse,
          response
        };
      });

    return {
      portal: {
        accessId: row.id,
        expiresAt: row.expires_at,
        label: fromJson(row.data_json).label || 'Client job portal'
      },
      job: {
        id: detail.id,
        title: detail.title,
        serviceType: detail.jobType,
        description: detail.description,
        address: detail.address,
        status: detail.status,
        progressPercent: detail.progressPercent,
        scheduledStart: detail.scheduledStart,
        scheduledEnd: detail.scheduledEnd,
        targetCompletion: detail.targetCompletion,
        siteVisits: detail.siteVisits.slice(0, 10).map(item => ({ visitType: item.visitType, status: item.status, scheduledAt: item.scheduledAt })),
        selections: clientVisibleSelections,
        updates: clientVisibleMessages,
        documents: clientVisibleDocuments
      }
    };
  }

  addClientPortalMessage(portalToken, payload = {}, options = {}) {
    const snapshot = this.getClientPortalSnapshot(portalToken);
    const body = String(payload.body || payload.message || '').trim().slice(0, 5000);
    if (!body) {
      const error = new Error('Client portal message body is required');
      error.statusCode = 400;
      throw error;
    }
    const subject = String(payload.subject || 'Client portal message').trim().slice(0, 240) || 'Client portal message';
    const communication = this.addCommunication(snapshot.job.id, {
      channel: 'portal',
      direction: 'inbound',
      status: 'received',
      subject,
      body,
      requiresApproval: false,
      source: 'client_portal',
      data: { source: 'client_portal', portalAccessId: snapshot.portal.accessId }
    }, { actor: options.actor || 'client_portal' });
    return { communication, portal: snapshot.portal };
  }

  submitClientPortalSelectionResponse(portalToken, selectionId, payload = {}, options = {}) {
    return this.transaction(() => {
      const snapshot = this.getClientPortalSnapshot(portalToken);
      const selectionRow = this.db.prepare('SELECT * FROM client_selections WHERE id = ? AND job_id = ?')
        .get(selectionId, snapshot.job.id);
      if (!selectionRow || fromJson(selectionRow.data_json, {}).clientVisible === false) throw this.portalAccessError();

      const portalSelection = snapshot.job.selections.find(item => item.id === selectionId);
      if (!portalSelection) throw this.portalAccessError();

      const requestedDecision = normalizeStatus(payload.decision || payload.response, '');
      const decision = ['accept', 'accepted', 'approve', 'approved', 'confirm', 'confirmed'].includes(requestedDecision)
        ? 'accepted'
        : ['request_change', 'request_changes', 'changes_requested', 'change', 'revise'].includes(requestedDecision)
          ? 'changes_requested'
          : null;
      if (!decision) {
        const error = new Error('Selection response must accept the selection or request a change');
        error.statusCode = 400;
        error.code = 'invalid_selection_response';
        throw error;
      }

      const responseId = normalizeText(payload.responseId || payload.response_id, '');
      if (!/^[A-Za-z0-9._:-]{8,200}$/.test(responseId)) {
        const error = new Error('Selection responseId must contain 8 to 200 safe characters');
        error.statusCode = 400;
        error.code = 'invalid_selection_response_id';
        throw error;
      }
      const note = String(payload.note || payload.notes || '').trim().slice(0, 2000);
      if (decision === 'changes_requested' && !note) {
        const error = new Error('Describe the requested change before submitting this response');
        error.statusCode = 400;
        error.code = 'selection_change_note_required';
        throw error;
      }

      const optionsList = fromJson(selectionRow.options_json, []);
      const optionValues = (Array.isArray(optionsList) ? optionsList : [])
        .map(option => typeof option === 'string' ? option : option?.value || option?.label || '')
        .map(option => String(option).trim())
        .filter(Boolean);
      const selectedOption = String(payload.selectedOption || payload.selected_option || '').trim().slice(0, 240);
      if (decision === 'accepted' && optionValues.length && !optionValues.includes(selectedOption)) {
        const error = new Error('Choose one of the published selection options before accepting');
        error.statusCode = 400;
        error.code = 'invalid_selection_option';
        throw error;
      }

      const pendingResponses = this.db.prepare(`
        SELECT * FROM approvals
        WHERE job_id = ? AND target_type = 'client_selection_response' AND status = 'pending'
        ORDER BY created_at DESC
      `).all(snapshot.job.id).map(row => this.mapApproval(row))
        .filter(approval => approval.data?.selectionId === selectionId);
      const replay = pendingResponses.find(approval => approval.data?.responseId === responseId);
      if (replay) {
        const replayMatches = replay.data?.decision === decision
          && (replay.data?.selectedOption || '') === (decision === 'accepted' ? selectedOption : '')
          && (replay.data?.note || '') === note;
        if (!replayMatches) {
          const error = new Error('This selection responseId was already used for a different response');
          error.statusCode = 409;
          error.code = 'selection_response_id_reused';
          throw error;
        }
        return {
          selection: this.mapClientSelection(selectionRow),
          approval: replay,
          response: { ...replay.data, status: 'pending_review' },
          portal: snapshot.portal,
          replayed: true
        };
      }
      if (pendingResponses.length) {
        const error = new Error('This selection response is already awaiting internal review');
        error.statusCode = 409;
        error.code = 'selection_response_pending_review';
        throw error;
      }
      if (!portalSelection.responseAllowed) {
        const error = new Error('This selection is not open for a client response');
        error.statusCode = 409;
        error.code = 'selection_response_closed';
        throw error;
      }

      const submittedAt = nowIso();
      const approvalId = makeId('approval');
      const responseData = {
        responseId,
        selectionId,
        selectionTitle: selectionRow.title,
        decision,
        requestedStatus: decision === 'accepted' ? 'client_confirmed' : 'changes_requested',
        selectedOption: decision === 'accepted' ? selectedOption || null : null,
        note: note || null,
        submittedAt,
        portalAccessId: snapshot.portal.accessId,
        externalCommitments: 0
      };
      const approval = this.createApproval({
        id: approvalId,
        targetType: 'client_selection_response',
        targetId: approvalId,
        jobId: snapshot.job.id,
        approvalType: 'client_selection_response',
        requestedBy: options.actor || 'client_portal',
        summary: decision === 'accepted'
          ? `Review client selection response: ${selectionRow.title} - ${selectedOption || 'accepted'}`
          : `Review requested selection change: ${selectionRow.title}`,
        reason: 'A client portal response is evidence of client intent, but an internal approver must verify scope, price, and procurement impact before the selection state changes.',
        data: responseData
      }, { actor: options.actor || 'client_portal', audit: false });
      const selection = this.mapClientSelection(selectionRow);
      this.audit({
        entityType: 'client_selection',
        entityId: selectionId,
        jobId: snapshot.job.id,
        action: 'submit_client_selection_response',
        actor: options.actor || 'client_portal',
        before: selection,
        after: { ...selection, clientResponseStatus: 'pending_review' },
        metadata: {
          approvalId: approval.id,
          responseId,
          decision,
          portalAccessId: snapshot.portal.accessId,
          externalCommitments: 0
        }
      });
      return {
        selection,
        approval,
        response: { ...responseData, status: 'pending_review' },
        portal: snapshot.portal,
        replayed: false
      };
    });
  }

  classifyDispatchReadiness(recommendation = {}) {
    const blockers = Array.isArray(recommendation.blockers) ? recommendation.blockers : [];
    const missing = Array.isArray(recommendation.missing) ? recommendation.missing : [];
    const warnings = Array.isArray(recommendation.warnings) ? recommendation.warnings : [];
    const hardBlockerTypes = new Set([
      'planned_start_missing',
      'worker_assignment_missing',
      'worker_record_missing',
      'worker_retirement_pending',
      'worker_unavailable',
      'worker_conflict',
      'tool_conflict',
      'tool_record_missing',
      'tool_retirement_pending',
      'tool_inspection_readiness',
      'tool_unavailable',
      'site_access_blocked',
      'safety_readiness'
    ]);
    const approvalBlockerTypes = new Set([
      'approval_gate',
      'procurement_gate',
      'weather_risk',
      'design_readiness'
    ]);
    const hasHardBlocker = blockers.some(blocker =>
      hardBlockerTypes.has(blocker.type)
      || ['high', 'critical'].includes(normalizeStatus(blocker.severity, 'medium'))
    );
    if (hasHardBlocker) return 'blocked';
    if (recommendation.requiresApproval || blockers.some(blocker => approvalBlockerTypes.has(blocker.type))) {
      return 'approval_required';
    }
    if (missing.length) return 'needs_plan';
    if (warnings.length) return 'ready_with_warnings';
    return 'ready';
  }

  summarizeDispatchReadiness(rows = [], matching = rows.length) {
    const summary = {
      total: rows.length,
      matching,
      ready: 0,
      readyWithWarnings: 0,
      needsPlan: 0,
      approvalRequired: 0,
      blocked: 0,
      pendingApprovals: 0,
      missingRoute: 0,
      missingLoading: 0,
      missingInstructions: 0,
      missingProcurement: 0,
      missingWeather: 0,
      missingSafety: 0,
      missingSiteAccess: 0,
      procurementApprovals: 0,
      safetyBlockers: 0,
      siteAccessBlockers: 0,
      weatherRisks: 0,
      toolConflicts: 0,
      workerConflicts: 0,
      workerReadinessBlockers: 0,
      missingWorkerRecords: 0,
      unavailableWorkers: 0,
      retirementPendingWorkers: 0,
      toolReadinessBlockers: 0,
      unregisteredTools: 0,
      inspectionToolBlockers: 0
    };
    for (const row of rows) {
      const status = normalizeStatus(row.readinessStatus, 'needs_plan');
      if (status === 'ready') summary.ready += 1;
      if (status === 'ready_with_warnings') summary.readyWithWarnings += 1;
      if (status === 'needs_plan') summary.needsPlan += 1;
      if (status === 'approval_required') summary.approvalRequired += 1;
      if (status === 'blocked') summary.blocked += 1;
      summary.pendingApprovals += normalizeNumber(row.counts?.pendingApprovals, 0);
      if ((row.missing || []).includes('route_plan')) summary.missingRoute += 1;
      if ((row.missing || []).includes('loading_plan')) summary.missingLoading += 1;
      if ((row.missing || []).includes('worker_instruction')) summary.missingInstructions += 1;
      if ((row.missing || []).includes('procurement_plan')) summary.missingProcurement += 1;
      if ((row.missing || []).includes('weather_assessment')) summary.missingWeather += 1;
      if ((row.missing || []).includes('safety_pack')) summary.missingSafety += 1;
      if ((row.missing || []).includes('site_access')) summary.missingSiteAccess += 1;
      if ((row.blockers || []).some(blocker => blocker.type === 'procurement_gate')) summary.procurementApprovals += 1;
      if ((row.blockers || []).some(blocker => blocker.type === 'safety_readiness')) summary.safetyBlockers += 1;
      if ((row.blockers || []).some(blocker => blocker.type === 'site_access_blocked')) summary.siteAccessBlockers += 1;
      if ((row.blockers || []).some(blocker => blocker.type === 'weather_risk')) summary.weatherRisks += 1;
      summary.toolConflicts += normalizeNumber(row.counts?.toolConflicts, 0);
      summary.workerConflicts += normalizeNumber(row.counts?.workerConflicts, 0);
      summary.workerReadinessBlockers += normalizeNumber(row.counts?.workerReadinessBlockers, 0);
      summary.missingWorkerRecords += (row.blockers || [])
        .filter(blocker => blocker.type === 'worker_record_missing').length;
      summary.unavailableWorkers += (row.blockers || [])
        .filter(blocker => blocker.type === 'worker_unavailable').length;
      summary.retirementPendingWorkers += (row.blockers || [])
        .filter(blocker => blocker.type === 'worker_retirement_pending').length;
      summary.toolReadinessBlockers += normalizeNumber(row.counts?.toolReadinessBlockers, 0);
      summary.unregisteredTools += (row.blockers || [])
        .filter(blocker => blocker.type === 'tool_record_missing').length;
      summary.inspectionToolBlockers += (row.blockers || [])
        .filter(blocker => blocker.type === 'tool_inspection_readiness').length;
    }
    return summary;
  }

  listDispatchReadiness(filters = {}) {
    const mode = normalizeStatus(filters.mode || filters.status, 'all');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const includeClosed = filters.includeClosed === true || filters.include_closed === true || filters.includeClosed === 'true' || filters.include_closed === 'true';
    const closedStatuses = new Set(['completed', 'cancelled', 'canceled', 'rejected', 'closed', 'archived']);
    const rows = this.listJobs({ includeArchived: includeClosed, limit: 500 })
      .filter(job => includeClosed || !closedStatuses.has(normalizeStatus(job.status, 'open')))
      .map(job => {
        const detail = this.getJobDetail(job.id, { includeAudit: false });
        const recommendation = this.recommendSchedule(job.id, {}, { actor: 'Contractor.AI', audit: false });
        const pendingApprovals = (detail.approvals || []).filter(approval => normalizeStatus(approval.status, 'pending') === 'pending');
        const activeAssignments = (detail.assignments || []).filter(assignment => this.activeAssignmentStatus(assignment.status));
        const blockers = Array.isArray(recommendation.blockers) ? recommendation.blockers : [];
        const missing = [...new Set(Array.isArray(recommendation.missing) ? recommendation.missing : [])];
        const warnings = [...new Set(Array.isArray(recommendation.warnings) ? recommendation.warnings : [])];
        const nextActions = Array.isArray(recommendation.nextActions) ? recommendation.nextActions : [];
        const surfacedNextActions = [
          ...nextActions.filter(action => action.recordType && action.recordId),
          ...nextActions.filter(action => !(action.recordType && action.recordId))
        ];
        const readinessStatus = this.classifyDispatchReadiness({ ...recommendation, blockers, missing, warnings });
        return {
          jobId: job.id,
          jobTitle: job.title,
          jobStatus: job.status,
          phase: job.phase,
          priority: job.priority,
          riskLevel: job.riskLevel,
          clientName: job.clientName,
          clientEmail: job.clientEmail,
          clientPhone: job.clientPhone,
          address: job.address || job.city || job.region,
          jobType: job.jobType,
          scheduledStart: job.scheduledStart,
          scheduledEnd: job.scheduledEnd,
          targetCompletion: job.targetCompletion,
          progressPercent: job.progressPercent,
          readinessStatus,
          recommendationStatus: recommendation.status,
          requiresApproval: Boolean(recommendation.requiresApproval),
          readiness: recommendation.readiness || {},
          recommendedWorker: recommendation.recommendedWorker,
          nextAction: recommendation.nextAction,
          nextActions: surfacedNextActions.slice(0, 8),
          blockers,
          missing,
          warnings,
          counts: {
            activeAssignments: activeAssignments.length,
            routePlans: (detail.routePlans || []).length,
            loadingPlans: (detail.loadingPlans || []).length,
            procurementOrders: (detail.procurementOrders || []).length,
            purchaseOrders: (detail.purchaseOrders || []).length,
            workerInstructions: (detail.workerInstructions || []).length,
            materialRequirements: (detail.materials || []).length,
            toolReservations: (detail.tools || []).length,
            weatherAssessments: (detail.weather || []).length,
            safetyRecords: (detail.safetyChecks || []).length
              + (detail.safetyMeetings || []).length
              + (detail.orientations || []).length
              + (detail.jhas || []).length
              + (detail.sdsSheets || []).length,
            siteAccessRecords: (detail.siteAccessLogs || []).length,
            designOpenRecords: normalizeNumber(recommendation.readiness?.design?.openRecords, 0),
            pendingApprovals: pendingApprovals.length,
            toolConflicts: (recommendation.toolConflicts || []).length,
            workerConflicts: normalizeNumber(recommendation.readiness?.workforce?.conflicts, 0),
            workerReadinessBlockers: normalizeNumber(recommendation.readiness?.workforce?.blocked, 0),
            workerReadinessWarnings: normalizeNumber(recommendation.readiness?.workforce?.warnings, 0),
            toolReadinessBlockers: normalizeNumber(recommendation.readiness?.tools?.blocked, 0),
            toolReadinessWarnings: normalizeNumber(recommendation.readiness?.tools?.warnings, 0)
          }
        };
      });

    const matchesMode = row => {
      if (mode === 'all') return true;
      if (mode === 'ready') return ['ready', 'ready_with_warnings'].includes(row.readinessStatus);
      if (mode === 'needs_plan') return row.readinessStatus === 'needs_plan';
      if (mode === 'approval') return row.readinessStatus === 'approval_required';
      if (mode === 'approval_required') return row.readinessStatus === 'approval_required';
      if (mode === 'blocked') return row.readinessStatus === 'blocked';
      return row.readinessStatus === mode;
    };
    const matchesSearch = row => !search || JSON.stringify(row).toLowerCase().includes(search);
    const filtered = rows.filter(row => matchesMode(row) && matchesSearch(row));
    const severityRank = {
      blocked: 0,
      approval_required: 1,
      needs_plan: 2,
      ready_with_warnings: 3,
      ready: 4
    };
    const priorityScore = priority => {
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      return rank[normalizePriority(priority)] || 0;
    };
    filtered.sort((left, right) => {
      const severityDelta = (severityRank[left.readinessStatus] ?? 5) - (severityRank[right.readinessStatus] ?? 5);
      if (severityDelta) return severityDelta;
      const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
      if (priorityDelta) return priorityDelta;
      return String(left.scheduledStart || left.targetCompletion || left.jobTitle)
        .localeCompare(String(right.scheduledStart || right.targetCompletion || right.jobTitle));
    });

    return {
      generatedAt: nowIso(),
      mode,
      summary: this.summarizeDispatchReadiness(rows, filtered.length),
      jobs: filtered.slice(0, limit)
    };
  }

  financeRecordOpen(status, closed = ['cancelled', 'canceled', 'rejected', 'void', 'closed']) {
    return !closed.includes(normalizeStatus(status, 'open'));
  }

  financeDueOrOverdue(value) {
    if (!value) return false;
    const dueAt = Date.parse(value);
    if (!Number.isFinite(dueAt)) return false;
    return dueAt <= Date.now();
  }

  classifyFinanceReadiness(flags = {}) {
    if (flags.approvalRequired) return 'approval_required';
    if (flags.paymentFollowUp) return 'payment_follow_up';
    if (flags.invoiceReady) return 'invoice_ready';
    if (flags.handoffReady) return 'handoff_ready';
    if (flags.needsCosts) return 'needs_costs';
    return 'stable';
  }

  summarizeFinanceReadiness(rows = [], matching = rows.length) {
    const summary = {
      total: rows.length,
      matching,
      approvalRequired: 0,
      invoiceReady: 0,
      paymentFollowUp: 0,
      handoffReady: 0,
      needsCosts: 0,
      stable: 0,
      pendingApprovals: 0,
      draftInvoices: 0,
      openPayments: 0,
      receivedPayments: 0,
      missingCosts: 0,
      missingBudgetLines: 0,
      missingHandoffs: 0,
      dueOrOverduePayments: 0,
      openPurchaseOrders: 0,
      openDrawRequests: 0,
      openLienWaivers: 0,
      contractValue: 0,
      quoteValue: 0,
      quotedNetValue: 0,
      invoiceValue: 0,
      invoicedNetValue: 0,
      invoiceDraftAmount: 0,
      uninvoicedValue: 0,
      uninvoicedNetValue: 0,
      unpaidValue: 0,
      receivedValue: 0,
      expenseValue: 0,
      billableLaborValue: 0,
      purchaseOrderValue: 0,
      drawRequestValue: 0,
      financeHandoffValue: 0
    };
    for (const row of rows) {
      const status = normalizeStatus(row.financeStatus, 'stable');
      if (status === 'approval_required') summary.approvalRequired += 1;
      if (status === 'invoice_ready') summary.invoiceReady += 1;
      if (status === 'payment_follow_up') summary.paymentFollowUp += 1;
      if (status === 'handoff_ready') summary.handoffReady += 1;
      if (status === 'needs_costs') summary.needsCosts += 1;
      if (status === 'stable') summary.stable += 1;
      summary.pendingApprovals += normalizeNumber(row.counts?.pendingApprovals, 0);
      summary.draftInvoices += normalizeNumber(row.counts?.draftInvoices, 0);
      summary.openPayments += normalizeNumber(row.counts?.openPayments, 0);
      summary.receivedPayments += normalizeNumber(row.counts?.receivedPayments, 0);
      summary.missingCosts += row.flags?.needsCosts ? 1 : 0;
      summary.missingBudgetLines += row.flags?.missingBudget ? 1 : 0;
      summary.missingHandoffs += row.flags?.handoffMissing ? 1 : 0;
      summary.dueOrOverduePayments += normalizeNumber(row.counts?.dueOrOverduePayments, 0);
      summary.openPurchaseOrders += normalizeNumber(row.counts?.openPurchaseOrders, 0);
      summary.openDrawRequests += normalizeNumber(row.counts?.openDrawRequests, 0);
      summary.openLienWaivers += normalizeNumber(row.counts?.openLienWaivers, 0);
      const money = row.money || {};
      summary.contractValue += normalizeNumber(money.contractValue, 0);
      summary.quoteValue += normalizeNumber(money.quoteValue, 0);
      summary.quotedNetValue += normalizeNumber(money.quotedNetValue, 0);
      summary.invoiceValue += normalizeNumber(money.invoiceValue, 0);
      summary.invoicedNetValue += normalizeNumber(money.invoicedNetValue, 0);
      summary.invoiceDraftAmount += normalizeNumber(money.invoiceDraftAmount, 0);
      summary.uninvoicedValue += normalizeNumber(money.uninvoicedValue, 0);
      summary.uninvoicedNetValue += normalizeNumber(money.uninvoicedNetValue, 0);
      summary.unpaidValue += normalizeNumber(money.unpaidValue, 0);
      summary.receivedValue += normalizeNumber(money.receivedValue, 0);
      summary.expenseValue += normalizeNumber(money.expenseValue, 0);
      summary.billableLaborValue += normalizeNumber(money.billableLaborValue, 0);
      summary.purchaseOrderValue += normalizeNumber(money.purchaseOrderValue, 0);
      summary.drawRequestValue += normalizeNumber(money.drawRequestValue, 0);
      summary.financeHandoffValue += normalizeNumber(money.financeHandoffValue, 0);
    }
    return summary;
  }

  listFinanceReadiness(filters = {}) {
    const mode = normalizeStatus(filters.mode || filters.status, 'all');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const includeArchived = normalizeBoolean(filters.includeArchived ?? filters.include_archived, false);
    const excludedStatuses = new Set(includeArchived ? [] : ['cancelled', 'canceled', 'rejected', 'archived']);
    const financeTargetTypes = new Set([
      'invoice',
      'payment',
      'budget_line',
      'purchase_order',
      'draw_request',
      'lien_waiver',
      'finance_handoff'
    ]);
    const completedStatuses = new Set(['completed', 'closed', 'accepted']);
    const activeJobStatuses = new Set(['scheduled', 'in_progress', 'active', 'approved', 'completed', 'closed', 'accepted']);
    const activeInvoiceStatuses = ['paid', 'received', 'settled', 'cancelled', 'canceled', 'rejected', 'void'];
    const activePaymentClosedStatuses = ['paid', 'received', 'settled', 'written_off', 'cancelled', 'canceled', 'rejected', 'void'];
    const activeHandoffClosedStatuses = ['exported', 'sent', 'cancelled', 'canceled', 'rejected', 'void'];

    const rows = this.listJobs({ includeArchived, limit: 500 })
      .filter(job => !excludedStatuses.has(normalizeStatus(job.status, 'open')))
      .map(job => {
        const detail = this.getJobDetail(job.id, { includeAudit: false });
        const jobStatus = normalizeStatus(detail.status, 'open');
        const financeApprovals = (detail.approvals || []).filter(approval =>
          normalizeStatus(approval.status, 'pending') === 'pending'
          && financeTargetTypes.has(normalizeStatus(approval.targetType, ''))
        );
        const validInvoices = (detail.invoices || []).filter(invoice => this.financeRecordOpen(invoice.status));
        const activeInvoices = validInvoices.filter(invoice => this.financeRecordOpen(invoice.status, activeInvoiceStatuses));
        const draftInvoices = activeInvoices.filter(invoice => ['draft', 'submitted', 'pending_approval'].includes(normalizeStatus(invoice.status, 'draft')));
        const issueableInvoices = activeInvoices.filter(invoice => ['approved', 'sent', 'submitted'].includes(normalizeStatus(invoice.status, 'draft')));
        const openPayments = (detail.payments || []).filter(payment => this.financeRecordOpen(payment.status, activePaymentClosedStatuses));
        const dueOrOverduePayments = openPayments.filter(payment => this.financeDueOrOverdue(payment.dueAt));
        const paymentsDueForFollowUp = openPayments.filter(payment => {
          const paymentData = payment.data || {};
          return this.financeDueOrOverdue(paymentData.nextFollowUpAt || payment.dueAt);
        });
        const receivedPayments = (detail.payments || []).filter(payment => ['paid', 'received', 'settled'].includes(normalizeStatus(payment.status, '')));
        const activeBudgetLines = (detail.budgetLines || []).filter(line => this.financeRecordOpen(line.status));
        const openPurchaseOrders = (detail.purchaseOrders || []).filter(order => this.financeRecordOpen(order.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'received']));
        const openDrawRequests = (detail.drawRequests || []).filter(draw => this.financeRecordOpen(draw.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'funded']));
        const openLienWaivers = (detail.lienWaivers || []).filter(waiver => this.financeRecordOpen(waiver.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'released', 'waived']));
        const activeHandoffs = (detail.financeHandoffs || []).filter(handoff => this.financeRecordOpen(handoff.status, activeHandoffClosedStatuses));
        const timeLogs = (detail.timeLogs || []).filter(log => this.financeRecordOpen(log.status, ['cancelled', 'canceled', 'rejected', 'void']));
        const expenses = (detail.expenses || []).filter(expense => this.financeRecordOpen(expense.status, ['cancelled', 'canceled', 'rejected', 'void']));
        const billableHours = timeLogs.reduce((sum, log) => sum + (log.billable === false ? 0 : normalizeNumber(log.hours, 0)), 0);
        const billableLaborValue = timeLogs.reduce((sum, log) => sum + (log.billable === false ? 0 : normalizeNumber(log.hours, 0) * normalizeNumber(log.rate, 0)), 0);
        const expenseValue = expenses.reduce((sum, expense) => sum + normalizeNumber(expense.amount, 0), 0);
        const validQuotes = (detail.quotes || [])
          .filter(quote => this.financeRecordOpen(quote.status, ['cancelled', 'canceled', 'rejected', 'expired', 'void']));
        const latestQuote = validQuotes[0] || null;
        const quoteValue = validQuotes
          .reduce((sum, quote) => sum + normalizeNumber(quote.total, 0), 0);
        const quotedNetValue = normalizeNumber(latestQuote?.subtotal, 0);
        const quotedGrossValue = normalizeNumber(latestQuote?.total, quotedNetValue);
        const contractValue = normalizeNumber(detail.contractValue, normalizeNumber(detail.estimatedCost, 0));
        const invoiceValue = validInvoices.reduce((sum, invoice) => sum + normalizeNumber(invoice.total || invoice.amount, 0), 0);
        const invoicedNetValue = validInvoices.reduce((sum, invoice) => sum + normalizeNumber(invoice.amount, 0), 0);
        const receivedValue = receivedPayments.reduce((sum, payment) => sum + normalizeNumber(payment.amount, 0), 0);
        const openPaymentValue = openPayments.reduce((sum, payment) => sum + normalizeNumber(payment.amount, 0), 0);
        const purchaseOrderValue = openPurchaseOrders.reduce((sum, order) => sum + normalizeNumber(order.amount, 0), 0);
        const drawRequestValue = openDrawRequests.reduce((sum, draw) => sum + normalizeNumber(draw.requestedAmount, 0), 0);
        const financeHandoffValue = activeHandoffs.reduce((sum, handoff) => sum + normalizeNumber(handoff.amount, 0), 0);
        const budgetForecastValue = activeBudgetLines.reduce((sum, line) => sum + normalizeNumber(line.forecastAmount, 0), 0);
        const budgetActualValue = activeBudgetLines.reduce((sum, line) => sum + normalizeNumber(line.actualAmount, 0), 0);
        const netRevenueBasis = Math.max(contractValue, quotedNetValue, invoicedNetValue);
        const grossRevenueBasis = Math.max(contractValue, quotedGrossValue, invoiceValue);
        const invoiceDraftAmount = Math.max(0, Math.max(contractValue, quotedNetValue) - invoicedNetValue);
        const progressedForFinance = completedStatuses.has(jobStatus) || normalizeNumber(detail.progressPercent, 0) >= 85;
        const startedForCosting = activeJobStatuses.has(jobStatus) && (normalizeNumber(detail.progressPercent, 0) >= 25 || completedStatuses.has(jobStatus));
        const hasFinancialActivity = activeInvoices.length
          || openPayments.length
          || receivedPayments.length
          || expenses.length
          || timeLogs.length
          || activeBudgetLines.length
          || openPurchaseOrders.length
          || openDrawRequests.length
          || openLienWaivers.length;
        const missingCosts = startedForCosting && !expenses.length && !timeLogs.length && budgetActualValue <= 0;
        const missingBudget = activeJobStatuses.has(jobStatus) && netRevenueBasis >= 1000 && !activeBudgetLines.length;
        const invoiceReady = progressedForFinance && invoiceDraftAmount > 1;
        const untrackedReceivable = issueableInvoices.length > 0
          && openPayments.length === 0
          && Math.max(0, invoiceValue - receivedValue) > 1;
        const paymentFollowUp = paymentsDueForFollowUp.length > 0 || untrackedReceivable;
        const handoffMissing = hasFinancialActivity && !activeHandoffs.length;
        const handoffReady = !missingCosts
          && !missingBudget
          && (handoffMissing || activeHandoffs.some(handoff => ['draft', 'ready'].includes(normalizeStatus(handoff.status, 'draft'))));
        const approvalRequired = financeApprovals.length > 0
          || activeInvoices.some(invoice => invoice.approvalId && ['draft', 'submitted', 'pending_approval'].includes(normalizeStatus(invoice.status, 'draft')))
          || openPayments.some(payment => payment.approvalId && ['pending_confirmation', 'pending_approval'].includes(normalizeStatus(payment.status, '')))
          || openPurchaseOrders.some(order => order.approvalId && ['pending_approval', 'ready_to_order'].includes(normalizeStatus(order.status, '')))
          || openDrawRequests.some(draw => draw.approvalId && ['pending_approval', 'submitted', 'approved_for_funding'].includes(normalizeStatus(draw.status, '')))
          || openLienWaivers.some(waiver => waiver.approvalId && ['pending_approval', 'received', 'released'].includes(normalizeStatus(waiver.status, '')))
          || activeHandoffs.some(handoff => handoff.approvalId && ['pending_approval', 'submitted', 'ready_to_export'].includes(normalizeStatus(handoff.status, '')));
        const flags = {
          approvalRequired,
          paymentFollowUp,
          invoiceReady,
          handoffReady,
          needsCosts: missingCosts || missingBudget,
          missingCosts,
          missingBudget,
          handoffMissing
        };
        const financeStatus = this.classifyFinanceReadiness(flags);
        const nextActions = [];
        if (approvalRequired) nextActions.push({ type: 'review_finance_approval', label: 'Review finance approval gates', approvalId: financeApprovals[0]?.id || null, requiresApproval: false });
        if (paymentFollowUp) nextActions.push({
          type: 'record_payment_follow_up',
          label: 'Record payment follow-up or confirmation',
          paymentId: paymentsDueForFollowUp[0]?.id || openPayments[0]?.id || null,
          invoiceId: issueableInvoices[0]?.id || null,
          requiresApproval: false
        });
        if (invoiceReady) nextActions.push({ type: 'draft_invoice', label: 'Draft invoice or Peppol/UBL package', requiresApproval: true });
        if (missingCosts) nextActions.push({ type: 'record_time_expense', label: 'Record time logs and job expenses', requiresApproval: false });
        if (missingBudget) nextActions.push({ type: 'create_budget_line', label: 'Create budget and forecast control', requiresApproval: true });
        if (issueableInvoices.length && !openDrawRequests.length && invoiceValue >= 1000) nextActions.push({ type: 'create_draw_request', label: 'Prepare progress draw request', invoiceId: issueableInvoices[0].id, requiresApproval: true });
        if (openPayments.some(payment => normalizeNumber(payment.amount, 0) >= 1000) && !openLienWaivers.length) nextActions.push({ type: 'request_lien_waiver', label: 'Prepare lien waiver request before payment closeout', paymentId: openPayments.find(payment => normalizeNumber(payment.amount, 0) >= 1000)?.id || null, requiresApproval: false });
        if (handoffReady) nextActions.push({ type: 'prepare_finance_handoff', label: 'Prepare FAB/bookkeeping handoff package', handoffId: activeHandoffs[0]?.id || null, requiresApproval: true });
        const primaryAction = nextActions[0]?.label || 'Finance records are stable.';

        return {
          jobId: detail.id,
          jobTitle: detail.title,
          jobStatus: detail.status,
          phase: detail.phase,
          priority: detail.priority,
          riskLevel: detail.riskLevel,
          clientName: detail.client?.name || detail.clientName,
          clientEmail: detail.client?.email || detail.clientEmail,
          clientPhone: detail.client?.phone || detail.clientPhone,
          address: detail.address || detail.city || detail.region,
          jobType: detail.jobType,
          scheduledStart: detail.scheduledStart,
          targetCompletion: detail.targetCompletion,
          progressPercent: detail.progressPercent,
          financeStatus,
          nextAction: primaryAction,
          nextActions,
          flags,
          counts: {
            timeLogs: timeLogs.length,
            billableHours,
            expenses: expenses.length,
            invoices: validInvoices.length,
            draftInvoices: draftInvoices.length,
            issueableInvoices: issueableInvoices.length,
            openPayments: openPayments.length,
            dueOrOverduePayments: dueOrOverduePayments.length,
            receivedPayments: receivedPayments.length,
            budgetLines: activeBudgetLines.length,
            openPurchaseOrders: openPurchaseOrders.length,
            openDrawRequests: openDrawRequests.length,
            openLienWaivers: openLienWaivers.length,
            financeHandoffs: activeHandoffs.length,
            pendingApprovals: financeApprovals.length
          },
          money: {
            contractValue,
            quoteValue,
            quotedNetValue,
            quotedGrossValue,
            invoiceValue,
            invoicedNetValue,
            invoiceDraftAmount,
            uninvoicedValue: Math.max(0, grossRevenueBasis - invoiceValue),
            uninvoicedNetValue: invoiceDraftAmount,
            unpaidValue: Math.max(openPaymentValue, Math.max(0, invoiceValue - receivedValue)),
            receivedValue,
            expenseValue,
            billableLaborValue,
            purchaseOrderValue,
            drawRequestValue,
            financeHandoffValue,
            budgetForecastValue,
            budgetActualValue,
            projectedMargin: netRevenueBasis - expenseValue - billableLaborValue - purchaseOrderValue
          },
          latest: {
            invoice: validInvoices[0] || null,
            payment: openPayments[0] || receivedPayments[0] || null,
            budgetLine: activeBudgetLines[0] || null,
            purchaseOrder: openPurchaseOrders[0] || null,
            drawRequest: openDrawRequests[0] || null,
            lienWaiver: openLienWaivers[0] || null,
            financeHandoff: activeHandoffs[0] || null,
            timeLog: timeLogs[0] || null,
            expense: expenses[0] || null
          }
        };
      });

    const matchesMode = row => {
      if (mode === 'all') return true;
      if (mode === 'approval') return row.flags?.approvalRequired === true;
      if (mode === 'payment') return row.flags?.paymentFollowUp === true;
      if (mode === 'payment_followup') return row.flags?.paymentFollowUp === true;
      if (mode === 'payment_follow_up') return row.flags?.paymentFollowUp === true;
      if (mode === 'invoice') return row.flags?.invoiceReady === true;
      if (mode === 'invoice_ready') return row.flags?.invoiceReady === true;
      if (mode === 'handoff') return row.flags?.handoffReady === true;
      if (mode === 'handoff_ready') return row.flags?.handoffReady === true;
      if (mode === 'costs') return row.flags?.needsCosts === true;
      if (mode === 'needs_costs') return row.flags?.needsCosts === true;
      return row.financeStatus === mode;
    };
    const matchesSearch = row => !search || JSON.stringify(row).toLowerCase().includes(search);
    const filtered = rows.filter(row => matchesMode(row) && matchesSearch(row));
    const statusRank = {
      approval_required: 0,
      payment_follow_up: 1,
      invoice_ready: 2,
      handoff_ready: 3,
      needs_costs: 4,
      stable: 5
    };
    const priorityScore = priority => {
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      return rank[normalizePriority(priority)] || 0;
    };
    filtered.sort((left, right) => {
      const statusDelta = (statusRank[left.financeStatus] ?? 6) - (statusRank[right.financeStatus] ?? 6);
      if (statusDelta) return statusDelta;
      const unpaidDelta = normalizeNumber(right.money?.unpaidValue, 0) - normalizeNumber(left.money?.unpaidValue, 0);
      if (Math.abs(unpaidDelta) > 0.01) return unpaidDelta;
      const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
      if (priorityDelta) return priorityDelta;
      return String(left.targetCompletion || left.scheduledStart || left.jobTitle)
        .localeCompare(String(right.targetCompletion || right.scheduledStart || right.jobTitle));
    });

    return {
      generatedAt: nowIso(),
      mode,
      summary: this.summarizeFinanceReadiness(rows, filtered.length),
      jobs: filtered.slice(0, limit)
    };
  }

  classifyClientSuccessReadiness(flags = {}) {
    if (flags.approvalRequired) return 'approval_required';
    if (flags.waitingClient) return 'waiting_client';
    if (flags.closeoutReady) return 'closeout_ready';
    if (flags.punchOrWarranty) return 'punch_warranty';
    if (flags.aftercareDue) return 'aftercare_due';
    return 'stable';
  }

  summarizeClientSuccess(rows = [], matching = rows.length) {
    const summary = {
      total: rows.length,
      matching,
      approvalRequired: 0,
      waitingClient: 0,
      closeoutReady: 0,
      punchWarranty: 0,
      aftercareDue: 0,
      stable: 0,
      pendingApprovals: 0,
      pendingSelections: 0,
      overdueSelections: 0,
      outboundDrafts: 0,
      waitingReplies: 0,
      closeoutMissing: 0,
      openPunchItems: 0,
      openWarrantyClaims: 0,
      openAftercare: 0,
      dueAftercare: 0,
      clientValue: 0,
      aftercareValue: 0
    };
    for (const row of rows) {
      const status = normalizeStatus(row.clientStatus, 'stable');
      if (row.flags?.approvalRequired) summary.approvalRequired += 1;
      if (row.flags?.waitingClient) summary.waitingClient += 1;
      if (row.flags?.closeoutReady) summary.closeoutReady += 1;
      if (row.flags?.punchOrWarranty) summary.punchWarranty += 1;
      if (row.flags?.aftercareDue) summary.aftercareDue += 1;
      if (status === 'stable') summary.stable += 1;
      summary.pendingApprovals += normalizeNumber(row.counts?.pendingApprovals, 0);
      summary.pendingSelections += normalizeNumber(row.counts?.pendingSelections, 0);
      summary.overdueSelections += normalizeNumber(row.counts?.overdueSelections, 0);
      summary.outboundDrafts += normalizeNumber(row.counts?.outboundDrafts, 0);
      summary.waitingReplies += normalizeNumber(row.counts?.waitingReplies, 0);
      summary.closeoutMissing += row.flags?.closeoutMissing ? 1 : 0;
      summary.openPunchItems += normalizeNumber(row.counts?.openPunchItems, 0);
      summary.openWarrantyClaims += normalizeNumber(row.counts?.openWarrantyClaims, 0);
      summary.openAftercare += normalizeNumber(row.counts?.openAftercare, 0);
      summary.dueAftercare += normalizeNumber(row.counts?.dueAftercare, 0);
      summary.clientValue += normalizeNumber(row.money?.clientValue, 0);
      summary.aftercareValue += normalizeNumber(row.money?.aftercareValue, 0);
    }
    return summary;
  }

  listClientSuccess(filters = {}) {
    const mode = normalizeStatus(filters.mode || filters.status, 'all');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const includeArchived = normalizeBoolean(filters.includeArchived ?? filters.include_archived, false);
    const excludedStatuses = new Set(includeArchived ? [] : ['cancelled', 'canceled', 'rejected', 'archived']);
    const clientTargetTypes = new Set([
      'communication',
      'client_selection',
      'quality_check',
      'punch_item',
      'warranty_claim',
      'job_update'
    ]);
    const closedStatuses = ['cancelled', 'canceled', 'rejected', 'void', 'closed'];
    const completedStatuses = new Set(['completed', 'closed', 'accepted']);

    const rows = this.listJobs({ includeArchived, limit: 500 })
      .filter(job => !excludedStatuses.has(normalizeStatus(job.status, 'open')))
      .map(job => {
        const detail = this.getJobDetail(job.id, { includeAudit: false });
        const jobStatus = normalizeStatus(detail.status, 'open');
        const pendingApprovals = (detail.approvals || []).filter(approval =>
          normalizeStatus(approval.status, 'pending') === 'pending'
          && clientTargetTypes.has(normalizeStatus(approval.targetType, ''))
        );
        const selections = (detail.clientSelections || []).filter(selection => this.financeRecordOpen(selection.status, closedStatuses));
        const pendingSelections = selections.filter(selection => !['approved', 'accepted', 'locked', 'selected'].includes(normalizeStatus(selection.status, 'pending_client')));
        const overdueSelections = pendingSelections.filter(selection => this.financeDueOrOverdue(selection.dueAt));
        const communications = detail.communications || [];
        const outboundDrafts = communications.filter(message =>
          normalizeStatus(message.direction, '') === 'outbound'
          && ['draft', 'pending_approval'].includes(normalizeStatus(message.status, 'draft'))
        );
        const waitingReplies = communications.filter(message => {
          const data = message.data || {};
          return normalizeStatus(message.direction, '') === 'outbound'
            && data.expectsReply
            && ['sent', 'delivered', 'awaiting_client', 'client_reply_required'].includes(normalizeStatus(message.status, ''));
        });
        const overdueReplies = waitingReplies.filter(message => this.financeDueOrOverdue(message.data?.replyBy));
        const qualityOpen = (detail.qualityChecks || []).filter(item =>
          !['approved', 'passed', 'closed', 'accepted'].includes(normalizeStatus(item.status, ''))
          || normalizeNumber(item.data?.defectsOpen, 0) > 0
          || (Array.isArray(item.defects) && item.defects.length > 0)
        );
        const safetyOpen = (detail.safetyChecks || []).filter(item =>
          !['approved', 'closed', 'completed', 'passed'].includes(normalizeStatus(item.status, ''))
          || ['high', 'critical'].includes(normalizeStatus(item.riskLevel, 'normal'))
        );
        const openPunchItems = (detail.punchItems || []).filter(item =>
          this.financeRecordOpen(item.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'verified', 'resolved'])
        );
        const duePunchItems = openPunchItems.filter(item => this.financeDueOrOverdue(item.dueAt));
        const openWarrantyClaims = (detail.warrantyClaims || []).filter(item =>
          this.financeRecordOpen(item.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'resolved'])
        );
        const dueWarrantyClaims = openWarrantyClaims.filter(item => this.financeDueOrOverdue(item.dueAt));
        const openAftercare = (detail.aftercare || []).filter(item =>
          this.financeRecordOpen(item.status, ['cancelled', 'canceled', 'closed', 'completed', 'done', 'resolved'])
        );
        const dueAftercare = openAftercare.filter(item => this.financeDueOrOverdue(item.dueAt));
        const activeRecurringPlans = (detail.recurringPlans || []).filter(plan =>
          this.financeRecordOpen(plan.status, ['cancelled', 'canceled', 'inactive', 'paused', 'closed'])
        );
        const hasClientCloseoutDraft = communications.some(message => {
          const subject = `${message.subject || ''} ${message.body || ''}`.toLowerCase();
          return normalizeStatus(message.direction, '') === 'outbound'
            && (subject.includes('closeout') || subject.includes('completion') || subject.includes('aftercare') || subject.includes('handover'));
        });
        const progressedForCloseout = completedStatuses.has(jobStatus) || normalizeNumber(detail.progressPercent, 0) >= 90;
        const closeoutMissing = progressedForCloseout && (!detail.aftercare?.length || !hasClientCloseoutDraft || !detail.qualityChecks?.length);
        const waitingClient = pendingSelections.length > 0 || waitingReplies.length > 0 || overdueSelections.length > 0 || overdueReplies.length > 0;
        const punchOrWarranty = openPunchItems.length > 0 || openWarrantyClaims.length > 0;
        const aftercareDue = dueAftercare.length > 0 || (completedStatuses.has(jobStatus) && openAftercare.length > 0);
        const approvalRequired = pendingApprovals.length > 0
          || outboundDrafts.some(message => message.approvalId && normalizeStatus(message.status, 'draft') === 'pending_approval')
          || selections.some(selection => selection.approvalId && normalizeStatus(selection.status, '') === 'pending_approval')
          || openPunchItems.some(item => item.approvalId && normalizeStatus(item.status, '') === 'pending_approval')
          || openWarrantyClaims.some(item => item.approvalId && normalizeStatus(item.status, '') === 'pending_approval');
        const flags = {
          approvalRequired,
          waitingClient,
          closeoutReady: closeoutMissing,
          punchOrWarranty,
          aftercareDue,
          closeoutMissing,
          overdueSelection: overdueSelections.length > 0,
          overdueReply: overdueReplies.length > 0
        };
        const clientStatus = this.classifyClientSuccessReadiness(flags);
        const nextActions = [];
        if (approvalRequired) nextActions.push({ type: 'review_client_approval', label: 'Review client-facing approval gates', approvalId: pendingApprovals[0]?.id || null, requiresApproval: false });
        if (overdueSelections.length) nextActions.push({ type: 'selection_follow_up', label: 'Draft client selection reminder', selectionId: overdueSelections[0].id, requiresApproval: true });
        if (overdueReplies.length || waitingReplies.length) nextActions.push({ type: 'client_reply_follow_up', label: 'Draft client reply follow-up', communicationId: (overdueReplies[0] || waitingReplies[0])?.id || null, requiresApproval: true });
        if (pendingSelections.length) nextActions.push({ type: 'review_client_selection', label: 'Record the retained client selection decision', selectionId: pendingSelections[0].id, requiresApproval: true });
        if (closeoutMissing) nextActions.push({ type: 'prepare_closeout', label: 'Create closeout pack and client handover draft', requiresApproval: true });
        if (openPunchItems.length) nextActions.push({
          type: 'resolve_punch_item',
          label: 'Resolve punch item before acceptance',
          punchItemId: openPunchItems[0].id,
          requiresApproval: true
        });
        if (openWarrantyClaims.length) nextActions.push({
          type: 'resolve_warranty_claim',
          label: 'Resolve warranty or aftercare claim',
          warrantyClaimId: openWarrantyClaims[0].id,
          requiresApproval: true
        });
        if (dueAftercare.length) nextActions.push({
          type: 'complete_aftercare',
          label: 'Complete aftercare follow-up',
          aftercareId: dueAftercare[0].id,
          requiresApproval: false
        });
        if (!activeRecurringPlans.length && completedStatuses.has(jobStatus) && /garden|maintenance|clean|service|aftercare|warranty/i.test(`${detail.jobType} ${detail.title}`)) {
          nextActions.push({ type: 'propose_recurring_plan', label: 'Propose recurring maintenance plan', requiresApproval: true });
        }

        const clientValue = Math.max(
          normalizeNumber(detail.contractValue, 0),
          (detail.quotes || []).reduce((sum, quote) => sum + normalizeNumber(quote.total, 0), 0),
          (detail.invoices || []).reduce((sum, invoice) => sum + normalizeNumber(invoice.total || invoice.amount, 0), 0)
        );
        const aftercareValue = (openWarrantyClaims.length + openPunchItems.length + openAftercare.length) * Math.max(1, clientValue);

        return {
          jobId: detail.id,
          jobTitle: detail.title,
          jobStatus: detail.status,
          phase: detail.phase,
          priority: detail.priority,
          riskLevel: detail.riskLevel,
          clientName: detail.client?.name || detail.clientName,
          clientEmail: detail.client?.email || detail.clientEmail,
          clientPhone: detail.client?.phone || detail.clientPhone,
          address: detail.address || detail.city || detail.region,
          jobType: detail.jobType,
          scheduledStart: detail.scheduledStart,
          targetCompletion: detail.targetCompletion,
          progressPercent: detail.progressPercent,
          clientStatus,
          nextAction: nextActions[0]?.label || 'Client loop is stable.',
          nextActions: nextActions.slice(0, 8),
          flags,
          counts: {
            pendingApprovals: pendingApprovals.length,
            selections: selections.length,
            pendingSelections: pendingSelections.length,
            overdueSelections: overdueSelections.length,
            outboundDrafts: outboundDrafts.length,
            waitingReplies: waitingReplies.length,
            overdueReplies: overdueReplies.length,
            qualityOpen: qualityOpen.length,
            safetyOpen: safetyOpen.length,
            openPunchItems: openPunchItems.length,
            duePunchItems: duePunchItems.length,
            openWarrantyClaims: openWarrantyClaims.length,
            dueWarrantyClaims: dueWarrantyClaims.length,
            openAftercare: openAftercare.length,
            dueAftercare: dueAftercare.length,
            recurringPlans: activeRecurringPlans.length
          },
          money: {
            clientValue,
            aftercareValue
          },
          latest: {
            selection: selections[0] || null,
            communication: outboundDrafts[0] || waitingReplies[0] || communications[0] || null,
            punchItem: openPunchItems[0] || null,
            warrantyClaim: openWarrantyClaims[0] || null,
            aftercare: openAftercare[0] || null,
            recurringPlan: activeRecurringPlans[0] || null
          }
        };
      });

    const matchesMode = row => {
      if (mode === 'all') return true;
      if (mode === 'approval') return row.flags?.approvalRequired === true;
      if (mode === 'waiting') return row.flags?.waitingClient === true;
      if (mode === 'waiting_client') return row.flags?.waitingClient === true;
      if (mode === 'closeout') return row.flags?.closeoutReady === true;
      if (mode === 'closeout_ready') return row.flags?.closeoutReady === true;
      if (mode === 'punch') return row.flags?.punchOrWarranty === true;
      if (mode === 'punch_warranty') return row.flags?.punchOrWarranty === true;
      if (mode === 'aftercare') return row.flags?.aftercareDue === true;
      if (mode === 'aftercare_due') return row.flags?.aftercareDue === true;
      return row.clientStatus === mode;
    };
    const matchesSearch = row => !search || JSON.stringify(row).toLowerCase().includes(search);
    const filtered = rows.filter(row => matchesMode(row) && matchesSearch(row));
    const statusRank = {
      approval_required: 0,
      waiting_client: 1,
      closeout_ready: 2,
      punch_warranty: 3,
      aftercare_due: 4,
      stable: 5
    };
    const priorityScore = priority => {
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      return rank[normalizePriority(priority)] || 0;
    };
    filtered.sort((left, right) => {
      const statusDelta = (statusRank[left.clientStatus] ?? 6) - (statusRank[right.clientStatus] ?? 6);
      if (statusDelta) return statusDelta;
      const overdueDelta = normalizeNumber(right.counts?.overdueSelections, 0) + normalizeNumber(right.counts?.overdueReplies, 0)
        - normalizeNumber(left.counts?.overdueSelections, 0) - normalizeNumber(left.counts?.overdueReplies, 0);
      if (overdueDelta) return overdueDelta;
      const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
      if (priorityDelta) return priorityDelta;
      return String(left.targetCompletion || left.scheduledStart || left.jobTitle)
        .localeCompare(String(right.targetCompletion || right.scheduledStart || right.jobTitle));
    });

    return {
      generatedAt: nowIso(),
      mode,
      summary: this.summarizeClientSuccess(rows, filtered.length),
      jobs: filtered.slice(0, limit)
    };
  }

  classifyWorkforceReadiness(flags = {}) {
    if (flags.approvalRequired) return 'approval_required';
    if (flags.workerConflict || flags.offlineAssigned) return 'worker_conflict';
    if (flags.needsAssignment) return 'needs_assignment';
    if (flags.needsInstruction) return 'needs_instruction';
    if (flags.siteAccess) return 'site_access';
    if (flags.timeMissing) return 'time_missing';
    return 'stable';
  }

  summarizeWorkforceReadiness(rows = [], matching = rows.length) {
    const summary = {
      total: rows.length,
      matching,
      approvalRequired: 0,
      workerConflicts: 0,
      needsAssignment: 0,
      needsInstruction: 0,
      siteAccess: 0,
      timeMissing: 0,
      stable: 0,
      pendingApprovals: 0,
      activeAssignments: 0,
      pendingAssignments: 0,
      offlineAssignments: 0,
      assignmentHours: 0,
      workerInstructions: 0,
      draftInstructions: 0,
      publishedInstructions: 0,
      orientations: 0,
      openOrientations: 0,
      dueOrientations: 0,
      blockedSiteAccess: 0,
      timeLogs: 0,
      billableHours: 0,
      missingTimeLogs: 0
    };
    for (const row of rows) {
      const flags = row.flags || {};
      if (flags.approvalRequired) summary.approvalRequired += 1;
      if (flags.workerConflict || flags.offlineAssigned) summary.workerConflicts += 1;
      if (flags.needsAssignment) summary.needsAssignment += 1;
      if (flags.needsInstruction) summary.needsInstruction += 1;
      if (flags.siteAccess) summary.siteAccess += 1;
      if (flags.timeMissing) summary.timeMissing += 1;
      if (normalizeStatus(row.workforceStatus, 'stable') === 'stable') summary.stable += 1;
      summary.pendingApprovals += normalizeNumber(row.counts?.pendingApprovals, 0);
      summary.activeAssignments += normalizeNumber(row.counts?.activeAssignments, 0);
      summary.pendingAssignments += normalizeNumber(row.counts?.pendingAssignments, 0);
      summary.offlineAssignments += normalizeNumber(row.counts?.offlineAssignments, 0);
      summary.assignmentHours += normalizeNumber(row.counts?.assignmentHours, 0);
      summary.workerInstructions += normalizeNumber(row.counts?.workerInstructions, 0);
      summary.draftInstructions += normalizeNumber(row.counts?.draftInstructions, 0);
      summary.publishedInstructions += normalizeNumber(row.counts?.publishedInstructions, 0);
      summary.orientations += normalizeNumber(row.counts?.orientations, 0);
      summary.openOrientations += normalizeNumber(row.counts?.openOrientations, 0);
      summary.dueOrientations += normalizeNumber(row.counts?.dueOrientations, 0);
      summary.blockedSiteAccess += normalizeNumber(row.counts?.blockedSiteAccess, 0);
      summary.timeLogs += normalizeNumber(row.counts?.timeLogs, 0);
      summary.billableHours += normalizeNumber(row.counts?.billableHours, 0);
      summary.missingTimeLogs += flags.timeMissing ? 1 : 0;
    }
    return summary;
  }

  listWorkforceReadiness(filters = {}) {
    const mode = normalizeStatus(filters.mode || filters.status, 'all');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const includeArchived = normalizeBoolean(filters.includeArchived ?? filters.include_archived, false);
    const excludedStatuses = new Set(includeArchived ? [] : ['cancelled', 'canceled', 'rejected', 'archived']);
    const workforceTargetTypes = new Set([
      'assignment',
      'worker_assignment',
      'worker_instruction',
      'worker_orientation',
      'site_access_log',
      'safety_meeting',
      'jha_record',
      'sds_sheet'
    ]);
    const closedStatuses = ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'released', 'completed'];
    const readyInstructionStatuses = new Set(['approved', 'sent', 'published', 'dispatched']);
    const crewJobStatuses = new Set(['planned', 'scheduled', 'confirmed', 'approved', 'active', 'in_progress']);
    const workStartedStatuses = new Set(['active', 'in_progress', 'completed', 'closed', 'accepted']);
    const offlineWorkerStatuses = new Set(['offline', 'on_leave', 'on_hold', 'inactive', 'unavailable', 'blocked', 'sick', 'retired']);
    const workersById = new Map(this.listWorkers({ includeInactive: true }).map(worker => [worker.id, worker]));

    const rows = this.listJobs({ includeArchived, limit: 500 })
      .filter(job => !excludedStatuses.has(normalizeStatus(job.status, 'open')))
      .map(job => {
        const detail = this.getJobDetail(job.id, { includeAudit: false });
        const jobStatus = normalizeStatus(detail.status, 'open');
        const progressPercent = normalizeNumber(detail.progressPercent, 0);
        const scheduledForCrew = crewJobStatuses.has(jobStatus) || Boolean(detail.scheduledStart || detail.targetCompletion);
        const timeExpected = workStartedStatuses.has(jobStatus) || progressPercent >= 50;
        const activeAssignments = (detail.assignments || []).filter(assignment => this.activeAssignmentStatus(assignment.status));
        const crewEvidence = this.crewEvidenceReadiness(detail);
        const currentApprovalTargets = new Map([
          ['assignment', new Set(activeAssignments.map(record => String(record.id)))],
          ['worker_assignment', new Set(activeAssignments.map(record => String(record.id)))],
          ['worker_instruction', new Set(crewEvidence.currentInstructions.map(record => String(record.id)))],
          ['worker_orientation', new Set(crewEvidence.currentOrientations.map(record => String(record.id)))],
          ['site_access_log', new Set(crewEvidence.currentSiteAccessLogs.map(record => String(record.id)))]
        ]);
        const pendingApprovals = (detail.approvals || []).filter(approval => {
          const targetType = normalizeStatus(approval.targetType, '');
          if (normalizeStatus(approval.status, 'pending') !== 'pending' || !workforceTargetTypes.has(targetType)) return false;
          const scopedTargets = currentApprovalTargets.get(targetType);
          return !scopedTargets || scopedTargets.has(String(approval.targetId || ''));
        });
        const pendingAssignments = activeAssignments.filter(assignment =>
          ['pending_approval', 'pending', 'planned', 'scheduled'].includes(normalizeStatus(assignment.status, 'planned'))
        );
        const workerConflicts = activeAssignments.flatMap(assignment => {
          if (Array.isArray(assignment.conflicts) && assignment.conflicts.length) {
            return assignment.conflicts;
          }
          return this.findAssignmentConflicts({
            workerId: assignment.workerId,
            scheduledStart: assignment.scheduledStart,
            scheduledEnd: assignment.scheduledEnd,
            excludeAssignmentId: assignment.id
          });
        });
        const offlineAssignments = activeAssignments.filter(assignment => {
          const worker = assignment.workerId ? workersById.get(assignment.workerId) : null;
          return !worker || offlineWorkerStatuses.has(normalizeStatus(worker.status, 'available'));
        });
        const activeInstructions = crewEvidence.currentInstructions.filter(instruction => this.financeRecordOpen(instruction.status, closedStatuses));
        const publishedInstructions = activeInstructions.filter(instruction =>
          readyInstructionStatuses.has(normalizeStatus(instruction.status, 'draft'))
        );
        const draftInstructions = activeInstructions.filter(instruction =>
          !readyInstructionStatuses.has(normalizeStatus(instruction.status, 'draft'))
        );
        const orientations = crewEvidence.currentOrientations.filter(orientation =>
          this.financeRecordOpen(orientation.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed'])
        );
        const openOrientations = orientations.filter(orientation =>
          !['completed', 'approved', 'cleared', 'valid'].includes(normalizeStatus(orientation.status, 'scheduled'))
        );
        const dueOrientations = openOrientations.filter(orientation => this.financeDueOrOverdue(orientation.dueAt));
        const blockedSiteAccess = crewEvidence.items.filter(item => item.siteAccess && !item.siteAccessReady).map(item => item.siteAccess);
        const timeLogs = (detail.timeLogs || []).filter(log =>
          this.financeRecordOpen(log.status, ['cancelled', 'canceled', 'rejected', 'void'])
        );
        const billableHours = timeLogs.reduce((sum, log) => sum + (log.billable === false ? 0 : normalizeNumber(log.hours, 0)), 0);
        const assignmentHours = activeAssignments.reduce((sum, assignment) => sum + normalizeNumber(assignment.allocationHours, 0), 0);
        const needsAssignment = scheduledForCrew && activeAssignments.length === 0;
        const needsInstruction = (scheduledForCrew || activeAssignments.length > 0)
          && activeAssignments.length > 0
          && !crewEvidence.instructionsReady;
        const siteAccess = activeAssignments.length > 0
          && (!crewEvidence.orientationsReady || !crewEvidence.siteAccessReady);
        const timeMissing = timeExpected && timeLogs.length === 0;
        const approvalRequired = pendingApprovals.length > 0
          || activeAssignments.some(assignment => assignment.approvalId && normalizeStatus(assignment.status, '') === 'pending_approval')
          || activeInstructions.some(instruction => instruction.approvalId && normalizeStatus(instruction.status, '') === 'pending_approval')
          || orientations.some(orientation => orientation.approvalId && normalizeStatus(orientation.status, '') === 'pending_approval')
          || blockedSiteAccess.some(access => access.approvalId && normalizeStatus(access.status, '') === 'pending_approval');
        const flags = {
          approvalRequired,
          workerConflict: workerConflicts.length > 0,
          needsAssignment,
          needsInstruction,
          siteAccess,
          timeMissing,
          offlineAssigned: offlineAssignments.length > 0,
          dueOrientation: dueOrientations.length > 0,
          blockedSiteAccess: blockedSiteAccess.length > 0
        };
        const workforceStatus = this.classifyWorkforceReadiness(flags);
        const instructionGap = crewEvidence.items.find(item => !item.instructionReady) || null;
        const siteAccessGap = crewEvidence.items.find(item => !item.siteAccessReady) || null;
        const nextActions = [];
        if (approvalRequired) nextActions.push({ type: 'review_worker_approval', label: 'Review crew approval gates', approvalId: pendingApprovals[0]?.id || null, requiresApproval: false });
        if (workerConflicts.length) nextActions.push({ type: 'resolve_worker_conflict', label: 'Resolve double-booked worker assignment', assignmentId: activeAssignments[0]?.id || null, workerId: activeAssignments[0]?.workerId || null, requiresApproval: false });
        if (offlineAssignments.length) nextActions.push({ type: 'resolve_worker_conflict', label: 'Replace unavailable worker assignment', assignmentId: offlineAssignments[0]?.id || null, workerId: offlineAssignments[0]?.workerId || null, requiresApproval: false });
        if (needsAssignment) nextActions.push({ type: 'assign_worker', label: 'Assign an available worker or subcontractor', requiresApproval: false });
        if (needsInstruction && instructionGap?.instruction) nextActions.push({
          type: 'publish_worker_instruction',
          label: 'Review and request instruction approval',
          instructionId: instructionGap.instruction.id,
          recordType: 'worker_instruction',
          recordId: instructionGap.instruction.id,
          record: instructionGap.instruction,
          targetStatus: 'published',
          assignmentId: instructionGap.assignmentId,
          workerId: instructionGap.workerId,
          workerName: instructionGap.workerName,
          requiresApproval: true
        });
        if (needsInstruction && !instructionGap?.instruction) nextActions.push({
          type: 'draft_worker_instruction',
          label: 'Draft crew instructions',
          assignmentId: instructionGap?.assignmentId || activeAssignments[0]?.id || null,
          workerId: instructionGap?.workerId || activeAssignments[0]?.workerId || null,
          workerName: instructionGap?.workerName || activeAssignments[0]?.workerName || null,
          requiresApproval: false
        });
        if (siteAccess && siteAccessGap && !siteAccessGap.orientationReady) nextActions.push({
          type: 'complete_worker_orientation',
          label: siteAccessGap.orientation ? 'Complete worker orientation' : 'Prepare worker orientation evidence',
          orientationId: siteAccessGap.orientation?.id || null,
          assignmentId: siteAccessGap.assignmentId,
          workerId: siteAccessGap.workerId,
          workerName: siteAccessGap.workerName,
          company: siteAccessGap.orientation?.company || null,
          requiresApproval: true
        });
        if (siteAccess && siteAccessGap?.orientationReady && !siteAccessGap.siteAccess) nextActions.push({
          type: 'prepare_site_access',
          label: 'Prepare site-access gate',
          orientationId: siteAccessGap.orientation?.id || null,
          assignmentId: siteAccessGap.assignmentId,
          workerId: siteAccessGap.workerId,
          workerName: siteAccessGap.workerName,
          requiresApproval: false
        });
        if (siteAccess && siteAccessGap?.orientationReady && siteAccessGap.siteAccess && normalizeStatus(siteAccessGap.siteAccess.status, 'requested') !== 'pending_approval') nextActions.push({
          type: 'clear_site_access',
          label: 'Request site-access clearance',
          siteAccessId: siteAccessGap.siteAccess.id,
          recordType: 'site_access',
          recordId: siteAccessGap.siteAccess.id,
          record: siteAccessGap.siteAccess,
          targetStatus: 'cleared',
          assignmentId: siteAccessGap.assignmentId,
          workerId: siteAccessGap.workerId,
          workerName: siteAccessGap.workerName,
          requiresApproval: true
        });
        if (timeMissing) nextActions.push({ type: 'record_time_log', label: 'Record worker time for costing and payroll evidence', assignmentId: activeAssignments[0]?.id || null, workerId: activeAssignments[0]?.workerId || null, workerName: activeAssignments[0]?.workerName || null, requiresApproval: false });

        return {
          jobId: detail.id,
          jobTitle: detail.title,
          jobStatus: detail.status,
          phase: detail.phase,
          priority: detail.priority,
          riskLevel: detail.riskLevel,
          clientName: detail.client?.name || detail.clientName,
          clientEmail: detail.client?.email || detail.clientEmail,
          clientPhone: detail.client?.phone || detail.clientPhone,
          address: detail.address || detail.city || detail.region,
          jobType: detail.jobType,
          scheduledStart: detail.scheduledStart,
          scheduledEnd: detail.scheduledEnd,
          targetCompletion: detail.targetCompletion,
          progressPercent,
          workforceStatus,
          nextAction: nextActions[0]?.label || 'Crew workflow is stable.',
          nextActions: nextActions.slice(0, 8),
          flags,
          counts: {
            pendingApprovals: pendingApprovals.length,
            activeAssignments: activeAssignments.length,
            pendingAssignments: pendingAssignments.length,
            workerConflicts: workerConflicts.length,
            offlineAssignments: offlineAssignments.length,
            assignmentHours,
            workerInstructions: activeInstructions.length,
            draftInstructions: draftInstructions.length,
            publishedInstructions: publishedInstructions.length,
            orientations: orientations.length,
            openOrientations: openOrientations.length,
            dueOrientations: dueOrientations.length,
            blockedSiteAccess: blockedSiteAccess.length,
            missingOrientations: crewEvidence.missingOrientations,
            missingSiteAccess: crewEvidence.missingSiteAccess,
            siteAccessRecords: crewEvidence.currentSiteAccessLogs.length,
            staleCrewEvidence: crewEvidence.staleRecords.instructions + crewEvidence.staleRecords.orientations + crewEvidence.staleRecords.siteAccess,
            timeLogs: timeLogs.length,
            billableHours
          },
          crewEvidence: {
            instructionsReady: crewEvidence.items.filter(item => item.instructionReady).length,
            orientationsReady: crewEvidence.items.filter(item => item.orientationReady).length,
            siteAccessReady: crewEvidence.items.filter(item => item.siteAccessReady).length,
            required: crewEvidence.items.length,
            staleRecords: crewEvidence.staleRecords
          },
          latest: {
            assignment: activeAssignments[0] || null,
            instruction: activeInstructions[0] || null,
            orientation: orientations[0] || null,
            siteAccess: crewEvidence.currentSiteAccessLogs[0] || null,
            timeLog: timeLogs[0] || null
          },
          conflicts: workerConflicts.slice(0, 8),
          workers: activeAssignments.map(assignment => ({
            id: assignment.workerId,
            name: assignment.workerName || workersById.get(assignment.workerId)?.name || assignment.workerId,
            role: assignment.role,
            status: assignment.status,
            workerStatus: workersById.get(assignment.workerId)?.status || null,
            scheduledStart: assignment.scheduledStart,
            scheduledEnd: assignment.scheduledEnd
          })).slice(0, 8)
        };
      });

    const matchesMode = row => {
      if (mode === 'all') return true;
      if (mode === 'approval' || mode === 'approval_required') return row.flags?.approvalRequired === true;
      if (mode === 'conflict' || mode === 'worker_conflict') return row.flags?.workerConflict === true || row.flags?.offlineAssigned === true;
      if (mode === 'assignment' || mode === 'needs_assignment') return row.flags?.needsAssignment === true;
      if (mode === 'instruction' || mode === 'needs_instruction') return row.flags?.needsInstruction === true;
      if (mode === 'access' || mode === 'site_access') return row.flags?.siteAccess === true;
      if (mode === 'time' || mode === 'time_missing') return row.flags?.timeMissing === true;
      if (mode === 'stable') return row.workforceStatus === 'stable';
      return row.workforceStatus === mode;
    };
    const matchesSearch = row => !search || JSON.stringify(row).toLowerCase().includes(search);
    const filtered = rows.filter(row => matchesMode(row) && matchesSearch(row));
    const statusRank = {
      approval_required: 0,
      worker_conflict: 1,
      needs_assignment: 2,
      needs_instruction: 3,
      site_access: 4,
      time_missing: 5,
      stable: 6
    };
    const priorityScore = priority => {
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      return rank[normalizePriority(priority)] || 0;
    };
    filtered.sort((left, right) => {
      const statusDelta = (statusRank[left.workforceStatus] ?? 7) - (statusRank[right.workforceStatus] ?? 7);
      if (statusDelta) return statusDelta;
      const conflictDelta = normalizeNumber(right.counts?.workerConflicts, 0) - normalizeNumber(left.counts?.workerConflicts, 0);
      if (conflictDelta) return conflictDelta;
      const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
      if (priorityDelta) return priorityDelta;
      return String(left.scheduledStart || left.targetCompletion || left.jobTitle)
        .localeCompare(String(right.scheduledStart || right.targetCompletion || right.jobTitle));
    });

    return {
      generatedAt: nowIso(),
      mode,
      summary: this.summarizeWorkforceReadiness(rows, filtered.length),
      jobs: filtered.slice(0, limit)
    };
  }

  classifyInventoryReadiness(flags = {}) {
    if (flags.supplierComplianceBlocked) return 'supplier_compliance';
    if (flags.approvalRequired) return 'approval_required';
    if (flags.toolConflict) return 'tool_conflict';
    if (flags.procurementNeeded) return 'procurement_needed';
    if (flags.loadingMissing) return 'loading_missing';
    if (flags.materialNeeded) return 'material_needed';
    return 'stable';
  }

  summarizeInventoryReadiness(rows = [], matching = rows.length) {
    const summary = {
      total: rows.length,
      matching,
      approvalRequired: 0,
      supplierComplianceBlocked: 0,
      toolConflicts: 0,
      procurementNeeded: 0,
      loadingMissing: 0,
      materialNeeded: 0,
      stable: 0,
      pendingApprovals: 0,
      toolReservations: 0,
      pendingToolReservations: 0,
      materialRequirements: 0,
      openMaterials: 0,
      dueMaterials: 0,
      procurementOrders: 0,
      pendingProcurement: 0,
      committedProcurement: 0,
      purchaseOrders: 0,
      loadingPlans: 0,
      loadingItems: 0,
      trailerLoads: 0,
      unresolvedLoadingMaterials: 0,
      pendingLoadingApprovals: 0,
      loadingExternalCommitments: 0,
      procurementValue: 0,
      materialCost: 0,
      partnerComplianceBlocks: 0
    };
    for (const row of rows) {
      const flags = row.flags || {};
      if (flags.supplierComplianceBlocked) summary.supplierComplianceBlocked += 1;
      if (flags.approvalRequired) summary.approvalRequired += 1;
      if (flags.toolConflict) summary.toolConflicts += 1;
      if (flags.procurementNeeded) summary.procurementNeeded += 1;
      if (flags.loadingMissing) summary.loadingMissing += 1;
      if (flags.materialNeeded) summary.materialNeeded += 1;
      if (normalizeStatus(row.inventoryStatus, 'stable') === 'stable') summary.stable += 1;
      summary.pendingApprovals += normalizeNumber(row.counts?.pendingApprovals, 0);
      summary.toolReservations += normalizeNumber(row.counts?.toolReservations, 0);
      summary.pendingToolReservations += normalizeNumber(row.counts?.pendingToolReservations, 0);
      summary.materialRequirements += normalizeNumber(row.counts?.materialRequirements, 0);
      summary.openMaterials += normalizeNumber(row.counts?.openMaterials, 0);
      summary.dueMaterials += normalizeNumber(row.counts?.dueMaterials, 0);
      summary.procurementOrders += normalizeNumber(row.counts?.procurementOrders, 0);
      summary.pendingProcurement += normalizeNumber(row.counts?.pendingProcurement, 0);
      summary.committedProcurement += normalizeNumber(row.counts?.committedProcurement, 0);
      summary.purchaseOrders += normalizeNumber(row.counts?.purchaseOrders, 0);
      summary.loadingPlans += normalizeNumber(row.counts?.loadingPlans, 0);
      summary.loadingItems += normalizeNumber(row.loadingReadiness?.itemCounts?.total, 0);
      summary.trailerLoads += normalizeNumber(row.loadingReadiness?.trailerRequired ? 1 : 0, 0);
      summary.unresolvedLoadingMaterials += normalizeNumber(row.loadingReadiness?.unresolvedMaterialCount, 0);
      summary.pendingLoadingApprovals += normalizeNumber(row.loadingReadiness?.pendingApprovalCount, 0);
      summary.loadingExternalCommitments += normalizeNumber(row.loadingReadiness?.externalCommitments, 0);
      summary.procurementValue += normalizeNumber(row.money?.procurementValue, 0);
      summary.materialCost += normalizeNumber(row.money?.materialCost, 0);
      summary.partnerComplianceBlocks += normalizeNumber(row.counts?.partnerComplianceBlocks, 0);
    }
    return summary;
  }

  listInventoryReadiness(filters = {}) {
    const mode = normalizeStatus(filters.mode || filters.status, 'all');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const includeArchived = normalizeBoolean(filters.includeArchived ?? filters.include_archived, false);
    const excludedStatuses = new Set(includeArchived ? [] : ['cancelled', 'canceled', 'rejected', 'archived']);
    const inventoryTargetTypes = new Set([
      'tool_reservation',
      'procurement_order',
      'purchase_order',
      'loading_plan',
      'material_requirement'
    ]);
    const materialClosedStatuses = ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'received', 'delivered', 'available', 'used'];
    const procurementClosedStatuses = ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'received'];
    const procurementPendingStatuses = new Set(['draft', 'pending', 'pending_approval', 'ready_to_order', 'needs_review', 'submitted']);
    const procurementCommittedStatuses = new Set(['approved', 'ordered', 'sent', 'received']);
    const inventoryJobStatuses = new Set(['planned', 'scheduled', 'confirmed', 'approved', 'active', 'in_progress']);

    const rows = this.listJobs({ includeArchived, limit: 500 })
      .filter(job => !excludedStatuses.has(normalizeStatus(job.status, 'open')))
      .map(job => {
        const detail = this.getJobDetail(job.id, { includeAudit: false });
        const jobStatus = normalizeStatus(detail.status, 'open');
        const scheduledForInventory = inventoryJobStatuses.has(jobStatus) || Boolean(detail.scheduledStart || detail.targetCompletion);
        const pendingApprovals = (detail.approvals || []).filter(approval =>
          normalizeStatus(approval.status, 'pending') === 'pending'
          && inventoryTargetTypes.has(normalizeStatus(approval.targetType, ''))
        );
        const activeTools = (detail.tools || []).filter(tool => this.activeToolReservationStatus(tool.status));
        const pendingToolReservations = activeTools.filter(tool =>
          ['pending_approval', 'pending', 'planned', 'scheduled'].includes(normalizeStatus(tool.status, 'reserved'))
        );
        const toolConflicts = activeTools.flatMap(tool => {
          if (Array.isArray(tool.conflicts) && tool.conflicts.length) {
            return tool.conflicts;
          }
          return this.findToolReservationConflicts({
            toolId: tool.toolId,
            toolName: tool.toolName,
            neededFrom: tool.neededFrom,
            neededUntil: tool.neededUntil,
            excludeReservationId: tool.id
          });
        });
        const activeMaterials = (detail.materials || []).filter(material =>
          this.financeRecordOpen(material.status, materialClosedStatuses)
        );
        const openMaterials = activeMaterials.filter(material =>
          ['needed', 'low_stock', 'requested', 'pending', 'draft', 'ordered'].includes(normalizeStatus(material.status, 'needed'))
        );
        const dueMaterials = openMaterials.filter(material => this.financeDueOrOverdue(material.neededBy));
        const procurementOrders = (detail.procurementOrders || []).filter(order =>
          this.financeRecordOpen(order.status, procurementClosedStatuses)
        );
        const pendingProcurement = procurementOrders.filter(order =>
          procurementPendingStatuses.has(normalizeStatus(order.status, 'draft'))
        );
        const committedProcurement = procurementOrders.filter(order =>
          procurementCommittedStatuses.has(normalizeStatus(order.status, 'draft'))
        );
        const purchaseOrders = (detail.purchaseOrders || []).filter(order =>
          this.financeRecordOpen(order.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed', 'received'])
        );
        const partnerReadiness = [...procurementOrders, ...purchaseOrders].map(order => ({
          orderId: order.id,
          recordType: detail.procurementOrders?.some(candidate => candidate.id === order.id) ? 'procurement_order' : 'purchase_order',
          ...this.tradePartnerReadinessForSpend(order)
        }));
        const partnerComplianceBlocks = partnerReadiness.filter(item => item.compliance.compliant !== true);
        const activeLoadingPlans = (detail.loadingPlans || []).filter(plan =>
          this.financeRecordOpen(plan.status, ['cancelled', 'canceled', 'rejected', 'void', 'closed'])
        );
        const activeLoadingPlan = activeLoadingPlans[0] || null;
        const loadingReadiness = activeLoadingPlan?.data?.readiness || null;
        const materialNeeded = scheduledForInventory && activeMaterials.length > 0 && openMaterials.length > 0;
        const procurementNeeded = openMaterials.length > 0 && !procurementOrders.length && !purchaseOrders.length;
        const loadingMissing = scheduledForInventory
          && (activeTools.length > 0 || activeMaterials.length > 0)
          && activeLoadingPlans.length === 0;
        const approvalRequired = pendingApprovals.length > 0
          || activeTools.some(tool => tool.approvalId && normalizeStatus(tool.status, '') === 'pending_approval')
          || procurementOrders.some(order => order.approvalId && normalizeStatus(order.status, '') === 'pending_approval')
          || purchaseOrders.some(order => order.approvalId && ['pending_approval', 'ready_to_order'].includes(normalizeStatus(order.status, '')))
          || activeLoadingPlans.some(plan => plan.approvalId && normalizeStatus(plan.status, '') === 'pending_approval');
        const flags = {
          supplierComplianceBlocked: partnerComplianceBlocks.length > 0,
          approvalRequired,
          toolConflict: toolConflicts.length > 0,
          procurementNeeded,
          loadingMissing,
          materialNeeded,
          dueMaterials: dueMaterials.length > 0,
          pendingProcurement: pendingProcurement.length > 0,
          pendingToolReservations: pendingToolReservations.length > 0
        };
        const inventoryStatus = this.classifyInventoryReadiness(flags);
        const nextActions = [];
        if (partnerComplianceBlocks.length) nextActions.push({
          type: 'review_trade_partner',
          label: 'Verify trade partner before purchasing approval',
          tradePartnerId: partnerComplianceBlocks[0].partner?.id || null,
          supplier: partnerComplianceBlocks[0].supplier || null,
          recordType: partnerComplianceBlocks[0].recordType,
          recordId: partnerComplianceBlocks[0].orderId,
          blockers: partnerComplianceBlocks[0].compliance.blockers,
          requiresApproval: false,
          blocked: true
        });
        if (approvalRequired) nextActions.push({ type: 'review_inventory_approval', label: 'Review inventory or procurement approval gates', approvalId: pendingApprovals[0]?.id || null, requiresApproval: false });
        if (toolConflicts.length) nextActions.push({ type: 'resolve_tool_conflict', label: 'Resolve overlapping tool reservation', reservationId: activeTools[0]?.id || null, toolId: activeTools[0]?.toolId || null, requiresApproval: false });
        if (procurementNeeded) nextActions.push({ type: 'create_procurement_order', label: 'Create procurement order for required materials', materialRequirementIds: openMaterials.map(material => material.id), requiresApproval: true });
        if (loadingMissing) nextActions.push({ type: 'prepare_loading_plan', label: 'Create loading checklist from tools and materials', materialRequirementIds: activeMaterials.map(material => material.id), reservationIds: activeTools.map(tool => tool.id), requiresApproval: false });
        if (materialNeeded && !procurementNeeded) nextActions.push({ type: 'review_material_status', label: 'Confirm material availability and supplier status', materialRequirementId: (dueMaterials[0] || openMaterials[0])?.id || null, requiresApproval: false });

        const materialCost = activeMaterials.reduce((sum, material) => {
          return sum + normalizeNumber(material.cost, 0) * Math.max(1, normalizeNumber(material.quantity, 1));
        }, 0);
        const procurementValue = procurementOrders.reduce((sum, order) => sum + normalizeNumber(order.amount, 0), 0)
          + purchaseOrders.reduce((sum, order) => sum + normalizeNumber(order.amount, 0), 0);

        return {
          jobId: detail.id,
          jobTitle: detail.title,
          jobStatus: detail.status,
          phase: detail.phase,
          priority: detail.priority,
          riskLevel: detail.riskLevel,
          clientName: detail.client?.name || detail.clientName,
          clientEmail: detail.client?.email || detail.clientEmail,
          clientPhone: detail.client?.phone || detail.clientPhone,
          address: detail.address || detail.city || detail.region,
          jobType: detail.jobType,
          scheduledStart: detail.scheduledStart,
          scheduledEnd: detail.scheduledEnd,
          targetCompletion: detail.targetCompletion,
          progressPercent: detail.progressPercent,
          inventoryStatus,
          nextAction: nextActions[0]?.label || 'Inventory workflow is stable.',
          nextActions: nextActions.slice(0, 8),
          flags,
          counts: {
            pendingApprovals: pendingApprovals.length,
            toolReservations: activeTools.length,
            pendingToolReservations: pendingToolReservations.length,
            toolConflicts: toolConflicts.length,
            materialRequirements: activeMaterials.length,
            openMaterials: openMaterials.length,
            dueMaterials: dueMaterials.length,
            procurementOrders: procurementOrders.length,
            pendingProcurement: pendingProcurement.length,
            committedProcurement: committedProcurement.length,
            purchaseOrders: purchaseOrders.length,
            partnerComplianceBlocks: partnerComplianceBlocks.length,
            loadingPlans: activeLoadingPlans.length,
            loadingItems: normalizeNumber(loadingReadiness?.itemCounts?.total, 0),
            loadingToolItems: normalizeNumber(loadingReadiness?.itemCounts?.tools, 0),
            loadingMaterialItems: normalizeNumber(loadingReadiness?.itemCounts?.materials, 0)
          },
          money: {
            materialCost,
            procurementValue
          },
          latest: {
            tool: activeTools[0] || null,
            material: openMaterials[0] || activeMaterials[0] || null,
            procurementOrder: pendingProcurement[0] || procurementOrders[0] || null,
            purchaseOrder: purchaseOrders[0] || null,
            tradePartner: partnerReadiness.find(item => item.partner)?.partner || null,
            loadingPlan: activeLoadingPlan
          },
          loadingReadiness,
          conflicts: toolConflicts.slice(0, 8),
          tools: activeTools.slice(0, 8),
          materials: activeMaterials.slice(0, 8)
        };
      });

    const matchesMode = row => {
      if (mode === 'all') return true;
      if (mode === 'approval' || mode === 'approval_required') return row.flags?.approvalRequired === true;
      if (mode === 'supplier' || mode === 'supplier_compliance') return row.flags?.supplierComplianceBlocked === true;
      if (mode === 'conflict' || mode === 'tool_conflict') return row.flags?.toolConflict === true;
      if (mode === 'procurement' || mode === 'procurement_needed') return row.flags?.procurementNeeded === true || row.flags?.pendingProcurement === true;
      if (mode === 'loading' || mode === 'loading_missing') return row.flags?.loadingMissing === true;
      if (mode === 'material' || mode === 'material_needed') return row.flags?.materialNeeded === true;
      if (mode === 'stable') return row.inventoryStatus === 'stable';
      return row.inventoryStatus === mode;
    };
    const matchesSearch = row => !search || JSON.stringify(row).toLowerCase().includes(search);
    const filtered = rows.filter(row => matchesMode(row) && matchesSearch(row));
    const statusRank = {
      supplier_compliance: 0,
      approval_required: 1,
      tool_conflict: 2,
      procurement_needed: 3,
      loading_missing: 4,
      material_needed: 5,
      stable: 6
    };
    const priorityScore = priority => {
      const rank = { low: 1, medium: 2, high: 3, critical: 4 };
      return rank[normalizePriority(priority)] || 0;
    };
    filtered.sort((left, right) => {
      const statusDelta = (statusRank[left.inventoryStatus] ?? 6) - (statusRank[right.inventoryStatus] ?? 6);
      if (statusDelta) return statusDelta;
      const conflictDelta = normalizeNumber(right.counts?.toolConflicts, 0) - normalizeNumber(left.counts?.toolConflicts, 0);
      if (conflictDelta) return conflictDelta;
      const dueMaterialDelta = normalizeNumber(right.counts?.dueMaterials, 0) - normalizeNumber(left.counts?.dueMaterials, 0);
      if (dueMaterialDelta) return dueMaterialDelta;
      const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
      if (priorityDelta) return priorityDelta;
      return String(left.scheduledStart || left.targetCompletion || left.jobTitle)
        .localeCompare(String(right.scheduledStart || right.targetCompletion || right.jobTitle));
    });

    return {
      generatedAt: nowIso(),
      mode,
      summary: this.summarizeInventoryReadiness(rows, filtered.length),
      jobs: filtered.slice(0, limit)
    };
  }

  classifyFieldAssuranceReadiness(flags = {}) {
    if (flags.approvalRequired) return 'approval_required';
    if (flags.incidentBlocker) return 'incident_blocked';
    if (flags.safetyGap) return 'safety_gap';
    if (flags.designReview) return 'design_review';
    if (flags.qualityReview) return 'quality_review';
    if (flags.evidenceMissing) return 'evidence_missing';
    return 'stable';
  }

  summarizeFieldAssurance(rows = [], matching = rows.length) {
    const summary = {
      total: rows.length,
      matching,
      approvalRequired: 0,
      incidentBlocked: 0,
      safetyGaps: 0,
      designReviews: 0,
      qualityReviews: 0,
      evidenceMissing: 0,
      stable: 0,
      pendingApprovals: 0,
      openRfis: 0,
      submittalReviews: 0,
      permitReviews: 0,
      expiringPermits: 0,
      inspectionReviews: 0,
      openObservations: 0,
      openIncidents: 0,
      openSafetyRecords: 0,
      dueSafetyRecords: 0,
      siteAccessBlocks: 0,
      qualityOpen: 0,
      safetyOpen: 0,
      punchOpen: 0,
      evidenceRecords: 0,
      documentReviews: 0
    };
    for (const row of rows) {
      const flags = row.flags || {};
      if (flags.approvalRequired) summary.approvalRequired += 1;
      if (flags.incidentBlocker) summary.incidentBlocked += 1;
      if (flags.safetyGap) summary.safetyGaps += 1;
      if (flags.designReview) summary.designReviews += 1;
      if (flags.qualityReview) summary.qualityReviews += 1;
      if (flags.evidenceMissing) summary.evidenceMissing += 1;
      if (normalizeStatus(row.fieldStatus, 'stable') === 'stable') summary.stable += 1;
      summary.pendingApprovals += normalizeNumber(row.counts?.pendingApprovals, 0);
      summary.openRfis += normalizeNumber(row.counts?.openRfis, 0);
      summary.submittalReviews += normalizeNumber(row.counts?.submittalReviews, 0);
      summary.permitReviews += normalizeNumber(row.counts?.permitReviews, 0);
      summary.expiringPermits += normalizeNumber(row.counts?.expiringPermits, 0);
      summary.inspectionReviews += normalizeNumber(row.counts?.inspectionReviews, 0);
      summary.openObservations += normalizeNumber(row.counts?.openObservations, 0);
      summary.openIncidents += normalizeNumber(row.counts?.openIncidents, 0);
      summary.openSafetyRecords += normalizeNumber(row.counts?.openSafetyRecords, 0);
      summary.dueSafetyRecords += normalizeNumber(row.counts?.dueSafetyRecords, 0);
      summary.siteAccessBlocks += normalizeNumber(row.counts?.siteAccessBlocks, 0);
      summary.qualityOpen += normalizeNumber(row.counts?.qualityOpen, 0);
      summary.safetyOpen += normalizeNumber(row.counts?.safetyOpen, 0);
      summary.punchOpen += normalizeNumber(row.counts?.punchOpen, 0);
      summary.evidenceRecords += normalizeNumber(row.counts?.evidenceRecords, 0);
      summary.documentReviews += normalizeNumber(row.counts?.documentReviews, 0);
    }
    return summary;
  }

  listFieldAssurance(filters = {}) {
    const mode = normalizeStatus(filters.mode || filters.status, 'all');
    const search = normalizeText(filters.search, '').toLowerCase();
    const limit = safeLimit(filters.limit, 100, 500);
    const includeArchived = normalizeBoolean(filters.includeArchived ?? filters.include_archived, false);
    const excludedStatuses = new Set(includeArchived ? [] : ['cancelled', 'canceled', 'rejected', 'archived']);
    const fieldTargetTypes = new Set([
      'rfi_record',
      'submittal_record',
      'permit_record',
      'inspection_record',
      'observation_record',
      'incident_record',
      'safety_meeting',
      'worker_orientation',
      'jha_record',
      'sds_sheet',
      'site_access_log',
      'quality_check',
      'safety_check',
      'punch_item',
      'document'
    ]);
    const closedStatuses = ['approved', 'accepted', 'closed', 'complete', 'completed', 'current', 'valid', 'passed', 'resolved', 'verified', 'cancelled', 'canceled', 'rejected', 'void'];
    const activeJobStatuses = new Set(['planned', 'scheduled', 'in_progress', 'active', 'completed']);
    const now = Date.now();
    const nearDue = (value, days = 7) => {
      if (!value) return false;
      const timestamp = new Date(value).getTime();
      if (!Number.isFinite(timestamp)) return false;
      return timestamp <= now + days * 24 * 60 * 60 * 1000;
    };
    const recordOpen = record => this.financeRecordOpen(record?.status, closedStatuses);
    const statusOfRecord = (record, fallback = 'open') => normalizeStatus(record?.status, fallback);
    const severityOf = record => normalizeStatus(record?.severity || record?.riskLevel || record?.risk_level, 'medium');

    const rows = this.listJobs({ includeArchived, limit: 500 })
      .filter(job => !excludedStatuses.has(normalizeStatus(job.status, 'open')))
      .map(job => {
        const detail = this.getJobDetail(job.id, { includeAudit: false });
        const jobStatus = normalizeStatus(detail.status, 'open');
        const pendingApprovals = (detail.approvals || []).filter(approval =>
          normalizeStatus(approval.status, 'pending') === 'pending'
          && fieldTargetTypes.has(normalizeStatus(approval.targetType, ''))
        );

        const openRfis = (detail.rfis || []).filter(recordOpen);
        const submittalReviews = (detail.submittals || []).filter(item =>
          recordOpen(item) || ['revise_resubmit', 'pending_review', 'pending_approval'].includes(statusOfRecord(item, 'draft'))
        );
        const permitReviews = (detail.permits || []).filter(item =>
          recordOpen(item) || ['draft', 'pending', 'pending_approval', 'needs_renewal', 'expired'].includes(statusOfRecord(item, 'draft'))
        );
        const expiringPermits = (detail.permits || []).filter(item =>
          !['closed', 'expired', 'cancelled', 'canceled', 'rejected'].includes(statusOfRecord(item, 'draft'))
          && nearDue(item.expiresAt)
        );
        const inspectionReviews = (detail.inspections || []).filter(item => {
          const defects = Array.isArray(item.defects) ? item.defects : [];
          const result = normalizeStatus(item.result, '');
          return recordOpen(item)
            || ['failed', 'rejected'].includes(result)
            || ['scheduled', 'pending_approval', 'failed'].includes(statusOfRecord(item, 'scheduled'))
            || defects.length > 0;
        });
        const openObservations = (detail.observations || []).filter(recordOpen);
        const openIncidents = (detail.incidents || []).filter(recordOpen);
        const safetyMeetings = (detail.safetyMeetings || []).filter(recordOpen);
        const orientations = (detail.orientations || []).filter(recordOpen);
        const jhas = (detail.jhas || []).filter(recordOpen);
        const sdsSheets = (detail.sdsSheets || []).filter(recordOpen);
        const siteAccessBlocks = (detail.siteAccessLogs || []).filter(item => {
          const status = statusOfRecord(item, 'requested');
          return ['blocked', 'rejected', 'expired', 'pending_approval', 'requested'].includes(status) || item.orientationValid === false;
        });
        const qualityOpen = (detail.qualityChecks || []).filter(item => {
          const defects = Array.isArray(item.defects) ? item.defects : [];
          return recordOpen(item) || normalizeNumber(item.data?.defectsOpen, defects.length) > 0 || defects.length > 0;
        });
        const safetyOpen = (detail.safetyChecks || []).filter(item =>
          recordOpen(item) || ['high', 'critical'].includes(severityOf(item))
        );
        const punchOpen = (detail.punchItems || []).filter(recordOpen);
        const documentReviews = (detail.documents || []).filter(item =>
          ['needs_review', 'needs_update', 'draft', 'pending_approval', 'expired'].includes(statusOfRecord(item, 'stored'))
        );

        const safetyRecords = [
          ...(detail.safetyMeetings || []),
          ...(detail.orientations || []),
          ...(detail.jhas || []),
          ...(detail.sdsSheets || []),
          ...(detail.safetyChecks || []),
          ...(detail.siteAccessLogs || [])
        ];
        const openSafetyRecords = [
          ...safetyMeetings,
          ...orientations,
          ...jhas,
          ...sdsSheets,
          ...safetyOpen,
          ...siteAccessBlocks
        ];
        const dueSafetyRecords = openSafetyRecords.filter(item =>
          this.financeDueOrOverdue(item.dueAt || item.expiresAt || item.scheduledAt || item.completedAt)
        );
        const evidenceRecords = (detail.documents || []).length + (detail.fieldReports || []).length;
        const activeFieldJob = activeJobStatuses.has(jobStatus) || (detail.assignments || []).length > 0 || evidenceRecords > 0;
        const safetyGap = activeFieldJob && safetyRecords.length === 0;
        const designReview = openRfis.length > 0
          || submittalReviews.length > 0
          || permitReviews.length > 0
          || expiringPermits.length > 0
          || documentReviews.length > 0;
        const incidentBlocker = openIncidents.some(item => ['high', 'critical'].includes(severityOf(item)))
          || safetyOpen.some(item => ['high', 'critical'].includes(severityOf(item)))
          || siteAccessBlocks.length > 0;
        const qualityReview = inspectionReviews.length > 0
          || openObservations.length > 0
          || qualityOpen.length > 0
          || punchOpen.length > 0;
        const evidenceMissing = ['in_progress', 'completed'].includes(jobStatus)
          && evidenceRecords === 0;
        const flags = {
          approvalRequired: pendingApprovals.length > 0,
          incidentBlocker,
          safetyGap,
          designReview,
          qualityReview,
          evidenceMissing,
          dueSafety: dueSafetyRecords.length > 0,
          dueDesign: expiringPermits.length > 0,
          siteAccessBlocked: siteAccessBlocks.length > 0
        };
        const fieldStatus = this.classifyFieldAssuranceReadiness(flags);
        const nextActions = [];
        if (flags.approvalRequired) nextActions.push({
          type: 'review_field_approval',
          label: 'Review field assurance approval gates',
          approvalId: pendingApprovals[0]?.id || null,
          requiresApproval: false
        });
        if (openIncidents.length) nextActions.push({
          type: 'resolve_incident',
          label: 'Resolve open incident before work proceeds',
          incidentId: openIncidents[0].id,
          requiresApproval: true
        });
        if (siteAccessBlocks.length) nextActions.push({
          type: 'clear_site_access',
          label: 'Clear site access and orientation blockers',
          siteAccessId: siteAccessBlocks[0].id,
          requiresApproval: true
        });
        if (safetyGap) nextActions.push({ type: 'prepare_safety_pack', label: 'Prepare JHA, SDS, safety talk, and access evidence', requiresApproval: false });
        if (jhas.length) nextActions.push({
          type: 'review_jha',
          label: 'Review JHA and work method controls',
          jhaId: jhas[0].id,
          requiresApproval: true
        });
        if (sdsSheets.length) nextActions.push({
          type: 'request_sds',
          label: 'Request or approve current SDS evidence',
          sdsSheetId: sdsSheets[0].id,
          requiresApproval: true
        });
        if (safetyMeetings.length) nextActions.push({
          type: 'complete_safety_meeting',
          label: 'Record toolbox talk completion evidence',
          safetyMeetingId: safetyMeetings[0].id,
          requiresApproval: true
        });
        if (orientations.length) nextActions.push({
          type: 'complete_orientation',
          label: 'Record crew orientation completion evidence',
          orientationId: orientations[0].id,
          requiresApproval: true
        });
        if (openRfis.length) nextActions.push({
          type: 'review_rfi',
          label: 'Resolve open RFI before field reliance',
          rfiId: openRfis[0].id,
          requiresApproval: true
        });
        if (submittalReviews.length) nextActions.push({
          type: 'review_submittal',
          label: 'Review submittal package before procurement or install',
          submittalId: submittalReviews[0].id,
          requiresApproval: true
        });
        if (permitReviews.length || expiringPermits.length) nextActions.push({
          type: 'review_permit',
          label: 'Resolve permit or compliance expiry risk',
          permitId: (permitReviews[0] || expiringPermits[0]).id,
          requiresApproval: true
        });
        if (documentReviews.length) nextActions.push({
          type: 'review_document',
          label: 'Review retained document before field reliance',
          documentId: documentReviews[0].id,
          requiresApproval: true
        });
        if (inspectionReviews.length) nextActions.push({
          type: 'review_inspection',
          label: 'Review inspection defects and sign-off',
          inspectionId: inspectionReviews[0].id,
          requiresApproval: true
        });
        if (openObservations.length) nextActions.push({
          type: 'resolve_observation',
          label: 'Close safety or quality observation',
          observationId: openObservations[0].id,
          requiresApproval: true
        });
        if (qualityOpen.length) nextActions.push({
          type: 'complete_quality_review',
          label: 'Complete quality review and defect decision',
          qualityCheckId: qualityOpen[0].id,
          requiresApproval: true
        });
        if (safetyOpen.length && !openIncidents.length) nextActions.push({
          type: 'complete_safety_check',
          label: 'Complete safety check and hazard decision',
          safetyCheckId: safetyOpen[0].id,
          requiresApproval: true
        });
        if (punchOpen.length) nextActions.push({
          type: 'resolve_punch_item',
          label: 'Resolve punch item before acceptance',
          punchItemId: punchOpen[0].id,
          requiresApproval: true
        });
        if (evidenceMissing) nextActions.push({ type: 'capture_field_evidence', label: 'Capture photo, document, field report, or progress evidence', requiresApproval: false });

        return {
          jobId: detail.id,
          jobTitle: detail.title,
          jobStatus: detail.status,
          phase: detail.phase,
          priority: detail.priority,
          riskLevel: detail.riskLevel,
          clientName: detail.client?.name || detail.clientName,
          address: detail.address || detail.city || detail.region,
          jobType: detail.jobType,
          scheduledStart: detail.scheduledStart,
          targetCompletion: detail.targetCompletion,
          progressPercent: detail.progressPercent,
          fieldStatus,
          nextAction: nextActions[0]?.label || 'Field assurance workflow is stable.',
          nextActions,
          flags,
          counts: {
            pendingApprovals: pendingApprovals.length,
            rfis: (detail.rfis || []).length,
            openRfis: openRfis.length,
            submittals: (detail.submittals || []).length,
            submittalReviews: submittalReviews.length,
            permits: (detail.permits || []).length,
            permitReviews: permitReviews.length,
            expiringPermits: expiringPermits.length,
            inspections: (detail.inspections || []).length,
            inspectionReviews: inspectionReviews.length,
            observations: (detail.observations || []).length,
            openObservations: openObservations.length,
            incidents: (detail.incidents || []).length,
            openIncidents: openIncidents.length,
            safetyMeetings: (detail.safetyMeetings || []).length,
            orientations: (detail.orientations || []).length,
            jhas: (detail.jhas || []).length,
            sdsSheets: (detail.sdsSheets || []).length,
            openSafetyRecords: openSafetyRecords.length,
            dueSafetyRecords: dueSafetyRecords.length,
            siteAccessBlocks: siteAccessBlocks.length,
            qualityOpen: qualityOpen.length,
            safetyOpen: safetyOpen.length,
            punchOpen: punchOpen.length,
            documents: (detail.documents || []).length,
            fieldReports: (detail.fieldReports || []).length,
            progressUpdates: (detail.progress || []).length,
            evidenceRecords,
            documentReviews: documentReviews.length
          },
          latest: {
            approval: pendingApprovals[0] || null,
            rfi: openRfis[0] || null,
            submittal: submittalReviews[0] || null,
            permit: permitReviews[0] || expiringPermits[0] || null,
            inspection: inspectionReviews[0] || null,
            observation: openObservations[0] || null,
            incident: openIncidents[0] || null,
            safetyMeeting: safetyMeetings[0] || null,
            orientation: orientations[0] || null,
            jha: jhas[0] || null,
            sdsSheet: sdsSheets[0] || null,
            siteAccess: siteAccessBlocks[0] || null,
            qualityCheck: qualityOpen[0] || null,
            safetyCheck: safetyOpen[0] || null,
            punchItem: punchOpen[0] || null,
            document: documentReviews[0] || (detail.documents || [])[0] || null
          }
        };
      });

    const matchesMode = row => {
      if (mode === 'all') return true;
      if (mode === 'approval') return row.flags?.approvalRequired === true;
      if (mode === 'incident' || mode === 'incident_blocked') return row.flags?.incidentBlocker === true;
      if (mode === 'safety' || mode === 'safety_gap') return row.flags?.safetyGap === true || row.counts?.openSafetyRecords > 0;
      if (mode === 'design' || mode === 'design_review') return row.flags?.designReview === true;
      if (mode === 'quality' || mode === 'quality_review') return row.flags?.qualityReview === true;
      if (mode === 'evidence' || mode === 'evidence_missing') return row.flags?.evidenceMissing === true;
      if (mode === 'stable') return row.fieldStatus === 'stable';
      return row.fieldStatus === mode;
    };
    const matchesSearch = row => !search || JSON.stringify(row).toLowerCase().includes(search);
    const filtered = rows.filter(row => matchesMode(row) && matchesSearch(row));
    const statusRank = {
      approval_required: 0,
      incident_blocked: 1,
      safety_gap: 2,
      design_review: 3,
      quality_review: 4,
      evidence_missing: 5,
      stable: 6
    };
    const priorityScore = priority => ({ low: 1, medium: 2, high: 3, critical: 4 }[normalizePriority(priority)] || 0);
    filtered.sort((left, right) => {
      const statusDelta = (statusRank[left.fieldStatus] ?? 7) - (statusRank[right.fieldStatus] ?? 7);
      if (statusDelta) return statusDelta;
      const blockerDelta = normalizeNumber(right.counts?.openIncidents, 0) + normalizeNumber(right.counts?.siteAccessBlocks, 0)
        - normalizeNumber(left.counts?.openIncidents, 0) - normalizeNumber(left.counts?.siteAccessBlocks, 0);
      if (blockerDelta) return blockerDelta;
      const priorityDelta = priorityScore(right.priority) - priorityScore(left.priority);
      if (priorityDelta) return priorityDelta;
      return String(left.targetCompletion || left.scheduledStart || left.jobTitle)
        .localeCompare(String(right.targetCompletion || right.scheduledStart || right.jobTitle));
    });

    return {
      generatedAt: nowIso(),
      mode,
      summary: this.summarizeFieldAssurance(rows, filtered.length),
      jobs: filtered.slice(0, limit)
    };
  }

  getJobDetail(jobId, options = {}) {
    const row = this.db.prepare(`
      SELECT jobs.*, clients.name AS client_name, clients.email AS client_email, clients.phone AS client_phone, clients.address AS client_address
      FROM jobs
      JOIN clients ON clients.id = jobs.client_id
      WHERE jobs.id = ?
    `).get(jobId);
    if (!row) {
      const error = new Error('Ledger job not found');
      error.statusCode = 404;
      throw error;
    }
    const detail = {
      ...this.mapJob(row),
      client: this.mapClient(this.db.prepare('SELECT * FROM clients WHERE id = ?').get(row.client_id)),
      tasks: this.db.prepare('SELECT * FROM job_tasks WHERE job_id = ? ORDER BY created_at ASC').all(jobId).map(row => this.mapTask(row)),
      quotes: this.db.prepare('SELECT * FROM quotes WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapQuote(row)),
      siteVisits: this.db.prepare('SELECT * FROM site_visits WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapSiteVisit(row)),
      changeOrders: this.db.prepare('SELECT * FROM change_orders WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapChangeOrder(row)),
      fieldReports: this.db.prepare('SELECT * FROM field_reports WHERE job_id = ? ORDER BY report_date DESC, created_at DESC').all(jobId).map(row => this.mapFieldReport(row)),
      rfis: this.db.prepare('SELECT * FROM rfi_records WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapRfi(row)),
      submittals: this.db.prepare('SELECT * FROM submittal_records WHERE job_id = ? ORDER BY due_at ASC, created_at DESC').all(jobId).map(row => this.mapSubmittal(row)),
      clientSelections: this.db.prepare('SELECT * FROM client_selections WHERE job_id = ? ORDER BY due_at ASC, created_at DESC').all(jobId).map(row => this.mapClientSelection(row)),
      permits: this.db.prepare('SELECT * FROM permit_records WHERE job_id = ? ORDER BY expires_at ASC, created_at DESC').all(jobId).map(row => this.mapPermit(row)),
      inspections: this.db.prepare('SELECT * FROM inspection_records WHERE job_id = ? ORDER BY scheduled_at DESC, created_at DESC').all(jobId).map(row => this.mapInspection(row)),
      observations: this.db.prepare('SELECT * FROM observation_records WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapObservation(row)),
      incidents: this.db.prepare('SELECT * FROM incident_records WHERE job_id = ? ORDER BY occurred_at DESC, created_at DESC').all(jobId).map(row => this.mapIncident(row)),
      safetyMeetings: this.db.prepare('SELECT * FROM safety_meetings WHERE job_id = ? ORDER BY scheduled_at DESC, created_at DESC').all(jobId).map(row => this.mapSafetyMeeting(row)),
      orientations: this.db.prepare('SELECT * FROM worker_orientations WHERE job_id = ? ORDER BY due_at DESC, created_at DESC').all(jobId).map(row => this.mapWorkerOrientation(row)),
      jhas: this.db.prepare('SELECT * FROM jha_records WHERE job_id = ? ORDER BY due_at DESC, created_at DESC').all(jobId).map(row => this.mapJha(row)),
      sdsSheets: this.db.prepare('SELECT * FROM sds_sheets WHERE job_id = ? ORDER BY expires_at ASC, created_at DESC').all(jobId).map(row => this.mapSdsSheet(row)),
      siteAccessLogs: this.db.prepare('SELECT * FROM site_access_logs WHERE job_id = ? ORDER BY checked_in_at DESC, created_at DESC').all(jobId).map(row => this.mapSiteAccessLog(row)),
      assignments: this.db.prepare('SELECT assignments.*, workers.name AS worker_name FROM assignments LEFT JOIN workers ON workers.id = assignments.worker_id WHERE job_id = ? ORDER BY created_at ASC').all(jobId).map(row => this.mapAssignment(row)),
      tools: this.db.prepare('SELECT * FROM tool_reservations WHERE job_id = ? ORDER BY created_at ASC').all(jobId).map(row => this.mapToolReservation(row)),
      materials: this.db.prepare('SELECT * FROM material_requirements WHERE job_id = ? ORDER BY created_at ASC').all(jobId).map(row => this.mapMaterialRequirement(row)),
      documents: this.db.prepare('SELECT * FROM documents WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapDocument(row)),
      progress: this.db.prepare('SELECT * FROM progress_updates WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapProgress(row)),
      communications: this.db.prepare('SELECT * FROM communication_records WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapCommunication(row)),
      timeLogs: this.db.prepare('SELECT * FROM time_logs WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapTimeLog(row)),
      expenses: this.db.prepare('SELECT * FROM expenses WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapExpense(row)),
      invoices: this.db.prepare('SELECT * FROM invoices WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapInvoice(row)),
      budgetLines: this.db.prepare('SELECT * FROM budget_lines WHERE job_id = ? ORDER BY cost_code ASC, created_at DESC').all(jobId).map(row => this.mapBudgetLine(row)),
      purchaseOrders: this.db.prepare('SELECT * FROM purchase_orders WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapPurchaseOrder(row)),
      drawRequests: this.db.prepare('SELECT * FROM draw_requests WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapDrawRequest(row)),
      lienWaivers: this.db.prepare('SELECT * FROM lien_waivers WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapLienWaiver(row)),
      financeHandoffs: this.db.prepare('SELECT * FROM finance_handoffs WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapFinanceHandoff(row)),
      qualityChecks: this.db.prepare('SELECT * FROM quality_checks WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapQualityCheck(row)),
      safetyChecks: this.db.prepare('SELECT * FROM safety_checks WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapSafetyCheck(row)),
      payments: this.db.prepare('SELECT * FROM payments WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapPayment(row)),
      aftercare: this.db.prepare('SELECT * FROM aftercare_items WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapAftercareItem(row)),
      punchItems: this.db.prepare('SELECT * FROM punch_items WHERE job_id = ? ORDER BY due_at ASC, created_at DESC').all(jobId).map(row => this.mapPunchItem(row)),
      warrantyClaims: this.db.prepare('SELECT * FROM warranty_claims WHERE job_id = ? ORDER BY due_at ASC, created_at DESC').all(jobId).map(row => this.mapWarrantyClaim(row)),
      recurringPlans: this.db.prepare('SELECT * FROM recurring_plans WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapRecurringPlan(row)),
      routePlans: this.db.prepare('SELECT * FROM route_plans WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapRoutePlan(row)),
      loadingPlans: this.db.prepare('SELECT * FROM loading_plans WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapLoadingPlan(row)),
      procurementOrders: this.db.prepare('SELECT * FROM procurement_orders WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapProcurementOrder(row)),
      workerInstructions: this.db.prepare('SELECT * FROM worker_instructions WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapWorkerInstruction(row)),
      portalAccess: this.db.prepare('SELECT * FROM client_portal_access WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapClientPortalAccess(row)),
      approvals: this.db.prepare('SELECT * FROM approvals WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapApproval(row)),
      weather: this.db.prepare('SELECT * FROM schedule_weather WHERE job_id = ? ORDER BY created_at DESC').all(jobId).map(row => this.mapWeather(row))
    };
    if (options.includeAudit) {
      detail.audit = this.listAudit({ jobId, limit: 50 });
    }
    const capabilityMap = this.ledgerCapabilityCoverage({ jobDetail: detail });
    detail.capabilities = capabilityMap.capabilities;
    detail.capabilitySummary = capabilityMap.summary;
    return detail;
  }

  countCapabilityRequirement(requirement = {}) {
    if (!requirement.table) return 0;
    return this.countActiveRecords(requirement.table);
  }

  countOpenCapabilityRequirement(requirement = {}) {
    if (!requirement.table) return 0;
    const statusColumn = {
      job_requests: 'status',
      quotes: 'status',
      site_visits: 'status',
      material_requirements: 'status',
      tool_reservations: 'status',
      assignments: 'status',
      jobs: 'status',
      job_tasks: 'status',
      route_plans: 'status',
      change_orders: 'status',
      rfi_records: 'status',
      submittal_records: 'status',
      field_reports: 'status',
      documents: 'status',
      punch_items: 'status',
      progress_updates: 'status',
      time_logs: 'status',
      worker_instructions: 'status',
      worker_orientations: 'status',
      jha_records: 'status',
      sds_sheets: 'status',
      permit_records: 'status',
      inspection_records: 'status',
      observation_records: 'status',
      incident_records: 'status',
      site_access_logs: 'status',
      budget_lines: 'status',
      expenses: 'status',
      purchase_orders: 'status',
      invoices: 'status',
      payments: 'status',
      draw_requests: 'status',
      lien_waivers: 'status',
      finance_handoffs: 'status',
      communication_records: 'status',
      client_selections: 'status',
      approvals: 'status',
      aftercare_items: 'status',
      recurring_plans: 'status'
    }[requirement.table];
    if (!statusColumn) {
      return requirement.table === 'audit_events' ? 0 : this.countCapabilityRequirement(requirement);
    }
    const closed = Array.from(LEDGER_CLOSED_STATUSES);
    const placeholders = closed.map(() => '?').join(',');
    const scope = this.activeRecordScope(requirement.table);
    return Number(this.db.prepare(`
      SELECT COUNT(DISTINCT records.id) AS count
      FROM ${scope.from}
      WHERE ${scope.condition}
        AND records.${statusColumn} NOT IN (${placeholders})
    `).get(...closed).count || 0);
  }

  describeCapabilityRequirement(requirement = {}, jobDetail = null) {
    if (jobDetail) {
      const value = jobDetail[requirement.detailKey];
      const records = Array.isArray(value)
        ? value
        : value
          ? [value]
          : [];
      const openCount = Array.isArray(value)
        ? records.filter(isLedgerCapabilityRecordOpen).length
        : records.length && isLedgerCapabilityRecordOpen(records[0])
          ? 1
          : 0;
      return {
        ...requirement,
        count: records.length,
        openCount,
        covered: records.length > 0,
        status: records.length ? (openCount ? 'action_required' : 'ready') : 'missing'
      };
    }

    const count = this.countCapabilityRequirement(requirement);
    const openCount = count ? this.countOpenCapabilityRequirement(requirement) : 0;
    return {
      ...requirement,
      count,
      openCount,
      covered: count > 0,
      status: count ? (openCount ? 'action_required' : 'ready') : 'missing'
    };
  }

  ledgerCapabilityCoverage(options = {}) {
    const jobDetail = options.jobDetail || null;
    const capabilities = LEDGER_CAPABILITY_BLUEPRINT.map(capability => {
      const requirements = (LEDGER_CAPABILITY_REQUIREMENTS[capability.key] || [])
        .map(requirement => this.describeCapabilityRequirement(requirement, jobDetail));
      const missingRequirements = requirements.filter(requirement => !requirement.covered);
      const openRequirements = requirements.filter(requirement => requirement.covered && requirement.openCount > 0);
      const recordCount = requirements.reduce((sum, requirement) => sum + normalizeNumber(requirement.count, 0), 0);
      const openCount = requirements.reduce((sum, requirement) => sum + normalizeNumber(requirement.openCount, 0), 0);
      const coverage = Math.round(((requirements.length - missingRequirements.length) / Math.max(1, requirements.length)) * 100);
      const status = missingRequirements.length
        ? 'needs_data'
        : openRequirements.length
          ? 'action_required'
          : 'ready';
      return {
        ...capability,
        coverage,
        status,
        requirements,
        missingRequirements: missingRequirements.map(requirement => requirement.key),
        openRequirements: openRequirements.map(requirement => requirement.key),
        recordCount,
        openCount,
        recommendedActions: missingRequirements.slice(0, 4).map(requirement => ({
          type: `add_${requirement.key}`,
          requirementKey: requirement.key,
          actionTarget: capabilityRequirementActionTarget(requirement.key),
          label: `Add ${requirement.label}`,
          requiresApproval: ['quote', 'assignment', 'tools', 'change_order', 'invoice', 'payment', 'draw', 'waiver', 'handoff', 'approval_audit'].includes(requirement.key),
          reason: `${capability.label} is missing ${requirement.label}.`
        }))
      };
    });
    const averageCoverage = Math.round(capabilities.reduce((sum, capability) => sum + capability.coverage, 0) / Math.max(1, capabilities.length));
    return {
      generatedAt: nowIso(),
      scope: jobDetail ? 'job' : 'ledger',
      jobId: jobDetail?.id || null,
      summary: {
        averageCoverage,
        ready: capabilities.filter(capability => capability.status === 'ready').length,
        actionRequired: capabilities.filter(capability => capability.status === 'action_required').length,
        needsData: capabilities.filter(capability => capability.status === 'needs_data').length,
        missingRequirements: capabilities.reduce((sum, capability) => sum + capability.missingRequirements.length, 0),
        openRequirements: capabilities.reduce((sum, capability) => sum + capability.openRequirements.length, 0),
        serviceGroups: capabilities.reduce((sum, capability) => sum + (capability.serviceGroups || []).length, 0),
        sourceEvidenceItems: capabilities.reduce((sum, capability) => sum + (capability.sourceEvidence || []).length, 0)
      },
      capabilities
    };
  }

  capabilityGapPayload(jobDetail = {}, requirement = {}, capability = {}, payload = {}) {
    const jobTitle = normalizeText(jobDetail.title, 'Contractor job');
    const clientName = normalizeText(jobDetail.client?.name || jobDetail.clientName, 'Client');
    const dueAt = payload.dueAt || payload.due_at || jobDetail.targetCompletion || futureIsoDate(3);
    const scheduledAt = payload.scheduledAt || payload.scheduled_at || jobDetail.scheduledStart || futureIsoDate(1);
    const amount = normalizeNumber(payload.amount || jobDetail.contractValue || jobDetail.estimatedCost, 0);
    const source = `capability_gap:${capability.key || 'contractor_suite'}`;
    const playbook = this.resolveJobPlaybook(jobDetail, payload);
    const jobLocation = normalizeText(jobDetail.address || jobDetail.city || jobDetail.region, 'job site');
    const taskSummary = normalizeList(playbook.tasks).slice(0, 4);
    const workSummary = taskSummary.length
      ? taskSummary.join('; ')
      : normalizeText(jobDetail.description || jobDetail.scope, `Confirm ${jobTitle} scope`);
    const primaryMaterial = (playbook.materials || [])[0] || {};
    const primaryTool = normalizeText((playbook.tools || [])[0], 'standard contractor tool kit');
    const materialAllowance = amount ? Math.round(amount * 0.25) : normalizeNumber(primaryMaterial.estimatedCost, 0);
    const evidenceFocus = [
      'before photos',
      'work area protection',
      'materials/tools ready',
      'blockers and client decisions',
      'after photos'
    ];
    const base = {
      source,
      notes: `Drafted from ${capability.label || 'Contractor.AI capability'} gap plan. Review before external commitment.`
    };
    const templates = {
      quote: {
        status: 'draft',
        currency: 'EUR',
        subtotal: amount,
        taxRate: 21,
        lineItems: (playbook.quoteLineItems || []).length ? playbook.quoteLineItems : [{ description: jobTitle, quantity: 1, unitPrice: amount, costCode: 'contract' }],
        ...base
      },
      site_visit: {
        visitType: 'site_survey',
        status: 'scheduled',
        scheduledAt,
        assignee: payload.assignee || 'Robert',
        checklist: this.defaultSiteVisitChecklist(jobDetail),
        ...base
      },
      materials: {
        name: normalizeText(primaryMaterial.name, `${jobTitle} material allowance`),
        quantity: normalizeNumber(primaryMaterial.quantity, 1),
        unit: primaryMaterial.unit || 'allowance',
        status: 'needed',
        supplier: payload.supplier || primaryMaterial.supplier || 'local supplier',
        estimatedCost: materialAllowance,
        ...base
      },
      tools: {
        toolName: payload.toolName || payload.tool_name || primaryTool,
        status: 'reserved',
        neededFrom: scheduledAt,
        neededUntil: dueAt,
        notes: base.notes
      },
      equipment: {
        toolName: payload.toolName || payload.tool_name || 'Equipment / vehicle slot',
        status: 'reserved',
        neededFrom: scheduledAt,
        neededUntil: dueAt,
        notes: base.notes
      },
      assignment: {
        role: payload.role || 'Lead contractor',
        workerName: payload.workerName || payload.worker_name || null,
        status: 'assigned',
        scheduledStart: scheduledAt,
        scheduledEnd: dueAt,
        notes: base.notes
      },
      tasks: {
        title: `Complete ${capability.label || 'contractor'} setup`,
        status: 'open',
        priority: normalizePriority(jobDetail.priority || 'medium'),
        dueAt,
        notes: base.notes
      },
      schedule: {
        origin: payload.origin || 'Depot',
        destination: jobDetail.address || jobDetail.city || jobDetail.region || clientName,
        status: 'draft',
        routeRisk: normalizePriority(jobDetail.riskLevel || 'medium'),
        plannedStart: scheduledAt,
        notes: base.notes
      },
      change_order: {
        title: `${jobTitle} scope decision draft`,
        status: 'draft',
        scopeDelta: `Use this only for verified extra scope beyond the current plan: ${workSummary}. Keep client, price, and date commitments blocked until Robert approves the exact change.`,
        amount: 0,
        total: 0,
        scheduleDeltaDays: 0,
        lineItems: [{ description: `${jobTitle} potential extra scope`, quantity: 1, unitPrice: 0, costCode: 'change_order' }],
        ...base
      },
      rfi: {
        title: `${jobTitle} clarification`,
        status: 'open',
        question: 'Confirm unresolved scope, access, material, or client decision before field reliance.',
        responsible: payload.responsible || 'Robert',
        dueAt,
        ...base
      },
      submittal: {
        title: `${jobTitle} material submittal`,
        packageName: payload.packageName || payload.package || 'Contractor package',
        status: 'draft',
        responsible: payload.responsible || 'Project team',
        reviewer: payload.reviewer || 'Robert',
        dueAt,
        material: payload.material || `${jobTitle} materials`,
        specification: 'Review product, material, or method before installation.',
        ...base
      },
      field_report: {
        reportDate: nowIso().slice(0, 10),
        status: 'draft',
        weather: payload.weather || null,
        manpower: normalizeNumber(payload.manpower, 0),
        workCompleted: `Draft daily report for ${jobTitle}: verify ${workSummary}. Add manpower, blockers, production notes, and evidence before submission.`,
        blockers: [],
        photos: [],
        ...base
      },
      documents: {
        title: `${jobTitle} evidence dossier`,
        type: 'photo',
        category: 'project_evidence',
        status: 'needs_review',
        filename: `${jobTitle.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'job'}-evidence-needed.txt`,
        url: null,
        ...base
      },
      closeout: {
        title: `${jobTitle} punch / closeout item`,
        status: 'open',
        category: 'closeout',
        dueAt,
        ...base
      },
      progress: {
        status: normalizeStatus(jobDetail.status, 'open'),
        percent: normalizeNumber(jobDetail.progressPercent, 0),
        note: `Internal progress marker for ${jobTitle}: confirm actual progress against ${workSummary}, capture ${evidenceFocus.join(', ')}, and escalate blockers before client commitments.`,
        source
      },
      time: {
        workerName: payload.workerName || payload.worker_name || 'Crew lead',
        workDate: nowIso().slice(0, 10),
        hours: normalizeNumber(payload.hours, 0),
        rate: normalizeNumber(payload.rate, 0),
        status: 'draft',
        billable: true,
        notes: base.notes
      },
      instructions: {
        audience: 'crew',
        channel: 'app',
        status: 'draft',
        title: `${jobTitle} worker instructions`,
        body: `${playbook.workerInstruction || `Review scope, access, tools, materials, safety controls, evidence requirements, and stop-work triggers for ${jobTitle}.`} Location: ${jobLocation}. Required evidence: ${evidenceFocus.join(', ')}. Stop and ask Robert before extra work, price promises, ordering, or client date commitments.`,
        ...base
      },
      orientation: {
        workerName: payload.workerName || payload.worker_name || 'Crew member',
        company: payload.company || 'Contractor.AI crew',
        status: 'scheduled',
        dueAt,
        topics: ['Site rules', 'PPE', 'Emergency route', 'Stop-work trigger'],
        ...base
      },
      jha: {
        title: `${jobTitle} JHA / risk assessment`,
        status: 'draft',
        riskLevel: normalizePriority(jobDetail.riskLevel || 'medium'),
        hazards: ['Access', 'Manual handling', 'Changed site conditions'],
        controls: ['Confirm access', 'Use PPE', 'Stop work when scope changes'],
        assignee: payload.assignee || 'Robert',
        ...base
      },
      sds: {
        material: payload.material || `${jobTitle} materials`,
        supplier: payload.supplier || 'local supplier',
        status: 'requested',
        expiresAt: futureIsoDate(180),
        hazardClass: 'review_required',
        ...base
      },
      vca: {
        material: 'VCA / site safety proof',
        supplier: payload.company || 'Contractor.AI crew',
        status: 'requested',
        expiresAt: futureIsoDate(365),
        hazardClass: 'safety_proof',
        ...base
      },
      permit: {
        permitType: 'work_permit',
        title: `${jobTitle} permit / compliance review`,
        status: 'draft',
        holder: payload.holder || 'Project team',
        location: jobDetail.address || jobDetail.city || jobDetail.region || null,
        expiresAt: dueAt,
        ...base
      },
      inspection: {
        inspectionType: 'pre_task_inspection',
        title: `${jobTitle} inspection`,
        status: 'scheduled',
        result: 'pending',
        inspector: payload.inspector || 'Robert',
        checklist: ['Access safe', 'Materials ready', 'Work area protected', 'Evidence captured'],
        defects: [],
        photos: [],
        ...base
      },
      observation: {
        category: 'quality',
        title: `${jobTitle} observation`,
        status: 'open',
        severity: normalizePriority(jobDetail.riskLevel || 'medium'),
        responsible: payload.responsible || 'Robert',
        correctiveAction: 'Review and assign corrective action before closeout.',
        ...base
      },
      incident: {
        incidentType: 'near_miss',
        title: `${jobTitle} safety or quality review`,
        status: 'open',
        severity: 'low',
        reportedBy: payload.reportedBy || 'Contractor.AI',
        description: `Open this only when ${jobTitle} has a real near miss, defect, property damage, unsafe access issue, or client-impacting quality concern at ${jobLocation}.`,
        immediateAction: 'Make the area safe, capture photos, record who was present, and pause affected work until reviewed.',
        correctiveAction: 'Assign owner, fix plan, due date, and approval before closing or telling the client it is resolved.',
        ...base
      },
      site_access: {
        workerName: payload.workerName || payload.worker_name || 'Crew member',
        company: payload.company || 'Contractor.AI crew',
        status: 'blocked',
        orientationValid: false,
        accessPoint: payload.accessPoint || jobDetail.address || 'site',
        location: jobDetail.address || jobDetail.city || jobDetail.region || null,
        ...base
      },
      budget: {
        costCode: payload.costCode || payload.cost_code || 'CONTRACT',
        description: `${jobTitle} budget baseline`,
        status: 'draft',
        budgetAmount: amount,
        forecastAmount: amount,
        actualAmount: 0,
        ...base
      },
      expense: {
        category: 'materials',
        description: `${jobTitle} receipt and cost capture`,
        amount: 0,
        currency: 'EUR',
        status: 'draft',
        incurredAt: nowIso().slice(0, 10),
        vendor: payload.supplier || primaryMaterial.supplier || null,
        ...base
      },
      purchase_order: {
        supplier: payload.supplier || 'local supplier',
        status: 'draft',
        amount: amount ? Math.round(amount * 0.25) : 0,
        currency: 'EUR',
        requiredBy: dueAt,
        items: [{ description: `${jobTitle} materials`, quantity: 1, unitPrice: amount ? Math.round(amount * 0.25) : 0 }],
        ...base
      },
      invoice: {
        status: 'draft',
        currency: 'EUR',
        amount,
        taxRate: 21,
        total: amount ? amount * 1.21 : 0,
        dueAt: futureIsoDate(14),
        lineItems: [{ description: jobTitle, quantity: 1, unitPrice: amount }],
        ...base
      },
      payment: {
        status: 'pending',
        amount: 0,
        currency: 'EUR',
        dueAt: futureIsoDate(14),
        payer: clientName,
        method: 'bank_transfer',
        ...base
      },
      draw: {
        title: `${jobTitle} progress draw`,
        status: 'draft',
        requestedAmount: amount,
        currency: 'EUR',
        dueAt,
        ...base
      },
      waiver: {
        title: `${jobTitle} waiver / compliance hold`,
        status: 'requested',
        amount: 0,
        currency: 'EUR',
        party: payload.party || 'supplier',
        dueAt,
        ...base
      },
      handoff: {
        title: `${jobTitle} finance handoff`,
        status: 'draft',
        targetSystem: payload.targetSystem || 'FAB',
        amount,
        currency: 'EUR',
        dueAt,
        ...base
      },
      communication: {
        direction: 'outbound',
        channel: 'portal',
        status: 'draft',
        subject: `${jobTitle} client update`,
        body: `Draft update for ${clientName}: current scope, next step, decisions needed, and evidence status for ${jobTitle}.`,
        recipient: clientName,
        expectsReply: true,
        replyBy: dueAt,
        ...base
      },
      selection: {
        title: `${jobTitle} client decision needed`,
        category: normalizeStatus(playbook.key || 'scope', 'scope'),
        status: 'pending_client',
        clientName,
        value: 0,
        dueAt,
        options: normalizeList(playbook.clientSelections).length
          ? normalizeList(playbook.clientSelections)
          : ['Approve current scope as drafted', 'Request alternative option', 'Defer until site visit'],
        ...base
      },
      punch: {
        title: `${jobTitle} punch item`,
        status: 'open',
        category: 'quality',
        dueAt,
        ...base
      },
      warranty: {
        title: `${jobTitle} warranty / service record`,
        status: 'open',
        issue: 'Track warranty or service issue here.',
        dueAt,
        ...base
      },
      aftercare: {
        title: `${jobTitle} aftercare follow-up`,
        type: 'aftercare_follow_up',
        status: 'open',
        dueAt: futureIsoDate(7),
        notes: base.notes
      },
      recurring: {
        service: `${jobTitle} recurring service`,
        status: 'draft',
        intervalRule: 'monthly',
        nextDueAt: futureIsoDate(30),
        notes: base.notes
      },
      wkb: {
        title: `${jobTitle} Wkb / handover evidence`,
        type: 'closeout',
        category: 'wkb_dossier',
        status: 'draft',
        url: null,
        ...base
      }
    };
    return templates[requirement.key] || null;
  }

  buildJobCapabilityPlan(jobId, payload = {}) {
    const detail = this.getJobDetail(jobId, { includeAudit: false });
    const coverage = this.ledgerCapabilityCoverage({ jobDetail: detail });
    const requestedCapabilities = normalizeList(payload.capabilities || payload.capabilityKeys || payload.capability_keys);
    const requestedRequirements = normalizeList(payload.requirements || payload.requirementKeys || payload.requirement_keys);
    const includeOpen = normalizeBoolean(payload.includeOpen || payload.include_open, false);
    const limit = safeLimit(payload.limit, 25, 100);
    const actions = [];
    const skipped = [];

    for (const capability of coverage.capabilities) {
      if (requestedCapabilities.length && !requestedCapabilities.includes(capability.key)) continue;
      for (const requirement of capability.requirements || []) {
        if (requestedRequirements.length && !requestedRequirements.includes(requirement.key)) continue;
        if (requirement.covered && !(includeOpen && requirement.openCount > 0)) {
          skipped.push({
            capabilityKey: capability.key,
            requirementKey: requirement.key,
            label: requirement.label,
            reason: requirement.openCount ? 'covered_but_open' : 'already_covered',
            count: requirement.count,
            openCount: requirement.openCount
          });
          continue;
        }
        if (['job', 'intake', 'approval', 'approval_audit', 'audit'].includes(requirement.key)) {
          skipped.push({
            capabilityKey: capability.key,
            requirementKey: requirement.key,
            label: requirement.label,
            reason: 'informational_requirement',
            count: requirement.count,
            openCount: requirement.openCount
          });
          continue;
        }
        const actionPayload = this.capabilityGapPayload(detail, requirement, capability, payload);
        if (!actionPayload) {
          skipped.push({
            capabilityKey: capability.key,
            requirementKey: requirement.key,
            label: requirement.label,
            reason: 'no_template',
            count: requirement.count,
            openCount: requirement.openCount
          });
          continue;
        }
        actions.push({
          type: `create_${requirement.key}`,
          capabilityKey: capability.key,
          capabilityLabel: capability.label,
          requirementKey: requirement.key,
          label: `Create ${requirement.label}`,
          actionTarget: capabilityRequirementActionTarget(requirement.key),
          requiresApproval: ['quote', 'assignment', 'tools', 'equipment', 'change_order', 'invoice', 'payment', 'draw', 'waiver', 'handoff', 'communication'].includes(requirement.key),
          sourceVendors: capability.vendors || [],
          sourceEvidence: capability.sourceEvidence || [],
          payload: actionPayload
        });
      }
    }

    return {
      jobId,
      generatedAt: nowIso(),
      mode: 'preview',
      coverage,
      actions: actions.slice(0, limit),
      skipped,
      summary: {
        create: Math.min(actions.length, limit),
        available: actions.length,
        skipped: skipped.length,
        approvalSafe: true,
        externalCommitments: 0,
        averageCoverage: coverage.summary.averageCoverage,
        missingRequirements: coverage.summary.missingRequirements,
        openRequirements: coverage.summary.openRequirements
      }
    };
  }

  applyJobCapabilityPlan(jobId, payload = {}, options = {}) {
    return this.transaction(() => {
      const actor = options.actor || payload.actor || 'Contractor.AI';
      const preview = this.buildJobCapabilityPlan(jobId, payload);
      const created = [];
      const addCreated = (action, record) => {
        created.push({
          type: action.type,
          capabilityKey: action.capabilityKey,
          requirementKey: action.requirementKey,
          id: record?.id || null,
          status: record?.status || null,
          approvalId: record?.approvalId || record?.approval?.id || null
        });
      };

      for (const action of preview.actions) {
        const data = action.payload || {};
        const key = action.requirementKey;
        if (key === 'quote') addCreated(action, this.createQuote(jobId, data, { actor }));
        if (key === 'site_visit') addCreated(action, this.createSiteVisit(jobId, data, { actor }));
        if (key === 'materials') addCreated(action, this.addMaterialRequirement(jobId, data, { actor }));
        if (key === 'tools' || key === 'equipment') addCreated(action, this.reserveTool(jobId, data, { actor }));
        if (key === 'assignment') addCreated(action, this.addAssignment(jobId, data, { actor, optional: true }));
        if (key === 'tasks') addCreated(action, this.addTask(jobId, data, { actor }));
        if (key === 'schedule') addCreated(action, this.createRoutePlan(jobId, data, { actor }));
        if (key === 'change_order') addCreated(action, this.createChangeOrder(jobId, data, { actor }));
        if (key === 'rfi') addCreated(action, this.createRfi(jobId, data, { actor }));
        if (key === 'submittal') addCreated(action, this.createSubmittalRecord(jobId, data, { actor }));
        if (key === 'field_report') addCreated(action, this.createFieldReport(jobId, data, { actor }));
        if (key === 'documents' || key === 'wkb') addCreated(action, this.addDocument(jobId, data, { actor }));
        if (key === 'closeout' || key === 'punch') addCreated(action, this.createPunchItem(jobId, data, { actor }));
        if (key === 'progress') addCreated(action, this.addProgressUpdate(jobId, data, { actor }));
        if (key === 'time') addCreated(action, this.addTimeLog(jobId, data, { actor }));
        if (key === 'instructions') addCreated(action, this.createWorkerInstruction(jobId, data, { actor }));
        if (key === 'orientation') addCreated(action, this.createWorkerOrientation(jobId, data, { actor }));
        if (key === 'jha') addCreated(action, this.createJhaRecord(jobId, data, { actor }));
        if (key === 'sds' || key === 'vca') addCreated(action, this.createSdsSheet(jobId, data, { actor }));
        if (key === 'permit') addCreated(action, this.createPermitRecord(jobId, data, { actor }));
        if (key === 'inspection') addCreated(action, this.createInspectionRecord(jobId, data, { actor }));
        if (key === 'observation') addCreated(action, this.createObservationRecord(jobId, data, { actor }));
        if (key === 'incident') addCreated(action, this.createIncidentRecord(jobId, data, { actor }));
        if (key === 'site_access') addCreated(action, this.createSiteAccessLog(jobId, data, { actor }));
        if (key === 'budget') addCreated(action, this.createBudgetLine(jobId, data, { actor }));
        if (key === 'expense') addCreated(action, this.addExpense(jobId, data, { actor }));
        if (key === 'purchase_order') addCreated(action, this.createPurchaseOrder(jobId, data, { actor }));
        if (key === 'invoice') addCreated(action, this.createInvoice(jobId, data, { actor }));
        if (key === 'payment') addCreated(action, this.recordPayment(jobId, data, { actor }));
        if (key === 'draw') addCreated(action, this.createDrawRequest(jobId, data, { actor }));
        if (key === 'waiver') addCreated(action, this.createLienWaiver(jobId, data, { actor }));
        if (key === 'handoff') addCreated(action, this.createFinanceHandoff(jobId, data, { actor }));
        if (key === 'communication') addCreated(action, this.addCommunication(jobId, data, { actor }));
        if (key === 'selection') addCreated(action, this.createClientSelection(jobId, data, { actor }));
        if (key === 'warranty') addCreated(action, this.createWarrantyClaim(jobId, data, { actor }));
        if (key === 'aftercare') addCreated(action, this.addAftercareItem(jobId, data, { actor }));
        if (key === 'recurring') addCreated(action, this.createRecurringPlan(jobId, data, { actor }));
      }

      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'apply_capability_gap_plan',
        actor,
        after: {
          created,
          skipped: preview.skipped,
          averageCoverageBefore: preview.coverage.summary.averageCoverage,
          externalCommitments: 0
        },
        metadata: { source: 'ledger_capability_gap_plan' }
      });

      const job = this.getJobDetail(jobId, { includeAudit: true });
      return {
        ...preview,
        mode: 'applied',
        created,
        job,
        coverageAfter: {
          summary: job.capabilitySummary,
          capabilities: job.capabilities
        },
        summary: {
          ...preview.summary,
          created: created.length,
          skipped: preview.skipped.length,
          averageCoverageAfter: job.capabilitySummary?.averageCoverage || preview.summary.averageCoverage
        }
      };
    });
  }

  listApprovals(filters = {}) {
    const status = normalizeStatus(filters.status, 'pending');
    const includeAll = filters.status === 'all' || filters.all === true;
    const rows = this.db.prepare(`
      SELECT * FROM approvals
      WHERE (? = 1 OR status = ?)
      ORDER BY created_at DESC
      LIMIT ?
    `).all(includeAll ? 1 : 0, status, safeLimit(filters.limit, 100, 500));
    return rows.map(row => this.mapApproval(row));
  }

  listAudit(filters = {}) {
    const limit = safeLimit(filters.limit, 100, 1000);
    if (filters.jobId) {
      return this.db.prepare('SELECT * FROM audit_events WHERE job_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(filters.jobId, limit)
        .map(row => this.mapAudit(row));
    }
    if (filters.entityId) {
      return this.db.prepare('SELECT * FROM audit_events WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(String(filters.entityId), limit)
        .map(row => this.mapAudit(row));
    }
    return this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?')
      .all(limit)
      .map(row => this.mapAudit(row));
  }

  auditHistoryFacets(limit = 100) {
    const facetLimit = Math.floor(safeLimit(limit, 100, 250));
    const facet = column => this.db.prepare(`
      SELECT ${column} AS value, COUNT(*) AS count
      FROM audit_events
      WHERE ${column} IS NOT NULL AND ${column} <> ''
      GROUP BY ${column}
      ORDER BY count DESC, ${column} ASC
      LIMIT ?
    `).all(facetLimit).map(row => ({ value: row.value, count: Number(row.count || 0) }));
    return {
      entityTypes: facet('entity_type'),
      actions: facet('action'),
      actors: facet('actor')
    };
  }

  listAuditPage(filters = {}) {
    const limit = Math.floor(safeLimit(filters.limit, 25, 100));
    const beforeSequence = auditHistorySequence(filters.beforeSequence ?? filters.before_sequence, 'Audit cursor');
    const clauses = [];
    const parameters = [];
    const exactFilters = [
      ['job_id', 'jobId', 'Job id'],
      ['entity_type', 'entityType', 'Entity type'],
      ['entity_id', 'entityId', 'Entity id'],
      ['action', 'action', 'Action'],
      ['actor', 'actor', 'Actor']
    ];
    const appliedFilters = {};

    for (const [column, key, label] of exactFilters) {
      const value = auditHistoryText(filters[key] ?? filters[key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)], label);
      if (!value) continue;
      clauses.push(`${column} = ?`);
      parameters.push(value);
      appliedFilters[key] = value;
    }
    if (beforeSequence !== null) {
      clauses.push('sequence_number < ?');
      parameters.push(beforeSequence);
    }

    const fromInput = auditHistoryText(filters.from ?? filters.fromDate ?? filters.from_date, 'From date');
    const untilInput = auditHistoryText(filters.until ?? filters.to ?? filters.untilDate ?? filters.until_date, 'Until date');
    if (fromInput) {
      const from = normalizeRetainedDate(fromInput, { label: 'From date', code: 'audit_from_invalid' });
      const fromTimestamp = /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00.000Z` : from;
      clauses.push('created_at >= ?');
      parameters.push(fromTimestamp);
      appliedFilters.from = fromTimestamp;
    }
    if (untilInput) {
      const until = normalizeRetainedDate(untilInput, { label: 'Until date', code: 'audit_until_invalid' });
      const untilTimestamp = /^\d{4}-\d{2}-\d{2}$/.test(until) ? `${until}T23:59:59.999Z` : until;
      clauses.push('created_at <= ?');
      parameters.push(untilTimestamp);
      appliedFilters.until = untilTimestamp;
    }
    if (appliedFilters.from && appliedFilters.until && appliedFilters.from > appliedFilters.until) {
      const error = new Error('Audit history start date must be before the end date');
      error.statusCode = 400;
      error.code = 'audit_date_range_invalid';
      throw error;
    }

    const searchPattern = auditHistorySearchPattern(filters.query ?? filters.search);
    if (searchPattern) {
      clauses.push(`(
        LOWER(id) LIKE ?
        OR LOWER(entity_type) LIKE ?
        OR LOWER(entity_id) LIKE ?
        OR LOWER(COALESCE(job_id, '')) LIKE ?
        OR LOWER(action) LIKE ?
        OR LOWER(actor) LIKE ?
      )`);
      parameters.push(...Array(6).fill(searchPattern));
      appliedFilters.query = auditHistoryText(filters.query ?? filters.search, 'Audit search', 120);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM audit_events
      ${where}
      ORDER BY sequence_number DESC
      LIMIT ?
    `).all(...parameters, limit + 1);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map(row => this.mapAudit(row));
    const newestSequence = events[0]?.sequenceNumber || null;
    const oldestSequence = events.at(-1)?.sequenceNumber || null;
    return {
      events,
      page: {
        limit,
        returned: events.length,
        hasMore,
        nextBeforeSequence: hasMore ? oldestSequence : null,
        newestSequence,
        oldestSequence,
        filters: appliedFilters
      },
      facets: normalizeBoolean(filters.includeFacets ?? filters.include_facets)
        ? this.auditHistoryFacets(filters.facetLimit ?? filters.facet_limit)
        : null
    };
  }

  dashboardSummary() {
    const toolReservationConflicts = this.detectToolReservationConflicts(100);
    const assignmentConflicts = this.detectAssignmentConflicts(100);
    const tradePartnerSummary = this.summarizeTradePartners();
    const activeCount = (table, condition = '1 = 1', params = []) => this.countActiveRecords(table, condition, params);
    const activeSum = (table, column, condition = '1 = 1', params = []) => this.sumActiveRecords(table, column, condition, params);
    const metrics = {
      clients: this.count('clients'),
      tradePartners: tradePartnerSummary.total,
      activeTradePartners: tradePartnerSummary.active,
      verifiedTradePartners: tradePartnerSummary.verified,
      expiringTradePartners: tradePartnerSummary.expiring,
      tradePartnerComplianceActions: tradePartnerSummary.actionRequired,
      jobs: this.count('jobs'),
      openJobs: activeCount('jobs', "records.status <> 'completed'"),
      completedJobs: activeCount('jobs', "records.status = 'completed'"),
      archivedJobs: Number(this.db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'archived'").get().count || 0),
      pendingArchiveJobs: Number(this.db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending' AND target_type = 'job_archive'").get().count || 0),
      pendingRestoreJobs: Number(this.db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending' AND target_type = 'job_restore'").get().count || 0),
      pendingApprovals: Number(this.db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending'").get().count || 0),
      approvedQuotes: activeCount('quotes', "records.status = 'approved'"),
      siteVisits: activeCount('site_visits'),
      pendingSiteVisits: activeCount('site_visits', "records.status IN ('draft', 'scheduled', 'pending_approval')"),
      changeOrders: activeCount('change_orders'),
      pendingChangeOrders: activeCount('change_orders', "records.status IN ('draft', 'pending_approval', 'submitted', 'sent')"),
      fieldReports: activeCount('field_reports'),
      openRfis: activeCount('rfi_records', "records.status IN ('open', 'pending', 'pending_approval')"),
      submittals: activeCount('submittal_records'),
      openSubmittals: activeCount('submittal_records', "records.status NOT IN ('approved', 'accepted', 'closed', 'cancelled', 'rejected')"),
      clientSelections: activeCount('client_selections'),
      pendingClientSelections: activeCount('client_selections', "records.status NOT IN ('approved', 'accepted', 'client_confirmed', 'locked', 'selected', 'cancelled', 'rejected')"),
      permitRecords: activeCount('permit_records'),
      expiringPermits: activeCount('permit_records', "records.status NOT IN ('closed', 'expired', 'cancelled', 'rejected') AND records.expires_at IS NOT NULL AND records.expires_at <= ?", [futureIsoDate(7)]),
      inspections: activeCount('inspection_records'),
      openObservations: activeCount('observation_records', "records.status NOT IN ('closed', 'resolved', 'approved', 'cancelled', 'rejected')"),
      openIncidents: activeCount('incident_records', "records.status NOT IN ('closed', 'resolved', 'approved', 'cancelled', 'rejected')"),
      safetyMeetings: activeCount('safety_meetings'),
      orientations: activeCount('worker_orientations'),
      jhas: activeCount('jha_records'),
      sdsSheets: activeCount('sds_sheets'),
      siteAccessLogs: activeCount('site_access_logs'),
      blockedSiteAccess: activeCount('site_access_logs', "records.status = 'blocked' OR records.orientation_valid = 0"),
      openMobilizationApprovals: activeCount('approvals', "records.status = 'pending' AND records.approval_type IN ('worker_orientation_completion', 'jha_approval', 'sds_current_review', 'site_access_clearance')"),
      budgetLines: activeCount('budget_lines'),
      purchaseOrders: activeCount('purchase_orders'),
      drawRequests: activeCount('draw_requests'),
      lienWaivers: activeCount('lien_waivers'),
      financeHandoffs: activeCount('finance_handoffs'),
      openFinanceApprovals: activeCount('approvals', "records.status = 'pending' AND records.approval_type IN ('budget_control', 'purchase_commitment', 'draw_request_submission', 'lien_waiver_release', 'finance_handoff')"),
      draftInvoices: activeCount('invoices', "records.status IN ('draft', 'submitted')"),
      qualityChecks: activeCount('quality_checks'),
      safetyChecks: activeCount('safety_checks'),
      paymentFollowUps: activeCount('payments', "records.status NOT IN ('paid', 'received', 'cancelled')"),
      openAftercare: activeCount('aftercare_items', "records.status NOT IN ('completed', 'cancelled', 'closed')"),
      punchItems: activeCount('punch_items'),
      openPunchItems: activeCount('punch_items', "records.status NOT IN ('closed', 'resolved', 'accepted', 'verified', 'cancelled', 'rejected')"),
      warrantyClaims: activeCount('warranty_claims'),
      openWarrantyClaims: activeCount('warranty_claims', "records.status NOT IN ('closed', 'resolved', 'accepted', 'rejected', 'cancelled')"),
      activeRecurringPlans: activeCount('recurring_plans', "records.status = 'active'"),
      routePlans: activeCount('route_plans'),
      loadingPlans: activeCount('loading_plans'),
      procurementOrders: activeCount('procurement_orders'),
      workerInstructions: activeCount('worker_instructions'),
      communications: activeCount('communication_records'),
      communicationDrafts: activeCount('communication_records', "records.direction = 'outbound' AND records.status IN ('draft', 'pending_approval')"),
      communicationsWaitingReply: activeCount('communication_records', "records.direction = 'outbound' AND records.status IN ('sent', 'delivered', 'awaiting_client', 'client_reply_required') AND records.data_json LIKE '%\"expectsReply\":true%'"),
      communicationApprovals: activeCount('approvals', "records.status = 'pending' AND records.target_type = 'communication'"),
      assignments: activeCount('assignments'),
      pendingAssignments: activeCount('assignments', "records.status = 'pending_approval'"),
      assignmentConflicts: assignmentConflicts.length,
      toolReservations: activeCount('tool_reservations'),
      pendingToolReservations: activeCount('tool_reservations', "records.status = 'pending_approval'"),
      toolReservationConflicts: toolReservationConflicts.length,
      weatherAssessments: activeCount('schedule_weather'),
      weatherRisks: activeCount('schedule_weather', "records.precipitation_percent >= 60 OR records.condition IN ('rain_risk', 'wind_risk', 'storm_risk', 'visibility_risk')"),
      openClientHandoverApprovals: activeCount('approvals', "records.status = 'pending' AND records.approval_type IN ('submittal_approval', 'client_selection_approval', 'punch_item_closeout', 'warranty_claim_resolution')"),
      dispatchReadyJobs: Number(this.db.prepare(`
        SELECT COUNT(DISTINCT jobs.id) AS count
        FROM jobs
        WHERE jobs.status IN ('planned', 'scheduled', 'in_progress')
          AND EXISTS (SELECT 1 FROM route_plans WHERE route_plans.job_id = jobs.id AND route_plans.status NOT IN ('cancelled', 'rejected'))
          AND EXISTS (SELECT 1 FROM loading_plans WHERE loading_plans.job_id = jobs.id AND loading_plans.status NOT IN ('cancelled', 'rejected'))
          AND EXISTS (SELECT 1 FROM worker_instructions WHERE worker_instructions.job_id = jobs.id AND worker_instructions.status NOT IN ('cancelled', 'rejected'))
      `).get().count || 0),
      storedDocuments: activeCount('documents'),
      learningProfiles: this.count('job_learning_profiles'),
      auditEvents: this.count('audit_events')
    };
    const pipelineMoney = this.db.prepare(`
      SELECT
        COALESCE(SUM(records.estimated_cost), 0) AS estimatedPipeline,
        COALESCE(SUM(records.contract_value), 0) AS contractValue
      FROM jobs AS records
      WHERE ${this.operationalJobStatusSql('records')} AND records.status <> 'completed'
    `).get();
    const money = {
      estimatedPipeline: pipelineMoney.estimatedPipeline,
      contractValue: pipelineMoney.contractValue,
      quotedValue: activeSum('quotes', 'total'),
      changeOrderValue: activeSum('change_orders', 'total', "records.status NOT IN ('cancelled', 'rejected')"),
      invoicedValue: activeSum('invoices', 'total'),
      paymentFollowUpValue: activeSum('payments', 'amount', "records.status NOT IN ('paid', 'received', 'cancelled')"),
      procurementValue: activeSum('procurement_orders', 'amount', "records.status NOT IN ('cancelled', 'rejected')"),
      budgetValue: activeSum('budget_lines', 'budget_amount', "records.status NOT IN ('cancelled', 'rejected')"),
      purchaseOrderValue: activeSum('purchase_orders', 'amount', "records.status NOT IN ('cancelled', 'rejected')"),
      drawRequestValue: activeSum('draw_requests', 'requested_amount', "records.status NOT IN ('cancelled', 'rejected')"),
      financeHandoffValue: activeSum('finance_handoffs', 'amount', "records.status NOT IN ('cancelled', 'rejected')")
    };
    const workload = this.db.prepare(`
      WITH active_jobs AS (
        SELECT id FROM jobs
        WHERE ${this.operationalJobStatusSql('jobs')}
      )
      SELECT
        COALESCE((SELECT COUNT(*) FROM job_tasks records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status NOT IN ('completed', 'cancelled')), 0) AS openTasks,
        COALESCE((SELECT COUNT(*) FROM assignments records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('planned', 'scheduled', 'active', 'in_progress')), 0) AS activeAssignments,
        COALESCE((SELECT COUNT(*) FROM assignments records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status = 'pending_approval'), 0) AS pendingAssignments,
        COALESCE((SELECT COUNT(*) FROM tool_reservations records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('reserved', 'in_use')), 0) AS reservedTools,
        COALESCE((SELECT COUNT(*) FROM tool_reservations records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status = 'pending_approval'), 0) AS pendingToolReservations,
        COALESCE((SELECT COUNT(*) FROM material_requirements records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('needed', 'ordered', 'low_stock')), 0) AS materialNeeds,
        COALESCE((SELECT COUNT(*) FROM site_visits records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'scheduled', 'pending_approval')), 0) AS siteVisitDrafts,
        COALESCE((SELECT COUNT(*) FROM change_orders records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval', 'submitted', 'sent')), 0) AS changeOrderDrafts,
        COALESCE((SELECT COUNT(*) FROM field_reports records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval')), 0) AS fieldReportDrafts,
        COALESCE((SELECT COUNT(*) FROM rfi_records records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('open', 'pending', 'pending_approval')), 0) AS rfiOpen,
        COALESCE((SELECT COUNT(*) FROM submittal_records records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'submitted', 'pending_review', 'pending_approval', 'revise_resubmit')), 0) AS submittalQueue,
        COALESCE((SELECT COUNT(*) FROM client_selections records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('open', 'pending_client', 'pending_approval', 'overdue')), 0) AS selectionQueue,
        COALESCE((SELECT COUNT(*) FROM permit_records records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending', 'pending_approval', 'needs_renewal')), 0) AS permitReviews,
        COALESCE((SELECT COUNT(*) FROM inspection_records records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('scheduled', 'pending_approval', 'failed')), 0) AS inspectionReviews,
        COALESCE((SELECT COUNT(*) FROM observation_records records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status NOT IN ('closed', 'resolved', 'approved', 'cancelled', 'rejected')), 0) AS observationQueue,
        COALESCE((SELECT COUNT(*) FROM incident_records records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status NOT IN ('closed', 'resolved', 'approved', 'cancelled', 'rejected')), 0) AS incidentQueue,
        COALESCE((SELECT COUNT(*) FROM safety_meetings records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'scheduled', 'pending_approval')), 0) AS safetyTalks,
        COALESCE((SELECT COUNT(*) FROM worker_orientations records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'scheduled', 'pending_approval', 'expired')), 0) AS orientationQueue,
        COALESCE((SELECT COUNT(*) FROM jha_records records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'submitted', 'pending_approval')), 0) AS jhaQueue,
        COALESCE((SELECT COUNT(*) FROM sds_sheets records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('missing', 'requested', 'pending_approval', 'expired')), 0) AS sdsQueue,
        COALESCE((SELECT COUNT(*) FROM site_access_logs records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('blocked', 'requested', 'pending_approval') OR records.orientation_valid = 0), 0) AS siteAccessQueue,
        COALESCE((SELECT COUNT(*) FROM budget_lines records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval') OR records.forecast_amount > records.budget_amount), 0) AS budgetReviews,
        COALESCE((SELECT COUNT(*) FROM purchase_orders records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval', 'ready_to_order')), 0) AS purchaseOrderQueue,
        COALESCE((SELECT COUNT(*) FROM draw_requests records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval', 'approved_for_funding')), 0) AS drawQueue,
        COALESCE((SELECT COUNT(*) FROM lien_waivers records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('requested', 'pending_approval')), 0) AS lienWaiverQueue,
        COALESCE((SELECT COUNT(*) FROM finance_handoffs records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval', 'ready_to_export')), 0) AS financeHandoffQueue,
        COALESCE((SELECT COUNT(*) FROM route_plans records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval')), 0) AS routeDrafts,
        COALESCE((SELECT COUNT(*) FROM loading_plans records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval')), 0) AS loadingDrafts,
        COALESCE((SELECT COUNT(*) FROM procurement_orders records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval', 'ready_to_order')), 0) AS procurementDrafts,
        COALESCE((SELECT COUNT(*) FROM worker_instructions records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status IN ('draft', 'pending_approval')), 0) AS instructionDrafts,
        COALESCE((SELECT COUNT(*) FROM punch_items records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status NOT IN ('closed', 'resolved', 'accepted', 'verified', 'cancelled', 'rejected')), 0) AS punchQueue,
        COALESCE((SELECT COUNT(*) FROM warranty_claims records JOIN active_jobs ON active_jobs.id = records.job_id WHERE records.status NOT IN ('closed', 'resolved', 'accepted', 'rejected', 'cancelled')), 0) AS warrantyQueue
    `).get();
    const nextActions = this.nextActions();
    const capabilityMap = this.ledgerCapabilityCoverage();
    return {
      generatedAt: nowIso(),
      dbFile: this.dbFile,
      metrics,
      money: {
        estimatedPipeline: normalizeNumber(money.estimatedPipeline, 0),
        contractValue: normalizeNumber(money.contractValue, 0),
        quotedValue: normalizeNumber(money.quotedValue, 0),
        changeOrderValue: normalizeNumber(money.changeOrderValue, 0),
        invoicedValue: normalizeNumber(money.invoicedValue, 0),
        paymentFollowUpValue: normalizeNumber(money.paymentFollowUpValue, 0),
        procurementValue: normalizeNumber(money.procurementValue, 0),
        budgetValue: normalizeNumber(money.budgetValue, 0),
        purchaseOrderValue: normalizeNumber(money.purchaseOrderValue, 0),
        drawRequestValue: normalizeNumber(money.drawRequestValue, 0),
        financeHandoffValue: normalizeNumber(money.financeHandoffValue, 0)
      },
      workload: {
        openTasks: normalizeNumber(workload.openTasks, 0),
        activeAssignments: normalizeNumber(workload.activeAssignments, 0),
        pendingAssignments: normalizeNumber(workload.pendingAssignments, 0),
        assignmentConflicts: assignmentConflicts.length,
        reservedTools: normalizeNumber(workload.reservedTools, 0),
        pendingToolReservations: normalizeNumber(workload.pendingToolReservations, 0),
        toolReservationConflicts: toolReservationConflicts.length,
        materialNeeds: normalizeNumber(workload.materialNeeds, 0),
        siteVisitDrafts: normalizeNumber(workload.siteVisitDrafts, 0),
        changeOrderDrafts: normalizeNumber(workload.changeOrderDrafts, 0),
        fieldReportDrafts: normalizeNumber(workload.fieldReportDrafts, 0),
        rfiOpen: normalizeNumber(workload.rfiOpen, 0),
        submittalQueue: normalizeNumber(workload.submittalQueue, 0),
        selectionQueue: normalizeNumber(workload.selectionQueue, 0),
        permitReviews: normalizeNumber(workload.permitReviews, 0),
        inspectionReviews: normalizeNumber(workload.inspectionReviews, 0),
        observationQueue: normalizeNumber(workload.observationQueue, 0),
        incidentQueue: normalizeNumber(workload.incidentQueue, 0),
        safetyTalks: normalizeNumber(workload.safetyTalks, 0),
        orientationQueue: normalizeNumber(workload.orientationQueue, 0),
        jhaQueue: normalizeNumber(workload.jhaQueue, 0),
        sdsQueue: normalizeNumber(workload.sdsQueue, 0),
        siteAccessQueue: normalizeNumber(workload.siteAccessQueue, 0),
        budgetReviews: normalizeNumber(workload.budgetReviews, 0),
        purchaseOrderQueue: normalizeNumber(workload.purchaseOrderQueue, 0),
        drawQueue: normalizeNumber(workload.drawQueue, 0),
        lienWaiverQueue: normalizeNumber(workload.lienWaiverQueue, 0),
        financeHandoffQueue: normalizeNumber(workload.financeHandoffQueue, 0),
        routeDrafts: normalizeNumber(workload.routeDrafts, 0),
        loadingDrafts: normalizeNumber(workload.loadingDrafts, 0),
        procurementDrafts: normalizeNumber(workload.procurementDrafts, 0),
        instructionDrafts: normalizeNumber(workload.instructionDrafts, 0),
        communicationDrafts: metrics.communicationDrafts,
        communicationsWaitingReply: metrics.communicationsWaitingReply,
        punchQueue: normalizeNumber(workload.punchQueue, 0),
        warrantyQueue: normalizeNumber(workload.warrantyQueue, 0)
      },
      nextActions,
      capabilities: capabilityMap.capabilities,
      capabilitySummary: capabilityMap.summary
    };
  }

  nextActions() {
    const actions = [];
    const actionableJobIds = new Set(this.db.prepare(`
      SELECT id FROM jobs
      WHERE status NOT IN ('cancelled', 'canceled', 'rejected', 'archived', 'pending_archive_approval', 'deleted', 'void')
    `).all().map(row => row.id));
    const jobsWithoutAssignment = this.db.prepare(`
      SELECT jobs.id, jobs.title FROM jobs
      LEFT JOIN assignments ON assignments.job_id = jobs.id
        AND assignments.status NOT IN ('released', 'cancelled', 'completed', 'closed', 'rejected', 'declined')
      WHERE jobs.status NOT IN ('completed', 'cancelled', 'canceled', 'rejected', 'archived', 'pending_archive_approval', 'deleted', 'void')
      GROUP BY jobs.id
      HAVING COUNT(assignments.id) = 0
      ORDER BY jobs.created_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutAssignment) {
      actions.push({ type: 'assign_worker', jobId: job.id, title: job.title, severity: 'high', message: `${job.title} needs a worker assignment.` });
    }

    const pendingApprovals = this.db.prepare(`
      SELECT approvals.id, approvals.approval_type, approvals.summary, approvals.job_id
      FROM approvals
      LEFT JOIN jobs ON jobs.id = approvals.job_id
      WHERE approvals.status = 'pending'
        AND (jobs.id IS NULL OR jobs.status NOT IN ('archived', 'pending_archive_approval', 'cancelled', 'canceled', 'rejected', 'deleted', 'void'))
      ORDER BY approvals.created_at DESC
      LIMIT 5
    `).all();
    for (const approval of pendingApprovals) {
      actions.push({ type: 'review_approval', approvalId: approval.id, jobId: approval.job_id, severity: 'medium', message: approval.summary || `Review ${approval.approval_type}.` });
    }

    const workerConflicts = this.detectAssignmentConflicts(5);
    for (const conflict of workerConflicts) {
      actions.push({
        type: 'resolve_worker_conflict',
        jobId: conflict.jobId,
        assignmentId: conflict.assignmentId,
        conflictingJobId: conflict.conflictingJobId,
        severity: 'high',
        message: `${conflict.workerName} is assigned across ${conflict.jobTitle} and ${conflict.conflictingJobTitle}; approve, release, or reschedule before dispatch.`
      });
    }

    const toolConflicts = this.detectToolReservationConflicts(5);
    for (const conflict of toolConflicts) {
      actions.push({
        type: 'resolve_tool_conflict',
        jobId: conflict.jobId,
        reservationId: conflict.reservationId,
        conflictingJobId: conflict.conflictingJobId,
        severity: 'high',
        message: `${conflict.toolName} is reserved across ${conflict.jobTitle} and ${conflict.conflictingJobTitle}; approve, release, or reschedule before dispatch.`
      });
    }

    const jobsWithoutSiteVisits = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.priority, jobs.risk_level, jobs.estimated_cost
      FROM jobs
      LEFT JOIN site_visits
        ON site_visits.job_id = jobs.id
        AND site_visits.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('intake', 'planned', 'scheduled')
        AND (
          jobs.priority IN ('high', 'critical')
          OR jobs.risk_level IN ('high', 'critical')
          OR jobs.estimated_cost >= 1000
        )
      GROUP BY jobs.id
      HAVING COUNT(site_visits.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutSiteVisits) {
      actions.push({ type: 'schedule_site_visit', jobId: job.id, severity: ['critical', 'high'].includes(job.priority) ? 'high' : 'medium', message: `${job.title} needs a site visit before quote, dispatch, or client commitment.` });
    }

    const today = nowIso().slice(0, 10);
    const jobsWithoutFieldReports = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.status
      FROM jobs
      LEFT JOIN field_reports
        ON field_reports.job_id = jobs.id
        AND substr(field_reports.report_date, 1, 10) = ?
        AND field_reports.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('scheduled', 'in_progress')
      GROUP BY jobs.id
      HAVING COUNT(field_reports.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all(today);
    for (const job of jobsWithoutFieldReports) {
      actions.push({ type: 'draft_field_report', jobId: job.id, severity: 'medium', message: `${job.title} needs today's field report for jobsite evidence and office visibility.` });
    }

    const clientReplyCandidates = this.db.prepare(`
      SELECT communication_records.*, jobs.title AS job_title
      FROM communication_records
      JOIN jobs ON jobs.id = communication_records.job_id
      WHERE communication_records.direction = 'outbound'
        AND communication_records.status IN ('sent', 'delivered', 'awaiting_client', 'client_reply_required')
      ORDER BY COALESCE(communication_records.sent_at, communication_records.created_at) ASC
      LIMIT 25
    `).all();
    for (const communication of clientReplyCandidates) {
      const data = fromJson(communication.data_json, {});
      const expectsReply = normalizeBoolean(
        data.expectsReply ?? data.expects_reply ?? data.replyRequired ?? data.reply_required,
        ['awaiting_client', 'client_reply_required'].includes(communication.status)
      );
      if (!expectsReply) continue;

      const referenceAt = communication.sent_at || communication.created_at || nowIso();
      const replyByRaw = data.replyBy || data.reply_by || data.dueAt || data.due_at || null;
      const replyByMs = Date.parse(replyByRaw || '') || (Date.parse(referenceAt) + 48 * 60 * 60 * 1000);
      if (!Number.isFinite(replyByMs) || replyByMs > Date.now()) continue;

      const inboundReply = this.db.prepare(`
        SELECT id FROM communication_records
        WHERE job_id = ?
          AND direction = 'inbound'
          AND created_at > ?
        LIMIT 1
      `).get(communication.job_id, referenceAt);
      if (inboundReply) continue;

      const existingFollowUp = this.db.prepare(`
        SELECT id FROM communication_records
        WHERE job_id = ?
          AND direction = 'outbound'
          AND status NOT IN ('cancelled', 'rejected')
          AND data_json LIKE ?
        LIMIT 1
      `).get(communication.job_id, `%${communication.id}%`);
      if (existingFollowUp) continue;

      const hoursOverdue = Math.max(0, Math.round((Date.now() - replyByMs) / (60 * 60 * 1000)));
      actions.push({
        type: 'client_reply_follow_up',
        communicationId: communication.id,
        jobId: communication.job_id,
        severity: hoursOverdue >= 24 ? 'high' : 'medium',
        replyBy: new Date(replyByMs).toISOString(),
        message: `${communication.job_title} is waiting on a client reply for "${communication.subject || 'client confirmation'}" (${hoursOverdue}h overdue). Draft a follow-up for Robert approval.`
      });
    }

    const blockerUpdates = this.db.prepare(`
      SELECT progress_updates.id AS progress_id, progress_updates.job_id, jobs.title, progress_updates.note, progress_updates.blockers_json
      FROM progress_updates
      JOIN jobs ON jobs.id = progress_updates.job_id
      LEFT JOIN rfi_records ON rfi_records.job_id = progress_updates.job_id AND rfi_records.status NOT IN ('closed', 'resolved', 'cancelled', 'rejected')
      WHERE progress_updates.blockers_json NOT IN ('[]', '{}', '', 'null')
        AND rfi_records.id IS NULL
      ORDER BY progress_updates.created_at DESC
      LIMIT 5
    `).all();
    for (const update of blockerUpdates) {
      actions.push({ type: 'open_rfi_for_blocker', progressId: update.progress_id, jobId: update.job_id, severity: 'high', message: `${update.title} has blocker evidence that needs an RFI or decision trail.` });
    }

    const materialSubmittalGaps = this.db.prepare(`
      SELECT material_requirements.id AS material_id, material_requirements.job_id, material_requirements.name, material_requirements.supplier, jobs.title
      FROM material_requirements
      JOIN jobs ON jobs.id = material_requirements.job_id
      LEFT JOIN submittal_records
        ON submittal_records.job_id = material_requirements.job_id
        AND submittal_records.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress')
        AND material_requirements.status NOT IN ('cancelled')
        AND submittal_records.id IS NULL
      ORDER BY material_requirements.created_at DESC
      LIMIT 5
    `).all();
    for (const material of materialSubmittalGaps) {
      actions.push({
        type: 'create_submittal',
        materialRequirementId: material.material_id,
        jobId: material.job_id,
        severity: 'medium',
        message: `${material.title} needs a submittal package for ${material.name}${material.supplier ? ` from ${material.supplier}` : ''}.`
      });
    }

    const selectionGaps = this.db.prepare(`
      SELECT jobs.id, jobs.title, COUNT(material_requirements.id) AS material_count
      FROM jobs
      JOIN material_requirements
        ON material_requirements.job_id = jobs.id
        AND material_requirements.status NOT IN ('cancelled')
      LEFT JOIN client_selections
        ON client_selections.job_id = jobs.id
        AND client_selections.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress')
      GROUP BY jobs.id
      HAVING COUNT(client_selections.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of selectionGaps) {
      actions.push({
        type: 'request_client_selection',
        jobId: job.id,
        severity: 'medium',
        message: `${job.title} has ${job.material_count || 0} material need(s) and should track client selections before procurement.`
      });
    }

    const changeOrderGaps = this.db.prepare(`
      SELECT
        jobs.id,
        jobs.title,
        COALESCE(SUM(expenses.amount), 0) AS actual_cost,
        COALESCE(MAX(quotes.subtotal), jobs.estimated_cost, 0) AS baseline_cost,
        COALESCE(MAX(quotes.total), jobs.contract_value, 0) AS baseline_value
      FROM jobs
      JOIN expenses ON expenses.job_id = jobs.id AND expenses.status NOT IN ('cancelled', 'rejected')
      LEFT JOIN quotes ON quotes.job_id = jobs.id
      LEFT JOIN change_orders ON change_orders.job_id = jobs.id AND change_orders.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress', 'completed')
      GROUP BY jobs.id
      HAVING COUNT(change_orders.id) = 0
        AND COALESCE(SUM(expenses.amount), 0) > 0
        AND COALESCE(MAX(quotes.subtotal), jobs.estimated_cost, 0) > 0
        AND COALESCE(SUM(expenses.amount), 0) > (COALESCE(MAX(quotes.subtotal), jobs.estimated_cost, 0) * 1.1)
      ORDER BY COALESCE(SUM(expenses.amount), 0) - COALESCE(MAX(quotes.subtotal), jobs.estimated_cost, 0) DESC
      LIMIT 5
    `).all();
    for (const job of changeOrderGaps) {
      const overrun = Math.max(0, normalizeNumber(job.actual_cost, 0) - normalizeNumber(job.baseline_cost, 0));
      actions.push({
        type: 'draft_change_order',
        jobId: job.id,
        severity: overrun > 500 ? 'high' : 'medium',
        suggestedAmount: overrun,
        message: `${job.title} has ${overrun.toFixed(2)} EUR estimated cost drift without a change order.`
      });
    }

    const highRiskJobsWithoutPermits = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.risk_level
      FROM jobs
      LEFT JOIN permit_records
        ON permit_records.job_id = jobs.id
        AND permit_records.status NOT IN ('closed', 'expired', 'cancelled', 'rejected')
      WHERE jobs.status IN ('scheduled', 'in_progress')
        AND jobs.risk_level IN ('high', 'critical')
      GROUP BY jobs.id
      HAVING COUNT(permit_records.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of highRiskJobsWithoutPermits) {
      actions.push({ type: 'create_permit_review', jobId: job.id, severity: 'high', message: `${job.title} is high-risk and needs a permit/compliance review before field reliance.` });
    }

    const expiringPermits = this.db.prepare(`
      SELECT id, job_id, title, expires_at
      FROM permit_records
      WHERE status NOT IN ('closed', 'expired', 'cancelled', 'rejected')
        AND expires_at IS NOT NULL
        AND expires_at <= ?
      ORDER BY expires_at ASC
      LIMIT 5
    `).all(futureIsoDate(7));
    for (const permit of expiringPermits) {
      actions.push({ type: 'renew_permit', permitId: permit.id, jobId: permit.job_id, severity: 'high', message: `${permit.title} expires ${permit.expires_at ? permit.expires_at.slice(0, 10) : 'soon'} and needs renewal review.` });
    }

    const jobsWithoutInspections = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.risk_level, jobs.priority
      FROM jobs
      LEFT JOIN inspection_records
        ON inspection_records.job_id = jobs.id
        AND inspection_records.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('scheduled', 'in_progress')
        AND (jobs.risk_level IN ('high', 'critical') OR jobs.priority IN ('high', 'critical'))
      GROUP BY jobs.id
      HAVING COUNT(inspection_records.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutInspections) {
      actions.push({ type: 'create_inspection_review', jobId: job.id, severity: 'high', message: `${job.title} needs an inspection record before high-risk field work continues.` });
    }

    const jobsWithoutSafetyMeetings = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.risk_level, jobs.priority
      FROM jobs
      LEFT JOIN safety_meetings
        ON safety_meetings.job_id = jobs.id
        AND safety_meetings.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('scheduled', 'in_progress')
        AND (jobs.risk_level IN ('high', 'critical') OR jobs.priority IN ('high', 'critical'))
      GROUP BY jobs.id
      HAVING COUNT(safety_meetings.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutSafetyMeetings) {
      actions.push({ type: 'schedule_safety_meeting', jobId: job.id, severity: 'high', message: `${job.title} needs a pre-task safety talk for VCA/Wkb evidence.` });
    }

    const jobsWithoutOrientations = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.priority, jobs.risk_level
      FROM jobs
      LEFT JOIN worker_orientations
        ON worker_orientations.job_id = jobs.id
        AND worker_orientations.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('scheduled', 'in_progress')
      GROUP BY jobs.id
      HAVING COUNT(worker_orientations.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutOrientations) {
      actions.push({
        type: 'schedule_orientation',
        jobId: job.id,
        severity: ['critical', 'high'].includes(job.risk_level) || ['critical', 'high'].includes(job.priority) ? 'high' : 'medium',
        message: `${job.title} needs worker orientation evidence before site access is cleared.`
      });
    }

    const jobsWithoutJhas = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.risk_level, jobs.priority
      FROM jobs
      LEFT JOIN jha_records
        ON jha_records.job_id = jobs.id
        AND jha_records.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('scheduled', 'in_progress')
        AND (jobs.risk_level IN ('high', 'critical') OR jobs.priority IN ('high', 'critical'))
      GROUP BY jobs.id
      HAVING COUNT(jha_records.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutJhas) {
      actions.push({ type: 'create_jha', jobId: job.id, severity: 'high', message: `${job.title} needs a job hazard analysis before high-risk work continues.` });
    }

    const jobsWithoutSds = this.db.prepare(`
      SELECT jobs.id, jobs.title, COUNT(material_requirements.id) AS material_count
      FROM jobs
      JOIN material_requirements
        ON material_requirements.job_id = jobs.id
        AND material_requirements.status NOT IN ('cancelled')
      LEFT JOIN sds_sheets
        ON sds_sheets.job_id = jobs.id
        AND sds_sheets.status NOT IN ('cancelled', 'rejected', 'expired')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress')
      GROUP BY jobs.id
      HAVING COUNT(sds_sheets.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutSds) {
      actions.push({ type: 'request_sds', jobId: job.id, severity: 'medium', message: `${job.title} has ${job.material_count || 0} material need(s) but no current SDS register.` });
    }

    const jobsWithoutSiteAccess = this.db.prepare(`
      SELECT jobs.id, jobs.title
      FROM jobs
      LEFT JOIN site_access_logs
        ON site_access_logs.job_id = jobs.id
        AND site_access_logs.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('scheduled', 'in_progress')
      GROUP BY jobs.id
      HAVING COUNT(site_access_logs.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutSiteAccess) {
      actions.push({ type: 'create_site_access_gate', jobId: job.id, severity: 'medium', message: `${job.title} needs a site-access gate tied to orientation validity.` });
    }

    const openObservations = this.db.prepare(`
      SELECT id, job_id, title, severity, due_at
      FROM observation_records
      WHERE status NOT IN ('closed', 'resolved', 'approved', 'cancelled', 'rejected')
      ORDER BY CASE WHEN severity IN ('critical', 'high') THEN 0 ELSE 1 END, due_at ASC, created_at DESC
      LIMIT 5
    `).all();
    for (const observation of openObservations) {
      actions.push({
        type: 'resolve_observation',
        observationId: observation.id,
        jobId: observation.job_id,
        severity: ['critical', 'high'].includes(observation.severity) ? 'high' : 'medium',
        message: `${observation.title} is open and needs corrective-action follow-up.`
      });
    }

    const openIncidents = this.db.prepare(`
      SELECT id, job_id, title, severity, status
      FROM incident_records
      WHERE status NOT IN ('closed', 'resolved', 'approved', 'cancelled', 'rejected')
      ORDER BY CASE WHEN severity IN ('critical', 'high') THEN 0 ELSE 1 END, created_at DESC
      LIMIT 5
    `).all();
    for (const incident of openIncidents) {
      actions.push({
        type: 'review_incident',
        incidentId: incident.id,
        jobId: incident.job_id,
        severity: ['critical', 'high'].includes(incident.severity) ? 'high' : 'medium',
        message: `${incident.title} is ${incident.status} and needs incident review.`
      });
    }

    const qualityPunchGaps = this.db.prepare(`
      SELECT quality_checks.id AS quality_id, quality_checks.job_id, quality_checks.title, MAX(jobs.title) AS job_title
      FROM quality_checks
      JOIN jobs ON jobs.id = quality_checks.job_id
      LEFT JOIN punch_items
        ON punch_items.job_id = quality_checks.job_id
        AND punch_items.status NOT IN ('cancelled', 'rejected')
      WHERE quality_checks.status NOT IN ('cancelled', 'rejected')
        AND (quality_checks.result = 'failed' OR quality_checks.defects_json NOT IN ('[]', '{}', '', 'null'))
      GROUP BY quality_checks.id
      HAVING COUNT(punch_items.id) = 0
      ORDER BY quality_checks.created_at DESC
      LIMIT 5
    `).all();
    for (const quality of qualityPunchGaps) {
      actions.push({
        type: 'create_punch_item',
        qualityCheckId: quality.quality_id,
        jobId: quality.job_id,
        severity: 'high',
        message: `${quality.job_title} has quality defects that need a punch item before closeout.`
      });
    }

    const warrantyAftercareGaps = this.db.prepare(`
      SELECT aftercare_items.id AS aftercare_id, aftercare_items.job_id, aftercare_items.title, MAX(jobs.title) AS job_title
      FROM aftercare_items
      JOIN jobs ON jobs.id = aftercare_items.job_id
      LEFT JOIN warranty_claims
        ON warranty_claims.job_id = aftercare_items.job_id
        AND warranty_claims.status NOT IN ('cancelled')
      WHERE aftercare_items.status NOT IN ('completed', 'cancelled', 'closed')
        AND aftercare_items.data_json LIKE '%"warranty":true%'
      GROUP BY aftercare_items.id
      HAVING COUNT(warranty_claims.id) = 0
      ORDER BY aftercare_items.due_at ASC, aftercare_items.created_at DESC
      LIMIT 5
    `).all();
    for (const aftercare of warrantyAftercareGaps) {
      actions.push({
        type: 'open_warranty_claim',
        aftercareId: aftercare.aftercare_id,
        jobId: aftercare.job_id,
        severity: 'medium',
        message: `${aftercare.job_title} has warranty aftercare that needs a warranty claim/service record.`
      });
    }

    const jobsWithoutBudgetLines = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.estimated_cost, jobs.contract_value
      FROM jobs
      LEFT JOIN budget_lines ON budget_lines.job_id = jobs.id AND budget_lines.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress', 'completed')
      GROUP BY jobs.id
      HAVING COUNT(budget_lines.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutBudgetLines) {
      const amount = normalizeNumber(job.estimated_cost || job.contract_value, 0);
      actions.push({ type: 'create_budget_line', jobId: job.id, severity: 'medium', suggestedAmount: amount, message: `${job.title} needs a budget line so costs, commitments, and forecast can be tracked.` });
    }

    const procurementWithoutPurchaseOrders = this.db.prepare(`
      SELECT procurement_orders.id, procurement_orders.job_id, procurement_orders.supplier, procurement_orders.amount, jobs.title
      FROM procurement_orders
      JOIN jobs ON jobs.id = procurement_orders.job_id
      LEFT JOIN purchase_orders
        ON purchase_orders.job_id = procurement_orders.job_id
        AND purchase_orders.status NOT IN ('cancelled', 'rejected')
        AND purchase_orders.data_json LIKE '%' || procurement_orders.id || '%'
      WHERE procurement_orders.status IN ('approved', 'ready_to_order')
        AND purchase_orders.id IS NULL
      ORDER BY procurement_orders.created_at DESC
      LIMIT 5
    `).all();
    for (const procurement of procurementWithoutPurchaseOrders) {
      actions.push({
        type: 'create_purchase_order',
        procurementOrderId: procurement.id,
        jobId: procurement.job_id,
        severity: normalizeNumber(procurement.amount, 0) >= 500 ? 'high' : 'medium',
        suggestedAmount: normalizeNumber(procurement.amount, 0),
        message: `${procurement.title} has approved procurement that needs a formal purchase order for ${procurement.supplier || 'supplier'}.`
      });
    }

    const invoiceReadyJobs = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.contract_value, jobs.estimated_cost,
        (
          SELECT quotes.id FROM quotes
          WHERE quotes.job_id = jobs.id
            AND quotes.status NOT IN ('cancelled', 'rejected', 'expired')
          ORDER BY quotes.created_at DESC
          LIMIT 1
        ) AS quote_id,
        (
          SELECT quotes.subtotal FROM quotes
          WHERE quotes.job_id = jobs.id
            AND quotes.status NOT IN ('cancelled', 'rejected', 'expired')
          ORDER BY quotes.created_at DESC
          LIMIT 1
        ) AS quote_subtotal,
        (
          SELECT quotes.total FROM quotes
          WHERE quotes.job_id = jobs.id
            AND quotes.status NOT IN ('cancelled', 'rejected', 'expired')
          ORDER BY quotes.created_at DESC
          LIMIT 1
        ) AS quote_total
      FROM jobs
      WHERE (jobs.status = 'completed' OR jobs.progress_percent >= 95)
        AND NOT EXISTS (
          SELECT 1 FROM invoices
          WHERE invoices.job_id = jobs.id
            AND invoices.status NOT IN ('cancelled', 'rejected', 'void')
        )
        AND (
          jobs.contract_value > 0
          OR jobs.estimated_cost > 0
          OR EXISTS (
            SELECT 1 FROM quotes
            WHERE quotes.job_id = jobs.id
              AND quotes.status NOT IN ('cancelled', 'rejected', 'expired')
          )
        )
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of invoiceReadyJobs) {
      const amount = normalizeNumber(job.quote_subtotal, normalizeNumber(job.contract_value, normalizeNumber(job.estimated_cost, 0)));
      const total = normalizeNumber(job.quote_total, amount > 0 ? amount * 1.21 : 0);
      actions.push({
        type: 'draft_invoice',
        jobId: job.id,
        quoteId: job.quote_id || null,
        severity: 'high',
        suggestedAmount: amount,
        suggestedTotal: total,
        message: `${job.title} is complete or nearly complete and needs an approval-gated invoice draft for ${total.toFixed(2)} EUR.`
      });
    }

    const invoicesWithoutDraws = this.db.prepare(`
      SELECT invoices.id, invoices.job_id, invoices.total, jobs.title
      FROM invoices
      JOIN jobs ON jobs.id = invoices.job_id
      LEFT JOIN draw_requests ON draw_requests.invoice_id = invoices.id AND draw_requests.status NOT IN ('cancelled', 'rejected')
      WHERE invoices.status IN ('approved', 'submitted', 'sent')
        AND draw_requests.id IS NULL
      ORDER BY invoices.created_at DESC
      LIMIT 5
    `).all();
    for (const invoice of invoicesWithoutDraws) {
      actions.push({
        type: 'create_draw_request',
        invoiceId: invoice.id,
        jobId: invoice.job_id,
        severity: 'medium',
        suggestedAmount: normalizeNumber(invoice.total, 0),
        message: `Invoice ${invoice.id} needs draw/funding tracking for ${normalizeNumber(invoice.total, 0).toFixed(2)} EUR before finance handoff.`
      });
    }

    const paymentsNeedingWaivers = this.db.prepare(`
      SELECT payments.id, payments.job_id, payments.amount, payments.status, jobs.title
      FROM payments
      JOIN jobs ON jobs.id = payments.job_id
      LEFT JOIN lien_waivers ON lien_waivers.payment_id = payments.id AND lien_waivers.status NOT IN ('cancelled', 'rejected')
      WHERE payments.status NOT IN ('paid', 'received', 'cancelled')
        AND payments.amount >= 1000
        AND lien_waivers.id IS NULL
      ORDER BY payments.due_at ASC, payments.created_at DESC
      LIMIT 5
    `).all();
    for (const payment of paymentsNeedingWaivers) {
      actions.push({
        type: 'request_lien_waiver',
        paymentId: payment.id,
        jobId: payment.job_id,
        severity: 'high',
        suggestedAmount: normalizeNumber(payment.amount, 0),
        message: `${payment.title || payment.id} needs lien-waiver evidence before payment release.`
      });
    }

    const jobsNeedingFinanceHandoff = this.db.prepare(`
      SELECT jobs.id, jobs.title
      FROM jobs
      LEFT JOIN finance_handoffs ON finance_handoffs.job_id = jobs.id AND finance_handoffs.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('completed', 'in_progress')
        AND (
          EXISTS (SELECT 1 FROM invoices WHERE invoices.job_id = jobs.id)
          OR EXISTS (SELECT 1 FROM expenses WHERE expenses.job_id = jobs.id)
          OR EXISTS (SELECT 1 FROM payments WHERE payments.job_id = jobs.id)
          OR EXISTS (SELECT 1 FROM purchase_orders WHERE purchase_orders.job_id = jobs.id)
        )
      GROUP BY jobs.id
      HAVING COUNT(finance_handoffs.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsNeedingFinanceHandoff) {
      actions.push({ type: 'create_finance_handoff', jobId: job.id, severity: 'medium', message: `${job.title} needs a finance handoff package for FAB/bookkeeping review.` });
    }

    const materialNeeds = this.db.prepare(`
      SELECT material_requirements.id, material_requirements.job_id, material_requirements.name, material_requirements.quantity, material_requirements.unit
      FROM material_requirements
      LEFT JOIN procurement_orders
        ON procurement_orders.job_id = material_requirements.job_id
        AND procurement_orders.status NOT IN ('cancelled', 'rejected')
      WHERE material_requirements.status IN ('needed', 'low_stock')
        AND procurement_orders.id IS NULL
      ORDER BY material_requirements.created_at DESC
      LIMIT 5
    `).all();
    for (const material of materialNeeds) {
      actions.push({ type: 'create_procurement_order', materialRequirementId: material.id, jobId: material.job_id, severity: 'medium', message: `${material.name} needs procurement planning (${material.quantity} ${material.unit}).` });
    }

    const jobsWithoutRoutes = this.db.prepare(`
      SELECT jobs.id, jobs.title, jobs.address, jobs.city FROM jobs
      LEFT JOIN route_plans ON route_plans.job_id = jobs.id AND route_plans.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress')
      GROUP BY jobs.id
      HAVING COUNT(route_plans.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutRoutes) {
      actions.push({ type: 'create_route_plan', jobId: job.id, severity: 'medium', message: `${job.title} needs a dispatch route to ${job.address || job.city || 'the job site'}.` });
    }

    const jobsWithoutLoading = this.db.prepare(`
      SELECT jobs.id, jobs.title,
        COUNT(DISTINCT tool_reservations.id) AS tools,
        COUNT(DISTINCT material_requirements.id) AS materials
      FROM jobs
      LEFT JOIN tool_reservations ON tool_reservations.job_id = jobs.id AND tool_reservations.status NOT IN ('cancelled', 'released')
      LEFT JOIN material_requirements ON material_requirements.job_id = jobs.id AND material_requirements.status NOT IN ('cancelled')
      LEFT JOIN loading_plans ON loading_plans.job_id = jobs.id AND loading_plans.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress')
      GROUP BY jobs.id
      HAVING COUNT(loading_plans.id) = 0
        AND (COUNT(DISTINCT tool_reservations.id) > 0 OR COUNT(DISTINCT material_requirements.id) > 0)
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of jobsWithoutLoading) {
      actions.push({ type: 'create_loading_plan', jobId: job.id, severity: 'medium', message: `${job.title} needs a loading checklist for ${job.tools || 0} tool(s) and ${job.materials || 0} material need(s).` });
    }

    const assignmentsWithoutInstructions = this.db.prepare(`
      SELECT assignments.id AS assignment_id, assignments.job_id, MAX(jobs.title) AS title
      FROM assignments
      JOIN jobs ON jobs.id = assignments.job_id
      LEFT JOIN worker_instructions
        ON worker_instructions.assignment_id = assignments.id
        AND worker_instructions.status NOT IN ('cancelled', 'rejected')
      WHERE jobs.status IN ('planned', 'scheduled', 'in_progress')
        AND assignments.status IN ('planned', 'scheduled', 'active')
      GROUP BY assignments.id
      HAVING COUNT(worker_instructions.id) = 0
      ORDER BY assignments.created_at DESC
      LIMIT 5
    `).all();
    for (const assignment of assignmentsWithoutInstructions) {
      actions.push({ type: 'draft_worker_instruction', assignmentId: assignment.assignment_id, jobId: assignment.job_id, severity: 'medium', message: `${assignment.title} needs crew instructions before dispatch.` });
    }

    const completedWithoutQuality = this.db.prepare(`
      SELECT jobs.id, jobs.title FROM jobs
      LEFT JOIN quality_checks ON quality_checks.job_id = jobs.id
      WHERE jobs.status = 'completed'
      GROUP BY jobs.id
      HAVING COUNT(quality_checks.id) = 0
      ORDER BY jobs.updated_at DESC
      LIMIT 5
    `).all();
    for (const job of completedWithoutQuality) {
      actions.push({ type: 'create_quality_check', jobId: job.id, severity: 'high', message: `${job.title} is complete but has no final quality check.` });
    }

    const openSafety = this.db.prepare(`
      SELECT id, job_id, title, risk_level FROM safety_checks
      WHERE status NOT IN ('approved', 'completed', 'closed', 'cancelled')
      ORDER BY CASE WHEN risk_level IN ('critical', 'high') THEN 0 ELSE 1 END, created_at DESC
      LIMIT 5
    `).all();
    for (const safety of openSafety) {
      actions.push({ type: 'safety_review', safetyCheckId: safety.id, jobId: safety.job_id, severity: ['critical', 'high'].includes(safety.risk_level) ? 'high' : 'medium', message: `${safety.title} needs safety review.` });
    }

    const paymentFollowUps = this.db.prepare(`
      SELECT id, job_id, amount, due_at, status FROM payments
      WHERE status NOT IN ('paid', 'received', 'cancelled')
      ORDER BY due_at ASC, created_at DESC
      LIMIT 5
    `).all();
    for (const payment of paymentFollowUps) {
      actions.push({ type: 'payment_follow_up', paymentId: payment.id, jobId: payment.job_id, severity: payment.due_at && payment.due_at < nowIso() ? 'high' : 'medium', message: `Payment follow-up ${payment.id} is ${payment.status} for ${Number(payment.amount || 0).toFixed(2)} EUR.` });
    }

    const aftercareDue = this.db.prepare(`
      SELECT id, job_id, title, due_at FROM aftercare_items
      WHERE status NOT IN ('completed', 'closed', 'cancelled')
      ORDER BY due_at ASC, created_at DESC
      LIMIT 5
    `).all();
    for (const aftercare of aftercareDue) {
      actions.push({ type: 'aftercare_follow_up', aftercareId: aftercare.id, jobId: aftercare.job_id, severity: aftercare.due_at && aftercare.due_at < nowIso() ? 'high' : 'low', message: `${aftercare.title} is due ${aftercare.due_at ? aftercare.due_at.slice(0, 10) : 'soon'}.` });
    }

    const recurringDue = this.db.prepare(`
      SELECT id, job_id, service, next_due_at FROM recurring_plans
      WHERE status = 'active' AND (next_due_at IS NULL OR next_due_at <= ?)
      ORDER BY next_due_at ASC
      LIMIT 5
    `).all(futureIsoDate(7));
    for (const plan of recurringDue) {
      actions.push({ type: 'recurring_job_due', recurringPlanId: plan.id, jobId: plan.job_id, severity: 'medium', message: `${plan.service} recurring plan is due ${plan.next_due_at ? plan.next_due_at.slice(0, 10) : 'now'}.` });
    }

    const learningRefreshes = this.learningJobTypesNeedingRefresh(5);
    for (const profile of learningRefreshes) {
      actions.push({
        type: 'refresh_learning_profile',
        jobType: profile.job_type,
        severity: profile.profile_updated_at ? 'low' : 'medium',
        requiresApproval: false,
        sampleCount: normalizeNumber(profile.sample_count, 0),
        latestJobUpdate: profile.latest_job_update,
        message: `${String(profile.job_type || 'general').replace(/_/g, ' ')} has ${normalizeNumber(profile.sample_count, 0)} completed job(s) ready for a learning-profile refresh.`
      });
    }
    const assignmentScopedCrewActions = [];
    const crewJobs = this.listJobs({ limit: 500 }).filter(job => (
      ['planned', 'scheduled', 'in_progress'].includes(normalizeStatus(job.status, 'open'))
      && actionableJobIds.has(job.id)
    ));
    for (const job of crewJobs) {
      const detail = this.getJobDetail(job.id, { includeAudit: false });
      const crewEvidence = this.crewEvidenceReadiness(detail);
      for (const item of crewEvidence.items) {
        if (!item.orientation) {
          assignmentScopedCrewActions.push({
            type: 'schedule_orientation',
            jobId: job.id,
            assignmentId: item.assignmentId,
            workerId: item.workerId,
            workerName: item.workerName,
            severity: ['critical', 'high'].includes(job.riskLevel) || ['critical', 'high'].includes(job.priority) ? 'high' : 'medium',
            message: `${job.title} needs orientation evidence for ${item.workerName} before site access is cleared.`
          });
        }
        if (!item.siteAccess) {
          assignmentScopedCrewActions.push({
            type: 'create_site_access_gate',
            jobId: job.id,
            assignmentId: item.assignmentId,
            workerId: item.workerId,
            workerName: item.workerName,
            orientationId: item.orientation?.id || null,
            severity: 'medium',
            message: `${job.title} needs an assignment-scoped site-access gate for ${item.workerName}.`
          });
        }
      }
    }
    // A historical child record may remain for audit after a job is archived.
    // It must not re-enter the operator queue or autonomous command plan.
    return [
      ...actions.filter(action => !['schedule_orientation', 'create_site_access_gate'].includes(action.type)),
      ...assignmentScopedCrewActions
    ]
      .filter(action => !action.jobId || actionableJobIds.has(action.jobId))
      .slice(0, 64);
  }

  commandPlanSeverityScore(severity) {
    const score = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    return score[normalizeStatus(severity, 'medium')] || 3;
  }

  commandPlanStreamForAction(actionType = '') {
    const type = normalizeStatus(actionType, 'review');
    if (type.includes('approval')) return 'approval';
    if (type.includes('invoice') || type.includes('payment') || type.includes('budget') || type.includes('purchase') || type.includes('draw') || type.includes('waiver') || type.includes('finance')) return 'finance';
    if (type.includes('client') || type.includes('selection') || type.includes('aftercare') || type.includes('warranty') || type.includes('punch') || type.includes('recurring')) return 'client_success';
    if (type.includes('safety') || type.includes('permit') || type.includes('inspection') || type.includes('incident') || type.includes('observation') || type.includes('rfi') || type.includes('submittal') || type.includes('jha') || type.includes('sds') || type.includes('access')) return 'field_assurance';
    if (type.includes('worker') || type.includes('assignment') || type.includes('orientation') || type.includes('instruction')) return 'workforce';
    if (type.includes('tool') || type.includes('material') || type.includes('loading') || type.includes('procurement')) return 'inventory';
    if (type.includes('route') || type.includes('dispatch') || type.includes('weather') || type.includes('schedule') || type.includes('site_visit')) return 'dispatch';
    if (type.includes('learning')) return 'learning';
    return 'operations';
  }

  commandPlanSafeActionTypes() {
    return new Set([
      'draft_field_report',
      'open_rfi_for_blocker',
      'create_submittal',
      'request_client_selection',
      'draft_change_order',
      'create_permit_review',
      'create_inspection_review',
      'schedule_safety_meeting',
      'schedule_orientation',
      'create_jha',
      'request_sds',
      'create_site_access_gate',
      'create_budget_line',
      'draft_invoice',
      'create_finance_handoff',
      'create_procurement_order',
      'create_route_plan',
      'create_loading_plan',
      'draft_worker_instruction',
      'create_quality_check',
      'payment_follow_up',
      'client_reply_follow_up',
      'renew_permit',
      'resolve_observation',
      'review_incident',
      'safety_review',
      'aftercare_follow_up',
      'recurring_job_due',
      'refresh_learning_profile'
    ]);
  }

  commandPlanId(prefix, parts = []) {
    const value = [prefix, ...parts]
      .filter(part => part !== undefined && part !== null && String(part).trim())
      .join('_')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return value || 'command_action';
  }

  commandPlanSummary(actions = [], matching = actions.length) {
    const summary = {
      total: actions.length,
      matching,
      highPriority: 0,
      approvalRequired: 0,
      safeDraftable: 0,
      blocked: 0,
      externalCommitments: 0,
      streams: {}
    };
    for (const action of actions) {
      const stream = action.stream || 'operations';
      summary.streams[stream] = (summary.streams[stream] || 0) + 1;
      if (['critical', 'high'].includes(normalizeStatus(action.severity, 'medium'))) summary.highPriority += 1;
      if (action.requiresApproval) summary.approvalRequired += 1;
      if (action.safeDraftable) summary.safeDraftable += 1;
      if (action.blocked) summary.blocked += 1;
    }
    return summary;
  }

  buildTodayCommandPlan(filters = {}) {
    const limit = safeLimit(filters.limit, 24, 100);
    const search = normalizeText(filters.search, '').toLowerCase();
    const mode = normalizeStatus(filters.mode || filters.status, 'all');
    const jobFilter = new Set(
      []
        .concat(filters.jobId || filters.job_id || [])
        .concat(filters.jobIds || filters.job_ids || [])
        .flatMap(value => String(value || '').split(','))
        .map(value => value.trim())
        .filter(Boolean)
    );
    const safeActionTypes = this.commandPlanSafeActionTypes();
    const actionableJobIds = new Set(this.db.prepare(`
      SELECT id FROM jobs
      WHERE status NOT IN ('cancelled', 'canceled', 'rejected', 'archived', 'pending_archive_approval', 'deleted', 'void')
    `).all().map(row => row.id));
    const commands = [];
    const seen = new Set();
    const add = command => {
      const actionType = normalizeStatus(command.actionType || command.type, 'review');
      const stream = command.stream || this.commandPlanStreamForAction(actionType);
      if (jobFilter.size && command.jobId && !jobFilter.has(command.jobId)) return;
      if (command.jobId && !actionableJobIds.has(command.jobId)) return;
      const id = command.id || this.commandPlanId('cmd', [stream, actionType, command.jobId, command.approvalId, command.requirementKey, command.sourceId]);
      if (seen.has(id)) return;
      seen.add(id);
      const severity = normalizeStatus(command.severity, 'medium');
      const requiresApproval = normalizeBoolean(command.requiresApproval, false);
      const safeDraftable = normalizeBoolean(command.safeDraftable, safeActionTypes.has(actionType) || actionType === 'draft_capability_gap');
      commands.push({
        id,
        stream,
        actionType,
        jobId: command.jobId || null,
        jobTitle: command.jobTitle || command.title || null,
        approvalId: command.approvalId || null,
        requirementKey: command.requirementKey || null,
        capabilityKey: command.capabilityKey || null,
        source: command.source || 'ledger',
        sourceId: command.sourceId || null,
        severity,
        score: this.commandPlanSeverityScore(severity) + (requiresApproval ? 0.5 : 0) + (safeDraftable ? 0.25 : 0),
        message: command.message || command.nextAction || 'Review command-plan action.',
        nextAction: command.nextAction || command.message || 'Review command-plan action.',
        requiresApproval,
        safeDraftable,
        blocked: normalizeBoolean(command.blocked, false),
        externalCommitments: 0,
        data: command.data || {}
      });
    };

    for (const approval of this.listApprovals({ status: 'pending', limit: 50 })) {
      add({
        stream: 'approval',
        actionType: 'review_approval',
        approvalId: approval.id,
        jobId: approval.jobId,
        source: 'approval_queue',
        sourceId: approval.id,
        severity: approval.decision?.riskLevel || 'medium',
        requiresApproval: true,
        safeDraftable: false,
        message: approval.decision?.primaryEffect || approval.summary || `Review ${approval.approvalType}.`,
        data: { approvalType: approval.approvalType, targetType: approval.targetType }
      });
    }

    for (const action of this.nextActions()) {
      add({
        ...action,
        stream: this.commandPlanStreamForAction(action.type),
        actionType: action.type,
        source: 'next_action_monitor',
        sourceId: action.approvalId || action.communicationId || action.assignmentId || action.reservationId || action.materialRequirementId || action.paymentId || action.aftercareId || action.recurringPlanId || action.jobType || action.jobId,
        safeDraftable: safeActionTypes.has(normalizeStatus(action.type, '')),
        requiresApproval: normalizeBoolean(action.requiresApproval, false)
      });
    }

    const readinessSources = [
      { stream: 'dispatch', result: this.listDispatchReadiness({ limit: 50 }), statusKey: 'readinessStatus', stable: ['ready'] },
      { stream: 'workforce', result: this.listWorkforceReadiness({ limit: 50 }), statusKey: 'workforceStatus', stable: ['stable'] },
      { stream: 'inventory', result: this.listInventoryReadiness({ limit: 50 }), statusKey: 'inventoryStatus', stable: ['stable'] },
      { stream: 'field_assurance', result: this.listFieldAssurance({ limit: 50 }), statusKey: 'fieldStatus', stable: ['stable'] },
      { stream: 'finance', result: this.listFinanceReadiness({ limit: 50 }), statusKey: 'financeStatus', stable: ['stable'] },
      { stream: 'client_success', result: this.listClientSuccess({ limit: 50 }), statusKey: 'clientStatus', stable: ['stable'] }
    ];
    for (const source of readinessSources) {
      for (const row of source.result.jobs || []) {
        const status = normalizeStatus(row[source.statusKey], 'needs_review');
        if (source.stable.includes(status)) continue;
        const action = Array.isArray(row.nextActions) && row.nextActions.length ? row.nextActions[0] : null;
        add({
          stream: source.stream,
          actionType: action?.type || `${source.stream}_review`,
          jobId: row.jobId,
          jobTitle: row.jobTitle,
          source: `${source.stream}_readiness`,
          sourceId: row.jobId,
          severity: status === 'blocked' || status === 'approval_required' ? 'high' : 'medium',
          requiresApproval: Boolean(row.requiresApproval || row.flags?.approvalRequired || normalizeNumber(row.counts?.pendingApprovals, 0) > 0),
          safeDraftable: safeActionTypes.has(normalizeStatus(action?.type, '')),
          blocked: status === 'blocked',
          message: action?.message || row.nextAction || `${row.jobTitle || row.jobId} needs ${source.stream.replace(/_/g, ' ')} review.`,
          data: { status, counts: row.counts || {}, flags: row.flags || {}, missing: row.missing || [], blockers: row.blockers || [] }
        });
      }
    }

    if (filters.includeCapabilities !== false && filters.include_capabilities !== 'false') {
      const capabilityJobs = this.listJobs({ limit: 25 }).filter(job => {
        const status = normalizeStatus(job.status, 'open');
        return !['completed', 'cancelled', 'canceled', 'rejected', 'archived'].includes(status);
      });
      for (const job of capabilityJobs) {
        if (jobFilter.size && !jobFilter.has(job.id)) continue;
        const plan = this.buildJobCapabilityPlan(job.id, { limit: 3, includeOpen: false });
        for (const action of plan.actions || []) {
          add({
            stream: 'capability',
            actionType: 'draft_capability_gap',
            jobId: job.id,
            jobTitle: job.title,
            source: 'capability_gap',
            sourceId: action.requirementKey,
            requirementKey: action.requirementKey,
            capabilityKey: action.capabilityKey,
            severity: action.requiresApproval ? 'high' : 'medium',
            requiresApproval: normalizeBoolean(action.requiresApproval, false),
            safeDraftable: true,
            message: `Draft missing ${action.requirementLabel || action.requirementKey} record for ${job.title}.`,
            data: { target: action.target, sourceVendors: action.sourceVendors || [] }
          });
        }
      }
    }

    const matchesMode = action => {
      if (mode === 'all') return true;
      if (mode === 'approval') return action.requiresApproval;
      if (mode === 'safe') return action.safeDraftable;
      if (mode === 'blocked') return action.blocked;
      return action.stream === mode || action.actionType === mode || action.severity === mode;
    };
    const matchesSearch = action => !search || JSON.stringify(action).toLowerCase().includes(search);
    const filtered = commands.filter(action => matchesMode(action) && matchesSearch(action));
    filtered.sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta) return scoreDelta;
      return String(left.jobTitle || left.message).localeCompare(String(right.jobTitle || right.message));
    });

    return {
      generatedAt: nowIso(),
      mode,
      summary: this.commandPlanSummary(commands, filtered.length),
      actions: filtered.slice(0, limit),
      safety: {
        externalCommitments: 0,
        policy: 'Draft internal records only. External messages, quotes, invoices, payment actions, orders, deletions, and client commitments remain approval-gated.'
      }
    };
  }

  applyTodayCommandPlan(payload = {}, options = {}) {
    const actor = options.actor || payload.actor || 'Contractor.AI';
    const limit = safeLimit(payload.limit, 10, 50);
    const preview = this.buildTodayCommandPlan({ ...payload, limit: Math.max(limit, 50), mode: payload.mode || 'safe' });
    const requestedIds = new Set(
      []
        .concat(payload.actionId || payload.action_id || [])
        .concat(payload.actionIds || payload.action_ids || [])
        .flatMap(value => String(value || '').split(','))
        .map(value => value.trim())
        .filter(Boolean)
    );
    const selected = preview.actions
      .filter(action => requestedIds.size ? requestedIds.has(action.id) : action.safeDraftable)
      .slice(0, limit);
    const applied = [];
    const skipped = [];
    const capabilityByJob = new Map();
    const cycleTypes = new Set();
    const cycleJobs = new Set();
    const safeActionTypes = this.commandPlanSafeActionTypes();

    for (const action of selected) {
      if (!action.safeDraftable) {
        skipped.push({ ...action, reason: 'Action is not safe for command-plan auto-drafting.' });
        continue;
      }
      if (action.actionType === 'draft_capability_gap' && action.jobId && action.requirementKey) {
        const existing = capabilityByJob.get(action.jobId) || new Set();
        existing.add(action.requirementKey);
        capabilityByJob.set(action.jobId, existing);
        continue;
      }
      if (safeActionTypes.has(action.actionType)) {
        cycleTypes.add(action.actionType);
        if (action.jobId) cycleJobs.add(action.jobId);
        continue;
      }
      skipped.push({ ...action, reason: 'No command-plan applier is mapped for this action type.' });
    }

    for (const [jobId, requirementSet] of capabilityByJob.entries()) {
      const result = this.applyJobCapabilityPlan(jobId, {
        requirementKeys: [...requirementSet],
        actor,
        limit: requirementSet.size
      }, { actor });
      applied.push({
        type: 'draft_capability_gap',
        jobId,
        requirementKeys: [...requirementSet],
        created: result.created || [],
        status: 'drafted'
      });
    }

    let autonomousCycle = null;
    if (cycleTypes.size) {
      autonomousCycle = this.runAutonomousCycle({
        actor,
        actionTypes: [...cycleTypes],
        jobIds: [...cycleJobs]
      });
      applied.push(...(autonomousCycle.applied || []).map(action => ({ ...action, source: 'autonomous_cycle' })));
      skipped.push(...(autonomousCycle.blocked || []).map(action => ({ ...action, reason: action.reason || 'Autonomous cycle blocked this action.' })));
    }

    this.audit({
      entityType: 'command_plan',
      entityId: 'today',
      action: 'apply_today_command_plan',
      actor,
      after: {
        selected: selected.length,
        applied: applied.length,
        skipped: skipped.length,
        actionTypes: [...cycleTypes],
        capabilityJobs: [...capabilityByJob.keys()],
        externalCommitments: 0
      },
      metadata: { source: 'today_command_plan' }
    });
    const affectedJobIds = [...new Set(selected.map(action => action.jobId).filter(Boolean))];
    for (const jobId of affectedJobIds) {
      this.audit({
        entityType: 'job',
        entityId: jobId,
        jobId,
        action: 'apply_today_command_plan',
        actor,
        after: {
          selected: selected.filter(action => action.jobId === jobId).length,
          applied: applied.filter(action => action.jobId === jobId).length,
          skipped: skipped.filter(action => action.jobId === jobId).length,
          externalCommitments: 0
        },
        metadata: { source: 'today_command_plan' }
      });
    }

    return {
      success: true,
      mode: 'applied',
      ranAt: nowIso(),
      selected,
      applied,
      skipped,
      autonomousCycle,
      summary: {
        selected: selected.length,
        applied: applied.length,
        skipped: skipped.length,
        externalCommitments: 0
      },
      dashboard: this.dashboardSummary()
    };
  }

  runAutonomousCycle(options = {}) {
    const dryRun = options.dryRun === true;
    const actor = options.actor || 'Contractor.AI';
    const actionTypeFilter = new Set(
      []
        .concat(options.actionType || options.action_type || [])
        .concat(options.actionTypes || options.action_types || [])
        .flatMap(value => String(value || '').split(','))
        .map(value => normalizeStatus(value, ''))
        .filter(Boolean)
    );
    const jobFilter = new Set(
      []
        .concat(options.jobId || options.job_id || [])
        .concat(options.jobIds || options.job_ids || [])
        .flatMap(value => String(value || '').split(','))
        .map(value => String(value || '').trim())
        .filter(Boolean)
    );
    const maxActions = Number.isFinite(Number(options.maxActions ?? options.max_actions))
      ? Math.max(1, Math.min(25, Number(options.maxActions ?? options.max_actions)))
      : null;
    const preview = this.nextActions().filter(action => {
      if (actionTypeFilter.size && !actionTypeFilter.has(normalizeStatus(action.type, ''))) return false;
      if (jobFilter.size && action.jobId && !jobFilter.has(action.jobId)) return false;
      return true;
    }).slice(0, maxActions || undefined);
    const applied = [];
    const blocked = [];

    if (!dryRun) {
      this.transaction(() => {
        const assignActions = preview.filter(action => action.type === 'assign_worker').slice(0, 3);
        for (const action of assignActions) {
          try {
            const assignment = this.addAssignment(action.jobId, { role: 'Lead contractor' }, { actor, optional: true, audit: false });
            if (assignment) {
              applied.push({ ...action, assignmentId: assignment.id, status: 'applied' });
              this.audit({ entityType: 'job', entityId: action.jobId, jobId: action.jobId, action: 'autonomous_assign_worker', actor, after: assignment });
            } else {
              blocked.push({ ...action, status: 'blocked', reason: 'No available worker in ledger.' });
            }
          } catch (error) {
            blocked.push({ ...action, status: 'blocked', reason: error.message });
          }
        }

        const siteVisits = preview.filter(action => action.type === 'schedule_site_visit').slice(0, 3);
        for (const action of siteVisits) {
          const siteVisit = this.createSiteVisit(action.jobId, {
            status: 'scheduled',
            visitType: 'site_survey',
            notes: 'Autonomous draft site visit. Confirm time, client availability, and access before external commitment.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, siteVisitId: siteVisit.id, status: 'scheduled' });
          this.audit({ entityType: 'site_visit', entityId: siteVisit.id, jobId: action.jobId, action: 'autonomous_schedule_site_visit', actor, after: siteVisit });
        }

        const fieldReports = preview.filter(action => action.type === 'draft_field_report').slice(0, 3);
        for (const action of fieldReports) {
          const fieldReport = this.createFieldReport(action.jobId, {
            status: 'draft',
            reportDate: nowIso().slice(0, 10),
            workCompleted: 'Autonomous daily field report draft. Add photos, manpower, blockers, and production notes before submission.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, fieldReportId: fieldReport.id, status: 'drafted' });
          this.audit({ entityType: 'field_report', entityId: fieldReport.id, jobId: action.jobId, action: 'autonomous_draft_field_report', actor, after: fieldReport });
        }

        const blockerRfis = preview.filter(action => action.type === 'open_rfi_for_blocker').slice(0, 3);
        for (const action of blockerRfis) {
          const progress = this.db.prepare('SELECT * FROM progress_updates WHERE id = ?').get(action.progressId);
          const blockers = fromJson(progress?.blockers_json, []);
          const rfi = this.createRfi(action.jobId, {
            status: 'open',
            title: 'Clarify blocker before field continuation',
            question: `${progress?.note || 'A field blocker was recorded.'} ${Array.isArray(blockers) && blockers.length ? `Blockers: ${blockers.join(', ')}` : ''}`.trim(),
            responsible: 'Robert',
            dueAt: futureIsoDate(2),
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, rfiId: rfi.id, status: 'opened' });
          this.audit({ entityType: 'rfi_record', entityId: rfi.id, jobId: action.jobId, action: 'autonomous_open_rfi_for_blocker', actor, after: rfi });
        }

        const submittals = preview.filter(action => action.type === 'create_submittal').slice(0, 3);
        for (const action of submittals) {
          const material = this.db.prepare('SELECT * FROM material_requirements WHERE id = ?').get(action.materialRequirementId);
          const submittal = this.createSubmittalRecord(action.jobId, {
            status: 'draft',
            title: material ? `${material.name} submittal package` : 'Material submittal package',
            packageName: material?.supplier || 'Material package',
            responsible: material?.supplier || 'Project team',
            reviewer: 'Robert',
            material: material?.name || null,
            notes: 'Autonomous submittal draft. Approve before procurement, installation, or client reliance.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, submittalId: submittal.id, status: 'drafted' });
          this.audit({ entityType: 'submittal_record', entityId: submittal.id, jobId: action.jobId, action: 'autonomous_create_submittal', actor, after: submittal });
        }

        const selections = preview.filter(action => action.type === 'request_client_selection').slice(0, 3);
        for (const action of selections) {
          const detail = this.getJobDetail(action.jobId, { includeAudit: false });
          const playbook = this.resolveJobPlaybook(detail, {});
          const decisionTitle = normalizeList(playbook.clientSelections)[0] || `${detail.title || 'Job'} client decision`;
          const selection = this.createClientSelection(action.jobId, {
            status: 'pending_client',
            title: decisionTitle,
            category: normalizeStatus(playbook.key || 'scope_selection', 'scope_selection'),
            dueAt: futureIsoDate(3),
            options: ['Approve current scope as drafted', 'Request alternative option', 'Defer until site visit'],
            notes: 'Autonomous client selection draft. Record client choice and approve before locking scope, ordering materials, changing price, or committing dates.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, clientSelectionId: selection.id, status: 'requested' });
          this.audit({ entityType: 'client_selection', entityId: selection.id, jobId: action.jobId, action: 'autonomous_request_client_selection', actor, after: selection });
        }

        const changeOrders = preview.filter(action => action.type === 'draft_change_order').slice(0, 3);
        for (const action of changeOrders) {
          const changeOrder = this.createChangeOrder(action.jobId, {
            status: 'draft',
            title: 'Cost and scope variance review',
            scopeDelta: action.message,
            amount: normalizeNumber(action.suggestedAmount, 0),
            notes: 'Autonomous draft change order. Robert must approve before client commitment.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, changeOrderId: changeOrder.id, approvalId: changeOrder.approvalId || null, status: 'drafted' });
          this.audit({ entityType: 'change_order', entityId: changeOrder.id, jobId: action.jobId, action: 'autonomous_draft_change_order', actor, after: changeOrder });
        }

        const permitReviews = preview.filter(action => action.type === 'create_permit_review').slice(0, 3);
        for (const action of permitReviews) {
          const permit = this.createPermitRecord(action.jobId, {
            status: 'draft',
            permitType: 'site_access',
            title: 'Permit and compliance review',
            holder: 'Project team',
            notes: 'Autonomous permit review draft for high-risk field work. Confirm permit needs, VCA/Wkb evidence, access controls, and expiry before activation.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, permitId: permit.id, status: 'drafted' });
          this.audit({ entityType: 'permit_record', entityId: permit.id, jobId: action.jobId, action: 'autonomous_create_permit_review', actor, after: permit });
        }

        const inspectionReviews = preview.filter(action => action.type === 'create_inspection_review').slice(0, 3);
        for (const action of inspectionReviews) {
          const inspection = this.createInspectionRecord(action.jobId, {
            status: 'scheduled',
            inspectionType: 'pre_task_inspection',
            title: 'Pre-task inspection review',
            scheduledAt: futureIsoDate(1),
            checklist: ['Access and fall/trip hazards', 'Tools and PPE ready', 'Photos and Wkb evidence plan', 'Client or site constraints'],
            notes: 'Autonomous inspection draft for high-risk work. Complete and approve before relying on the record.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, inspectionId: inspection.id, status: 'scheduled' });
          this.audit({ entityType: 'inspection_record', entityId: inspection.id, jobId: action.jobId, action: 'autonomous_create_inspection_review', actor, after: inspection });
        }

        const safetyMeetings = preview.filter(action => action.type === 'schedule_safety_meeting').slice(0, 3);
        for (const action of safetyMeetings) {
          const meeting = this.createSafetyMeeting(action.jobId, {
            status: 'scheduled',
            meetingType: 'pre_task_talk',
            title: 'Pre-task toolbox talk',
            scheduledAt: futureIsoDate(1),
            topics: ['Work method', 'PPE and VCA controls', 'Site access', 'Stop-work triggers'],
            notes: 'Autonomous safety talk draft. Record attendees and approve completion after the talk.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, safetyMeetingId: meeting.id, status: 'scheduled' });
          this.audit({ entityType: 'safety_meeting', entityId: meeting.id, jobId: action.jobId, action: 'autonomous_schedule_safety_meeting', actor, after: meeting });
        }

        const orientations = preview.filter(action => action.type === 'schedule_orientation').slice(0, 3);
        for (const action of orientations) {
          const orientation = this.createWorkerOrientation(action.jobId, {
            assignmentId: action.assignmentId || null,
            workerId: action.workerId || null,
            status: 'scheduled',
            workerName: action.workerName || undefined,
            company: 'Project team',
            language: 'nl',
            topics: ['Site rules', 'PPE and VCA controls', 'Emergency contacts', 'Access boundaries'],
            notes: 'Autonomous orientation draft. Complete and approve before the worker is cleared for site access.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, orientationId: orientation.id, status: 'scheduled' });
          this.audit({ entityType: 'worker_orientation', entityId: orientation.id, jobId: action.jobId, action: 'autonomous_schedule_orientation', actor, after: orientation });
        }

        const jhas = preview.filter(action => action.type === 'create_jha').slice(0, 3);
        for (const action of jhas) {
          const jha = this.createJhaRecord(action.jobId, {
            status: 'draft',
            title: 'Pre-task job hazard analysis',
            riskLevel: action.severity === 'high' ? 'high' : 'medium',
            hazards: ['Access constraints', 'Manual handling', 'Tools and PPE controls'],
            controls: ['Confirm method statement', 'Brief crew before work', 'Stop work on changed conditions'],
            notes: 'Autonomous JHA draft. Approval is required before field reliance.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, jhaId: jha.id, approvalId: jha.approvalId || jha.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'jha_record', entityId: jha.id, jobId: action.jobId, action: 'autonomous_create_jha', actor, after: jha });
        }

        const sdsRequests = preview.filter(action => action.type === 'request_sds').slice(0, 3);
        for (const action of sdsRequests) {
          const sdsSheet = this.createSdsSheet(action.jobId, {
            status: 'requested',
            material: 'Site materials SDS register',
            supplier: 'Project supplier',
            notes: 'Autonomous SDS register request for materials planned on this job.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, sdsSheetId: sdsSheet.id, status: 'requested' });
          this.audit({ entityType: 'sds_sheet', entityId: sdsSheet.id, jobId: action.jobId, action: 'autonomous_request_sds', actor, after: sdsSheet });
        }

        const accessGates = preview.filter(action => action.type === 'create_site_access_gate').slice(0, 3);
        for (const action of accessGates) {
          const accessLog = this.createSiteAccessLog(action.jobId, {
            assignmentId: action.assignmentId || null,
            workerId: action.workerId || null,
            orientationId: action.orientationId || null,
            status: 'blocked',
            workerName: action.workerName || undefined,
            company: 'Project team',
            orientationValid: false,
            accessPoint: 'Main site access',
            notes: 'Autonomous access gate. Remains blocked until orientation is completed and access is approved.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, siteAccessLogId: accessLog.id, status: 'blocked' });
          this.audit({ entityType: 'site_access_log', entityId: accessLog.id, jobId: action.jobId, action: 'autonomous_create_site_access_gate', actor, after: accessLog });
        }

        const budgetLines = preview.filter(action => action.type === 'create_budget_line').slice(0, 3);
        for (const action of budgetLines) {
          const budgetAmount = normalizeNumber(action.suggestedAmount, 0);
          if (!(budgetAmount > 0)) {
            blocked.push({
              ...action,
              status: 'blocked',
              reason: 'A positive estimate or contract value is required before an internal budget draft can be created.'
            });
            continue;
          }
          const budgetLine = this.createBudgetLine(action.jobId, {
            status: 'draft',
            costCode: '00-100',
            description: 'Autonomous job budget control',
            category: 'general',
            budgetAmount,
            notes: 'Autonomous budget draft. Approve or split into cost codes before finance reporting.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, budgetLineId: budgetLine.id, status: 'drafted' });
          this.audit({ entityType: 'budget_line', entityId: budgetLine.id, jobId: action.jobId, action: 'autonomous_create_budget_line', actor, after: budgetLine });
        }

        const purchaseOrders = preview.filter(action => action.type === 'create_purchase_order').slice(0, 3);
        for (const action of purchaseOrders) {
          const procurement = this.db.prepare('SELECT * FROM procurement_orders WHERE id = ?').get(action.procurementOrderId);
          const purchaseOrder = this.createPurchaseOrder(action.jobId, {
            status: 'draft',
            supplier: procurement?.supplier || null,
            amount: normalizeNumber(procurement?.amount, normalizeNumber(action.suggestedAmount, 0)),
            requiredBy: procurement?.required_by || null,
            items: fromJson(procurement?.items_json, []),
            procurementOrderId: procurement?.id || action.procurementOrderId,
            notes: 'Autonomous purchase order draft from approved procurement. Robert must approve before supplier commitment.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, purchaseOrderId: purchaseOrder.id, approvalId: purchaseOrder.approvalId || purchaseOrder.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'purchase_order', entityId: purchaseOrder.id, jobId: action.jobId, action: 'autonomous_create_purchase_order', actor, after: purchaseOrder });
        }

        const invoiceDrafts = preview.filter(action => action.type === 'draft_invoice').slice(0, 3);
        for (const action of invoiceDrafts) {
          const amount = normalizeNumber(action.suggestedAmount, 0);
          const total = normalizeNumber(action.suggestedTotal, amount > 0 ? amount * 1.21 : 0);
          const invoice = this.createInvoice(action.jobId, {
            quoteId: action.quoteId || null,
            amount,
            taxAmount: Math.max(0, total - amount),
            total,
            dueAt: futureIsoDate(14),
            peppolReady: true,
            notes: 'Autonomous invoice draft from completed work. Approval required before issuing, sending, or Peppol/UBL submission.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, invoiceId: invoice.id, approvalId: invoice.approvalId || invoice.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'invoice', entityId: invoice.id, jobId: action.jobId, action: 'autonomous_draft_invoice', actor, after: invoice });
        }

        const drawRequests = preview.filter(action => action.type === 'create_draw_request').slice(0, 3);
        for (const action of drawRequests) {
          const drawRequest = this.createDrawRequest(action.jobId, {
            invoiceId: action.invoiceId,
            status: 'draft',
            requestedAmount: normalizeNumber(action.suggestedAmount, 0),
            notes: 'Autonomous draw request draft for finance review. Approval required before submission or funding reliance.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, drawRequestId: drawRequest.id, approvalId: drawRequest.approvalId || drawRequest.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'draw_request', entityId: drawRequest.id, jobId: action.jobId, action: 'autonomous_create_draw_request', actor, after: drawRequest });
        }

        const lienWaivers = preview.filter(action => action.type === 'request_lien_waiver').slice(0, 3);
        for (const action of lienWaivers) {
          const lienWaiver = this.createLienWaiver(action.jobId, {
            paymentId: action.paymentId,
            status: 'requested',
            amount: normalizeNumber(action.suggestedAmount, 0),
            notes: 'Autonomous lien-waiver request draft before payment release.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, lienWaiverId: lienWaiver.id, approvalId: lienWaiver.approvalId || lienWaiver.approval?.id || null, status: 'requested' });
          this.audit({ entityType: 'lien_waiver', entityId: lienWaiver.id, jobId: action.jobId, action: 'autonomous_request_lien_waiver', actor, after: lienWaiver });
        }

        const financeHandoffs = preview.filter(action => action.type === 'create_finance_handoff').slice(0, 3);
        for (const action of financeHandoffs) {
          const handoff = this.createFinanceHandoff(action.jobId, {
            status: 'draft',
            packageType: 'job_finance',
            targetSystem: 'FAB',
            notes: 'Autonomous finance handoff draft. Robert must approve before export or external sharing.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, financeHandoffId: handoff.id, status: 'drafted' });
          this.audit({ entityType: 'finance_handoff', entityId: handoff.id, jobId: action.jobId, action: 'autonomous_create_finance_handoff', actor, after: handoff });
        }

        const punchItems = preview.filter(action => action.type === 'create_punch_item').slice(0, 3);
        for (const action of punchItems) {
          const quality = this.db.prepare('SELECT * FROM quality_checks WHERE id = ?').get(action.qualityCheckId);
          const punchItem = this.createPunchItem(action.jobId, {
            status: 'open',
            title: quality ? `Resolve defects from ${quality.title}` : 'Resolve quality defect',
            severity: action.severity === 'high' ? 'high' : 'medium',
            assignee: 'Project team',
            description: 'Autonomous punch item from failed or defect-bearing quality check.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, punchItemId: punchItem.id, status: 'opened' });
          this.audit({ entityType: 'punch_item', entityId: punchItem.id, jobId: action.jobId, action: 'autonomous_create_punch_item', actor, after: punchItem });
        }

        const warrantyClaims = preview.filter(action => action.type === 'open_warranty_claim').slice(0, 3);
        for (const action of warrantyClaims) {
          const aftercare = this.db.prepare('SELECT * FROM aftercare_items WHERE id = ?').get(action.aftercareId);
          const warrantyClaim = this.createWarrantyClaim(action.jobId, {
            status: 'open',
            title: aftercare ? `Warranty review: ${aftercare.title}` : 'Warranty review',
            severity: 'medium',
            issue: aftercare?.notes || 'Autonomous warranty review from aftercare record.',
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, warrantyClaimId: warrantyClaim.id, status: 'opened' });
          this.audit({ entityType: 'warranty_claim', entityId: warrantyClaim.id, jobId: action.jobId, action: 'autonomous_open_warranty_claim', actor, after: warrantyClaim });
        }

        const materials = preview.filter(action => action.type === 'create_procurement_order').slice(0, 3);
        for (const action of materials) {
          const material = this.db.prepare('SELECT * FROM material_requirements WHERE id = ?').get(action.materialRequirementId);
          const procurement = this.createProcurementOrder(action.jobId, {
            status: 'draft',
            supplier: material?.supplier || null,
            items: material ? [{
              materialRequirementId: material.id,
              name: material.name,
              quantity: normalizeNumber(material.quantity, 1),
              unit: material.unit,
              supplier: material.supplier,
              cost: normalizeNumber(material.cost, 0)
            }] : [],
            notes: 'Autonomous procurement draft. Robert must approve before any supplier commitment.'
          }, { actor, audit: false });
          applied.push({ ...action, procurementOrderId: procurement.id, approvalId: procurement.approvalId || procurement.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'procurement_order', entityId: procurement.id, jobId: action.jobId, action: 'autonomous_create_procurement_order', actor, after: procurement });
        }

        const routePlans = preview.filter(action => action.type === 'create_route_plan').slice(0, 3);
        for (const action of routePlans) {
          const routePlan = this.createRoutePlan(action.jobId, {
            status: 'draft',
            notes: 'Autonomous draft route. Confirm live route, access, and parking before crew dispatch.'
          }, { actor, audit: false });
          applied.push({ ...action, routePlanId: routePlan.id, status: 'drafted' });
          this.audit({ entityType: 'route_plan', entityId: routePlan.id, jobId: action.jobId, action: 'autonomous_create_route_plan', actor, after: routePlan });
        }

        const loadingPlans = preview.filter(action => action.type === 'create_loading_plan').slice(0, 3);
        for (const action of loadingPlans) {
          const loadingPlan = this.createLoadingPlan(action.jobId, {
            status: 'draft',
            notes: 'Autonomous loading draft based on current tools and material needs.'
          }, { actor, audit: false });
          applied.push({ ...action, loadingPlanId: loadingPlan.id, status: 'drafted' });
          this.audit({ entityType: 'loading_plan', entityId: loadingPlan.id, jobId: action.jobId, action: 'autonomous_create_loading_plan', actor, after: loadingPlan });
        }

        const instructionDrafts = preview.filter(action => action.type === 'draft_worker_instruction').slice(0, 3);
        for (const action of instructionDrafts) {
          const instruction = this.createWorkerInstruction(action.jobId, {
            assignmentId: action.assignmentId,
            status: 'draft',
            title: 'Crew dispatch instructions',
            notes: 'Autonomous crew instruction draft.'
          }, { actor, audit: false });
          applied.push({ ...action, workerInstructionId: instruction.id, status: 'drafted' });
          this.audit({ entityType: 'worker_instruction', entityId: instruction.id, jobId: action.jobId, action: 'autonomous_draft_worker_instruction', actor, after: instruction });
        }

        const qualityGaps = preview.filter(action => action.type === 'create_quality_check').slice(0, 3);
        for (const action of qualityGaps) {
          const quality = this.addQualityCheck(action.jobId, {
            title: `Autonomous final quality review for ${action.message.replace(/ is complete.*/, '')}`,
            status: 'pending_review',
            result: 'pending',
            notes: 'Generated because the job was completed without a final quality record.'
          }, { actor, audit: false });
          applied.push({ ...action, qualityCheckId: quality.id, status: 'created' });
          this.audit({ entityType: 'quality_check', entityId: quality.id, jobId: action.jobId, action: 'autonomous_create_quality_check', actor, after: quality });
        }

        const paymentFollowUps = preview.filter(action => action.type === 'payment_follow_up').slice(0, 2);
        for (const action of paymentFollowUps) {
          const communication = this.addCommunication(action.jobId, {
            channel: 'portal',
            direction: 'outbound',
            subject: 'Payment follow-up draft',
            body: `${action.message} Draft a polite payment follow-up for Robert to approve before sending.`,
            status: 'draft',
            requiresApproval: true
          }, { actor, audit: false });
          applied.push({ ...action, communicationId: communication.id, approvalId: communication.approvalId || communication.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'communication', entityId: communication.id, jobId: action.jobId, action: 'autonomous_draft_payment_followup', actor, after: communication });
        }

        const clientReplyFollowUps = preview.filter(action => action.type === 'client_reply_follow_up').slice(0, 3);
        for (const action of clientReplyFollowUps) {
          const original = this.db.prepare('SELECT * FROM communication_records WHERE id = ?').get(action.communicationId);
          const subject = original?.subject || 'client confirmation';
          const communication = this.addCommunication(action.jobId, {
            channel: original?.channel || 'portal',
            direction: 'outbound',
            subject: `Follow-up: ${subject}`,
            body: [
              `Hi, just checking whether you can confirm: ${subject}.`,
              'Contractor.AI flagged this as overdue so Robert can review this follow-up before anything is sent.',
              original?.body ? `Original message: ${original.body}` : null
            ].filter(Boolean).join('\n\n'),
            status: 'draft',
            requiresApproval: true,
            followUpFor: action.communicationId,
            followUpSource: 'client_reply_monitor',
            data: {
              followUpFor: action.communicationId,
              followUpSource: 'client_reply_monitor',
              originalSubject: subject,
              originalSentAt: original?.sent_at || original?.created_at || null,
              replyBy: action.replyBy || null
            }
          }, { actor, audit: false });
          applied.push({ ...action, followUpCommunicationId: communication.id, approvalId: communication.approvalId || communication.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'communication', entityId: communication.id, jobId: action.jobId, action: 'autonomous_draft_client_reply_followup', actor, after: communication });
        }

        const permitRenewals = preview.filter(action => action.type === 'renew_permit').slice(0, 3);
        for (const action of permitRenewals) {
          const permit = this.db.prepare('SELECT * FROM permit_records WHERE id = ?').get(action.permitId);
          const task = this.addTask(action.jobId, {
            title: permit ? `Renew permit: ${permit.title}` : 'Renew expiring permit',
            description: `${action.message} Confirm authority, documents, expiry date, and field reliance before updating permit status.`,
            priority: action.severity === 'high' ? 'high' : 'medium',
            dueAt: permit?.expires_at || futureIsoDate(2),
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, taskId: task.id, status: 'task_created' });
          this.audit({ entityType: 'task', entityId: task.id, jobId: action.jobId, action: 'autonomous_create_permit_renewal_task', actor, after: task });
        }

        const observationReviews = preview.filter(action => action.type === 'resolve_observation').slice(0, 3);
        for (const action of observationReviews) {
          const observation = this.db.prepare('SELECT * FROM observation_records WHERE id = ?').get(action.observationId);
          const task = this.addTask(action.jobId, {
            title: observation ? `Correct observation: ${observation.title}` : 'Correct open observation',
            description: `${action.message} Record corrective action, photos, responsible person, and approval before closure.`,
            priority: action.severity === 'high' ? 'high' : 'medium',
            dueAt: observation?.due_at || futureIsoDate(1),
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, taskId: task.id, status: 'task_created' });
          this.audit({ entityType: 'task', entityId: task.id, jobId: action.jobId, action: 'autonomous_create_observation_followup_task', actor, after: task });
        }

        const incidentReviews = preview.filter(action => action.type === 'review_incident').slice(0, 3);
        for (const action of incidentReviews) {
          const incident = this.db.prepare('SELECT * FROM incident_records WHERE id = ?').get(action.incidentId);
          const task = this.addTask(action.jobId, {
            title: incident ? `Review incident: ${incident.title}` : 'Review open incident',
            description: `${action.message} Confirm immediate action, witnesses, client impact, reporting needs, and approval before closure.`,
            priority: action.severity === 'high' ? 'high' : 'medium',
            dueAt: futureIsoDate(1),
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, taskId: task.id, status: 'task_created' });
          this.audit({ entityType: 'task', entityId: task.id, jobId: action.jobId, action: 'autonomous_create_incident_review_task', actor, after: task });
        }

        const safetyReviews = preview.filter(action => action.type === 'safety_review').slice(0, 3);
        for (const action of safetyReviews) {
          const safety = this.db.prepare('SELECT * FROM safety_checks WHERE id = ?').get(action.safetyCheckId);
          const task = this.addTask(action.jobId, {
            title: safety ? `Review safety check: ${safety.title}` : 'Review safety check',
            description: `${action.message} Confirm hazards, controls, VCA evidence, stop-work status, and approval before relying on this record.`,
            priority: action.severity === 'high' ? 'high' : 'medium',
            dueAt: safety?.due_at || futureIsoDate(1),
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          applied.push({ ...action, taskId: task.id, status: 'task_created' });
          this.audit({ entityType: 'task', entityId: task.id, jobId: action.jobId, action: 'autonomous_create_safety_review_task', actor, after: task });
        }

        const aftercareFollowUps = preview.filter(action => action.type === 'aftercare_follow_up').slice(0, 3);
        for (const action of aftercareFollowUps) {
          const aftercare = this.db.prepare('SELECT * FROM aftercare_items WHERE id = ?').get(action.aftercareId);
          const communication = this.addCommunication(action.jobId, {
            channel: 'portal',
            direction: 'outbound',
            subject: aftercare ? `Aftercare follow-up: ${aftercare.title}` : 'Aftercare follow-up draft',
            body: `${action.message} Draft a concise aftercare check-in for Robert to review before sending.`,
            status: 'draft',
            requiresApproval: true,
            followUpSource: 'aftercare_monitor',
            data: {
              aftercareId: action.aftercareId || null
            }
          }, { actor, audit: false });
          applied.push({ ...action, communicationId: communication.id, approvalId: communication.approvalId || communication.approval?.id || null, status: 'drafted' });
          this.audit({ entityType: 'communication', entityId: communication.id, jobId: action.jobId, action: 'autonomous_draft_aftercare_followup', actor, after: communication });
        }

        const recurringDue = preview.filter(action => action.type === 'recurring_job_due').slice(0, 3);
        for (const action of recurringDue) {
          const plan = this.db.prepare('SELECT * FROM recurring_plans WHERE id = ?').get(action.recurringPlanId);
          const preparedJob = this.prepareRecurringServiceJob(action.recurringPlanId, {
            title: plan ? `Recurring service: ${plan.service}` : 'Recurring service follow-up',
            service: plan?.service || null,
            targetCompletion: plan?.next_due_at || futureIsoDate(7),
            description: `${action.message} Internal follow-up job prepared from recurring plan. Confirm client availability, scope, crew, tools, weather, and price before booking or sending updates.`,
            priority: action.severity === 'high' ? 'high' : 'medium'
          }, { actor });
          const task = this.addTask(action.jobId, {
            title: plan ? `Prepare recurring service: ${plan.service}` : 'Prepare recurring service',
            description: `${action.message} Confirm scope, weather, access, client availability, crew, tools, and quote/invoice assumptions before booking.`,
            priority: action.severity === 'high' ? 'high' : 'medium',
            dueAt: plan?.next_due_at || futureIsoDate(2),
            source: 'autonomous_cycle'
          }, { actor, audit: false });
          const communication = this.addCommunication(action.jobId, {
            channel: 'portal',
            direction: 'outbound',
            subject: plan ? `Recurring service check: ${plan.service}` : 'Recurring service check',
            body: `${action.message} Draft a client confirmation message for Robert to approve before sending.`,
            status: 'draft',
            requiresApproval: true,
            expectsReply: true,
            replyBy: futureIsoDate(3),
            followUpSource: 'recurring_plan_monitor',
            data: {
              recurringPlanId: action.recurringPlanId || null
            }
          }, { actor, audit: false });
          applied.push({
            ...action,
            recurringJobId: preparedJob?.recurringJob?.id || null,
            nextDueAt: preparedJob?.nextDueAt || null,
            taskId: task.id,
            communicationId: communication.id,
            approvalId: communication.approvalId || communication.approval?.id || null,
            status: 'prepared'
          });
          if (preparedJob?.recurringJob?.id) {
            this.audit({ entityType: 'job', entityId: preparedJob.recurringJob.id, jobId: preparedJob.recurringJob.id, action: 'autonomous_prepare_recurring_service_job', actor, after: { recurringPlanId: action.recurringPlanId, sourceJobId: action.jobId, nextDueAt: preparedJob.nextDueAt } });
          }
          this.audit({ entityType: 'task', entityId: task.id, jobId: action.jobId, action: 'autonomous_create_recurring_service_task', actor, after: task });
          this.audit({ entityType: 'communication', entityId: communication.id, jobId: action.jobId, action: 'autonomous_draft_recurring_service_confirmation', actor, after: communication });
        }

        const learningRefreshes = preview.filter(action => action.type === 'refresh_learning_profile').slice(0, 3);
        for (const action of learningRefreshes) {
          try {
            const profile = this.rebuildLearningProfile(action.jobType, { actor, audit: false });
            applied.push({
              ...action,
              status: 'refreshed',
              confidence: profile.confidence,
              sampleCount: profile.sampleCount
            });
            this.audit({
              entityType: 'job_learning_profile',
              entityId: profile.jobType,
              action: 'autonomous_refresh_learning_profile',
              actor,
              after: profile
            });
          } catch (error) {
            blocked.push({ ...action, status: 'blocked', reason: error.message });
          }
        }

        if (!actionTypeFilter.size || actionTypeFilter.has('create_weather_check')) {
          const activeJobs = this.db.prepare("SELECT * FROM jobs WHERE status IN ('planned', 'scheduled', 'in_progress') ORDER BY updated_at DESC LIMIT 5").all();
          for (const job of activeJobs) {
            if (jobFilter.size && !jobFilter.has(job.id)) continue;
            const hasWeather = this.db.prepare('SELECT id FROM schedule_weather WHERE job_id = ? LIMIT 1').get(job.id);
            if (!hasWeather) {
              const weatherId = makeId('weather');
              this.db.prepare(`
                INSERT INTO schedule_weather (id, job_id, location, forecast_at, condition, precipitation_percent, recommendation, data_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                weatherId,
                job.id,
                job.city || job.region || job.address || 'Netherlands',
                job.scheduled_start || nowIso(),
                'planning_required',
                20,
                'Confirm weather and access before field start.',
                toJson({ source: 'autonomous_cycle' }),
                nowIso()
              );
              applied.push({ type: 'create_weather_check', jobId: job.id, weatherId, status: 'created' });
            }
          }
        }
      });
    }

    return {
      success: true,
      dryRun,
      ranAt: nowIso(),
      preview,
      applied,
      blocked,
      summary: {
        previewed: preview.length,
        applied: applied.length,
        blocked: blocked.length,
        externalCommitments: 0
      },
      approvalsStillRequired: this.listApprovals({ status: 'pending', limit: 25 }),
      dashboard: this.dashboardSummary()
    };
  }

  diagnose() {
    const issues = [];
    let auditIntegrity;
    try {
      auditIntegrity = this.verifyAuditIntegrity();
    } catch (error) {
      auditIntegrity = {
        valid: false,
        status: 'verification_unavailable',
        format: AUDIT_CHAIN_FORMAT,
        algorithm: AUDIT_CHAIN_ALGORITHM,
        eventCount: this.count('audit_events'),
        headEventId: null,
        headHash: null,
        checkedAt: nowIso(),
        failures: [{ code: error.code || 'audit_integrity_verification_failed' }]
      };
    }
    if (!auditIntegrity.valid) {
      issues.push({ severity: 'error', message: `Audit integrity verification failed with ${auditIntegrity.failures.length} retained issue(s).` });
    }
    const orphanTasks = Number(this.db.prepare('SELECT COUNT(*) AS count FROM job_tasks LEFT JOIN jobs ON jobs.id = job_tasks.job_id WHERE jobs.id IS NULL').get().count || 0);
    if (orphanTasks) issues.push({ severity: 'error', message: `${orphanTasks} task(s) are orphaned.` });
    const jobsWithoutClient = Number(this.db.prepare('SELECT COUNT(*) AS count FROM jobs LEFT JOIN clients ON clients.id = jobs.client_id WHERE clients.id IS NULL').get().count || 0);
    if (jobsWithoutClient) issues.push({ severity: 'error', message: `${jobsWithoutClient} job(s) are missing clients.` });
    const quotesWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM quotes WHERE status = 'draft' AND approval_id IS NULL").get().count || 0);
    if (quotesWithoutApproval) issues.push({ severity: 'warning', message: `${quotesWithoutApproval} draft quote(s) have no approval gate.` });
    const siteVisitsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM site_visits WHERE status IN ('confirmed', 'client_confirmed', 'committed', 'approved') AND approval_id IS NULL").get().count || 0);
    if (siteVisitsWithoutApproval) issues.push({ severity: 'warning', message: `${siteVisitsWithoutApproval} committed site visit(s) have no approval gate.` });
    const changeOrdersWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM change_orders WHERE status IN ('approved', 'accepted', 'committed', 'sent', 'submitted', 'issued') AND approval_id IS NULL").get().count || 0);
    if (changeOrdersWithoutApproval) issues.push({ severity: 'warning', message: `${changeOrdersWithoutApproval} committed change order(s) have no approval gate.` });
    const fieldReportsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM field_reports WHERE status IN ('submitted', 'published', 'client_visible', 'approved', 'sent') AND approval_id IS NULL").get().count || 0);
    if (fieldReportsWithoutApproval) issues.push({ severity: 'warning', message: `${fieldReportsWithoutApproval} submitted field report(s) have no approval gate.` });
    const rfisWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM rfi_records WHERE status IN ('answered', 'closed', 'resolved', 'issued', 'sent', 'approved') AND approval_id IS NULL").get().count || 0);
    if (rfisWithoutApproval) issues.push({ severity: 'warning', message: `${rfisWithoutApproval} closed RFI response(s) have no approval gate.` });
    const submittalsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM submittal_records WHERE status IN ('approved', 'accepted', 'issued', 'sent', 'closed', 'client_visible') AND approval_id IS NULL").get().count || 0);
    if (submittalsWithoutApproval) issues.push({ severity: 'warning', message: `${submittalsWithoutApproval} approved/issued submittal(s) have no approval gate.` });
    const selectionsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM client_selections WHERE status IN ('approved', 'accepted', 'client_confirmed', 'locked', 'selected', 'ordered') AND approval_id IS NULL").get().count || 0);
    if (selectionsWithoutApproval) issues.push({ severity: 'warning', message: `${selectionsWithoutApproval} locked client selection(s) have no approval gate.` });
    const permitsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM permit_records WHERE status IN ('active', 'approved', 'issued', 'submitted') AND approval_id IS NULL").get().count || 0);
    if (permitsWithoutApproval) issues.push({ severity: 'warning', message: `${permitsWithoutApproval} active permit/compliance record(s) have no approval gate.` });
    const inspectionsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM inspection_records WHERE status IN ('completed', 'passed', 'failed', 'approved', 'closed') AND approval_id IS NULL").get().count || 0);
    if (inspectionsWithoutApproval) issues.push({ severity: 'warning', message: `${inspectionsWithoutApproval} completed inspection record(s) have no approval gate.` });
    const observationsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM observation_records WHERE (severity IN ('high', 'critical') OR status IN ('closed', 'resolved', 'approved', 'client_visible')) AND approval_id IS NULL").get().count || 0);
    if (observationsWithoutApproval) issues.push({ severity: 'warning', message: `${observationsWithoutApproval} safety/quality observation(s) have no approval gate.` });
    const incidentsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM incident_records WHERE (severity IN ('high', 'critical') OR status IN ('closed', 'resolved', 'approved', 'reportable', 'escalated')) AND approval_id IS NULL").get().count || 0);
    if (incidentsWithoutApproval) issues.push({ severity: 'warning', message: `${incidentsWithoutApproval} incident record(s) have no approval gate.` });
    const safetyMeetingsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM safety_meetings WHERE status IN ('completed', 'approved', 'client_visible') AND approval_id IS NULL").get().count || 0);
    if (safetyMeetingsWithoutApproval) issues.push({ severity: 'warning', message: `${safetyMeetingsWithoutApproval} completed safety meeting(s) have no approval gate.` });
    const orientationsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM worker_orientations WHERE status IN ('completed', 'approved', 'cleared', 'valid') AND approval_id IS NULL").get().count || 0);
    if (orientationsWithoutApproval) issues.push({ severity: 'warning', message: `${orientationsWithoutApproval} completed worker orientation(s) have no approval gate.` });
    const jhasWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM jha_records WHERE (risk_level IN ('high', 'critical') OR status IN ('approved', 'issued', 'accepted', 'completed', 'signed_off', 'client_visible')) AND approval_id IS NULL").get().count || 0);
    if (jhasWithoutApproval) issues.push({ severity: 'warning', message: `${jhasWithoutApproval} JHA record(s) have no approval gate.` });
    const sdsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM sds_sheets WHERE status IN ('current', 'approved', 'accepted', 'active') AND approval_id IS NULL").get().count || 0);
    if (sdsWithoutApproval) issues.push({ severity: 'warning', message: `${sdsWithoutApproval} current SDS sheet(s) have no approval gate.` });
    const siteAccessWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM site_access_logs WHERE status IN ('checked_in', 'cleared', 'approved', 'granted') AND approval_id IS NULL").get().count || 0);
    if (siteAccessWithoutApproval) issues.push({ severity: 'warning', message: `${siteAccessWithoutApproval} site access clearance record(s) have no approval gate.` });
    const budgetLinesWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM budget_lines WHERE status IN ('approved', 'locked', 'baseline') AND approval_id IS NULL").get().count || 0);
    if (budgetLinesWithoutApproval) issues.push({ severity: 'warning', message: `${budgetLinesWithoutApproval} approved budget line(s) have no approval gate.` });
    const purchaseOrdersWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM purchase_orders WHERE status IN ('approved', 'ready_to_order', 'ordered', 'sent', 'submitted', 'issued') AND approval_id IS NULL").get().count || 0);
    if (purchaseOrdersWithoutApproval) issues.push({ severity: 'warning', message: `${purchaseOrdersWithoutApproval} purchase order commitment(s) have no approval gate.` });
    const drawRequestsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM draw_requests WHERE status IN ('submitted', 'approved', 'approved_for_funding', 'funded', 'sent') AND approval_id IS NULL").get().count || 0);
    if (drawRequestsWithoutApproval) issues.push({ severity: 'warning', message: `${drawRequestsWithoutApproval} draw/funding request(s) have no approval gate.` });
    const lienWaiversWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM lien_waivers WHERE status IN ('received', 'approved', 'released', 'waived') AND approval_id IS NULL").get().count || 0);
    if (lienWaiversWithoutApproval) issues.push({ severity: 'warning', message: `${lienWaiversWithoutApproval} lien waiver release record(s) have no approval gate.` });
    const financeHandoffsWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM finance_handoffs WHERE status IN ('ready', 'approved', 'submitted', 'sent', 'exported', 'ready_to_export') AND approval_id IS NULL").get().count || 0);
    if (financeHandoffsWithoutApproval) issues.push({ severity: 'warning', message: `${financeHandoffsWithoutApproval} finance handoff package(s) have no approval gate.` });
    const punchWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM punch_items WHERE status IN ('closed', 'resolved', 'accepted', 'verified', 'client_visible') AND approval_id IS NULL").get().count || 0);
    if (punchWithoutApproval) issues.push({ severity: 'warning', message: `${punchWithoutApproval} closed punch item(s) have no approval gate.` });
    const warrantyWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM warranty_claims WHERE status IN ('closed', 'resolved', 'accepted', 'rejected', 'client_visible') AND approval_id IS NULL").get().count || 0);
    if (warrantyWithoutApproval) issues.push({ severity: 'warning', message: `${warrantyWithoutApproval} warranty claim resolution(s) have no approval gate.` });
    const externalWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM communication_records WHERE direction = 'outbound' AND status = 'draft' AND approval_id IS NULL").get().count || 0);
    if (externalWithoutApproval) issues.push({ severity: 'warning', message: `${externalWithoutApproval} outbound communication draft(s) have no approval gate.` });
    const qualityWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM quality_checks WHERE status IN ('passed', 'approved') AND approval_id IS NULL").get().count || 0);
    if (qualityWithoutApproval) issues.push({ severity: 'warning', message: `${qualityWithoutApproval} quality sign-off record(s) have no approval gate.` });
    const safetyWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM safety_checks WHERE risk_level IN ('high', 'critical') AND approval_id IS NULL").get().count || 0);
    if (safetyWithoutApproval) issues.push({ severity: 'warning', message: `${safetyWithoutApproval} high-risk safety check(s) have no approval gate.` });
    const paymentWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM payments WHERE status IN ('paid', 'received', 'settled') AND approval_id IS NULL").get().count || 0);
    if (paymentWithoutApproval) issues.push({ severity: 'warning', message: `${paymentWithoutApproval} confirmed payment record(s) have no approval gate.` });
    const routeWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM route_plans WHERE route_risk IN ('high', 'critical') AND approval_id IS NULL").get().count || 0);
    if (routeWithoutApproval) issues.push({ severity: 'warning', message: `${routeWithoutApproval} high-risk route plan(s) have no approval gate.` });
    const procurementWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM procurement_orders WHERE amount > 0 AND status IN ('approved', 'ready_to_order', 'ordered', 'submitted', 'sent') AND approval_id IS NULL").get().count || 0);
    if (procurementWithoutApproval) issues.push({ severity: 'warning', message: `${procurementWithoutApproval} procurement commitment(s) have no approval gate.` });
    const committedSpendRecords = [
      ...this.db.prepare(`
        SELECT procurement_orders.* FROM procurement_orders
        JOIN jobs ON jobs.id = procurement_orders.job_id
        WHERE ${this.operationalJobStatusSql('jobs')}
          AND procurement_orders.status IN ('approved', 'ready_to_order', 'ordered', 'submitted', 'sent')
      `).all(),
      ...this.db.prepare(`
        SELECT purchase_orders.* FROM purchase_orders
        JOIN jobs ON jobs.id = purchase_orders.job_id
        WHERE ${this.operationalJobStatusSql('jobs')}
          AND purchase_orders.status IN ('approved', 'ready_to_order', 'ordered', 'submitted', 'sent', 'issued')
      `).all()
    ];
    const nonCompliantCommittedSpend = committedSpendRecords.filter(record => !this.tradePartnerReadinessForSpend(record).compliance.compliant).length;
    if (nonCompliantCommittedSpend) {
      issues.push({ severity: 'error', message: `${nonCompliantCommittedSpend} active purchasing commitment(s) lack a current compliant trade partner.` });
    }
    const instructionWithoutApproval = Number(this.db.prepare("SELECT COUNT(*) AS count FROM worker_instructions WHERE status IN ('approved', 'sent', 'published', 'dispatched') AND approval_id IS NULL").get().count || 0);
    if (instructionWithoutApproval) issues.push({ severity: 'warning', message: `${instructionWithoutApproval} published worker instruction(s) have no approval gate.` });
    return {
      valid: !issues.some(issue => issue.severity === 'error'),
      issueCount: issues.length,
      issues,
      migrations: this.migrationStatus(),
      auditIntegrity,
      counts: {
        clients: this.count('clients'),
        tradePartners: this.count('trade_partners'),
        jobs: this.count('jobs'),
        approvals: this.count('approvals'),
        siteVisits: this.count('site_visits'),
        changeOrders: this.count('change_orders'),
        fieldReports: this.count('field_reports'),
        rfiRecords: this.count('rfi_records'),
        submittals: this.count('submittal_records'),
        clientSelections: this.count('client_selections'),
        permitRecords: this.count('permit_records'),
        inspectionRecords: this.count('inspection_records'),
        observationRecords: this.count('observation_records'),
        incidentRecords: this.count('incident_records'),
        safetyMeetings: this.count('safety_meetings'),
        orientations: this.count('worker_orientations'),
        jhas: this.count('jha_records'),
        sdsSheets: this.count('sds_sheets'),
        siteAccessLogs: this.count('site_access_logs'),
        budgetLines: this.count('budget_lines'),
        purchaseOrders: this.count('purchase_orders'),
        drawRequests: this.count('draw_requests'),
        lienWaivers: this.count('lien_waivers'),
        financeHandoffs: this.count('finance_handoffs'),
        qualityChecks: this.count('quality_checks'),
        safetyChecks: this.count('safety_checks'),
        payments: this.count('payments'),
        aftercareItems: this.count('aftercare_items'),
        punchItems: this.count('punch_items'),
        warrantyClaims: this.count('warranty_claims'),
        recurringPlans: this.count('recurring_plans'),
        routePlans: this.count('route_plans'),
        loadingPlans: this.count('loading_plans'),
        procurementOrders: this.count('procurement_orders'),
        workerInstructions: this.count('worker_instructions'),
        communications: this.count('communication_records'),
        learningProfiles: this.count('job_learning_profiles'),
        auditEvents: this.count('audit_events')
      }
    };
  }

  mapClient(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      company: row.company,
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      country: row.country,
      vatNumber: row.vat_number,
      preferredLanguage: row.preferred_language,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapTradePartner(row) {
    if (!row) return null;
    const partner = {
      id: row.id,
      name: row.name,
      partnerType: row.partner_type,
      contactName: row.contact_name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      city: row.city,
      country: row.country,
      registrationNumber: row.registration_number,
      vatNumber: row.vat_number,
      status: row.status,
      insuranceExpiresAt: row.insurance_expires_at,
      vcaExpiresAt: row.vca_expires_at,
      specialties: fromJson(row.specialties_json, []),
      data: fromJson(row.data_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    return { ...partner, compliance: this.assessTradePartnerCompliance(partner) };
  }

  mapWorker(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      email: row.email,
      phone: row.phone,
      status: normalizeWorkerStatus(row.status, 'available'),
      homeRegion: row.home_region,
      hourlyRate: normalizeNumber(row.hourly_rate, 0),
      skills: fromJson(row.skills_json, []),
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapTool(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      status: row.status,
      homeLocation: row.home_location,
      currentLocation: row.current_location,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapJob(row) {
    return {
      id: row.id,
      requestId: row.request_id,
      clientId: row.client_id,
      clientName: row.client_name,
      clientEmail: row.client_email,
      clientPhone: row.client_phone,
      title: row.title,
      jobType: row.job_type,
      description: row.description,
      address: row.address,
      city: row.city,
      region: row.region,
      country: row.country,
      priority: row.priority,
      status: row.status,
      phase: row.phase,
      riskLevel: row.risk_level,
      estimatedHours: normalizeNumber(row.estimated_hours, 0),
      estimatedCost: normalizeNumber(row.estimated_cost, 0),
      contractValue: normalizeNumber(row.contract_value, 0),
      marginTargetPercent: normalizeNumber(row.margin_target_percent, 0),
      progressPercent: normalizeNumber(row.progress_percent, 0),
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      targetCompletion: row.target_completion,
      approvalState: row.approval_state,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapTask(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assignee_id,
      dueAt: row.due_at,
      completedAt: row.completed_at,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapQuote(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      currency: row.currency,
      subtotal: normalizeNumber(row.subtotal, 0),
      taxRate: normalizeNumber(row.tax_rate, 0),
      taxAmount: normalizeNumber(row.tax_amount, 0),
      total: normalizeNumber(row.total, 0),
      validUntil: row.valid_until,
      approvalId: row.approval_id,
      lineItems: fromJson(row.line_items_json, []),
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapLearningProfile(row) {
    if (!row) return null;
    return {
      jobType: row.job_type,
      sampleCount: normalizeNumber(row.sample_count, 0),
      completedCount: normalizeNumber(row.completed_count, 0),
      avgEstimatedHours: normalizeNumber(row.avg_estimated_hours, 0),
      avgActualHours: normalizeNumber(row.avg_actual_hours, 0),
      avgEstimatedCost: normalizeNumber(row.avg_estimated_cost, 0),
      avgActualCost: normalizeNumber(row.avg_actual_cost, 0),
      avgQuoteTotal: normalizeNumber(row.avg_quote_total, 0),
      avgInvoiceTotal: normalizeNumber(row.avg_invoice_total, 0),
      confidence: row.confidence || 'low',
      tasks: fromJson(row.tasks_json, []),
      tools: fromJson(row.tools_json, []),
      materials: fromJson(row.materials_json, []),
      quoteItems: fromJson(row.quote_items_json, []),
      workerSignals: fromJson(row.worker_signals_json, []),
      evidence: fromJson(row.evidence_json, {}),
      data: fromJson(row.data_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapSiteVisit(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      visitType: row.visit_type,
      status: row.status,
      scheduledAt: row.scheduled_at,
      completedAt: row.completed_at,
      assignee: row.assignee,
      findings: row.findings,
      checklist: fromJson(row.checklist_json, []),
      photos: fromJson(row.photos_json, []),
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapChangeOrder(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      quoteId: row.quote_id,
      title: row.title,
      status: row.status,
      scopeDelta: row.scope_delta,
      currency: row.currency,
      amount: normalizeNumber(row.amount, 0),
      taxRate: normalizeNumber(row.tax_rate, 0),
      taxAmount: normalizeNumber(row.tax_amount, 0),
      total: normalizeNumber(row.total, 0),
      scheduleDeltaDays: normalizeNumber(row.schedule_delta_days, 0),
      approvalId: row.approval_id,
      lineItems: fromJson(row.line_items_json, []),
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapFieldReport(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      reportDate: row.report_date,
      status: row.status,
      weather: row.weather,
      manpower: normalizeNumber(row.manpower, 0),
      workCompleted: row.work_completed,
      blockers: fromJson(row.blockers_json, []),
      photos: fromJson(row.photos_json, []),
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapRfi(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      title: row.title,
      status: row.status,
      question: row.question,
      response: row.response,
      responsible: row.responsible,
      dueAt: row.due_at,
      answeredAt: row.answered_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapSubmittal(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      title: row.title,
      packageName: row.package_name,
      status: row.status,
      responsible: row.responsible,
      reviewer: row.reviewer,
      dueAt: row.due_at,
      submittedAt: row.submitted_at,
      approvedAt: row.approved_at,
      approvalId: row.approval_id,
      attachments: fromJson(row.attachments_json, []),
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapClientSelection(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      title: row.title,
      category: row.category,
      status: row.status,
      clientName: row.client_name,
      currency: row.currency,
      value: normalizeNumber(row.value, 0),
      dueAt: row.due_at,
      decidedAt: row.decided_at,
      approvalId: row.approval_id,
      options: fromJson(row.options_json, []),
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapPermit(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      permitType: row.permit_type,
      title: row.title,
      status: row.status,
      holder: row.holder,
      location: row.location,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapInspection(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      inspectionType: row.inspection_type,
      title: row.title,
      status: row.status,
      result: row.result,
      inspector: row.inspector,
      scheduledAt: row.scheduled_at,
      completedAt: row.completed_at,
      defects: fromJson(row.defects_json, []),
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapObservation(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      category: row.category,
      title: row.title,
      status: row.status,
      severity: row.severity,
      responsible: row.responsible,
      dueAt: row.due_at,
      closedAt: row.closed_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapIncident(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      incidentType: row.incident_type,
      title: row.title,
      status: row.status,
      severity: row.severity,
      reportedBy: row.reported_by,
      occurredAt: row.occurred_at,
      resolvedAt: row.resolved_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapSafetyMeeting(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      meetingType: row.meeting_type,
      title: row.title,
      status: row.status,
      facilitator: row.facilitator,
      scheduledAt: row.scheduled_at,
      completedAt: row.completed_at,
      attendees: fromJson(row.attendees_json, []),
      topics: fromJson(row.topics_json, []),
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapWorkerOrientation(row) {
    const data = fromJson(row.data_json);
    return {
      id: row.id,
      jobId: row.job_id,
      assignmentId: data.assignmentId || null,
      workerId: data.workerId || null,
      workerName: row.worker_name,
      company: row.company,
      status: row.status,
      language: row.language,
      dueAt: row.due_at,
      completedAt: row.completed_at,
      approvalId: row.approval_id,
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapJha(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      title: row.title,
      status: row.status,
      riskLevel: row.risk_level,
      assignee: row.assignee,
      dueAt: row.due_at,
      approvedAt: row.approved_at,
      hazards: fromJson(row.hazards_json, []),
      controls: fromJson(row.controls_json, []),
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapSdsSheet(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      material: row.material,
      supplier: row.supplier,
      status: row.status,
      expiresAt: row.expires_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapSiteAccessLog(row) {
    const data = fromJson(row.data_json);
    return {
      id: row.id,
      jobId: row.job_id,
      orientationId: row.orientation_id,
      assignmentId: data.assignmentId || null,
      workerId: data.workerId || null,
      workerName: row.worker_name,
      company: row.company,
      status: row.status,
      orientationValid: normalizeBoolean(row.orientation_valid, false),
      checkedInAt: row.checked_in_at,
      checkedOutAt: row.checked_out_at,
      approvalId: row.approval_id,
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapAssignment(row) {
    const data = fromJson(row.data_json);
    return {
      id: row.id,
      jobId: row.job_id,
      workerId: row.worker_id,
      workerName: row.worker_name || data.workerName || null,
      role: row.role,
      status: row.status,
      scheduledStart: row.scheduled_start,
      scheduledEnd: row.scheduled_end,
      allocationHours: normalizeNumber(row.allocation_hours, 0),
      approvalId: data.approvalId || null,
      conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
      requiresApproval: normalizeBoolean(data.requiresApproval, false),
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapToolReservation(row) {
    const data = fromJson(row.data_json);
    return {
      id: row.id,
      jobId: row.job_id,
      toolId: row.tool_id,
      toolName: row.tool_name,
      status: row.status,
      neededFrom: row.needed_from,
      neededUntil: row.needed_until,
      approvalId: data.approvalId || null,
      conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
      requiresApproval: normalizeBoolean(data.requiresApproval, false),
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapMaterialRequirement(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      materialId: row.material_id,
      name: row.name,
      quantity: normalizeNumber(row.quantity, 0),
      unit: row.unit,
      status: row.status,
      supplier: row.supplier,
      cost: normalizeNumber(row.cost, 0),
      neededBy: row.needed_by,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapRoutePlan(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      origin: row.origin,
      destination: row.destination,
      waypoints: fromJson(row.waypoints_json, []),
      distanceKm: normalizeNumber(row.distance_km, 0),
      durationMinutes: normalizeNumber(row.duration_minutes, 0),
      routeRisk: row.route_risk,
      status: row.status,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapLoadingPlan(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      vehicle: row.vehicle,
      trailerRequired: normalizeBoolean(row.trailer_required, false),
      checklist: fromJson(row.checklist_json, []),
      loadItems: fromJson(row.load_items_json, []),
      status: row.status,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapProcurementOrder(row) {
    const data = fromJson(row.data_json);
    return {
      id: row.id,
      jobId: row.job_id,
      supplier: row.supplier,
      status: row.status,
      currency: row.currency,
      amount: normalizeNumber(row.amount, 0),
      requiredBy: row.required_by,
      approvalId: row.approval_id,
      items: fromJson(row.items_json, []),
      tradePartnerId: data.tradePartnerId || null,
      partnerComplianceSnapshot: data.partnerComplianceSnapshot || null,
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapWorkerInstruction(row) {
    const data = fromJson(row.data_json);
    return {
      id: row.id,
      jobId: row.job_id,
      assignmentId: row.assignment_id,
      workerId: data.workerId || null,
      workerName: data.workerName || null,
      audience: row.audience,
      channel: row.channel,
      title: row.title,
      body: row.body,
      status: row.status,
      approvalId: row.approval_id,
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapDocument(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      type: row.type,
      title: row.title,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: normalizeNumber(row.size_bytes, 0),
      storageRef: row.storage_ref,
      status: row.status,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapProgress(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      status: row.status,
      progressPercent: normalizeNumber(row.progress_percent, 0),
      note: row.note,
      weather: row.weather,
      blockers: fromJson(row.blockers_json, []),
      photos: fromJson(row.photos_json, []),
      createdBy: row.created_by,
      data: fromJson(row.data_json),
      createdAt: row.created_at
    };
  }

  mapCommunication(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      clientId: row.client_id,
      channel: row.channel,
      direction: row.direction,
      subject: row.subject,
      body: row.body,
      status: row.status,
      approvalId: row.approval_id,
      sentAt: row.sent_at,
      data: fromJson(row.data_json),
      jobTitle: row.job_title,
      jobStatus: row.job_status,
      clientName: row.client_name,
      clientEmail: row.client_email,
      clientPhone: row.client_phone,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapTimeLog(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      workerId: row.worker_id,
      workDate: row.work_date,
      hours: normalizeNumber(row.hours, 0),
      billable: Boolean(row.billable),
      rate: normalizeNumber(row.rate, 0),
      status: row.status,
      approvalId: row.approval_id,
      notes: row.notes,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapExpense(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      category: row.category,
      amount: normalizeNumber(row.amount, 0),
      currency: row.currency,
      vendor: row.vendor,
      receiptRef: row.receipt_ref,
      status: row.status,
      approvalId: row.approval_id,
      notes: row.notes,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapInvoice(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      quoteId: row.quote_id,
      status: row.status,
      currency: row.currency,
      amount: normalizeNumber(row.amount, 0),
      taxAmount: normalizeNumber(row.tax_amount, 0),
      total: normalizeNumber(row.total, 0),
      dueAt: row.due_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapQualityCheck(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      checkType: row.check_type,
      title: row.title,
      status: row.status,
      result: row.result,
      inspector: row.inspector,
      checkedAt: row.checked_at,
      defects: fromJson(row.defects_json, []),
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapSafetyCheck(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      checkType: row.check_type,
      title: row.title,
      status: row.status,
      riskLevel: row.risk_level,
      assignee: row.assignee,
      dueAt: row.due_at,
      completedAt: row.completed_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapPayment(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      invoiceId: row.invoice_id,
      status: row.status,
      currency: row.currency,
      amount: normalizeNumber(row.amount, 0),
      dueAt: row.due_at,
      paidAt: row.paid_at,
      method: row.method,
      reference: row.reference,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapBudgetLine(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      costCode: row.cost_code,
      description: row.description,
      category: row.category,
      status: row.status,
      currency: row.currency,
      budgetAmount: normalizeNumber(row.budget_amount, 0),
      committedAmount: normalizeNumber(row.committed_amount, 0),
      actualAmount: normalizeNumber(row.actual_amount, 0),
      forecastAmount: normalizeNumber(row.forecast_amount, 0),
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapPurchaseOrder(row) {
    const data = fromJson(row.data_json);
    return {
      id: row.id,
      jobId: row.job_id,
      budgetLineId: row.budget_line_id,
      supplier: row.supplier,
      status: row.status,
      currency: row.currency,
      amount: normalizeNumber(row.amount, 0),
      requiredBy: row.required_by,
      approvalId: row.approval_id,
      items: fromJson(row.items_json, []),
      tradePartnerId: data.tradePartnerId || null,
      partnerComplianceSnapshot: data.partnerComplianceSnapshot || null,
      data,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapDrawRequest(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      invoiceId: row.invoice_id,
      title: row.title,
      status: row.status,
      currency: row.currency,
      requestedAmount: normalizeNumber(row.requested_amount, 0),
      approvedAmount: normalizeNumber(row.approved_amount, 0),
      dueAt: row.due_at,
      fundedAt: row.funded_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapLienWaiver(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      paymentId: row.payment_id,
      supplier: row.supplier,
      waiverType: row.waiver_type,
      status: row.status,
      currency: row.currency,
      amount: normalizeNumber(row.amount, 0),
      dueAt: row.due_at,
      receivedAt: row.received_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapFinanceHandoff(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      targetSystem: row.target_system,
      packageType: row.package_type,
      status: row.status,
      currency: row.currency,
      amount: normalizeNumber(row.amount, 0),
      approvalId: row.approval_id,
      package: fromJson(row.payload_json),
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapAftercareItem(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      type: row.type,
      title: row.title,
      status: row.status,
      owner: row.owner,
      dueAt: row.due_at,
      completedAt: row.completed_at,
      notes: row.notes,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapPunchItem(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      title: row.title,
      status: row.status,
      severity: row.severity,
      assignee: row.assignee,
      dueAt: row.due_at,
      closedAt: row.closed_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapWarrantyClaim(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      title: row.title,
      status: row.status,
      clientName: row.client_name,
      severity: row.severity,
      dueAt: row.due_at,
      resolvedAt: row.resolved_at,
      approvalId: row.approval_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapRecurringPlan(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      clientId: row.client_id,
      service: row.service,
      status: row.status,
      intervalRule: row.interval_rule,
      nextDueAt: row.next_due_at,
      lastCreatedJobId: row.last_created_job_id,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  approvalDecisionSummary(approval = {}) {
    const targetType = normalizeStatus(approval.targetType || approval.target_type, 'record');
    const approvalType = normalizeStatus(approval.approvalType || approval.approval_type, 'approval');
    const data = approval.data || fromJson(approval.data_json);
    const effects = [];
    const safeguards = [];
    const preview = {};
    let riskLevel = 'medium';
    let primaryEffect = approval.summary || `Review ${approvalType}.`;

    const addEffect = value => {
      if (value) effects.push(value);
    };
    const addSafeguard = value => {
      if (value) safeguards.push(value);
    };

    if (targetType === 'schedule_commitment') {
      const patch = data.patch || {};
      const assignment = data.proposedAssignment || null;
      primaryEffect = `Approve internal schedule ${patch.scheduledStart || 'start'} to ${patch.scheduledEnd || 'end'}.`;
      addEffect(`Set job status/phase to scheduled for ${patch.scheduledStart || 'the proposed start'} through ${patch.scheduledEnd || 'the proposed end'}.`);
      if (assignment?.workerName || assignment?.workerId) {
        addEffect(`Create a planned internal assignment for ${assignment.workerName || assignment.workerId}.`);
      }
      if (Array.isArray(data.blockers) && data.blockers.length) {
        riskLevel = data.blockers.some(blocker => ['high', 'critical'].includes(normalizeStatus(blocker.severity, 'medium'))) ? 'high' : 'medium';
        preview.blockers = data.blockers.slice(0, 6);
      } else {
        riskLevel = 'low';
      }
      if (Array.isArray(data.warnings) && data.warnings.length) preview.warnings = data.warnings.slice(0, 6);
      addSafeguard('Does not send client messages, publish crew instructions, order materials, clear site access, or approve safety evidence.');
    } else if (targetType === 'communication') {
      const message = this.db.prepare('SELECT * FROM communication_records WHERE id = ?').get(approval.targetId || approval.target_id);
      const mapped = message ? this.mapCommunication(message) : null;
      primaryEffect = `Approve ${mapped?.channel || data.channel || 'message'} draft: ${mapped?.subject || data.subject || approval.summary || 'client update'}.`;
      addEffect('Mark the outbound communication draft as approved.');
      addSafeguard('Does not send the message automatically; sending remains a separate explicit action.');
      riskLevel = 'high';
      preview.subject = mapped?.subject || data.subject || null;
      preview.channel = mapped?.channel || data.channel || null;
      preview.body = mapped?.body || null;
      preview.recipient = mapped?.data?.recipient || data.recipient || null;
    } else if (targetType === 'job_archive') {
      primaryEffect = `Archive ${data.jobTitle || approval.jobTitle || 'this job'} from active operating workflows.`;
      addEffect(`Set job status and phase to archived from ${data.previousStatus || 'its retained state'}.`);
      addEffect('Remove the job from active queues, schedules, conflict checks, command plans, and operating rollups.');
      const activePortalAccessCount = Number(data.activePortalAccessCount || 0);
      if (activePortalAccessCount > 0) {
        addEffect(`Revoke ${activePortalAccessCount} active client portal link${activePortalAccessCount === 1 ? '' : 's'} so archived work cannot receive client activity.`);
      }
      addSafeguard('Does not delete the job or any linked evidence, finance, client, field, resource, or audit record.');
      addSafeguard('Does not cancel work externally, contact anyone, place an order, make a payment, or create a schedule commitment. Restore requires a separate approval.');
      addSafeguard('Client portal links are not reactivated by restore; a new scoped link requires a separate approval.');
      riskLevel = 'high';
      preview.reason = data.reason || approval.reason || null;
      preview.previousStatus = data.previousStatus || null;
      preview.previousPhase = data.previousPhase || null;
      preview.activePortalAccessCount = activePortalAccessCount;
      preview.requestedAt = data.requestedAt || null;
    } else if (targetType === 'job_restore') {
      primaryEffect = `Restore ${data.jobTitle || approval.jobTitle || 'this job'} to ${data.restoreStatus || 'its retained pre-archive state'}.`;
      addEffect(`Return the job to ${data.restoreStatus || 'its retained status'} / ${data.restorePhase || 'its retained phase'} and make it available to the applicable internal workflows.`);
      addSafeguard('Does not send external communication, confirm a schedule, clear safety controls, order materials, or create a financial commitment.');
      addSafeguard('The archive history remains retained, and current schedule, resource, safety, and approval checks still apply after restore.');
      riskLevel = 'high';
      preview.reason = data.reason || approval.reason || null;
      preview.restoreStatus = data.restoreStatus || null;
      preview.restorePhase = data.restorePhase || null;
      preview.archivedAt = data.archivedAt || null;
      preview.requestedAt = data.requestedAt || null;
    } else if (targetType === 'client_selection_response') {
      const selection = data.selectionId
        ? this.db.prepare('SELECT * FROM client_selections WHERE id = ?').get(data.selectionId)
        : null;
      const mapped = selection ? this.mapClientSelection(selection) : null;
      primaryEffect = data.decision === 'accepted'
        ? `Record the client's selected option for ${mapped?.title || data.selectionTitle || 'the project selection'}.`
        : `Record the client's requested change for ${mapped?.title || data.selectionTitle || 'the project selection'}.`;
      addEffect(data.decision === 'accepted'
        ? `Set the retained selection to client confirmed with option ${data.selectedOption || 'the submitted option'}.`
        : 'Set the retained selection to changes requested so the office can revise it.');
      addSafeguard('Approval records client intent only. It does not change price, scope, schedule, safety state, or procurement commitments.');
      addSafeguard('No message, supplier order, payment, or external integration is triggered.');
      riskLevel = 'high';
      preview.selectionTitle = mapped?.title || data.selectionTitle || null;
      preview.decision = data.decision || null;
      preview.selectedOption = data.selectedOption || null;
      preview.note = data.note || null;
      preview.submittedAt = data.submittedAt || null;
    } else if (targetType === 'client_portal_access') {
      const access = this.db.prepare('SELECT * FROM client_portal_access WHERE id = ?').get(approval.targetId || approval.target_id);
      const mapped = this.mapClientPortalAccess(access);
      primaryEffect = `Activate restricted client portal access until ${mapped?.expiresAt || data.expiresAt || 'the configured expiry'}.`;
      addEffect('Activate one scoped, read-only client job portal link.');
      addSafeguard('The raw access token is stored only with the operator, never in the database. The portal excludes costs, invoices, internal notes, audit events, worker details, and supplier records.');
      addSafeguard('Client messages are recorded as inbound requests and never count as approval of scope, price, dates, or safety decisions.');
      riskLevel = 'high';
      preview.expiresAt = mapped?.expiresAt || data.expiresAt || null;
      preview.label = mapped?.data?.label || data.label || null;
    } else if (targetType === 'quote') {
      const quote = this.db.prepare('SELECT * FROM quotes WHERE id = ?').get(approval.targetId || approval.target_id);
      const mapped = quote ? this.mapQuote(quote) : null;
      primaryEffect = `Approve quote${mapped ? ` for ${mapped.total.toFixed(2)} ${mapped.currency}` : ''}.`;
      addEffect('Mark the quote approved and move the job approval state forward.');
      addSafeguard('Does not send the quote to the client automatically.');
      riskLevel = 'high';
      preview.total = mapped?.total ?? data.total ?? null;
      preview.currency = mapped?.currency || 'EUR';
      preview.lineItems = mapped?.lineItems || data.lineItems || [];
    } else if (targetType === 'invoice') {
      const invoice = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(approval.targetId || approval.target_id);
      const mapped = invoice ? this.mapInvoice(invoice) : null;
      primaryEffect = `Approve invoice${mapped ? ` for ${(mapped.total || mapped.amount || 0).toFixed(2)} ${mapped.currency}` : ''}.`;
      addEffect('Mark the invoice approved for issue.');
      addSafeguard('Does not send the invoice or collect payment automatically.');
      riskLevel = 'high';
      preview.total = mapped?.total ?? data.total ?? null;
      preview.amount = mapped?.amount ?? data.amount ?? null;
      preview.currency = mapped?.currency || 'EUR';
    } else if (targetType === 'assignment') {
      primaryEffect = `Approve worker assignment for ${data.workerName || data.workerId || 'worker'}.`;
      addEffect(`Set assignment to ${data.requestedStatus || 'planned'} for ${data.scheduledStart || 'the proposed start'} through ${data.scheduledEnd || 'the proposed end'}.`);
      if (Array.isArray(data.conflicts) && data.conflicts.length) {
        riskLevel = 'high';
        preview.conflicts = data.conflicts.slice(0, 6);
      }
      addSafeguard('Does not notify the worker or client automatically.');
    } else if (targetType === 'tool_reservation') {
      primaryEffect = `Approve tool reservation for ${data.toolName || data.toolId || 'tool'}.`;
      addEffect(`Set reservation to ${data.requestedStatus || 'reserved'} for the proposed job window.`);
      if (Array.isArray(data.conflicts) && data.conflicts.length) {
        riskLevel = 'high';
        preview.conflicts = data.conflicts.slice(0, 6);
      }
      addSafeguard('Does not rent, buy, or externally book equipment.');
    } else if (targetType === 'worker_retirement') {
      const activeAssignmentCount = Number(data.activeAssignmentCount || 0);
      const dormantAssignmentCount = Number(data.dormantAssignmentCount || 0);
      primaryEffect = `Retire ${data.name || 'this crew member'} from new and restored work.`;
      addEffect('Set the retained worker to retired so new assignments cannot use this person.');
      if (dormantAssignmentCount > 0) {
        addEffect(`Release ${dormantAssignmentCount} dormant assignment${dormantAssignmentCount === 1 ? '' : 's'} retained on inactive jobs so a later restore requires reassignment.`);
      }
      if (activeAssignmentCount > 0) {
        addSafeguard(`Resolution remains blocked until ${activeAssignmentCount} operational assignment${activeAssignmentCount === 1 ? '' : 's'} have been released or reassigned.`);
      }
      addSafeguard('Does not delete crew, assignment, time, approval, or audit history. Released dormant assignments remain retained on their jobs.');
      addSafeguard('Does not contact the crew member, client, payroll provider, or site and creates no external commitment.');
      riskLevel = 'high';
      preview.workerId = data.workerId || null;
      preview.activeAssignmentCount = activeAssignmentCount;
      preview.dormantAssignmentCount = dormantAssignmentCount;
      preview.activeAssignments = Array.isArray(data.activeAssignments) ? data.activeAssignments.slice(0, 10) : [];
      preview.dormantAssignments = Array.isArray(data.dormantAssignments) ? data.dormantAssignments.slice(0, 10) : [];
    } else if (targetType === 'tool_retirement') {
      const activeReservationCount = Number(data.activeReservationCount || 0);
      const dormantReservationCount = Number(data.dormantReservationCount || 0);
      primaryEffect = `Retire ${data.name || 'this equipment item'} from new and restored work.`;
      addEffect('Set the retained equipment item to retired so new reservations cannot use it.');
      if (dormantReservationCount > 0) {
        addEffect(`Release ${dormantReservationCount} dormant reservation${dormantReservationCount === 1 ? '' : 's'} retained on inactive jobs so a later restore requires a new equipment plan.`);
      }
      if (activeReservationCount > 0) {
        addSafeguard(`Resolution remains blocked until ${activeReservationCount} operational reservation${activeReservationCount === 1 ? '' : 's'} have been released or reassigned.`);
      }
      addSafeguard('Does not delete equipment, reservation, approval, or audit history. Released dormant reservations remain retained on their jobs.');
      addSafeguard('Does not rent, replace, collect, move, or externally book equipment and creates no external commitment.');
      riskLevel = 'high';
      preview.toolId = data.toolId || null;
      preview.category = data.category || null;
      preview.activeReservationCount = activeReservationCount;
      preview.dormantReservationCount = dormantReservationCount;
      preview.activeReservations = Array.isArray(data.activeReservations) ? data.activeReservations.slice(0, 10) : [];
      preview.dormantReservations = Array.isArray(data.dormantReservations) ? data.dormantReservations.slice(0, 10) : [];
    } else if (targetType === 'trade_partner_retirement') {
      primaryEffect = `Retire ${data.name || 'this trade partner'} from new procurement and purchase workflows.`;
      addEffect('Set the retained trade partner to retired so new supplier commitments cannot use it.');
      addSafeguard('Does not delete the partner, prior orders, compliance evidence, approvals, or audit history.');
      addSafeguard('Does not cancel an external order, contact the partner, release payment, or change an existing contract.');
      if (Number(data.activeProcurement || 0) + Number(data.activePurchaseOrders || 0) > 0) {
        addSafeguard(`${Number(data.activeProcurement || 0) + Number(data.activePurchaseOrders || 0)} active purchasing record(s) remain retained for operator review.`);
      }
      riskLevel = 'high';
      preview.partnerId = data.partnerId || null;
      preview.partnerType = data.partnerType || null;
      preview.activeProcurement = Number(data.activeProcurement || 0);
      preview.activePurchaseOrders = Number(data.activePurchaseOrders || 0);
      preview.compliance = data.compliance || null;
    } else if (['procurement_order', 'purchase_order'].includes(targetType)) {
      primaryEffect = `Approve ${ledgerApprovalHumanTarget(targetType)} readiness.`;
      addEffect('Move the purchasing record to the approved or ready-to-order state.');
      addSafeguard('Does not place a supplier order or spend money automatically.');
      if (data.partnerCompliance?.compliant === false) {
        addSafeguard('Resolution is refused until the linked trade partner has current retained compliance evidence.');
      } else {
        addSafeguard('Partner compliance is rechecked from the current ledger record when this approval resolves.');
      }
      riskLevel = 'high';
      preview.amount = data.amount || data.total || null;
      preview.supplier = data.supplier || null;
      preview.tradePartnerId = data.tradePartnerId || null;
      preview.partnerCompliance = data.partnerCompliance || null;
    } else if (targetType === 'payment') {
      primaryEffect = 'Approve payment confirmation.';
      addEffect('Record the payment as received/settled.');
      addSafeguard('Does not move funds or contact the client automatically.');
      riskLevel = 'high';
      preview.amount = data.amount || null;
    } else if (['quality_check', 'safety_check', 'inspection_record', 'observation_record', 'incident_record', 'safety_meeting', 'worker_orientation', 'jha_record', 'sds_sheet', 'site_access_log'].includes(targetType)) {
      primaryEffect = `Approve ${ledgerApprovalHumanTarget(targetType)} evidence.`;
      addEffect('Move the field, safety, access, or quality record to its approved/completed state.');
      addSafeguard('Does not override future safety observations, client issues, or field blockers.');
      riskLevel = ['incident_record', 'safety_check', 'jha_record', 'site_access_log'].includes(targetType) ? 'high' : 'medium';
    } else if (['budget_line', 'draw_request', 'lien_waiver', 'finance_handoff'].includes(targetType)) {
      primaryEffect = `Approve ${ledgerApprovalHumanTarget(targetType)} finance control.`;
      addEffect('Move the finance control record to its approved/submitted/ready state.');
      addSafeguard('Does not export bookkeeping data, request funding, or release legal/financial commitments automatically unless a later explicit action does so.');
      riskLevel = 'high';
    } else if (['change_order', 'client_selection', 'punch_item', 'warranty_claim', 'job_update'].includes(targetType)) {
      primaryEffect = `Approve ${ledgerApprovalHumanTarget(targetType)} change.`;
      addEffect('Apply the requested client, scope, closeout, or job-state change.');
      addSafeguard('Does not send external client communication automatically.');
      riskLevel = 'high';
    } else {
      primaryEffect = approval.reason || primaryEffect;
      addEffect('Resolve this approval gate and apply the linked target state where supported.');
      addSafeguard('External communications, payments, supplier orders, and public actions remain separately gated.');
    }

    return {
      title: approval.summary || ledgerApprovalHumanTarget(approvalType),
      primaryEffect,
      riskLevel,
      effects,
      safeguards,
      preview,
      confirmLabel: `Approve ${ledgerApprovalHumanTarget(approvalType)}`
    };
  }

  mapApproval(row) {
    const approval = {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      jobId: row.job_id,
      approvalType: row.approval_type,
      status: row.status,
      requestedBy: row.requested_by,
      resolvedBy: row.resolved_by,
      resolvedAt: row.resolved_at,
      summary: row.summary,
      reason: row.reason,
      data: fromJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    approval.decision = this.approvalDecisionSummary(approval);
    return approval;
  }

  mapAudit(row) {
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      jobId: row.job_id,
      action: row.action,
      actor: row.actor,
      before: fromJson(row.before_json),
      after: fromJson(row.after_json),
      metadata: fromJson(row.metadata_json),
      sequenceNumber: Number(row.sequence_number),
      previousHash: row.previous_hash,
      eventHash: row.event_hash,
      createdAt: row.created_at
    };
  }

  mapWeather(row) {
    return {
      id: row.id,
      jobId: row.job_id,
      location: row.location,
      forecastAt: row.forecast_at,
      condition: row.condition,
      precipitationPercent: normalizeNumber(row.precipitation_percent, 0),
      recommendation: row.recommendation,
      data: fromJson(row.data_json),
      createdAt: row.created_at
    };
  }
}

module.exports = {
  ContractorOperatingLedger,
  LEDGER_CAPABILITY_BLUEPRINT,
  JOB_OPERATING_PLAYBOOKS,
  AUDIT_CHAIN_ID,
  AUDIT_CHAIN_FORMAT,
  AUDIT_CHAIN_ALGORITHM,
  AUDIT_CHAIN_GENESIS_HASH,
  auditEventHash,
  auditEventFromRow,
  rebuildAuditChain,
  verifyAuditChainRows,
  appendAuditEventToDatabase
};
