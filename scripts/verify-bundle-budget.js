const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const assetsDirectory = path.join(root, 'dist', 'assets');
const budgets = {
  largestJavaScriptBytes: 600_000,
  largestCssBytes: 300_000,
  totalGzipBytes: 500_000
};

function verifyBundleBudget() {
  if (!fs.existsSync(assetsDirectory)) throw new Error('Built assets are missing. Run npm run build first.');
  const assets = fs.readdirSync(assetsDirectory)
    .map(name => ({ name, bytes: fs.readFileSync(path.join(assetsDirectory, name)) }))
    .filter(asset => /\.(?:js|css)$/.test(asset.name));
  const javascript = assets.filter(asset => asset.name.endsWith('.js'));
  const styles = assets.filter(asset => asset.name.endsWith('.css'));
  const largestJavaScriptBytes = Math.max(0, ...javascript.map(asset => asset.bytes.length));
  const largestCssBytes = Math.max(0, ...styles.map(asset => asset.bytes.length));
  const totalGzipBytes = assets.reduce((sum, asset) => sum + zlib.gzipSync(asset.bytes, { level: 9 }).length, 0);
  const measurements = { largestJavaScriptBytes, largestCssBytes, totalGzipBytes };
  const failures = Object.entries(budgets)
    .filter(([key, limit]) => measurements[key] > limit)
    .map(([key, limit]) => `${key} is ${measurements[key]} bytes; budget is ${limit}.`);
  if (failures.length) throw new Error(failures.join(' '));
  return { valid: true, budgets, measurements, assetCount: assets.length };
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(verifyBundleBudget())}\n`); } catch (error) {
    process.stderr.write(`Bundle budget failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { budgets, verifyBundleBudget };
