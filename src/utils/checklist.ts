import { jsPDF } from 'jspdf';
import type { BedLayout } from './arrange';
import { buildBedSvg } from './svg';

interface ChecklistOptions {
  projectName: string;
  bedWidth: number;
  bedHeight: number;
  workWidth: number;
  workHeight: number;
  margin: number;
  colorForPlacement: (bed: BedLayout, designId: string, placementIndex: number) => string;
}

interface PartSummary {
  label: string;
  quantity: number;
  width: number;
  height: number;
}

export async function buildChecklistPdf(beds: BedLayout[], options: ChecklistOptions) {
  if (!beds.length) {
    throw new Error('No beds available to build a checklist.');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const title = options.projectName || 'CNC Run';

  for (let bedIndex = 0; bedIndex < beds.length; bedIndex += 1) {
    const bed = beds[bedIndex];
    if (bedIndex > 0) {
      doc.addPage();
    }

    doc.setFontSize(16);
    doc.text(`${title} – Bed ${bed.index}`, 20, 18);
    doc.setFontSize(11);
    doc.text(`Total parts: ${bed.placements.length}`, 20, 25);

    const svg = buildBedSvg(
      bed,
      options.bedWidth,
      options.bedHeight,
      options.workWidth,
      options.workHeight,
      options.margin,
      (designId, placementIndex) => options.colorForPlacement(bed, designId, placementIndex),
      { includeMarginOutline: false },
    );
    try {
      const preview = await svgToPngDataUrl(svg, options.bedWidth, options.bedHeight);
      const maxWidth = 170;
      const scale = Math.min(1, maxWidth / options.bedWidth);
      const displayWidth = options.bedWidth * scale;
      const displayHeight = options.bedHeight * scale;
      doc.addImage(preview, 'PNG', 20, 32, displayWidth, displayHeight);
      doc.line(20, 32 + displayHeight + 2, 190, 32 + displayHeight + 2);
      addSummary(doc, bed, 38 + displayHeight);
    } catch (error) {
      // fallback to text-only summary if SVG conversion fails
      doc.text('Preview unavailable', 20, 34);
      addSummary(doc, bed, 42);
      console.error('Unable to embed bed preview into checklist PDF.', error);
    }
  }

  return doc.output('arraybuffer');
}

function addSummary(doc: jsPDF, bed: BedLayout, startY: number) {
  const summaries = summarizeBed(bed);
  let y = startY;
  const maxY = 280;

  summaries.forEach((summary, index) => {
    if (y > maxY) {
      doc.addPage();
      y = 20;
    }
    const line = `[  ] ${summary.label} (qty ${summary.quantity}) – ${summary.width.toFixed(0)} × ${summary.height.toFixed(0)} mm`;
    doc.text(line, 20, y);
    y += 8;
    if ((index + 1) % 5 === 0) {
      doc.line(20, y - 4, 190, y - 4);
    }
  });
}

function summarizeBed(bed: BedLayout): PartSummary[] {
  const summary = new Map<string, PartSummary>();
  bed.placements.forEach((placement) => {
    const key = placement.design.id;
    const label = placement.design.name || 'Unnamed part';
    const entry = summary.get(key);
    if (entry) {
      entry.quantity += 1;
    } else {
      summary.set(key, {
        label,
        quantity: 1,
        width: placement.design.width,
        height: placement.design.height,
      });
    }
  });
  return Array.from(summary.values());
}

function svgToPngDataUrl(svg: string, width: number, height: number) {
  return new Promise<string>((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Unable to acquire canvas context.'));
        return;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });
}
