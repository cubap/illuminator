/**
 * tests/resource.test.js – Unit tests for the ResourceRecord model.
 */

import {
  createResourceRecord,
  updateResourceRecord,
  ResourceType,
  Confidence,
  DetectedVia,
} from '../src/models/resource.js';

// ---------------------------------------------------------------------------
// createResourceRecord
// ---------------------------------------------------------------------------

describe('createResourceRecord', () => {
  const base = {
    resourceType: ResourceType.MANIFEST,
    sourcePage: 'https://example.com/',
    confidence: Confidence.EXPLICIT,
    detectedVia: DetectedVia.METADATA,
  };

  test('creates a record with required fields', () => {
    const record = createResourceRecord(base);

    expect(record.id).toBeTruthy();
    expect(record.resourceType).toBe(ResourceType.MANIFEST);
    expect(record.sourcePage).toBe('https://example.com/');
    expect(record.confidence).toBe(Confidence.EXPLICIT);
    expect(record.detectedVia).toBe(DetectedVia.METADATA);
  });

  test('assigns a unique id to each record', () => {
    const a = createResourceRecord(base);
    const b = createResourceRecord(base);
    expect(a.id).not.toBe(b.id);
  });

  test('sets createdAt and updatedAt as ISO strings', () => {
    const record = createResourceRecord(base);
    expect(() => new Date(record.createdAt)).not.toThrow();
    expect(() => new Date(record.updatedAt)).not.toThrow();
    expect(record.createdAt).toBe(record.updatedAt);
  });

  test('defaults label to empty string when not provided', () => {
    const record = createResourceRecord(base);
    expect(record.label).toBe('');
  });

  test('defaults resourceUrl to null when not provided', () => {
    const record = createResourceRecord(base);
    expect(record.resourceUrl).toBeNull();
  });

  test('defaults context to empty object when not provided', () => {
    const record = createResourceRecord(base);
    expect(record.context).toEqual({});
  });

  test('accepts optional fields', () => {
    const record = createResourceRecord({
      ...base,
      resourceUrl: 'https://example.com/manifest.json',
      label: 'My Manuscript',
      context: { selector: '#viewer' },
    });

    expect(record.resourceUrl).toBe('https://example.com/manifest.json');
    expect(record.label).toBe('My Manuscript');
    expect(record.context).toEqual({ selector: '#viewer' });
  });

  test('throws if resourceType is missing', () => {
    const { resourceType: _removed, ...incomplete } = base;
    expect(() => createResourceRecord(incomplete)).toThrow('resourceType is required');
  });

  test('throws if sourcePage is missing', () => {
    const { sourcePage: _removed, ...incomplete } = base;
    expect(() => createResourceRecord(incomplete)).toThrow('sourcePage is required');
  });

  test('throws if confidence is missing', () => {
    const { confidence: _removed, ...incomplete } = base;
    expect(() => createResourceRecord(incomplete)).toThrow('confidence is required');
  });

  test('throws if detectedVia is missing', () => {
    const { detectedVia: _removed, ...incomplete } = base;
    expect(() => createResourceRecord(incomplete)).toThrow('detectedVia is required');
  });
});

// ---------------------------------------------------------------------------
// updateResourceRecord
// ---------------------------------------------------------------------------

describe('updateResourceRecord', () => {
  let record;

  beforeEach(() => {
    record = createResourceRecord({
      resourceType: ResourceType.IMAGE,
      sourcePage: 'https://example.com/',
      confidence: Confidence.INFERRED,
      detectedVia: DetectedVia.DOM,
      label: 'Original label',
    });
  });

  test('updates label', () => {
    const updated = updateResourceRecord(record, { label: 'New label' });
    expect(updated.label).toBe('New label');
  });

  test('updates resourceUrl', () => {
    const updated = updateResourceRecord(record, { resourceUrl: 'https://example.com/img.jpg' });
    expect(updated.resourceUrl).toBe('https://example.com/img.jpg');
  });

  test('updates context', () => {
    const updated = updateResourceRecord(record, { context: { selector: 'img.hero' } });
    expect(updated.context).toEqual({ selector: 'img.hero' });
  });

  test('advances updatedAt', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(record.updatedAt).getTime() + 1000);
    const updated = updateResourceRecord(record, { label: 'Later' });
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(record.updatedAt).getTime()
    );
    jest.useRealTimers();
  });

  test('does not mutate original record', () => {
    const originalLabel = record.label;
    updateResourceRecord(record, { label: 'Changed' });
    expect(record.label).toBe(originalLabel);
  });

  test('ignores disallowed fields like id and sourcePage', () => {
    const originalId = record.id;
    const originalSource = record.sourcePage;
    const updated = updateResourceRecord(record, {
      id: 'hacked',
      sourcePage: 'https://evil.com/',
      label: 'OK change',
    });
    expect(updated.id).toBe(originalId);
    expect(updated.sourcePage).toBe(originalSource);
    expect(updated.label).toBe('OK change');
  });

  test('preserves unchanged fields', () => {
    const updated = updateResourceRecord(record, { label: 'New' });
    expect(updated.resourceType).toBe(record.resourceType);
    expect(updated.confidence).toBe(record.confidence);
    expect(updated.detectedVia).toBe(record.detectedVia);
    expect(updated.createdAt).toBe(record.createdAt);
    expect(updated.sourcePage).toBe(record.sourcePage);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ResourceType constants', () => {
  test('defines expected types', () => {
    expect(ResourceType.MANIFEST).toBe('manifest');
    expect(ResourceType.IIIF_IMAGE).toBe('iiif-image');
    expect(ResourceType.IMAGE).toBe('image');
    expect(ResourceType.METADATA).toBe('metadata');
    expect(ResourceType.UNKNOWN).toBe('unknown');
  });
});

describe('Confidence constants', () => {
  test('defines three levels', () => {
    expect(Confidence.EXPLICIT).toBe('explicit');
    expect(Confidence.INFERRED).toBe('inferred');
    expect(Confidence.SPECULATIVE).toBe('speculative');
  });
});

describe('DetectedVia constants', () => {
  test('defines detection methods', () => {
    expect(DetectedVia.TEXT_SCAN).toBe('text-scan');
    expect(DetectedVia.DOM).toBe('dom');
    expect(DetectedVia.METADATA).toBe('metadata');
    expect(DetectedVia.INFERENCE).toBe('inference');
  });
});
