const { parentPort, workerData } = require('node:worker_threads');
const { Client } = require('pg');

const client = new Client({
  connectionString: workerData.connectionString,
  ssl: workerData.ssl === false ? false : { rejectUnauthorized: workerData.rejectUnauthorized !== false }
});
let queue = client.connect();

function writeResponse(shared, payload) {
  const signal = new Int32Array(shared, 0, 2);
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const target = new Uint8Array(shared, 8);
  if (body.length > target.length) {
    const message = Buffer.from(JSON.stringify({ ok: false, error: { message: 'Postgres bridge response exceeded its configured size limit.' } }), 'utf8');
    target.set(message.subarray(0, target.length));
    Atomics.store(signal, 1, Math.min(message.length, target.length));
    Atomics.store(signal, 0, -1);
  } else {
    target.set(body);
    Atomics.store(signal, 1, body.length);
    Atomics.store(signal, 0, payload.ok ? 1 : -1);
  }
  Atomics.notify(signal, 0, 1);
}

async function execute(request) {
  if (request.operation === 'close') {
    await client.end();
    return { rows: [], rowCount: 0 };
  }
  const result = await client.query(request.text, request.values || []);
  const resultSet = Array.isArray(result) ? result : [result];
  const finalResult = resultSet.at(-1) || { rows: [], rowCount: 0 };
  return { rows: finalResult.rows || [], rowCount: Number(finalResult.rowCount || 0) };
}

parentPort.on('message', message => {
  queue = queue.then(async () => {
    try {
      const result = await execute(message.request);
      writeResponse(message.shared, { ok: true, result });
    } catch (error) {
      writeResponse(message.shared, {
        ok: false,
        error: {
          message: error.message || 'PostgreSQL request failed.',
          code: error.code || null
        }
      });
    }
  }).catch(error => {
    writeResponse(message.shared, {
      ok: false,
      error: { message: error.message || 'PostgreSQL connection failed.', code: error.code || null }
    });
  });
});
