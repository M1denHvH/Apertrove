const { test } = require('node:test');
const assert = require('node:assert/strict');
const { capabilityReport, readStatus } = require('../electron/camera-capabilities.cjs');
const { onboardingState } = require('../electron/onboarding.cjs');

test('Capability report separates live evidence, descriptor limits, Busy and unknown commands', () => {
  const state = { saveTo: 3, properties: { iso: { writable: true, allowed: [72, 80] }, aperture: { descriptorCode: 0x81 }, afMode: { value: 3 } } };
  const input = { state, read: id => ({ code: id === 0x507 ? 0xa102 : 0 }), storage: { volumes: [], code: 0x81 }, exports: { volume: true }, restricted: false };
  const report = new Map(capabilityReport(input).map(row => [row.id, row.status]));
  assert.equal(report.get('iso'), 'ready');
  assert.equal(report.get('aperture'), 'temporary');
  assert.equal(report.get('autofocus'), 'temporary');
  assert.equal(report.get('capture'), 'unknown');
  assert.equal(report.get('evfZoom'), 'temporary');
  assert.equal(report.get('volumes'), 'temporary');
  assert.equal(report.get('video'), 'unimplemented');
  assert.equal(capabilityReport({ ...input, evidence: { capture: true } }).find(row => row.id === 'capture').status, 'ready');
  assert.equal(capabilityReport({ ...input, restricted: true }).find(row => row.id === 'capture').status, 'unsupported');
  assert.equal(readStatus(0x7), 'unknown');
  assert.equal(readStatus(0x2), 'error');
});

test('New profiles begin at welcome, existing profiles are not interrupted, and incomplete progress resumes', () => {
  assert.equal(onboardingState(null).completed, false);
  assert.equal(onboardingState(null, true).completed, true);
  const progress = onboardingState({ step: 'workspace', topic: 'inspector', completed: false, skipped: ['connection', 'invalid', 'connection'] }, true);
  assert.equal(progress.completed, false);
  assert.equal(progress.step, 'workspace');
  assert.equal(progress.topic, 'inspector');
  assert.deepEqual(progress.skipped, ['connection']);
});
