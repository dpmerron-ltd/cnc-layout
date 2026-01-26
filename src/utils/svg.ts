import type { BedLayout } from './arrange';
import type { PolylineShape } from './dxf';

interface PathOptions {
  rotate?: boolean;
  designHeight?: number;
}

export function polylineToPath(polyline: PolylineShape, offsetX = 0, offsetY = 0, options?: PathOptions) {
  if (!polyline.points.length) return '';
  const { rotate, designHeight = 0 } = options ?? {};
  const commands = polyline.points.map((point, index) => {
    const { x, y } = rotate ? rotatePoint(point, designHeight) : point;
    const prefix = index === 0 ? 'M' : 'L';
    return `${prefix}${(x + offsetX).toFixed(2)} ${(y + offsetY).toFixed(2)}`;
  });
  if (polyline.closed) {
    commands.push('Z');
  }
  return commands.join(' ');
}

interface BedSvgOptions {
  includeMarginOutline?: boolean;
}

export function buildBedSvg(
  bed: BedLayout,
  bedWidth: number,
  bedHeight: number,
  workWidth: number,
  workHeight: number,
  margin: number,
  colorForDesign: (designId: string, placementIndex: number) => string,
  options?: BedSvgOptions,
) {
  const includeMarginOutline = options?.includeMarginOutline ?? true;
  const gridId = `export-grid-${bed.id}`;
  const lines: string[] = [];

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bedWidth} ${bedHeight}" width="${bedWidth}" height="${bedHeight}" shape-rendering="geometricPrecision">`,
  );
  lines.push(
    `<defs><pattern id="${gridId}" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.2)" /></pattern></defs>`,
  );

  lines.push(`<rect width="${bedWidth}" height="${bedHeight}" fill="url(#${gridId})" />`);
  if (includeMarginOutline && margin > 0 && workWidth > 0 && workHeight > 0) {
    lines.push(
      `<rect x="${margin}" y="${margin}" width="${workWidth}" height="${workHeight}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-dasharray="8 8" />`,
    );
  }
  if (workWidth > 0 && workHeight > 0) {
    lines.push(`<g transform="translate(${margin} ${margin})">`);
    lines.push(`<g transform="scale(1,-1) translate(0 -${workHeight})">`);
    bed.placements.forEach((placement, placementIndex) => {
      placement.design.polylines.forEach((polyline) => {
        const path = polylineToPath(polyline, placement.x, placement.y, {
          rotate: placement.rotated,
          designHeight: placement.design.height,
        });
        if (!path) return;
        const stroke = colorForDesign(placement.design.id, placementIndex);
        lines.push(
          `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter" vector-effect="non-scaling-stroke" />`,
        );
      });
    });
    lines.push('</g>');
    lines.push('</g>');
  }

  lines.push('</svg>');

  return lines.join('\n');
}

function rotatePoint(point: { x: number; y: number }, designHeight: number) {
  return {
    x: designHeight - point.y,
    y: point.x,
  };
}
