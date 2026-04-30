/**
 * tests/stash.test.js – Unit tests for stash persistence logic.
 *
 * We test the stash operations (add, remove, update, clear) independently of
 * the browser extension runtime by extracting the pure-function logic into a
 * testable module (stash-ops.js) or testing directly via in-memory simulation.
 *
 * Since the actual service-worker.js relies on chrome.storage.local, we verify
 * the logic by unit-testing equivalent pure functions.
 */

import {
  createResourceRecord,
  ResourceType,
  Confidence,
  DetectedVia,
} from '../src/models/resource.js';

// ---------------------------------------------------------------------------
// Pure stash operations (mirrors service-worker.js logic, minus chrome.storage)
// ---------------------------------------------------------------------------

function addToStash(stash, record) {
  if (stash.some((r) => r.id === record.id)) return stash;
  return [...stash, record];
}

function removeFromStash(stash, id) {
  return stash.filter((r) => r.id !== id);
}

function updateInStash(stash, id, changes) {
  const allowed = ['label', 'resourceUrl', 'context'];
  const patch = Object.fromEntries(
    Object.entries(changes).filter(([k]) => allowed.includes(k))
  );
  return stash.map((r) => {
    if (r.id !== id) return r;
    return { ...r, ...patch, updatedAt: new Date().toISOString() };
  });
}

function clearStash() {
  return [];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(overrides = {}) {
  return createResourceRecord({
    resourceType: ResourceType.MANIFEST,
    sourcePage: 'https://example.com/',
    confidence: Confidence.EXPLICIT,
    detectedVia: DetectedVia.METADATA,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stash: addToStash', () => {
  test('adds a new record to an empty stash', () => {
    const rec = makeRecord();
    const stash = addToStash([], rec);
    expect(stash).toHaveLength(1);
    expect(stash[0].id).toBe(rec.id);
  });

  test('adds multiple distinct records', () => {
    const a = makeRecord({ label: 'A' });
    const b = makeRecord({ label: 'B' });
    let stash = addToStash([], a);
    stash = addToStash(stash, b);
    expect(stash).toHaveLength(2);
  });

  test('does not add the same record twice (by id)', () => {
    const rec = makeRecord();
    let stash = addToStash([], rec);
    stash = addToStash(stash, rec);
    expect(stash).toHaveLength(1);
  });

  test('does not mutate the original stash array', () => {
    const original = [];
    const rec = makeRecord();
    addToStash(original, rec);
    expect(original).toHaveLength(0);
  });
});

describe('stash: removeFromStash', () => {
  test('removes a record by id', () => {
    const a = makeRecord({ label: 'A' });
    const b = makeRecord({ label: 'B' });
    let stash = [a, b];
    stash = removeFromStash(stash, a.id);
    expect(stash).toHaveLength(1);
    expect(stash[0].id).toBe(b.id);
  });

  test('returns unchanged stash when id not found', () => {
    const a = makeRecord();
    const stash = removeFromStash([a], 'nonexistent-id');
    expect(stash).toHaveLength(1);
  });

  test('returns empty array when removing last record', () => {
    const a = makeRecord();
    const stash = removeFromStash([a], a.id);
    expect(stash).toHaveLength(0);
  });
});

describe('stash: updateInStash', () => {
  test('updates label of matching record', () => {
    const rec = makeRecord({ label: 'Original' });
    const stash = updateInStash([rec], rec.id, { label: 'Updated' });
    expect(stash[0].label).toBe('Updated');
  });

  test('updates resourceUrl of matching record', () => {
    const rec = makeRecord();
    const stash = updateInStash([rec], rec.id, { resourceUrl: 'https://new.url/' });
    expect(stash[0].resourceUrl).toBe('https://new.url/');
  });

  test('ignores disallowed field changes (id, sourcePage, resourceType)', () => {
    const rec = makeRecord();
    const originalId = rec.id;
    const stash = updateInStash([rec], rec.id, {
      id: 'evil',
      sourcePage: 'https://evil.com/',
      resourceType: 'unknown',
      label: 'Allowed',
    });
    expect(stash[0].id).toBe(originalId);
    expect(stash[0].sourcePage).toBe('https://example.com/');
    expect(stash[0].label).toBe('Allowed');
  });

  test('does not affect other records in the stash', () => {
    const a = makeRecord({ label: 'A' });
    const b = makeRecord({ label: 'B' });
    const stash = updateInStash([a, b], a.id, { label: 'A Updated' });
    expect(stash[1].label).toBe('B');
  });

  test('updates updatedAt timestamp', (done) => {
    const rec = makeRecord();
    setTimeout(() => {
      const stash = updateInStash([rec], rec.id, { label: 'New' });
      expect(new Date(stash[0].updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(rec.updatedAt).getTime()
      );
      done();
    }, 5);
  });
});

describe('stash: clearStash', () => {
  test('returns an empty array', () => {
    const stash = clearStash();
    expect(stash).toEqual([]);
  });

  test('clears a non-empty stash', () => {
    const a = makeRecord();
    const b = makeRecord();
    const stash = clearStash([a, b]);
    expect(stash).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

describe('stash invariants', () => {
  test('all records in the stash have unique ids', () => {
    const records = [makeRecord(), makeRecord(), makeRecord()];
    const ids = records.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  test('stash preserves record immutability – original unchanged after update', () => {
    const rec = makeRecord({ label: 'Original' });
    updateInStash([rec], rec.id, { label: 'Mutated' });
    expect(rec.label).toBe('Original');
  });
});
