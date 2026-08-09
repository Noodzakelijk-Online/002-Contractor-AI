const path = require('node:path');
const { validateHaiFeed, writeHaiFeedAtomically } = require('../hai-connector');

function parseArguments(args) {
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

function validateBaseUrl(value) {
  const url = new URL(String(value || ''));
  if (url.username || url.password || url.search || url.hash) throw new Error('HAI export URL must not contain credentials, query parameters, or a fragment.');
  const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('HAI export requires HTTPS, except for a loopback-only local Contractor.AI URL.');
  return url;
}

async function exportHaiFeed(options = {}) {
  const baseUrl = validateBaseUrl(options.url || process.env.CONTRACTOR_AI_URL || 'http://127.0.0.1:3000');
  const token = String(options.token || process.env.CONTRACTOR_AI_AUTH_TOKEN || '').trim();
  if (token.length < 32) throw new Error('A strong Contractor.AI owner access key is required.');
  const outputFile = String(options.output || process.env.CONTRACTOR_AI_HAI_FEED_PATH || '').trim();
  if (!outputFile || !path.isAbsolute(outputFile)) throw new Error('Set CONTRACTOR_AI_HAI_FEED_PATH or --output to an absolute HAI local-feed file path.');
  const limit = String(options.limit || process.env.CONTRACTOR_AI_HAI_FEED_LIMIT || '100');
  const endpoint = new URL('/api/integrations/hai/feed', baseUrl);
  endpoint.searchParams.set('limit', limit);
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    let code = `http_${response.status}`;
    try { code = (await response.json())?.error?.code || code; } catch { /* Preserve the HTTP status when no JSON error body exists. */ }
    throw new Error(`Contractor.AI rejected the HAI export (${code}).`);
  }
  const feed = validateHaiFeed(await response.json());
  return writeHaiFeedAtomically(outputFile, feed);
}

async function main(args = process.argv.slice(2)) {
  const result = await exportHaiFeed(parseArguments(args));
  process.stdout.write(`${JSON.stringify({ success: true, ...result })}\n`);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`HAI feed export failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { exportHaiFeed, main, parseArguments, validateBaseUrl };
