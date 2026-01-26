import type { ParsedDesign, Point, PolylineShape } from './dxf';
import { buildDesignId, MIN_LAYOUT_SIZE, normalizePolylines } from './dxf';

const PATH_MIN_SEGMENTS = 64;
const PATH_TARGET_SEGMENT_LENGTH = 4;
const PATH_GAP_MULTIPLIER = 1.5;
const CIRCLE_STEPS = 64;
const ELLIPSE_STEPS = 96;
const MAX_TRAVERSAL_DEPTH = 100;
const hiddenContainers = new Set(['defs', 'clipPath', 'mask', 'symbol']);

export async function parseSvgFile(file: File): Promise<ParsedDesign> {
  if (typeof DOMParser === 'undefined' || typeof DOMMatrix === 'undefined') {
    throw new Error('SVG parsing is not supported in this environment.');
  }

  const parser = new DOMParser();
  const text = await file.text();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Unable to parse SVG file.');
  }
  const root = doc.documentElement;
  if (!(root instanceof SVGSVGElement)) {
    throw new Error('No SVG root element was found.');
  }

  const polylines = extractSvgPolylines(root);
  if (!polylines.length) {
    throw new Error('No drawable vectors were found in the SVG file.');
  }
  const { bounds, polylines: normalized } = normalizePolylines(polylines);

  return {
    id: buildDesignId(),
    name: file.name.replace(/\.svg$/i, ''),
    width: Math.max(bounds.maxX - bounds.minX, MIN_LAYOUT_SIZE),
    height: Math.max(bounds.maxY - bounds.minY, MIN_LAYOUT_SIZE),
    polylines: normalized,
    quantity: 1,
  };
}

function extractSvgPolylines(root: SVGSVGElement): PolylineShape[] {
  const polylines: PolylineShape[] = [];
  const ownerDocument = root.ownerDocument ?? document;

  const walk = (element: Element, transform: DOMMatrix, depth: number, includeHidden = false) => {
    if (depth > MAX_TRAVERSAL_DEPTH) {
      return;
    }
    const tagName = element.tagName?.toLowerCase() ?? '';
    if (!includeHidden && hiddenContainers.has(tagName)) {
      return;
    }

    const localTransform = parseTransform(element.getAttribute('transform'));
    const nextTransform = localTransform ? transform.multiply(localTransform) : transform;

    if (element instanceof SVGUseElement) {
      const href = element.getAttribute('href') ?? element.getAttribute('xlink:href');
      const targetId = href?.startsWith('#') ? href.slice(1) : null;
      if (targetId && ownerDocument) {
        const target = ownerDocument.getElementById(targetId);
        if (target) {
          const offsetX = parseNumber(element.getAttribute('x'));
          const offsetY = parseNumber(element.getAttribute('y'));
          const offsetMatrix =
            offsetX || offsetY ? nextTransform.multiply(translationMatrix(offsetX, offsetY)) : nextTransform;
          walk(target, offsetMatrix, depth + 1, true);
        }
      }
      return;
    }

    const geometry = geometryToPolylines(element, nextTransform);
    if (geometry.length) {
      polylines.push(...geometry);
    }

    Array.from(element.children).forEach((child) => walk(child, nextTransform, depth + 1, includeHidden));
  };

  walk(root, new DOMMatrix(), 0, false);
  return polylines.filter((polyline) => polyline.points.length >= 2);
}

function geometryToPolylines(element: Element, transform: DOMMatrix): PolylineShape[] {
  if (element instanceof SVGPathElement) {
    return samplePathElement(element).map((polyline) => transformPolyline(polyline, transform));
  }
  if (element instanceof SVGPolygonElement) {
    const points = parseSvgPoints(element.getAttribute('points'));
    return points.length >= 2 ? [transformPolyline({ points, closed: true }, transform)] : [];
  }
  if (element instanceof SVGPolylineElement) {
    const points = parseSvgPoints(element.getAttribute('points'));
    return points.length >= 2 ? [transformPolyline({ points, closed: false }, transform)] : [];
  }
  if (element instanceof SVGLineElement) {
    const x1 = parseNumber(element.getAttribute('x1'));
    const y1 = parseNumber(element.getAttribute('y1'));
    const x2 = parseNumber(element.getAttribute('x2'));
    const y2 = parseNumber(element.getAttribute('y2'));
    const points = [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
    return Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)
      ? [transformPolyline({ points, closed: false }, transform)]
      : [];
  }
  if (element instanceof SVGRectElement) {
    const x = parseNumber(element.getAttribute('x'));
    const y = parseNumber(element.getAttribute('y'));
    const width = parseNumber(element.getAttribute('width'));
    const height = parseNumber(element.getAttribute('height'));
    if (width <= 0 || height <= 0) {
      return [];
    }
    const points = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x, y },
    ];
    return [transformPolyline({ points, closed: true }, transform)];
  }
  if (element instanceof SVGCircleElement) {
    const cx = parseNumber(element.getAttribute('cx'));
    const cy = parseNumber(element.getAttribute('cy'));
    const radius = parseNumber(element.getAttribute('r'));
    if (radius <= 0) {
      return [];
    }
    return [transformPolyline({ points: approximateCirclePoints(cx, cy, radius), closed: true }, transform)];
  }
  if (element instanceof SVGEllipseElement) {
    const cx = parseNumber(element.getAttribute('cx'));
    const cy = parseNumber(element.getAttribute('cy'));
    const rx = parseNumber(element.getAttribute('rx'));
    const ry = parseNumber(element.getAttribute('ry'));
    if (rx <= 0 || ry <= 0) {
      return [];
    }
    return [transformPolyline({ points: approximateEllipsePoints(cx, cy, rx, ry), closed: true }, transform)];
  }

  return [];
}

function samplePathElement(element: SVGPathElement): PolylineShape[] {
  let totalLength: number;
  try {
    totalLength = element.getTotalLength();
  } catch {
    return [];
  }
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    return [];
  }

  const segments = Math.max(PATH_MIN_SEGMENTS, Math.ceil(totalLength / PATH_TARGET_SEGMENT_LENGTH));
  const step = totalLength / segments;
  const gapThreshold = Math.max(1, step * PATH_GAP_MULTIPLIER);
  const polylines: PolylineShape[] = [];
  let current: Point[] = [];

  const pushCurrent = () => {
    if (current.length >= 2) {
      const closed = distance(current[0], current[current.length - 1]) < gapThreshold;
      polylines.push({ points: current, closed });
    }
    current = [];
  };

  for (let index = 0; index <= segments; index += 1) {
    const lengthAt = (totalLength * index) / segments;
    const point = element.getPointAtLength(lengthAt);
    const nextPoint: Point = { x: point.x, y: point.y };
    if (!current.length) {
      current.push(nextPoint);
      continue;
    }
    const last = current[current.length - 1];
    const gap = distance(last, nextPoint);
    if (gap > gapThreshold) {
      pushCurrent();
      current.push(nextPoint);
    } else if (gap > 0) {
      current.push(nextPoint);
    }
  }

  pushCurrent();
  return polylines;
}

function transformPolyline(polyline: PolylineShape, transform: DOMMatrix): PolylineShape {
  return {
    closed: polyline.closed,
    points: transformPoints(polyline.points, transform),
  };
}

function transformPoints(points: Point[], transform: DOMMatrix): Point[] {
  return points.map((point) => {
    const transformed = transform.transformPoint({ x: point.x, y: point.y, z: 0, w: 1 });
    return { x: transformed.x, y: transformed.y };
  });
}

function parseSvgPoints(value: string | null): Point[] {
  if (!value) return [];
  const parts = value
    .trim()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((token) => parseFloat(token))
    .filter((num) => Number.isFinite(num));
  const points: Point[] = [];
  for (let index = 0; index < parts.length - 1; index += 2) {
    points.push({ x: parts[index], y: parts[index + 1] });
  }
  return points;
}

function approximateCirclePoints(cx: number, cy: number, radius: number): Point[] {
  return Array.from({ length: CIRCLE_STEPS + 1 }, (_, index) => {
    const angle = (index / CIRCLE_STEPS) * Math.PI * 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

function approximateEllipsePoints(cx: number, cy: number, rx: number, ry: number): Point[] {
  return Array.from({ length: ELLIPSE_STEPS + 1 }, (_, index) => {
    const angle = (index / ELLIPSE_STEPS) * Math.PI * 2;
    return {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    };
  });
}

function parseTransform(value: string | null): DOMMatrix | null {
  if (!value) {
    return null;
  }
  const commandPattern = /([a-zA-Z]+)\(([^)]+)\)/g;
  const matrix = new DOMMatrix();
  let match: RegExpExecArray | null;
  while ((match = commandPattern.exec(value)) !== null) {
    const command = match[1].toLowerCase();
    const params = match[2]
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((num) => Number.isFinite(num));
    switch (command) {
      case 'matrix': {
        if (params.length >= 6) {
          const next = new DOMMatrix();
          [next.a, next.b, next.c, next.d, next.e, next.f] = params;
          matrix.multiplySelf(next);
        }
        break;
      }
      case 'translate': {
        const [tx = 0, ty = 0] = params;
        matrix.translateSelf(tx, ty);
        break;
      }
      case 'scale': {
        const [sx = 1, sy = sx] = params;
        matrix.scaleSelf(sx, sy);
        break;
      }
      case 'rotate': {
        const [angle = 0, cx = 0, cy = 0] = params;
        if (cx || cy) {
          matrix.translateSelf(cx, cy);
          matrix.rotateSelf(angle);
          matrix.translateSelf(-cx, -cy);
        } else {
          matrix.rotateSelf(angle);
        }
        break;
      }
      case 'skewx': {
        const [angle = 0] = params;
        matrix.skewXSelf(angle);
        break;
      }
      case 'skewy': {
        const [angle = 0] = params;
        matrix.skewYSelf(angle);
        break;
      }
      default:
        break;
    }
  }
  return matrix;
}

function translationMatrix(x: number, y: number) {
  const matrix = new DOMMatrix();
  matrix.translateSelf(x, y);
  return matrix;
}

function parseNumber(value: string | null, fallback = 0) {
  if (value == null) {
    return fallback;
  }
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
