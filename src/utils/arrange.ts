import type { ParsedDesign } from './dxf';

export interface Placement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotated: boolean;
  design: ParsedDesign;
}

export interface BedLayout {
  id: string;
  index: number;
  placements: Placement[];
  usedWidth: number;
  usedHeight: number;
}

interface WorkingBed extends BedLayout {
  freeRects: FreeRect[];
}

interface DesignInstance {
  design: ParsedDesign;
  instanceId: string;
}

interface FreeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacementCandidate {
  rect: FreeRect;
  width: number;
  height: number;
  rotated: boolean;
  score: number;
  leftoverLongSide: number;
}

export function arrangeDesigns(
  designs: ParsedDesign[],
  bedWidth: number,
  bedHeight: number,
  spacing: number,
): BedLayout[] {
  const normalizedSpacing = Math.max(spacing, 0);
  const instances = expandDesigns(designs).sort(sortBySize);
  if (!instances.length) {
    return [];
  }

  const beds: BedLayout[] = [];
  let bedIndex = 0;
  let bed = createBed(++bedIndex, bedWidth, bedHeight);

  const finalizeBed = () => {
    if (!bed.placements.length) {
      return;
    }
    beds.push({
      id: bed.id,
      index: bed.index,
      placements: [...bed.placements],
      usedWidth: Math.min(bed.usedWidth, bedWidth),
      usedHeight: Math.min(bed.usedHeight, bedHeight),
    });
  };

  instances.forEach((instance) => {
    const width = Math.max(instance.design.width, 1);
    const height = Math.max(instance.design.height, 1);
    if (width > bedWidth || height > bedHeight) {
      return;
    }

    let placed = false;
    while (!placed) {
      const nextPlacement = findPlacement(bed, width, height);
      if (!nextPlacement) {
        finalizeBed();
        bed = createBed(++bedIndex, bedWidth, bedHeight);
        continue;
      }

      const candidate: PlacementCandidate = nextPlacement;
      const placement: Placement = {
        id: instance.instanceId,
        x: candidate.rect.x,
        y: candidate.rect.y,
        width: candidate.width,
        height: candidate.height,
        rotated: candidate.rotated,
        design: instance.design,
      };

      bed.placements.push(placement);
      const extentX = placement.x + placement.width;
      const extentY = placement.y + placement.height;
      bed.usedWidth = Math.max(bed.usedWidth, extentX);
      bed.usedHeight = Math.max(bed.usedHeight, extentY);

      const occupied = {
        x: placement.x,
        y: placement.y,
        width: Math.min(placement.width + normalizedSpacing, bedWidth - placement.x),
        height: Math.min(placement.height + normalizedSpacing, bedHeight - placement.y),
      };

      bed.freeRects = splitFreeRects(bed.freeRects, occupied);
      bed.freeRects = pruneFreeRects(bed.freeRects);
      placed = true;
    }
  });

  finalizeBed();

  return beds;

  function findPlacement(currentBed: WorkingBed, width: number, height: number) {
    let bestCandidate: PlacementCandidate | null = null;
    currentBed.freeRects.forEach((rect) => {
      const candidates = [tryPlace(rect, width, height, false), tryPlace(rect, height, width, true)];
      candidates.forEach((candidate) => {
        if (!candidate) return;
        if (
          !bestCandidate ||
          candidate.score < bestCandidate.score ||
          (candidate.score === bestCandidate.score && candidate.leftoverLongSide < bestCandidate.leftoverLongSide)
        ) {
          bestCandidate = candidate;
        }
      });
    });
    return bestCandidate;
  }

  function tryPlace(rect: FreeRect, width: number, height: number, rotated: boolean): PlacementCandidate | null {
    if (width > rect.width || height > rect.height) {
      return null;
    }
    const leftoverHoriz = Math.abs(rect.width - width);
    const leftoverVert = Math.abs(rect.height - height);
    const shortSideFit = Math.min(leftoverHoriz, leftoverVert);
    const longSideFit = Math.max(leftoverHoriz, leftoverVert);
    return { rect, width, height, rotated, score: shortSideFit, leftoverLongSide: longSideFit };
  }
}

function expandDesigns(designs: ParsedDesign[]): DesignInstance[] {
  const instances: DesignInstance[] = [];
  designs.forEach((design) => {
    const qty = Math.max(1, Math.floor(design.quantity || 1));
    for (let count = 0; count < qty; count += 1) {
      instances.push({
        design,
        instanceId: `${design.id}-${count + 1}`,
      });
    }
  });
  return instances;
}

function sortBySize(a: DesignInstance, b: DesignInstance) {
  const areaA = a.design.width * a.design.height;
  const areaB = b.design.width * b.design.height;
  if (areaA === areaB) {
    return Math.max(b.design.width, b.design.height) - Math.max(a.design.width, a.design.height);
  }
  return areaB - areaA;
}

function createBed(index: number, width: number, height: number): WorkingBed {
  return {
    id: `bed-${index}`,
    index,
    placements: [],
    usedWidth: 0,
    usedHeight: 0,
    freeRects: [
      {
        x: 0,
        y: 0,
        width,
        height,
      },
    ],
  };
}

function splitFreeRects(rects: FreeRect[], used: { x: number; y: number; width: number; height: number }) {
  const result: FreeRect[] = [];
  rects.forEach((rect) => {
    if (!rectanglesIntersect(rect, used)) {
      result.push(rect);
      return;
    }

    const usedRight = used.x + used.width;
    const usedTop = used.y + used.height;
    const rectRight = rect.x + rect.width;
    const rectTop = rect.y + rect.height;

    if (used.x > rect.x) {
      result.push({
        x: rect.x,
        y: rect.y,
        width: used.x - rect.x,
        height: rect.height,
      });
    }

    if (usedRight < rectRight) {
      result.push({
        x: usedRight,
        y: rect.y,
        width: rectRight - usedRight,
        height: rect.height,
      });
    }

    const overlapWidth = Math.min(rectRight, usedRight) - Math.max(rect.x, used.x);
    if (overlapWidth > 0) {
      if (used.y > rect.y) {
        result.push({
          x: Math.max(rect.x, used.x),
          y: rect.y,
          width: overlapWidth,
          height: used.y - rect.y,
        });
      }

      if (usedTop < rectTop) {
        result.push({
          x: Math.max(rect.x, used.x),
          y: usedTop,
          width: overlapWidth,
          height: rectTop - usedTop,
        });
      }
    }
  });

  return result.filter((rect) => rect.width > 0 && rect.height > 0);
}

function pruneFreeRects(rects: FreeRect[]) {
  const pruned: FreeRect[] = [];
  rects.forEach((rect, index) => {
    let contained = false;
    rects.forEach((other, otherIndex) => {
      if (index === otherIndex) return;
      if (isContained(rect, other)) {
        contained = true;
      }
    });
    if (!contained) {
      pruned.push(rect);
    }
  });
  return pruned;
}

function rectanglesIntersect(a: FreeRect, b: { x: number; y: number; width: number; height: number }) {
  return !(
    a.x >= b.x + b.width ||
    a.x + a.width <= b.x ||
    a.y >= b.y + b.height ||
    a.y + a.height <= b.y
  );
}

function isContained(a: FreeRect, b: FreeRect) {
  return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}
