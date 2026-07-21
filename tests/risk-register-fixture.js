function riskRegisterPayload(entryKey, commercialScopeRevisionId, overrides = {}) {
  return {
    entryKey,
    commercialScopeRevisionId,
    title: overrides.title || 'Test project risk register',
    currency: 'EUR',
    risks: overrides.risks || [{
      riskKey: 'RISK-TEST-01',
      category: 'schedule',
      title: 'Retained test schedule exposure',
      cause: 'A retained project dependency may complete later than planned.',
      event: 'The planned work package cannot start on its retained date.',
      consequence: 'The internal sequence and forecast completion date may move.',
      owner: 'Test project manager',
      probability: 3,
      impact: 3,
      responseStrategy: 'mitigate',
      mitigationAction: 'Verify the dependency before releasing the affected work package.',
      contingencyAction: 'Resequence unaffected work and retain the revised internal plan.',
      trigger: 'The dependency remains unconfirmed five working days before start.',
      residualProbability: 2,
      residualImpact: 2,
      costExposureAmount: 1_000,
      scheduleExposureDays: 2,
      status: 'monitoring'
    }],
    premortem: overrides.premortem || {
      workshopDate: '2026-08-01',
      failureStatement: 'The test project missed its target because a retained dependency was not controlled.',
      facilitator: 'Test commercial manager',
      participants: ['Test estimator', 'Test project manager'],
      failureModes: [{
        riskKey: 'RISK-TEST-01',
        failureMode: 'The retained dependency prevented the planned work package start.',
        earlyWarning: 'The dependency remained unconfirmed before the release deadline.',
        prevention: 'Review and retain dependency confirmation before commercial approval.'
      }]
    },
    reason: overrides.reason || 'Retain the test project risk review before pricing and quote approval.'
  };
}

function approveLowRiskRegister(ledger, jobId, commercialScopeRevision, entryKey = `risk-fixture-${jobId}`) {
  const requested = ledger.requestRiskRegisterRevision(
    jobId,
    riskRegisterPayload(entryKey, commercialScopeRevision.id),
    { actor: 'test-project-manager' }
  );
  ledger.resolveApproval(requested.approval.id, {
    status: 'approved',
    resolvedBy: 'test-risk-approver',
    reason: 'Test risk ownership, treatments, exposure, and premortem links verified.'
  });
  return ledger.getRiskRegisterRevision(requested.revision.id);
}

module.exports = { approveLowRiskRegister, riskRegisterPayload };
