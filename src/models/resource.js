/**
 * ResourceRecord – canonical internal representation of any detected or stashed resource.
 *
 * Design principles:
 *  - Detection code only *produces* records; it never mutates them after creation.
 *  - Downstream integrations *consume* records.
 *  - User-initiated mutations (label edits, removal) go through explicit update helpers.
 */

/**
 * Valid resource type strings.
 * @readonly
 * @enum {string}
 */
export const ResourceType = {
  MANIFEST: 'manifest',
  IIIF_IMAGE: 'iiif-image',
  IMAGE: 'image',
  METADATA: 'metadata',
  UNKNOWN: 'unknown',
};

/**
 * Detection confidence levels.
 * @readonly
 * @enum {string}
 */
export const Confidence = {
  EXPLICIT: 'explicit',
  INFERRED: 'inferred',
  SPECULATIVE: 'speculative',
};

/**
 * Detection method descriptors.
 * @readonly
 * @enum {string}
 */
export const DetectedVia = {
  TEXT_SCAN: 'text-scan',
  DOM: 'dom',
  METADATA: 'metadata',
  INFERENCE: 'inference',
};

/**
 * Generate a stable UUID for a new record.
 * Falls back to a timestamp-based ID in environments without crypto.randomUUID.
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random hex
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Create a new ResourceRecord with required defaults.
 *
 * @param {object} fields
 * @param {string} fields.resourceType       – One of ResourceType values
 * @param {string} [fields.resourceUrl]      – Canonical URL if available
 * @param {string} fields.sourcePage         – URL of the page where detected
 * @param {string} [fields.label]            – Human-readable label
 * @param {string} fields.confidence         – One of Confidence values
 * @param {string} fields.detectedVia        – One of DetectedVia values
 * @param {object} [fields.context]          – Optional selector, dimensions, metadata snippets
 * @returns {ResourceRecord}
 */
export function createResourceRecord({
  resourceType,
  resourceUrl,
  sourcePage,
  label,
  confidence,
  detectedVia,
  context,
}) {
  if (!resourceType) throw new Error('resourceType is required');
  if (!sourcePage) throw new Error('sourcePage is required');
  if (!confidence) throw new Error('confidence is required');
  if (!detectedVia) throw new Error('detectedVia is required');

  const now = new Date().toISOString();
  return {
    id: generateId(),
    resourceType,
    resourceUrl: resourceUrl || null,
    sourcePage,
    label: label || '',
    confidence,
    detectedVia,
    context: context || {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Produce an updated copy of an existing record with user-supplied changes.
 * Only label, context, and resourceUrl may be mutated after creation.
 *
 * @param {ResourceRecord} record  – Existing record
 * @param {object} changes         – { label?, resourceUrl?, context? }
 * @returns {ResourceRecord}
 */
export function updateResourceRecord(record, changes) {
  const allowed = ['label', 'resourceUrl', 'context'];
  const patch = Object.fromEntries(
    Object.entries(changes).filter(([k]) => allowed.includes(k))
  );
  return {
    ...record,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}
