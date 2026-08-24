class MultipartParserError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'MultipartParserError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function fail(statusCode, code, message) {
  throw new MultipartParserError(statusCode, code, message);
}

function sanitizeUploadFilename(value) {
  const base = require('node:path').basename(String(value || 'upload.bin')).replace(/[^\w.\- ]+/g, '_').trim();
  const normalized = base.replace(/\s+/g, '-').slice(0, 120);
  return normalized || 'upload.bin';
}

function safeFieldName(value) {
  return String(value || '').replace(/[^\w.\-:[\]]+/g, '').slice(0, 120);
}

function parseMultipartDisposition(value = '') {
  const result = {};
  for (const part of String(value).split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey || !rawValue.length) continue;
    const key = rawKey.trim().toLowerCase();
    result[key] = rawValue.join('=').trim().replace(/^"|"$/g, '');
  }
  return result;
}

function nextDelimiter(buffer, marker, from) {
  let offset = buffer.indexOf(marker, from);
  while (offset !== -1) {
    const framedBefore = offset === 0 || (buffer[offset - 2] === 0x0d && buffer[offset - 1] === 0x0a);
    const after = offset + marker.length;
    const opening = buffer[after] === 0x0d && buffer[after + 1] === 0x0a;
    const closing = buffer[after] === 0x2d && buffer[after + 1] === 0x2d;
    if (framedBefore && (opening || closing)) {
      return { offset, end: after + 2, closing };
    }
    offset = buffer.indexOf(marker, offset + 1);
  }
  return null;
}

function parseHeaders(headerBytes, maxHeaderPairs) {
  const lines = headerBytes.toString('latin1').split('\r\n');
  if (lines.length > maxHeaderPairs) {
    fail(413, 'multipart_headers_exceeded', `Multipart part exceeds ${maxHeaderPairs} headers`);
  }
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) fail(400, 'malformed_multipart_body', 'Multipart part contains a malformed header.');
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function parseMultipartFormData(buffer, contentType = '', options = {}) {
  const maxParts = options.maxParts ?? 64;
  const maxFields = options.maxFields ?? 32;
  const maxHeaderPairs = options.maxHeaderPairs ?? 16;
  const maxFieldBytes = options.maxFieldBytes ?? 65_536;
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) fail(400, 'missing_multipart_boundary', 'Multipart boundary is missing');
  if (!/^[0-9A-Za-z'()+_,\-./:=?]{12,70}$/.test(boundary)) {
    fail(400, 'invalid_multipart_boundary', 'Multipart boundary syntax or length is invalid');
  }
  if (!Buffer.isBuffer(buffer)) fail(400, 'malformed_multipart_body', 'Multipart body must be binary data.');

  const marker = Buffer.from(`--${boundary}`, 'latin1');
  let delimiter = nextDelimiter(buffer, marker, 0);
  if (!delimiter || delimiter.closing) fail(400, 'malformed_multipart_body', 'Multipart body has no opening delimiter.');

  let preflight = delimiter;
  let preflightParts = 0;
  while (preflight && !preflight.closing) {
    preflightParts += 1;
    if (preflightParts > maxParts) {
      fail(413, 'multipart_parts_exceeded', `Multipart upload exceeds ${maxParts} parts`);
    }
    preflight = nextDelimiter(buffer, marker, preflight.end);
  }
  if (!preflight) fail(400, 'malformed_multipart_body', 'Multipart body is truncated before its closing delimiter.');

  const fields = {};
  const files = [];
  let fieldCount = 0;
  let partCount = 0;
  let partStart = delimiter.end;

  while (true) {
    delimiter = nextDelimiter(buffer, marker, partStart);
    if (!delimiter) fail(400, 'malformed_multipart_body', 'Multipart body is truncated before its closing delimiter.');
    partCount += 1;
    if (partCount > maxParts) {
      fail(413, 'multipart_parts_exceeded', `Multipart upload exceeds ${maxParts} parts`);
    }

    const contentEnd = delimiter.offset - 2;
    if (contentEnd < partStart) fail(400, 'malformed_multipart_body', 'Multipart part framing is invalid.');
    const part = buffer.subarray(partStart, contentEnd);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n', 'latin1'));
    if (headerEnd === -1) fail(400, 'malformed_multipart_body', 'Multipart part headers are incomplete.');
    const headers = parseHeaders(part.subarray(0, headerEnd), maxHeaderPairs);
    const disposition = parseMultipartDisposition(headers['content-disposition']);
    const fieldName = safeFieldName(disposition.name);
    if (!fieldName) fail(400, 'malformed_multipart_body', 'Multipart part field name is missing.');
    const content = part.subarray(headerEnd + 4);

    if (disposition.filename !== undefined) {
      if (files.length >= 1) fail(413, 'multipart_files_exceeded', 'Evidence upload accepts exactly one file');
      const originalName = sanitizeUploadFilename(disposition.filename);
      if (content.length && originalName) {
        files.push({
          fieldName,
          originalName,
          mimeType: headers['content-type'] || 'application/octet-stream',
          size: content.length,
          buffer: Buffer.from(content)
        });
      }
    } else {
      fieldCount += 1;
      if (fieldCount > maxFields) fail(413, 'multipart_fields_exceeded', `Multipart upload exceeds ${maxFields} fields`);
      if (content.length > maxFieldBytes) fail(413, 'multipart_field_too_large', `Multipart field exceeds ${maxFieldBytes} bytes`);
      const value = content.toString('utf8');
      if (fields[fieldName] === undefined) fields[fieldName] = value;
      else if (Array.isArray(fields[fieldName])) fields[fieldName].push(value);
      else fields[fieldName] = [fields[fieldName], value];
    }

    if (delimiter.closing) {
      const trailer = buffer.subarray(delimiter.end);
      if (trailer.length && !/^\r\n$/.test(trailer.toString('latin1'))) {
        fail(400, 'malformed_multipart_body', 'Multipart body contains data after its closing delimiter.');
      }
      break;
    }
    partStart = delimiter.end;
  }

  return { fields, files };
}

module.exports = { MultipartParserError, parseMultipartFormData };
