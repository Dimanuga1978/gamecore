import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr } from '../src/encoder.js';
import { qrToSvg } from '../src/svg.js';

test('qrToSvg produces well-formed SVG with the right viewBox dimensions', () => {
  const encoded = encodeQr('http://192.168.1.42:4170/j/test01');
  const svg = qrToSvg(encoded, { moduleSize: 10, margin: 4 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  const expectedPx = (encoded.size + 8) * 10;
  assert.match(svg, new RegExp(`viewBox="0 0 ${expectedPx} ${expectedPx}"`));
});

test('qrToSvg draws exactly one <rect> per dark module, plus the background rect', () => {
  const encoded = encodeQr('http://x/j/A');
  const svg = qrToSvg(encoded);
  let darkModuleCount = 0;
  for (const row of encoded.modules) for (const cell of row) if (cell) darkModuleCount++;
  const rectCount = (svg.match(/<rect/g) || []).length;
  assert.equal(rectCount, darkModuleCount + 1, 'one <rect> per dark module, plus the one background rect');
});

test('qrToSvg respects custom colors', () => {
  const encoded = encodeQr('http://x/j/color-test');
  const svg = qrToSvg(encoded, { darkColor: '#123456', lightColor: '#abcdef' });
  assert.match(svg, /fill="#abcdef"/);
  assert.match(svg, /fill="#123456"/);
});
