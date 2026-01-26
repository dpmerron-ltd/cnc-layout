import { type DragEventHandler, useCallback, useEffect, useMemo, useState } from 'react';
import { arrangeDesigns, canFitWithin, type BedLayout } from './utils/arrange';
import type { ParsedDesign } from './utils/dxf';
import { parseDxfFile } from './utils/dxf';
import { buildBedSvg, polylineToPath } from './utils/svg';
import { buildChecklistPdf } from './utils/checklist';

const accentPalette = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#8338ec'];

interface TrafficSummary {
  count: number;
  uniques: number;
}

interface TrafficSample {
  timestamp: string;
  count: number;
  uniques: number;
}

interface TrafficReport {
  collectedAt: string | null;
  views: TrafficSummary;
  clones: TrafficSummary;
  dailyViews: TrafficSample[];
  dailyClones: TrafficSample[];
}

function App() {
  const [designs, setDesigns] = useState<ParsedDesign[]>([]);
  const [bedWidth, setBedWidth] = useState(1220);
  const [bedHeight, setBedHeight] = useState(1220);
  const [bedMargin, setBedMargin] = useState(10);
  const [spacing, setSpacing] = useState(5);
  const [projectName, setProjectName] = useState('CNC Run');
  const [downloadDirHandle, setDownloadDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [fsAccessSupported, setFsAccessSupported] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeBedIndex, setActiveBedIndex] = useState(0);
  const [folderMessage, setFolderMessage] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<TrafficReport | null>(null);

  useEffect(() => {
    setFsAccessSupported(typeof window !== 'undefined' && 'showDirectoryPicker' in window);
  }, []);

  const workWidth = Math.max(0, bedWidth - bedMargin * 2);
  const workHeight = Math.max(0, bedHeight - bedMargin * 2);

  const { placeableDesigns, oversizedDesigns, totalQuantity, totalArea } = useMemo(() => {
    const overs: ParsedDesign[] = [];
    const placeable: ParsedDesign[] = [];
    let quantity = 0;
    let area = 0;

    designs.forEach((design) => {
      const partArea = design.width * design.height * design.quantity;
      area += partArea;
      quantity += design.quantity;
      if (!canFitWithin(design.width, design.height, workWidth, workHeight)) {
        overs.push(design);
      } else {
        placeable.push(design);
      }
    });

    return { placeableDesigns: placeable, oversizedDesigns: overs, totalQuantity: quantity, totalArea: area };
  }, [designs, workWidth, workHeight]);

  const bedLayouts = useMemo(
    () => arrangeDesigns(placeableDesigns, workWidth, workHeight, spacing),
    [placeableDesigns, workWidth, workHeight, spacing],
  );

  const bedCount = bedLayouts.length;

  useEffect(() => {
    setActiveBedIndex((current) => (bedCount ? Math.min(current, bedCount - 1) : 0));
  }, [bedCount]);

  const activeBed = bedLayouts[activeBedIndex];

  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    designs.forEach((design, index) => {
      map.set(design.id, accentPalette[index % accentPalette.length]);
    });
    return map;
  }, [designs]);

  const oversizedSet = useMemo(
    () => new Set(oversizedDesigns.map((design) => design.id)),
    [oversizedDesigns],
  );

  const sanitizedProjectName = useMemo(() => {
    const trimmed = projectName.trim();
    if (!trimmed) return 'cnc-layout';
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'cnc-layout';
  }, [projectName]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const source = `${import.meta.env.BASE_URL ?? '/'}traffic.json`;
    fetch(source, { cache: 'no-store', signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: TrafficReport | null) => {
        if (!active || !data) {
          return;
        }
        setTraffic(data);
      })
      .catch(() => {
        /* ignore analytics fetch errors */
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const coverage =
    bedCount && workWidth > 0 && workHeight > 0
      ? Math.min(1, totalArea / (workWidth * workHeight * bedCount || 1))
      : 0;

  const totalPlaced = bedLayouts.reduce((sum, bed) => sum + bed.placements.length, 0);
  const activeBedArea =
    activeBed?.placements.reduce((sum, placement) => sum + placement.width * placement.height, 0) ?? 0;
  const activeCoverage =
    workWidth * workHeight ? Math.min(1, activeBedArea / (workWidth * workHeight)) : 0;

  const resetMessages = () => {
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || !files.length) return;
    resetMessages();
    setIsLoading(true);

    const parsed: ParsedDesign[] = [];
    const errors: string[] = [];

    for (const file of Array.from(files)) {
      try {
        const next = await parseDxfFile(file);
        parsed.push(next);
      } catch (error) {
        const details = error instanceof Error ? error.message : 'Unable to parse DXF file.';
        errors.push(`${file.name}: ${details}`);
      }
    }

    setDesigns((current) => [...current, ...parsed]);
    if (parsed.length) {
      setStatusMessage(`Added ${parsed.length} design${parsed.length > 1 ? 's' : ''}.`);
    }
    if (errors.length) {
      setErrorMessage(errors.join(' '));
    }

    setIsLoading(false);
  }, []);

  const removeDesign = (id: string) => {
    resetMessages();
    setDesigns((current) => current.filter((design) => design.id !== id));
  };

  const clearAll = () => {
    resetMessages();
    setDesigns([]);
  };

  const updateQuantity = (id: string, next: number) => {
    resetMessages();
    const safeValue = clamp(Number.isNaN(next) ? 1 : next, 1, 500);
    setDesigns((current) =>
      current.map((design) => (design.id === id ? { ...design, quantity: safeValue } : design)),
    );
  };

  const handleDrop: DragEventHandler<HTMLLabelElement> = (event) => {
    event.preventDefault();
    handleFiles(event.dataTransfer?.files ?? null);
  };

  const handleDragOver: DragEventHandler<HTMLLabelElement> = (event) => {
    event.preventDefault();
  };

  const downloadBed = useCallback(
    async (bed: BedLayout) => {
      const svg = buildBedSvg(
        bed,
        bedWidth,
        bedHeight,
        workWidth,
        workHeight,
        bedMargin,
        (designId, placementIndex) => {
          return (
            colorMap.get(designId) ??
            accentPalette[(bed.index + placementIndex + bed.placements.length) % accentPalette.length]
          );
        },
      );
      const fileName = `${sanitizedProjectName}-bed-${bed.index}.svg`;

      if (downloadDirHandle) {
        await saveToDirectory(downloadDirHandle, fileName, svg);
        return;
      }

      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    },
    [bedWidth, bedHeight, workWidth, workHeight, bedMargin, colorMap, sanitizedProjectName, downloadDirHandle],
  );

  const handleDownloadBed = async () => {
    if (!activeBed) return;
    await downloadBed(activeBed);
    setStatusMessage(`Downloaded bed ${activeBed.index} as SVG.`);
  };

  const handleDownloadAllBeds = async () => {
    if (!bedLayouts.length) return;
    for (const bed of bedLayouts) {
      await downloadBed(bed);
      if (!downloadDirHandle) {
        await delay(150);
      }
    }
    setStatusMessage(`Downloaded ${bedLayouts.length} bed SVG${bedLayouts.length > 1 ? 's' : ''}.`);
  };

  const handleChooseFolder = async () => {
    if (!fsAccessSupported || !window.showDirectoryPicker) {
      setErrorMessage('This browser does not support choosing a download folder.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      setDownloadDirHandle(handle);
      setFolderMessage(`Saving to: ${handle.name}`);
      setStatusMessage(`Selected folder: ${handle.name}`);
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        setErrorMessage('Unable to access the selected folder.');
      }
    }
  };

  const handleDownloadChecklist = async () => {
    if (!bedLayouts.length) return;
    try {
      const pdfBuffer = await buildChecklistPdf(bedLayouts, {
        projectName: projectName.trim() || 'CNC Run',
        bedWidth,
        bedHeight,
        workWidth,
        workHeight,
        margin: bedMargin,
        colorForPlacement: (bed, designId, placementIndex) =>
          colorMap.get(designId) ??
          accentPalette[(bed.index + placementIndex + bed.placements.length) % accentPalette.length],
      });

      const fileName = `${sanitizedProjectName}-checklist.pdf`;
      const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

      if (downloadDirHandle) {
        await saveToDirectory(downloadDirHandle, fileName, pdfBlob);
      } else {
        const url = URL.createObjectURL(pdfBlob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }

      setStatusMessage('Checklist PDF downloaded.');
    } catch (error) {
      console.error(error);
      setErrorMessage('Unable to build the checklist PDF.');
    }
  };

  return (
    <div className="layout-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">CNC Layout Planner</p>
          <h1>
            Bring DXF files together, specify run counts, and preview each bed before you cut.
          </h1>
          <p className="lede">
            Upload as many DXF parts as you need. Set your cutting bed dimensions, choose spacing,
            then export a ready-to-review SVG layout for every bed required.
          </p>
          <div className="hero-stats">
            <div>
              <p>Machine Envelope</p>
              <strong>
                {bedWidth} × {bedHeight} mm
              </strong>
            </div>
            <div>
              <p>Parts queued</p>
              <strong>{totalQuantity || 0}</strong>
            </div>
            <div>
              <p>Beds needed</p>
              <strong>{bedCount || (totalQuantity ? 1 : 0)}</strong>
            </div>
            <div>
              <p>Overall coverage</p>
              <strong>{(coverage * 100).toFixed(1)}%</strong>
            </div>
            <div>
              <p>Visitors (14d)</p>
              <strong>{formatTrafficStat(traffic?.views?.uniques)}</strong>
            </div>
          </div>
          <p className="traffic-note">
            Visitor stats refresh from GitHub traffic logs
            {traffic?.collectedAt ? ` · updated ${new Date(traffic.collectedAt).toLocaleString()}` : ''}
          </p>
        </div>
      </header>

      <main className="workspace">
        <section className="panel controls">
          <div className="panel-header">
            <h2>Setup</h2>
            <p>Tell the planner about your machine envelope and how tight you want the rows.</p>
          </div>
          <div className="field-grid">
            <InputField
              label="Machine Width"
              suffix="mm"
              value={bedWidth}
              max={5000}
              onChange={(value) => setBedWidth(Math.max(value, 0))}
            />
            <InputField
              label="Machine Height"
              suffix="mm"
              value={bedHeight}
              max={5000}
              onChange={(value) => setBedHeight(Math.max(value, 0))}
            />
            <InputField
              label="Part Spacing"
              suffix="mm"
              value={spacing}
              min={0}
              max={250}
              onChange={(value) => setSpacing(value)}
            />
            <InputField
              label="Clamp Border"
              suffix="mm"
              value={bedMargin}
              max={500}
              onChange={(value) =>
                setBedMargin(
                  Math.min(Math.max(value, 0), Math.floor(Math.min(bedWidth, bedHeight) / 2)),
                )
              }
            />
          </div>
          <div className="field-grid single-column">
            <label className="input-field">
              <span>Project Name</span>
              <div>
                <input
                  type="text"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="Enter project title"
                />
              </div>
            </label>
          </div>

          {fsAccessSupported && (
            <div className="folder-controls">
              <button className="ghost-btn" type="button" onClick={() => void handleChooseFolder()}>
                {downloadDirHandle ? 'Change download folder' : 'Choose download folder'}
              </button>
              <span className="folder-status">{folderMessage ?? 'Using browser downloads'}</span>
            </div>
          )}

          <div className="upload-card">
            <label
              htmlFor="dxf-upload"
              className="drop-area"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <div>
                <p className="drop-title">Drop DXF files here or browse</p>
                <p className="drop-subtitle">
                  We&apos;ll parse outlines directly in the browser. Nothing is uploaded.
                </p>
              </div>
              <span className="browse-btn">Select files</span>
              <input
                id="dxf-upload"
                type="file"
                accept=".dxf"
                multiple
                onChange={(event) => {
                  handleFiles(event.target.files);
                  event.target.value = '';
                }}
              />
            </label>
            <div className="upload-meta">
              {isLoading && <p className="status">Parsing DXF data…</p>}
              {statusMessage && <p className="status success">{statusMessage}</p>}
              {errorMessage && <p className="status error">{errorMessage}</p>}
            </div>
          </div>

          <div className="design-list">
            <div className="list-header">
              <h3>Loaded Parts</h3>
              {designs.length > 0 && (
                <button className="text-btn" onClick={clearAll}>
                  Clear layout
                </button>
              )}
            </div>
            {designs.length === 0 && (
              <p className="empty-state">
                No files yet. Bring in one or more DXF files to see the arrangement.
              </p>
            )}
            <ul>
              {designs.map((design, index) => {
                const color = colorMap.get(design.id) ?? accentPalette[index % accentPalette.length];
                const tooLarge = oversizedSet.has(design.id);
                return (
                  <li key={design.id} className="design-item">
                    <span className="swatch" style={{ backgroundColor: color }} />
                    <div className="design-info">
                      <p className="design-name">{design.name || `Part ${index + 1}`}</p>
                      <p className="design-meta">
                        {design.width.toFixed(0)} × {design.height.toFixed(0)} mm
                        {tooLarge && <span className="chip warn">Too large for bed</span>}
                      </p>
                    </div>
                    <div className="design-controls">
                      <label className="qty-label">
                        Qty
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={design.quantity}
                          onChange={(event) => updateQuantity(design.id, Number(event.target.value))}
                        />
                      </label>
                      <button className="text-btn" onClick={() => removeDesign(design.id)}>
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="panel preview">
          <div className="panel-header">
            <h2>Layout Preview</h2>
            <p>
              Cycle through each bed to preview spacing and coverage. Export a combined SVG when
              you&apos;re happy with the layout.
            </p>
          </div>

          <div className="preview-tools">
            <button className="ghost-btn" disabled={!activeBed} onClick={() => void handleDownloadBed()}>
              Download this bed (SVG)
            </button>
            <button className="ghost-btn" disabled={!bedLayouts.length} onClick={() => void handleDownloadAllBeds()}>
              Download all beds
            </button>
            <button className="ghost-btn" disabled={!bedLayouts.length} onClick={() => void handleDownloadChecklist()}>
              Download bed checklist (PDF)
            </button>
            {bedCount > 1 && (
              <div className="bed-switcher">
                <span>
                  Bed {activeBedIndex + 1} / {bedCount}
                </span>
                <div>
                  <button
                    className="ghost-btn"
                    disabled={activeBedIndex === 0}
                    onClick={() => setActiveBedIndex((index) => Math.max(0, index - 1))}
                  >
                    ←
                  </button>
                  <button
                    className="ghost-btn"
                    disabled={activeBedIndex >= bedCount - 1}
                    onClick={() => setActiveBedIndex((index) => Math.min(bedCount - 1, index + 1))}
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </div>

          {oversizedDesigns.length > 0 && (
            <div className="alert warn">
              {oversizedDesigns.length} part{oversizedDesigns.length > 1 ? 's' : ''} exceed the bed. Increase
              the machine size or remove them to include in the layout.
            </div>
          )}

          <div className="preview-card">
            {!activeBed || workWidth <= 0 || workHeight <= 0 ? (
              <div className="empty-preview">
                <p>
                  {designs.length === 0
                    ? 'Load DXF files to visualize the layout.'
                    : workWidth <= 0 || workHeight <= 0
                    ? 'Clamp border leaves no usable workspace. Reduce the border or increase machine size.'
                    : 'All current parts exceed the bed. Increase the machine size or remove them.'}
                </p>
              </div>
            ) : (
              <svg
                viewBox={`0 0 ${bedWidth} ${bedHeight}`}
                className="layout-canvas"
                role="img"
                aria-label={`Layout preview for bed ${activeBed.index}`}
                shapeRendering="geometricPrecision"
              >
                <defs>
                  <pattern id="preview-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                    <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,0.08)" />
                  </pattern>
                </defs>
                <rect width={bedWidth} height={bedHeight} fill="url(#preview-grid)" />
                {bedMargin > 0 && (
                  <rect
                    x={bedMargin}
                    y={bedMargin}
                    width={workWidth}
                    height={workHeight}
                    fill="none"
                    stroke="rgba(255,255,255,0.4)"
                    strokeDasharray="8 8"
                  />
                )}
                <g transform={`translate(${bedMargin} ${bedMargin})`}>
                  <g transform={`scale(1,-1) translate(0, -${workHeight})`}>
                    {activeBed.placements.map((placement) => (
                      <g key={placement.id} className="shape-group">
                        {placement.design.polylines.map((polyline, polyIndex) => (
                          <path
                            key={`${placement.id}-${polyIndex}`}
                            d={polylineToPath(polyline, placement.x, placement.y, {
                              rotate: placement.rotated,
                              designHeight: placement.design.height,
                            })}
                            fill="none"
                            stroke={colorMap.get(placement.design.id) ?? accentPalette[0]}
                            strokeWidth={1}
                            strokeLinecap="butt"
                            strokeLinejoin="miter"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                      </g>
                    ))}
                  </g>
                </g>
              </svg>
            )}
          </div>
          <div className="preview-footer">
            <dl>
              <div>
                <dt>Parts on this bed</dt>
                <dd>{activeBed?.placements.length ?? 0}</dd>
              </div>
              <div>
                <dt>Bed coverage</dt>
                <dd>{(activeCoverage * 100).toFixed(1)}%</dd>
              </div>
              <div>
                <dt>Total placed</dt>
                <dd>{totalPlaced}</dd>
              </div>
            </dl>
          </div>
        </section>
      </main>
    </div>
  );
}

interface InputFieldProps {
  label: string;
  suffix?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

const InputField = ({ label, suffix, value, min, max, onChange }: InputFieldProps) => (
  <label className="input-field">
    <span>{label}</span>
    <div>
      <input
        type="number"
        value={value}
        min={min !== undefined ? min : undefined}
        max={max !== undefined ? max : undefined}
        step={1}
        onChange={(event) => {
          const raw = Number(event.target.value);
          const numeric = Number.isFinite(raw) ? raw : 0;
          onChange(clamp(numeric, min, max));
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </div>
  </label>
);

function clamp(value: number, min?: number, max?: number) {
  let result = value;
  if (typeof min === 'number') {
    result = Math.max(result, min);
  }
  if (typeof max === 'number') {
    result = Math.min(result, max);
  }
  return result;
}

function formatTrafficStat(value?: number) {
  if (typeof value !== 'number' || value < 0) {
    return '—';
  }
  return value.toString();
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function saveToDirectory(handle: FileSystemDirectoryHandle, fileName: string, contents: string | ArrayBuffer | Blob) {
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

export default App;
