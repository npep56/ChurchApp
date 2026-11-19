# Coweta County Church Map

A React + Leaflet app for planning multi-day church visit routes in Coweta County, GA
(9am–5pm, 10 minutes per stop, 48 stops per day).

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173). `npm run build` produces a static site in `dist/`.

## Church data

`public/churches.json` lists **182 churches inside Coweta County**. It was built in November 2026 by these steps:

1. **Collecting churches.** Places of worship came from OpenStreetMap (searched through Nominatim) and from the christianity.com church directory. That covered Newnan, Senoia, Sharpsburg, Grantville, Moreland, Turin, Haralson, Sargent and the Coweta part of Palmetto.
2. **Checking the county line.** Each address was turned into map coordinates with the U.S. Census geocoder. Only points inside the official Coweta County boundary (Census TIGER, GEOID 13077) were kept. 18 directory churches, mostly in Palmetto, Whitesburg and Luthersville, fell outside and were dropped.
3. **Finding and checking websites.** Candidate sites came from OpenStreetMap, web searches and likely domain names. A site was accepted only if its pages name the church and show a Coweta location:
   - `website_verified: "address"` (11 churches): the site shows the same street address.
   - `website_verified: "area"` (20 churches): the site names the church and a Coweta town or ZIP code.

   The other 151 churches had no website that passed the check. Many small rural churches only have a Facebook page or no web presence at all.
4. **Flagging estimated locations.** `address_approx: true` (62 churches) means there is no street number on file. Usually the map pin comes from OpenStreetMap and the address is just the road name. The detail panel shows a warning for these.

`tools/church-data/church-report.csv` is the same data as a spreadsheet. The scripts in `tools/church-data/` are the ones used to collect and check it.

Changes you make in the app (visited, notes, removed churches) are saved in the browser's localStorage. If you edit `churches.json`, clear the saved copy by running this in the browser console:
`localStorage.removeItem('coweta-churches-v2')`

## Differences from the Base44 version

- `src/api/base44Client.js` is a local stand-in for the Base44 SDK. To use your Base44 backend, swap it for the real client.
- **Verify URLs** only tidies URLs here (trims spaces, adds a missing `https://`). The original backend's AI web search check needs a server.
- `ChurchNotesModal` and `MapAutoResize` were rebuilt because they weren't included with the code.
