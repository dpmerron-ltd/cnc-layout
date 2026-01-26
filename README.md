# CNC Layout Planner

Single-page web application for quickly arranging DXF parts on a CNC / laser machine bed directly in the browser.

## Features

- Drag-and-drop multi-file DXF uploader (handled client-side, nothing sent to a server).
- Configurable machine envelope, spacing, clamp border, project naming, and per-part quantity controls with instant updates.
- Automatic shelf-style nesting that spills into additional beds when required.
- High-contrast SVG preview (per-bed) with grid overlay and one-click per-bed SVG exports.
- Part list with color-coded swatches and inline warnings when a part exceeds the active bed size.
- Optional File System Access integration lets you target a specific download folder; otherwise files drop into your default browser downloads.

## Getting Started

```bash
npm install
npm run dev
```

Open the provided local URL (default `http://localhost:5173`) to access the planner.

To create a production build:

```bash
npm run build
npm run preview   # optional local preview of the build output
```

To publish the GitHub Pages site (served from `main/docs`):

```bash
npm run build:docs   # rebuilds dist/ and copies it to docs/
git commit docs
git push
```

## Deploying to GitHub Pages

Two options are available:

1. **Static `docs/` folder (easiest)**
   - Run `npm run build:docs` locally.
   - Commit the generated `docs/` folder.
   - In GitHub → Settings → Pages, choose “Deploy from branch” → `main` / `docs`.
   - Pages will serve the contents of `docs/` immediately.

2. **GitHub Actions workflow**
   - Enable GitHub Pages → Source: `GitHub Actions`.
   - The bundled `deploy.yml` workflow builds `dist/` and deploys automatically on every push to `main`.

## How it Works

- **DXF parsing** – Uses `dxf-parser` in tolerant mode. Lines, polylines, circles, arcs, ellipses, and splines are converted into simplified polylines for rendering and measurement.
- **Arrangement** – A best-fit bin-packing engine (with automatic 90° rotation) respects quantities, spacing, and spills gracefully into additional beds only when the envelope is fully utilized.
- **Rendering / Export** – Each bed is drawn as an SVG with a subtle grid. The layout view mirrors the colors used in the design list, and a single click exports every bed into one SVG file for downstream CAM review.

## Notes

- DXF units are treated as millimetres.
- Curved polyline bulges, arcs, splines, and block INSERT entities (with arrays, rotation, and scaling) are expanded into dense polylines so keyholes and other rounded features remain true to shape.
- The current algorithm does not rotate parts automatically. Rotate within your CAD tool if you need a different orientation before uploading.

## Visitor Stats (optional)

Visitor counts inside the hero card are powered by GitHub's built-in traffic metrics—no external tracker required.

- A GitHub Actions workflow (`.github/workflows/update-traffic.yml`) runs daily (and can be triggered manually) to pull the latest `views`/`uniques` data and write it to `docs/traffic.json`.
- The front-end reads `traffic.json` at runtime and displays the unique visitor total for the last 14 days.

### Manual refresh / first run

GitHub traffic endpoints only return data for repositories with GitHub Pages enabled and at least one visit. To seed the file:

```bash
node scripts/update-traffic.mjs
```

Commit the updated `docs/traffic.json`, then deploy as usual. The scheduled workflow will keep the data fresh afterward.
