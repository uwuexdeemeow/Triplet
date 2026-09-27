// The website's map (maplibre-gl 6) runs part of its work in a background worker, which it
// loads from a separate file. The bundler can't place that file for it, so copy it (and the
// code it shares with the main library) into public/, where the site serves it as
// /maplibre/... src/components/place-map.web.tsx points MapLibre there with setWorkerUrl.
// Runs after every npm install, so the copies always match the installed version.
const fs = require('fs');
const path = require('path');

// npm runs install scripts from the app's folder (mobile/)
const root = process.cwd();
const from = path.join(root, 'node_modules', 'maplibre-gl', 'dist');
const to = path.join(root, 'public', 'maplibre');

if (!fs.existsSync(from)) {
  console.warn('[copy-maplibre-worker] maplibre-gl is not installed; skipping');
  process.exit(0);
}

fs.mkdirSync(to, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  fs.copyFileSync(path.join(from, file), path.join(to, file));
}
console.log('[copy-maplibre-worker] copied the map worker to public/maplibre');
