const { spawn } = require('node:child_process');
const { applyStandaloneEnvironment } = require('./standalone-runtime');

function startupSummary(runtime, url) {
  const accessLine = runtime.created
    ? `First-run owner access key: ${runtime.config.ownerToken}`
    : `Owner access key: retained in ${runtime.paths.configFile}`;
  return `\nContractor.AI is running at ${url}\n${accessLine}\nLocal data: ${runtime.paths.dataDir}\n\n`;
}

async function launchStandalone() {
  const runtime = applyStandaloneEnvironment();
  const app = require('./server');
  const url = `http://127.0.0.1:${runtime.config.port}`;
  const server = await app.locals.runtimeControl.start({ host: '127.0.0.1', port: runtime.config.port });

  process.stdout.write(startupSummary(runtime, url));

  if (process.platform === 'win32' && process.env.CONTRACTOR_AI_OPEN_BROWSER !== 'false') {
    const browser = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.unref();
  }

  const shutdown = signal => app.locals.runtimeControl.shutdown({ server, signal })
    .then(() => { process.exitCode = 0; })
    .catch(() => { process.exitCode = 1; });
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  launchStandalone().catch(error => {
    process.stderr.write(`Contractor.AI could not start: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { launchStandalone, startupSummary };
