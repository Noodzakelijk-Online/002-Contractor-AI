const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  HAI_FEED_FORMAT,
  HAI_FEED_OPERATION,
  HAI_ITEM_PROVIDER,
  HAI_ITEM_TYPE,
  buildHaiFeed,
  connectorManifest,
  validateHaiFeed
} = require('../hai-connector');

const HAI_ACCOUNTFEED_FILES = ['generic_feed.go', 'enum.go', 'bridge.go'];
const HAI_GO_DOCKER_IMAGE = 'golang:1.25-alpine@sha256:56961d79ea8129efddcc0b8643fd8a5416b4e6228cfd477e3fd61deb2672c587';

function parseArguments(args = []) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const [key, inlineValue] = argument.slice(2).split('=', 2);
    if (inlineValue !== undefined) values[key] = inlineValue;
    else {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}.`);
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

function compatibilityFixture() {
  return buildHaiFeed([{
    type: 'review_framework_implementation',
    id: 'hai-contract-fixture',
    sourceHash: '7'.repeat(64),
    title: 'Review governed Contractor.AI action',
    message: 'Review the retained internal action in Contractor.AI. No command can be executed from HAI.',
    severity: 'high',
    requiresApproval: true,
    createdAt: '2026-08-09T00:00:00.000Z'
  }]);
}

function verifyNativeContract() {
  const feed = validateHaiFeed(compatibilityFixture());
  const manifest = connectorManifest();
  if (manifest.format !== HAI_FEED_FORMAT
    || manifest.schema !== 'accountfeed.GenericItem'
    || manifest.itemProvider !== HAI_ITEM_PROVIDER
    || manifest.itemType !== HAI_ITEM_TYPE
    || manifest.operationType !== HAI_FEED_OPERATION) {
    throw new Error('HAI connector manifest does not match the emitted generic-item contract.');
  }
  const item = feed[0];
  if (item.provider !== HAI_ITEM_PROVIDER || item.itemType !== HAI_ITEM_TYPE || typeof item.content !== 'string') {
    throw new Error('HAI compatibility fixture is missing a required GenericItem field.');
  }
  return {
    format: manifest.format,
    schema: manifest.schema,
    provider: item.provider,
    itemType: item.itemType,
    operationType: manifest.operationType,
    canExecute: item.metadata.canExecute,
    externalCommitments: item.metadata.externalCommitments,
    fixtureSha256: crypto.createHash('sha256').update(JSON.stringify(feed)).digest('hex')
  };
}

function resolveHaiAccountfeedRoot(haiRoot) {
  const root = path.resolve(String(haiRoot || ''));
  if (!path.isAbsolute(String(haiRoot || ''))) throw new Error('HAI source root must be an absolute path.');
  const accountfeedRoot = path.join(root, 'backend', 'internal', 'accountfeed');
  for (const file of HAI_ACCOUNTFEED_FILES) {
    if (!fs.statSync(path.join(accountfeedRoot, file), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Maintained HAI parser source is missing: ${file}`);
    }
  }
  return accountfeedRoot;
}

function verifyWithMaintainedHaiParser(haiRoot) {
  const accountfeedRoot = resolveHaiAccountfeedRoot(haiRoot);
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'contractor-ai-hai-contract-'));
  const fixturePath = path.join(temporaryRoot, 'contractor-ai.json');
  try {
    for (const file of HAI_ACCOUNTFEED_FILES) {
      fs.copyFileSync(path.join(accountfeedRoot, file), path.join(temporaryRoot, file));
    }
    fs.writeFileSync(path.join(temporaryRoot, 'go.mod'), 'module contractor-ai-hai-contract\n\ngo 1.22\n', 'utf8');
    fs.writeFileSync(path.join(temporaryRoot, 'compat_types.go'), `package accountfeed

type FeedItem struct {
  ExternalID string
  Title string
  Body string
  OperationType string
  Metadata map[string]any
  RawJSON string
}

func firstNonEmpty(values ...string) string {
  for _, value := range values {
    if value != "" { return value }
  }
  return ""
}
`, 'utf8');
    fs.writeFileSync(path.join(temporaryRoot, 'contractor_ai_compat_test.go'), `package accountfeed

import (
  "os"
  "testing"
)

func TestContractorAICompatibility(t *testing.T) {
  data, err := os.ReadFile(os.Getenv("CONTRACTOR_AI_HAI_FIXTURE"))
  if err != nil { t.Fatal(err) }
  feed, err := ParseGenericFeed(data, 200000, 16000)
  if err != nil { t.Fatal(err) }
  if len(feed.Items) != 1 { t.Fatalf("expected one item, got %d", len(feed.Items)) }
  item := feed.Items[0]
  if item.Provider != "generic_json_feed" { t.Fatalf("unexpected provider %q", item.Provider) }
  if item.ItemType != "document" { t.Fatalf("unexpected item type %q", item.ItemType) }
  normalized := item.ToFeedItem()
  if normalized.OperationType != "review_document" { t.Fatalf("unexpected operation type %q", normalized.OperationType) }
  if value, ok := item.Metadata["canExecute"].(bool); !ok || value { t.Fatalf("canExecute must be false") }
  if value, ok := item.Metadata["externalCommitments"].(float64); !ok || value != 0 { t.Fatalf("externalCommitments must be zero") }
}
`, 'utf8');
    fs.writeFileSync(fixturePath, `${JSON.stringify(compatibilityFixture(), null, 2)}\n`, 'utf8');
    const executionOptions = {
      cwd: temporaryRoot,
      env: { ...process.env, CONTRACTOR_AI_HAI_FIXTURE: fixturePath },
      encoding: 'utf8',
      windowsHide: true
    };
    let runtime = 'go';
    let result = spawnSync('go', ['test', '-run', '^TestContractorAICompatibility$', '-count=1', '.'], executionOptions);
    if (result.error?.code === 'ENOENT') {
      runtime = 'docker';
      result = spawnSync('docker', [
        'run', '--rm', '--network', 'none',
        '--mount', `type=bind,source=${temporaryRoot},target=/src`,
        '--workdir', '/src',
        '--env', 'CONTRACTOR_AI_HAI_FIXTURE=/src/contractor-ai.json',
        HAI_GO_DOCKER_IMAGE,
        'go', 'test', '-run', '^TestContractorAICompatibility$', '-count=1', '.'
      ], { ...executionOptions, env: process.env });
    }
    if (result.error) throw new Error(`Maintained HAI parser could not run: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`Maintained HAI parser rejected the Contractor.AI feed: ${(result.stderr || result.stdout).trim()}`);
    return { actualHaiParser: true, parserRuntime: runtime, parserFiles: [...HAI_ACCOUNTFEED_FILES] };
  } finally {
    const resolvedTemporaryRoot = path.resolve(temporaryRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());
    const relativeTemporaryRoot = path.relative(resolvedSystemTemp, resolvedTemporaryRoot);
    if (relativeTemporaryRoot && !relativeTemporaryRoot.startsWith('..') && !path.isAbsolute(relativeTemporaryRoot)) {
      fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });
    }
  }
}

function verifyHaiContract(options = {}) {
  const native = verifyNativeContract();
  const haiRoot = String(options.haiRoot || process.env.CONTRACTOR_AI_HAI_SOURCE_ROOT || '').trim();
  return {
    valid: true,
    ...native,
    ...(haiRoot ? verifyWithMaintainedHaiParser(haiRoot) : { actualHaiParser: false })
  };
}

function main(args = process.argv.slice(2)) {
  const values = parseArguments(args);
  const result = verifyHaiContract({ haiRoot: values['hai-root'] });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`HAI compatibility verification failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  HAI_GO_DOCKER_IMAGE,
  compatibilityFixture,
  parseArguments,
  resolveHaiAccountfeedRoot,
  verifyHaiContract,
  verifyNativeContract,
  verifyWithMaintainedHaiParser
};
