const DEFAULT_MAX_JSON_BYTES = 256 * 1024;

class BoundedJsonResponseError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'BoundedJsonResponseError';
    this.code = code;
    this.statusCode = 502;
  }
}

function responseHeader(response, name) {
  return String(response?.headers?.get?.(name) || '').trim();
}

function assertJsonContentType(response) {
  const contentType = responseHeader(response, 'content-type').toLowerCase();
  if (!/^application\/(?:json|[^;]+\+json)(?:\s*;|$)/i.test(contentType)) {
    throw new BoundedJsonResponseError('External response did not declare a JSON content type.', 'json_response_content_type_invalid');
  }
}

function declaredLength(response) {
  const value = responseHeader(response, 'content-length');
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function assertWithinLimit(size, maxBytes) {
  if (size > maxBytes) {
    throw new BoundedJsonResponseError(`External JSON response exceeds the ${maxBytes}-byte limit.`, 'json_response_too_large');
  }
}

async function readBoundedJsonResponse(response, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxBytes || DEFAULT_MAX_JSON_BYTES));
  assertJsonContentType(response);
  const length = declaredLength(response);
  if (length !== null) assertWithinLimit(length, maxBytes);

  let bytes;
  if (response?.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        const chunk = Buffer.from(result.value);
        size += chunk.length;
        assertWithinLimit(size, maxBytes);
        chunks.push(chunk);
      }
      bytes = Buffer.concat(chunks, size);
    } catch (error) {
      if (error instanceof BoundedJsonResponseError) {
        await reader.cancel().catch(() => {});
        throw error;
      }
      throw new BoundedJsonResponseError('External JSON response could not be read.', 'json_response_read_failed', error);
    }
  } else if (typeof response?.text === 'function') {
    const text = await response.text();
    bytes = Buffer.from(text, 'utf8');
    assertWithinLimit(bytes.length, maxBytes);
  } else {
    throw new BoundedJsonResponseError('External response did not provide a readable body.', 'json_response_body_missing');
  }

  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new BoundedJsonResponseError('External response was not valid JSON.', 'json_response_invalid', error);
  }
}

module.exports = {
  BoundedJsonResponseError,
  DEFAULT_MAX_JSON_BYTES,
  readBoundedJsonResponse
};
