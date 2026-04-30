# Resource Model

All detected and stashed items in Illuminator share a single canonical **ResourceRecord** shape, regardless of how they were discovered.

---

## ResourceRecord

```typescript
interface ResourceRecord {
  id: string;               // Stable UUID (crypto.randomUUID or fallback)
  resourceType: string;     // See ResourceType below
  resourceUrl: string | null; // Canonical URL, if available
  sourcePage: string;       // URL of the page where detected
  label: string;            // Inferred or user-supplied label (may be empty)
  confidence: string;       // See Confidence below
  detectedVia: string;      // See DetectedVia below
  context: object;          // Selector, dimensions, metadata snippets
  createdAt: ISODateString; // When the record was first created
  updatedAt: ISODateString; // When the record was last mutated by the user
}
```

---

## ResourceType

| Value | Meaning |
|-------|---------|
| `manifest` | IIIF Presentation API manifest |
| `iiif-image` | IIIF Image API URL or info.json reference |
| `image` | High-resolution image rendered on the page |
| `metadata` | Image reference from meta/link tags or JSON-LD |
| `unknown` | Unable to classify |

---

## Confidence

| Value | Meaning |
|-------|---------|
| `explicit` | Unambiguously identified (e.g. `@type: sc:Manifest`) |
| `inferred` | Strong heuristic evidence (e.g. URL contains `manifest`) |
| `speculative` | Weak signal; worth surfacing but flagged for user review |

---

## DetectedVia

| Value | Meaning |
|-------|---------|
| `text-scan` | Found in inline script text |
| `dom` | Found via DOM element inspection |
| `metadata` | Found via `<meta>`, `<link>`, or JSON-LD |
| `inference` | Derived from surrounding structure or patterns |

---

## Context object

The `context` field is a free-form object used to carry detection-specific metadata. Common keys:

| Key | Used by | Meaning |
|-----|---------|---------|
| `selector` | DOM detectors | CSS selector for the originating element (used for highlighting) |
| `alt` | Image detectors | `alt` attribute of the `<img>` element |
| `width` / `height` | Image detectors | Pixel dimensions |
| `iiifServiceBase` | IIIF Image API detector | Base URI of the Image API service |
| `viewerSrc` | Iframe detector | Full `src` of the viewer iframe |
| `foundIn` | Text scan | Where in the document the URL was found |

---

## Immutability Rules

- Detection code **only produces** records — never mutates after creation.
- Only three fields may be mutated by user action (via `updateResourceRecord`):
  - `label`
  - `resourceUrl`
  - `context`
- Every mutation advances `updatedAt`.
- `id`, `resourceType`, `sourcePage`, `confidence`, `detectedVia`, and `createdAt` are write-once.

---

## Example record

```json
{
  "id": "3b6d0c4a-1f5e-4a2b-8c7d-9e0f1a2b3c4d",
  "resourceType": "manifest",
  "resourceUrl": "https://iiif.example.com/manuscripts/ms001/manifest.json",
  "sourcePage": "https://library.example.com/ms001",
  "label": "Manuscript 001",
  "confidence": "explicit",
  "detectedVia": "metadata",
  "context": {
    "selector": "link",
    "rel": "related",
    "type": "application/ld+json"
  },
  "createdAt": "2026-04-30T12:00:00.000Z",
  "updatedAt": "2026-04-30T12:00:00.000Z"
}
```
