import type { ParsedDesign } from './dxf';
import { parseDxfFile } from './dxf';
import { parseSvgFile } from './svg-file';

type SupportedFormat = 'dxf' | 'svg';

export async function parseDesignFile(file: File): Promise<ParsedDesign> {
  const format = detectVectorFormat(file);
  if (format === 'svg') {
    return parseSvgFile(file);
  }
  if (format === 'dxf') {
    return parseDxfFile(file);
  }
  throw new Error('Unsupported file type. Please upload SVG or DXF files.');
}

function detectVectorFormat(file: File): SupportedFormat | null {
  const extension = file.name?.split('.').pop()?.toLowerCase();
  if (extension === 'svg') {
    return 'svg';
  }
  if (extension === 'dxf') {
    return 'dxf';
  }
  if (file.type) {
    if (file.type.includes('svg')) {
      return 'svg';
    }
    if (file.type.includes('dxf')) {
      return 'dxf';
    }
    if (file.type.includes('cad')) {
      return 'dxf';
    }
  }
  return null;
}
