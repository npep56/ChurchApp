# Coweta County Church Map

A React + Leaflet app for planning multi-day church visit routes in Coweta County, GA
(9am–5pm, 10 minutes per stop, 48 stops per day).

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). `npm run build` produces a static site in `dist/`.

## Your church data

On first load, churches come from `public/churches.json`. **The file in the repo is sample/placeholder data**.
Replace it with your real list. Each entry looks like this:

```json
{ "church_id": 1, "name": "…", "address": "…", "city": "Newnan",
  "lat": 33.38, "lng": -84.79, "website": "https://…" }
```

Changes you make in the app (visited, notes, removed churches) are saved in the browser's localStorage.
After you replace `churches.json`, clear the old copy by running this in the browser console:
`localStorage.removeItem('coweta-churches-v1')`

## Differences from the Base44 version

- `src/api/base44Client.js` is a local stand-in for the Base44 SDK. To use your Base44 backend, swap it for the real client.
- **Verify URLs** only tidies URLs here (trims spaces, adds a missing `https://`). The original backend's AI web search check needs a server.
- `ChurchNotesModal` and `MapAutoResize` were rebuilt because they weren't included with the code.
