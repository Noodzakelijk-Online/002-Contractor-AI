function escapeCsvText(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function startsWithFormulaPrefix(text) {
  let index = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || /\s/.test(text[index])) index += 1;
    else break;
  }
  return '=+-@'.includes(text[index] || '');
}

function encodeCsvCell(value, options = {}) {
  const type = options.type || 'text';
  const quote = options.quote === true;
  let text = String(value ?? '');

  if (type === 'number') {
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) throw new TypeError('CSV numeric cells must contain finite numbers.');
  } else if (startsWithFormulaPrefix(text)) {
    text = `'${text}`;
  }

  const escaped = escapeCsvText(text);
  if (quote && !/^".*"$/.test(escaped)) return `"${escaped.replace(/"/g, '""')}"`;
  return escaped;
}

module.exports = { encodeCsvCell };
