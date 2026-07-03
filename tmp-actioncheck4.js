#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const dashboardPath = path.join(__dirname, 'public', 'index.html');
const dashboard = fs.readFileSync(dashboardPath, 'utf8');

const actionStart = dashboard.indexOf('function runLedgerAction');
const actionEnd = dashboard.indexOf('async function runLedgerCycle', actionStart);

if (actionStart === -1 || actionEnd === -1 || actionEnd <= actionStart) {
  throw new Error('Unable to locate runLedgerAction block in public/index.html');
}

const actionBlock = dashboard.slice(actionStart, actionEnd);

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

const routesMatch = actionBlock.match(/const\s+jobFormRoutes\s*=\s*\{([\s\S]*?)\n\s*\};/);
const routeMapBody = routesMatch ? routesMatch[1] : '';
const routeMapActions = unique(
  [...routeMapBody.matchAll(/^\s*([a-z][a-z0-9_:-]+)\s*:/gm)].map(match => match[1])
);

const normalizedArrayActions = unique(
  [...actionBlock.matchAll(/\[([\s\S]*?)\]\.includes\(normalizedType\)/g)].flatMap(match =>
    [...match[1].matchAll(/['"`]([a-z][a-z0-9_:-]+)['"`]/g)].map(item => item[1])
  )
);

if (!routeMapActions.length) {
  throw new Error('No jobFormRoutes actions were extracted from runLedgerAction');
}

const actionNames = unique([...routeMapActions, ...normalizedArrayActions]);
const routeActions = actionNames.filter(value =>
  /route|dispatch|weather|schedule|loading|procurement|instruction/.test(value)
);
const approvalActions = actionNames.filter(value =>
  /approval|approve|invoice|payment|quote|purchase|commit|warranty/.test(value)
);
const fallbackOnlyActions = normalizedArrayActions.filter(value => !routeMapActions.includes(value));

const summary = {
  dashboard: path.relative(__dirname, dashboardPath),
  runLedgerActionFound: true,
  routeMapActionCount: routeMapActions.length,
  normalizedArrayActionCount: normalizedArrayActions.length,
  uniqueActionCount: actionNames.length,
  routeAndDispatchActionCount: routeActions.length,
  approvalSensitiveActionCount: approvalActions.length,
  routeMapActions,
  fallbackOnlyActions,
  routeAndDispatchActions: routeActions,
  approvalSensitiveActions: approvalActions
};

console.log(JSON.stringify(summary, null, 2));
