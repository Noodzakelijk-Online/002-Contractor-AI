const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const espree = require('espree');

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      value.forEach(item => walk(item, visit));
    } else if (value && typeof value === 'object' && value.type) {
      walk(value, visit);
    }
  }
}

function memberName(member) {
  if (member?.type !== 'MemberExpression') return null;
  return member.computed ? member.property?.value : member.property?.name;
}

function isTransactionReturn(statement) {
  const call = statement?.type === 'ReturnStatement' ? statement.argument : null;
  return call?.type === 'CallExpression'
    && call.callee?.object?.type === 'ThisExpression'
    && memberName(call.callee) === 'transaction';
}

function hasExecutableMutation(node) {
  let mutation = false;

  function inspect(current) {
    if (!current || typeof current !== 'object' || mutation) return;
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(current.type)) return;
    if (current.type === 'CallExpression') {
      const name = memberName(current.callee);
      if ((current.callee?.object?.type === 'ThisExpression' && name === 'createApproval') || name === 'run' || name === 'exec') {
        mutation = true;
        return;
      }
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) value.forEach(inspect);
      else if (value && typeof value === 'object') inspect(value);
    }
  }

  inspect(node);
  return mutation;
}

function hasDominatingTransaction(method) {
  const statements = method.value.body.body;
  const transactionIndex = statements.findIndex(isTransactionReturn);
  return transactionIndex >= 0
    && statements.slice(0, transactionIndex).every(statement => !hasExecutableMutation(statement));
}

test('approval-producing ledger writes are dominated by a transaction', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'operating-ledger.js'), 'utf8');
  const ast = espree.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    loc: true
  });
  const approvalWriters = [];

  walk(ast, node => {
    if (node.type !== 'MethodDefinition' || node.value?.type !== 'FunctionExpression') return;
    let writes = false;
    let createsApproval = false;

    walk(node.value.body, child => {
      if (child.type !== 'CallExpression') return;
      const name = memberName(child.callee);
      if (child.callee?.object?.type === 'ThisExpression' && name === 'createApproval') {
        createsApproval = true;
      }
      if (name === 'run' || name === 'exec') {
        writes = true;
      }
    });

    if (writes && createsApproval) {
      approvalWriters.push({
        name: node.key.name || node.key.value,
        line: node.loc.start.line,
        atomic: hasDominatingTransaction(node)
      });
    }
  });

  assert.ok(approvalWriters.length >= 32, 'approval writer scan did not cover the expected ledger surface');
  assert.deepEqual(
    approvalWriters.filter(method => !method.atomic),
    [],
    'approval-producing writes must roll back their primary record when approval persistence fails'
  );
});
