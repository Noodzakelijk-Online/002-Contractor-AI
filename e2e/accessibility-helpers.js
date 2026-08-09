const { expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function violationSummary(violations) {
  return violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    targets: violation.nodes.flatMap(node => node.target.map(target => String(target)))
  }));
}

async function expectNoAxeViolations(page, context) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const violations = violationSummary(results.violations);
  expect(violations, `${context} accessibility violations:\n${JSON.stringify(violations, null, 2)}`).toEqual([]);
}

module.exports = { WCAG_TAGS, expectNoAxeViolations, violationSummary };
