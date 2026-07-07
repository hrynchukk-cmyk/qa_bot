import test from 'node:test';
import assert from 'node:assert/strict';
import { parseViewports, DEFAULT_VIEWPORTS } from '../src/viewports.js';
import { parseFigmaUrl } from '../src/figma/client.js';

test('parseViewports: empty spec returns defaults', () => {
  assert.equal(parseViewports(''), DEFAULT_VIEWPORTS);
});

test('parseViewports: parses sizes and derives labels', () => {
  const vps = parseViewports('390x844,1920x1080');
  assert.deepEqual(vps, [
    { label: 'mobile', width: 390, height: 844 },
    { label: 'desktop', width: 1920, height: 1080 },
  ]);
});

test('parseViewports: explicit labels', () => {
  const vps = parseViewports('iphone:390x844');
  assert.deepEqual(vps, [{ label: 'iphone', width: 390, height: 844 }]);
});

test('parseViewports: rejects garbage', () => {
  assert.throws(() => parseViewports('banana'));
  assert.throws(() => parseViewports('50x50'));
});

test('parseFigmaUrl: design link with node-id', () => {
  const { fileKey, nodeId } = parseFigmaUrl(
    'https://www.figma.com/design/AbC123xyz/My-Site?node-id=12-345&t=q'
  );
  assert.equal(fileKey, 'AbC123xyz');
  assert.equal(nodeId, '12:345');
});

test('parseFigmaUrl: file link without node-id', () => {
  const { fileKey, nodeId } = parseFigmaUrl('https://www.figma.com/file/Key456/Name');
  assert.equal(fileKey, 'Key456');
  assert.equal(nodeId, null);
});

test('parseFigmaUrl: rejects non-figma URLs', () => {
  assert.throws(() => parseFigmaUrl('https://example.com/design/abc'));
});
