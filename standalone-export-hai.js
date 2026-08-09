const { applyStandaloneEnvironment } = require('./standalone-runtime');
const { main } = require('./scripts/export-hai-feed');

applyStandaloneEnvironment();
process.env.CONTRACTOR_AI_URL = `http://127.0.0.1:${process.env.PORT}`;

main().catch(error => {
  process.stderr.write(`HAI feed export failed: ${error.message}\n`);
  process.exitCode = 1;
});
