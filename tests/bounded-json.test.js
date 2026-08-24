const assert = require('node:assert/strict');
const test = require('node:test');

const { BoundedJsonResponseError, readBoundedJsonResponse } = require('../bounded-json');

function streamResponse(chunks, contentType = 'application/json') {
  const encoded = chunks.map(chunk => Buffer.from(chunk));
  return {
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      }
    },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of encoded) controller.enqueue(chunk);
        controller.close();
      }
    })
  };
}

test('bounded JSON reader parses a valid streamed response without buffering twice', async () => {
  const response = streamResponse(['{"status":', '"ready"}']);
  assert.deepEqual(await readBoundedJsonResponse(response, { maxBytes: 128 }), { status: 'ready' });
});

test('bounded JSON reader rejects an oversized chunked response before parsing it', async () => {
  const response = streamResponse(['{"payload":"', 'x'.repeat(128), '"}']);
  await assert.rejects(
    readBoundedJsonResponse(response, { maxBytes: 32 }),
    error => error instanceof BoundedJsonResponseError && error.code === 'json_response_too_large'
  );
});

test('bounded JSON reader rejects a non-JSON content type', async () => {
  const response = streamResponse(['not json'], 'text/plain');
  await assert.rejects(
    readBoundedJsonResponse(response, { maxBytes: 128 }),
    error => error instanceof BoundedJsonResponseError && error.code === 'json_response_content_type_invalid'
  );
});
