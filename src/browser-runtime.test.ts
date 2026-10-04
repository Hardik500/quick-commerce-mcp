import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bigBasketHeadless, bigBasketBrowserArgs, bigBasketBrowserMode } from './browser-runtime.js';

test('BigBasket defaults to headless and visible recovery requires explicit false', () => {
  assert.equal(bigBasketHeadless('true'), true);
  assert.equal(bigBasketHeadless('false'), false);
  const previous = process.env.QC_BIGBASKET_HEADLESS;
  delete process.env.QC_BIGBASKET_HEADLESS;
  try { assert.equal(bigBasketHeadless(), true); }
  finally { if (previous !== undefined) process.env.QC_BIGBASKET_HEADLESS = previous; }
  assert.throws(() => bigBasketHeadless('TRUE'), /true or false/);
  assert.throws(() => bigBasketHeadless(''), /true or false/);
});

test('native Windows headless browser keeps isolated profile and loopback debugging', () => {
  const args = bigBasketBrowserArgs('dedicated-profile', true);
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--user-data-dir=dedicated-profile'));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
  assert.ok(args.includes('--remote-debugging-port=0'));
  assert.ok(!bigBasketBrowserArgs('dedicated-profile', false).some(a => a.startsWith('--headless')));
});

test('background mode is default; visible and true headless modes remain explicit', () => {
  const previous = process.env.QC_BIGBASKET_BROWSER_MODE;
  delete process.env.QC_BIGBASKET_BROWSER_MODE;
  try { assert.equal(bigBasketBrowserMode(), 'background'); }
  finally { if (previous !== undefined) process.env.QC_BIGBASKET_BROWSER_MODE = previous; }
  for (const mode of ['background', 'headless', 'visible'] as const) assert.equal(bigBasketBrowserMode(mode), mode);
  assert.throws(() => bigBasketBrowserMode('hidden'), /headless, background or visible/);
});
