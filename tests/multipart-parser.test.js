const assert = require('node:assert/strict');
const test = require('node:test');

const { parseMultipartFormData } = require('../multipart-parser');

function multipartBody(boundary, fileBytes) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="evidenceFile"; filename="site.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'latin1'),
    fileBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1')
  ]);
}

test('binary multipart parsing preserves an embedded boundary-like byte sequence', () => {
  const boundary = 'contractor-ai-boundary-2026';
  const fileBytes = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0x00, 0x01]),
    Buffer.from(`binary--${boundary}inside`, 'latin1'),
    Buffer.from([0x00, 0xc3, 0x28, 0xff])
  ]);
  const parsed = parseMultipartFormData(
    multipartBody(boundary, fileBytes),
    `multipart/form-data; boundary=${boundary}`,
    { maxParts: 4, maxFields: 4, maxHeaderPairs: 8, maxFieldBytes: 1024 }
  );
  assert.equal(parsed.files.length, 1);
  assert.deepEqual(parsed.files[0].buffer, fileBytes);
});

test('binary multipart parsing rejects a malformed or truncated delimiter structure', () => {
  const boundary = 'contractor-ai-boundary-2026';
  const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="field"\r\n\r\nvalue`, 'latin1');
  assert.throws(
    () => parseMultipartFormData(body, `multipart/form-data; boundary=${boundary}`),
    error => error.code === 'malformed_multipart_body'
  );
});
