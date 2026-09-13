import DxfParser from 'dxf-parser';

export interface Point {
  x: number;
  y: number;
}

export interface PolylineShape {
  points: Point[];
  closed: boolean;
}

export interface CircleShape {
  center: Point;
  radius: number;
}

export interface ParsedDesign {
  id: string;
  name: string;
  width: number;
  height: number;
  polylines: PolylineShape[];
  circles: CircleShape[];
  quantity: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface TransformMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

type BlockDictionary = Record<string, { entities?: any[] } | undefined>;

export const MIN_LAYOUT_SIZE = 1;
const EPSILON = 1e-5;
const identityTransform: TransformMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export async function parseDxfFile(file: File): Promise<ParsedDesign> {
  const text = await file.text();
  const parser = new DxfParser({ tolerantMode: true });
  const drawing = parser.parseSync(text);
  const entities: any[] = drawing?.entities ?? [];
  const blocks: BlockDictionary = drawing?.blocks ?? {};
  const rawGeometry = extractGeometry(entities, blocks, identityTransform);

  if (!rawGeometry.polylines.length && !rawGeometry.circles.length) {
    throw new Error('No drawable vectors were found in the DXF file.');
  }

  const { bounds, polylines: normalizedPolylines, circles: normalizedCircles } = normalizeGeometry(rawGeometry);

  return {
    id: buildDesignId(),
    name: file.name.replace(/\.dxf$/i, ''),
    width: Math.max(bounds.maxX - bounds.minX, MIN_LAYOUT_SIZE),
    height: Math.max(bounds.maxY - bounds.minY, MIN_LAYOUT_SIZE),
    polylines: normalizedPolylines,
    circles: normalizedCircles,
    quantity: 1,
  };
}

export function normalizePolylines(polylines: PolylineShape[]) {
  return normalizeGeometry({ polylines, circles: [] });
}

export function normalizeGeometry(geometry: { polylines: PolylineShape[]; circles?: CircleShape[] }) {
  const circles = geometry.circles ?? [];
  const bounds = getBounds(geometry.polylines, circles);
  const normalizedPolylines = geometry.polylines.map((polyline) => ({
    closed: polyline.closed,
    points: polyline.points.map((point) => ({
      x: point.x - bounds.minX,
      y: point.y - bounds.minY,
    })),
  }));
  const normalizedCircles = circles.map((circle) => ({
    radius: circle.radius,
    center: {
      x: circle.center.x - bounds.minX,
      y: circle.center.y - bounds.minY,
    },
  }));

  return { bounds, polylines: normalizedPolylines, circles: normalizedCircles };
}

export function buildDesignId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `design-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function extractGeometry(
  entities: any[],
  blocks: BlockDictionary,
  transform: TransformMatrix,
): { polylines: PolylineShape[]; circles: CircleShape[] } {
  const polylines: PolylineShape[] = [];
  const circles: CircleShape[] = [];

  entities.forEach((entity) => {
    if (!entity) return;
    if (entity.type === 'INSERT') {
      const expanded = expandInsert(entity, blocks, transform);
      polylines.push(...expanded.polylines);
      circles.push(...expanded.circles);
      return;
    }

    const geometry = entityToGeometry(entity);
    geometry.polylines.forEach((polyline) => {
      polylines.push(applyTransform(polyline, transform));
    });
    geometry.circles.forEach((circle) => {
      const transformed = applyCircleTransform(circle, transform);
      if (transformed.circle) {
        circles.push(transformed.circle);
      } else if (transformed.polyline) {
        polylines.push(transformed.polyline);
      }
    });
  });

  return {
    polylines: polylines.filter((polyline) => polyline.points.length >= 2),
    circles: circles.filter((circle) => circle.radius > 0),
  };
}

function expandInsert(entity: any, blocks: BlockDictionary, parentTransform: TransformMatrix) {
  const blockName = entity.name || entity.block || entity.blockName;
  if (!blockName) {
    return { polylines: [], circles: [] };
  }
  const block = blocks[blockName];
  if (!block?.entities?.length) {
    return { polylines: [], circles: [] };
  }

  const baseTransform = composeTransforms(
    parentTransform,
    composeTransforms(
      createTranslationTransform(entity.position?.x ?? 0, entity.position?.y ?? 0),
      createRotationScaleTransform(entity),
    ),
  );

  const rows = Math.max(1, entity.rowCount ?? 1);
  const cols = Math.max(1, entity.columnCount ?? 1);
  const rowSpacing = entity.rowSpacing ?? 0;
  const columnSpacing = entity.columnSpacing ?? 0;
  const polylines: PolylineShape[] = [];
  const circles: CircleShape[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const offset = createTranslationTransform(col * columnSpacing, row * rowSpacing);
      const combined = composeTransforms(baseTransform, offset);
      const extracted = extractGeometry(block.entities ?? [], blocks, combined);
      polylines.push(...extracted.polylines);
      circles.push(...extracted.circles);
    }
  }

  return { polylines, circles };
}

function entityToGeometry(entity: any): { polylines: PolylineShape[]; circles: CircleShape[] } {
  switch (entity.type) {
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vertices = entity.vertices ?? entity.points ?? [];
      const closed = Boolean(entity.closed || entity.shape || entity.isClosed);
      const polyline = buildPolylineFromVertices(vertices, closed);
      return { polylines: polyline ? [polyline] : [], circles: [] };
    }
    case 'LINE': {
      const startPoint = toPoint(entity.start ?? entity.vertices?.[0]);
      const endPoint = toPoint(entity.end ?? entity.vertices?.[1]);
      const points = [startPoint, endPoint].filter(isPoint) as Point[];
      return points.length >= 2
        ? { polylines: [{ closed: false, points }], circles: [] }
        : { polylines: [], circles: [] };
    }
    case 'CIRCLE': {
      const circle = circleFromEntity(entity);
      return circle ? { polylines: [], circles: [circle] } : { polylines: [], circles: [] };
    }
    case 'ARC':
      return { polylines: [{ closed: false, points: approximateArc(entity) }], circles: [] };
    case 'ELLIPSE':
      return { polylines: [{ closed: Boolean(entity.closed), points: approximateEllipse(entity) }], circles: [] };
    case 'SPLINE':
      return {
        polylines: [
          {
            closed: Boolean(entity.closed),
            points: (entity.fitPoints ?? entity.controlPoints ?? []).map(toPoint).filter(isPoint) as Point[],
          },
        ],
        circles: [],
      };
    default:
      return { polylines: [], circles: [] };
  }
}

function toPoint(input: any): Point | null {
  if (!input) return null;
  const x = typeof input.x === 'number' ? input.x : typeof input[0] === 'number' ? input[0] : null;
  const y = typeof input.y === 'number' ? input.y : typeof input[1] === 'number' ? input[1] : null;
  if (x === null || y === null || !isFinite(x) || !isFinite(y)) {
    return null;
  }
  return { x, y };
}

function isPoint(candidate: Point | null): candidate is Point {
  return Boolean(candidate);
}

export function getBounds(polylines: PolylineShape[], circles: CircleShape[] = []): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  polylines.forEach((polyline) => {
    polyline.points.forEach((point) => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    });
  });
  circles.forEach((circle) => {
    minX = Math.min(minX, circle.center.x - circle.radius);
    minY = Math.min(minY, circle.center.y - circle.radius);
    maxX = Math.max(maxX, circle.center.x + circle.radius);
    maxY = Math.max(maxY, circle.center.y + circle.radius);
  });

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    throw new Error('Unable to determine vector bounds.');
  }

  return { minX, minY, maxX, maxY };
}

function circleFromEntity(entity: any): CircleShape | null {
  const radius = entity.radius ?? entity.r ?? 0;
  const center = toPoint(entity.center ?? { x: 0, y: 0 });
  if (!center || radius <= 0) {
    return null;
  }
  return { center, radius };
}

function approximateCircle(circle: CircleShape): Point[] {
  const { center, radius } = circle;
  const steps = 64;
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

function approximateArc(entity: any): Point[] {
  const radius = entity.radius ?? 0;
  const center = entity.center ?? { x: 0, y: 0 };
  const startAngle = degToRad(entity.startAngle ?? 0);
  let endAngle = degToRad(entity.endAngle ?? 360);
  if (endAngle <= startAngle) {
    endAngle += Math.PI * 2;
  }
  const sweep = endAngle - startAngle;
  const segments = Math.max(12, Math.ceil((sweep * 180) / (Math.PI * 10)));

  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + (sweep * index) / segments;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });
}

function approximateEllipse(entity: any): Point[] {
  const center = entity.center ?? { x: 0, y: 0 };
  const axis = entity.majorAxisEndPoint ?? { x: 1, y: 0 };
  const major = Math.hypot(axis.x, axis.y) || 1;
  const minor = major * (entity.axisRatio ?? 1);
  const rotation = Math.atan2(axis.y, axis.x);
  const startAngle = entity.startAngle ?? 0;
  let endAngle = entity.endAngle ?? Math.PI * 2;
  if (endAngle <= startAngle) {
    endAngle += Math.PI * 2;
  }
  const segments = Math.max(24, Math.ceil(((endAngle - startAngle) * 180) / (Math.PI * 10)));

  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = startAngle + ((endAngle - startAngle) * index) / segments;
    const localX = major * Math.cos(angle);
    const localY = minor * Math.sin(angle);
    return {
      x: center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
      y: center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation),
    };
  });
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function buildPolylineFromVertices(vertices: any[], closed: boolean): PolylineShape | null {
  if (!Array.isArray(vertices) || vertices.length < 2) {
    return null;
  }

  const count = vertices.length;
  const limit = closed ? count : count - 1;
  const points: Point[] = [];

  for (let index = 0; index < limit; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % count];
    const start = toPoint(current);
    const end = toPoint(next);
    if (!start || !end) continue;

    pushPoint(points, start);
    const bulge = typeof current?.bulge === 'number' ? current.bulge : 0;
    if (Math.abs(bulge) > EPSILON) {
      const arcPoints = buildBulgeSegment(start, end, bulge);
      arcPoints.forEach((point, pointIndex) => {
        if (!pointIndex && nearlyEqual(point, start)) {
          return;
        }
        pushPoint(points, point);
      });
    } else if (!closed || index < limit - 1) {
      pushPoint(points, end);
    }
  }

  if (!closed) {
    const last = toPoint(vertices[count - 1]);
    if (last) {
      pushPoint(points, last);
    }
  }

  return points.length >= 2 ? { points, closed } : null;
}

function buildBulgeSegment(start: Point, end: Point, bulge: number): Point[] {
  const chord = Math.hypot(end.x - start.x, end.y - start.y);
  if (chord < EPSILON) {
    return [end];
  }

  const sagitta = (bulge * chord) / 2;
  if (Math.abs(sagitta) < EPSILON) {
    return [end];
  }

  const absSagitta = Math.abs(sagitta);
  const radius = (chord * chord + 4 * absSagitta * absSagitta) / (8 * absSagitta);

  const dirX = (end.x - start.x) / chord;
  const dirY = (end.y - start.y) / chord;
  const leftNormal = { x: -dirY, y: dirX };
  const normal =
    sagitta >= 0 ? leftNormal : { x: -leftNormal.x, y: -leftNormal.y };

  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const offset = radius - absSagitta;
  const center = {
    x: mid.x + normal.x * offset,
    y: mid.y + normal.y * offset,
  };

  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const sweep = 4 * Math.atan(bulge);
  const segments = Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
  const points: Point[] = [];

  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + (sweep * index) / segments;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }

  return points;
}

function pushPoint(collection: Point[], point: Point) {
  const previous = collection[collection.length - 1];
  if (!previous || !nearlyEqual(previous, point)) {
    collection.push(point);
  }
}

function nearlyEqual(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y) < EPSILON;
}

function applyTransform(polyline: PolylineShape, transform: TransformMatrix) {
  return {
    ...polyline,
    points: polyline.points.map((point) => applyToPoint(transform, point)),
  };
}

function applyCircleTransform(circle: CircleShape, transform: TransformMatrix) {
  const center = applyToPoint(transform, circle.center);
  const scaleX = Math.hypot(transform.a, transform.b);
  const scaleY = Math.hypot(transform.c, transform.d);
  const dot = transform.a * transform.c + transform.b * transform.d;

  if (Math.abs(scaleX - scaleY) < EPSILON && Math.abs(dot) < EPSILON) {
    return {
      circle: {
        center,
        radius: circle.radius * scaleX,
      },
    };
  }

  return {
    polyline: applyTransform({ closed: true, points: approximateCircle(circle) }, transform),
  };
}

function applyToPoint(transform: TransformMatrix, point: Point): Point {
  return {
    x: point.x * transform.a + point.y * transform.c + transform.tx,
    y: point.x * transform.b + point.y * transform.d + transform.ty,
  };
}

function composeTransforms(a: TransformMatrix, b: TransformMatrix): TransformMatrix {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    tx: a.a * b.tx + a.c * b.ty + a.tx,
    ty: a.b * b.tx + a.d * b.ty + a.ty,
  };
}

function createTranslationTransform(x: number, y: number): TransformMatrix {
  return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y };
}

function createRotationScaleTransform(entity: any): TransformMatrix {
  const rotation = degToRad(entity.rotation ?? 0);
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const sx = entity.xScale ?? 1;
  const sy = entity.yScale ?? 1;

  return {
    a: cosR * sx,
    b: sinR * sx,
    c: -sinR * sy,
    d: cosR * sy,
    tx: 0,
    ty: 0,
  };
}
