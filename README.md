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

## Deploying to GitHub Pages

The repository already includes a `deploy.yml` workflow that builds and deploys `dist/` to GitHub Pages.

1. Push the project to GitHub (ensure your default branch is `main`).
2. In the repo settings, enable GitHub Pages → Source: `GitHub Actions`.
3. On the next push to `main` (or via the “Run workflow” button), the action will:
   - Install dependencies (`npm ci`)
   - Run `npm run build`
   - Upload `dist/` as a Pages artifact
   - Publish it to the Pages site URL reported in the workflow summary

Because `vite.config.ts` sets `base: './'`, the build works on sub-paths without extra tweaks.

## How it Works

- **DXF parsing** – Uses `dxf-parser` in tolerant mode. Lines, polylines, circles, arcs, ellipses, and splines are converted into simplified polylines for rendering and measurement.
- **Arrangement** – A best-fit bin-packing engine (with automatic 90° rotation) respects quantities, spacing, and spills gracefully into additional beds only when the envelope is fully utilized.
- **Rendering / Export** – Each bed is drawn as an SVG with a subtle grid. The layout view mirrors the colors used in the design list, and a single click exports every bed into one SVG file for downstream CAM review.

## Notes

- DXF units are treated as millimetres.
- Curved polyline bulges, arcs, splines, and block INSERT entities (with arrays, rotation, and scaling) are expanded into dense polylines so keyholes and other rounded features remain true to shape.
- The current algorithm does not rotate parts automatically. Rotate within your CAD tool if you need a different orientation before uploading.
