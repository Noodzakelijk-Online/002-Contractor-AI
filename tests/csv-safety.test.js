const assert = require('node:assert/strict');
const test = require('node:test');

const { encodeCsvCell } = require('../csv-safety');

test('spreadsheet text cells neutralize formula prefixes after whitespace and control characters', () => {
  assert.equal(encodeCsvCell('=1+1'), "'=1+1");
  assert.equal(encodeCsvCell('  \t=1+1'), "'  \t=1+1");
  assert.equal(encodeCsvCell('\u0000@SUM(A1:A2)'), "'\u0000@SUM(A1:A2)");
  assert.equal(encodeCsvCell('normal, text'), '"normal, text"');
});

test('typed numeric cells keep negative values numeric instead of formula-protected', () => {
  assert.equal(encodeCsvCell(-12.5, { type: 'number' }), '-12.5');
  assert.equal(encodeCsvCell('-12.5', { type: 'number' }), '-12.5');
  assert.equal(encodeCsvCell('-12.5'), "'-12.5");
});
