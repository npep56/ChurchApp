import { useState, useMemo, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, GeoJSON } from 'react-leaflet';
import { X, Navigation, Globe, MapPin, Clock, Calendar, CheckCircle2, RefreshCw, Shuffle } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { Trash2, Route, NotebookPen, Heart, Phone } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import ChurchNotesModal from '@/components/ChurchNotesModal';
import MapAutoResize from '@/components/MapAutoResize';

const STOPS_PER_DAY = 48; // 10 min/stop × 48 = 8 hrs (9am-5pm)

// Haversine distance in miles between two lat/lng points
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Nearest-neighbor greedy TSP per day chunk
function optimizeRouteByDay(churches) {
  if (!churches.length) return churches;

  // Split into day buckets (STOPS_PER_DAY each), preserving current order
  const days = [];
  for (let i = 0; i < churches.length; i += STOPS_PER_DAY) {
    days.push(churches.slice(i, i + STOPS_PER_DAY));
  }

  const optimized = [];
  for (const dayChurches of days) {
    const valid = dayChurches.filter(c => c.lat && c.lng);
    const invalid = dayChurches.filter(c => !c.lat || !c.lng);
    if (valid.length === 0) { optimized.push(...dayChurches); continue; }

    // Start from the northernmost church (top of county)
    const startIdx = valid.reduce((best, c, i) => c.lat > valid[best].lat ? i : best, 0);
    const visited = new Array(valid.length).fill(false);
    const route = [];
    let current = startIdx;

    for (let step = 0; step < valid.length; step++) {
      visited[current] = true;
      route.push(valid[current]);
      let nearest = -1;
      let nearestDist = Infinity;
      for (let j = 0; j < valid.length; j++) {
        if (visited[j]) continue;
        const d = haversineDistance(valid[current].lat, valid[current].lng, valid[j].lat, valid[j].lng);
        if (d < nearestDist) { nearestDist = d; nearest = j; }
      }
      if (nearest === -1) break;
      current = nearest;
    }
    optimized.push(...route, ...invalid);
  }
  return optimized;
}

function getTimeSlotForStop(stopNumber) {
  // stopNumber is 1-based within a day (1 = 9:00am, 2 = 9:10am, etc.)
  const minutes = (stopNumber - 1) * 10;
  const hours = 9 + Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours > 12 ? hours - 12 : hours}:${mins.toString().padStart(2, '0')}${hours >= 12 ? 'pm' : 'am'}`;
}

const DAY_COLORS = [
  '#2d6a4f', // Day 1 - green
  '#b5622c', // Day 2 - orange
  '#1d4ed8', // Day 3 - blue
  '#7c3aed', // Day 4 - purple
  '#be123c', // Day 5 - red
  '#0f766e', // Day 6 - teal
];

function getDayColor(day) {
  return DAY_COLORS[(day - 1) % DAY_COLORS.length];
}

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function getNumberedIcon(number, day, isChecked) {
  const bg = isChecked ? '#6b7280' : getDayColor(day);
  const label = isChecked
    ? `<text x="14" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="white" font-family="Arial,sans-serif">✓</text>`
    : `<text x="14" y="19" text-anchor="middle" font-size="${number > 99 ? '7' : number > 9 ? '9' : '11'}" font-weight="bold" fill="white" font-family="Arial,sans-serif">${number}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 38" width="28" height="38">
    <path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.268 21.732 0 14 0z" fill="${bg}" stroke="white" stroke-width="1.5"/>
    <circle cx="14" cy="14" r="10" fill="white" opacity="0.15"/>
    ${label}
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [28, 38], iconAnchor: [14, 38], popupAnchor: [0, -38] });
}

export default function CowetaChurchMap() {
  const [churches, setChurches] = useState([]);
  const [countyGeo, setCountyGeo] = useState(null);
  const [selectedChurch, setSelectedChurch] = useState(null);
  const [search, setSearch] = useState('');
  const [dayFilter, setDayFilter] = useState('All Days');
  const [cityFilter, setCityFilter] = useState('All Cities');

  const [isOptimized, setIsOptimized] = useState(false);
  const [optimizedOrder, setOptimizedOrder] = useState(null);

  const [notesChurch, setNotesChurch] = useState(null);

  // URL verification state
  const [verifying, setVerifying] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState(null);
  const [verifyDone, setVerifyDone] = useState(false);

  useEffect(() => {
    base44.entities.CowetaChurch.filter({ excluded: false }, 'church_id', 500).then(setChurches);
    fetch("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query?where=GEOID%3D%2713077%27&outFields=NAME,GEOID&outSR=4326&f=geojson")
      .then(r => r.json())
      .then(data => {
        if (data?.type === 'FeatureCollection' && data.features?.length) setCountyGeo(data);
      })
      .catch(() => {});
  }, []);

  // Dynamically assign route stops, days, and times based on order (optimized or church_id)
  const churchesWithDays = useMemo(() => {
    let ordered;
    if (isOptimized && optimizedOrder) {
      ordered = optimizedOrder;
    } else {
      ordered = [...churches].sort((a, b) => {
        const aHas = a.website ? 1 : 0;
        const bHas = b.website ? 1 : 0;
        return bHas - aHas || (a.church_id || 0) - (b.church_id || 0);
      });
    }
    return ordered.map((c, i) => {
      const routeStop = ((i % STOPS_PER_DAY) + 1);
      const routeDay = Math.ceil((i + 1) / STOPS_PER_DAY);
      const scheduledTime = getTimeSlotForStop(routeStop);
      return { ...c, routeStop, routeDay, scheduledTime };
    });
  }, [churches, isOptimized, optimizedOrder]);

  const totalDays = useMemo(() => {
    if (!churchesWithDays.length) return 1;
    return Math.max(...churchesWithDays.map(c => c.routeDay));
  }, [churchesWithDays]);

  const dayOptions = useMemo(() => [
    'All Days',
    ...Array.from({ length: totalDays }, (_, i) => `Day ${i + 1}`)
  ], [totalDays]);

  const toggleVisited = async (church) => {
    const updated = !church.visited;
    await base44.entities.CowetaChurch.update(church.id, { visited: updated });
    setChurches(prev => prev.map(c => c.id === church.id ? { ...c, visited: updated } : c));
    if (selectedChurch?.id === church.id) setSelectedChurch(s => ({ ...s, visited: updated }));
  };

  const dismissChurch = async (church) => {
    await base44.entities.CowetaChurch.update(church.id, { excluded: true });
    setChurches(prev => prev.filter(c => c.id !== church.id));
    if (selectedChurch?.id === church.id) setSelectedChurch(null);
  };

  const openSeeTheNeed = async (church) => {
    const addr = church.address || '';
    try { await navigator.clipboard.writeText(addr); } catch {}
    window.open('https://seetheneed.org/', '_blank', 'noopener');
  };

  const handleNotesSaved = (updated) => {
    setChurches(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
    if (selectedChurch?.id === updated.id) setSelectedChurch(s => ({ ...s, ...updated }));
    if (notesChurch?.id === updated.id) setNotesChurch({ ...notesChurch, ...updated });
  };

  const CITIES = useMemo(() => [...new Set(churches.map(c => c.city))].sort(), [churches]);

  const visible = useMemo(() => {
    return churchesWithDays.filter(c => {
      if (dayFilter !== 'All Days') {
        const dayNum = parseInt(dayFilter.replace('Day ', ''));
        if (c.routeDay !== dayNum) return false;
      }
      if (cityFilter !== 'All Cities' && c.city !== cityFilter) return false;
      const q = search.toLowerCase();
      if (q && !c.name.toLowerCase().includes(q) && !c.address.toLowerCase().includes(q) && !c.city.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [search, dayFilter, cityFilter, churchesWithDays]);

  const visibleByDay = useMemo(() => {
    const counts = {};
    visible.forEach(c => { counts[c.routeDay] = (counts[c.routeDay] || 0) + 1; });
    return counts;
  }, [visible]);

  const handleOptimize = useCallback(() => {
    if (isOptimized) {
      setIsOptimized(false);
      return;
    }
    const base = [...churches].sort((a, b) => {
      const aHas = a.website ? 1 : 0;
      const bHas = b.website ? 1 : 0;
      return bHas - aHas || (a.church_id || 0) - (b.church_id || 0);
    });
    const result = optimizeRouteByDay(base);
    setOptimizedOrder(result);
    setIsOptimized(true);
  }, [churches, isOptimized]);

  // Run URL verification in batches
  const runVerification = useCallback(async () => {
    setVerifying(true);
    setVerifyDone(false);
    setVerifyProgress({ processed: 0, total: churches.length, allChanges: [] });
    let offset = 0;
    let allChanges = [];

    while (true) {
      const res = await base44.functions.invoke('verifyCowetaChurchUrls', { offset });
      const data = res.data;
      allChanges = [...allChanges, ...(data.changes || [])];
      setVerifyProgress({ processed: data.processed, total: data.total, allChanges });

      if (data.done) {
        const updated = await base44.entities.CowetaChurch.filter({ excluded: false }, 'church_id', 500);
        setChurches(updated);
        setVerifyDone(true);
        setVerifying(false);
        break;
      }
      offset = data.nextOffset;
    }
  }, [churches.length]);

  return (
    <div className="flex flex-col h-screen" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div className="bg-gray-900 text-white px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold">Coweta County Church Map</h1>
            <p className="text-gray-400 text-sm">
              Newnan, GA · {totalDays}-Day Route · {churches.length} Churches · 9am-5pm (10 min/stop)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-2 text-sm flex-wrap">
              {Array.from({ length: totalDays }, (_, i) => {
                const d = i + 1;
                const start = (d - 1) * STOPS_PER_DAY + 1;
                const end = Math.min(d * STOPS_PER_DAY, churches.length);
                return (
                  <span key={d} className="px-3 py-1 rounded-full text-white font-medium" style={{ backgroundColor: getDayColor(d) }}>
                    Day {d}: {start}–{end}
                  </span>
                );
              })}
            </div>
            <button
              onClick={handleOptimize}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{ backgroundColor: isOptimized ? '#1d4ed8' : '#4b5563', color: 'white' }}
              title="Optimize route order using nearest-neighbor (Haversine distances in miles)"
            >
              <Shuffle size={12} />
              {isOptimized ? 'Optimized ✓' : 'Optimize Route'}
            </button>
            <button
              onClick={runVerification}
              disabled={verifying}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: verifyDone ? '#2d6a4f' : '#4b5563', color: 'white' }}
              title="Verify and correct church website URLs using AI web search"
            >
              {verifying ? <RefreshCw size={12} className="animate-spin" /> : verifyDone ? <CheckCircle2 size={12} /> : <Globe size={12} />}
              {verifying ? `Verifying… ${verifyProgress?.processed || 0}/${verifyProgress?.total || 0}` : verifyDone ? 'URLs Verified' : 'Verify URLs'}
            </button>
          </div>
        </div>

        {/* Verification progress / results */}
        {verifying && verifyProgress && (
          <div className="mt-2">
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300 rounded-full"
                style={{ width: `${(verifyProgress.processed / verifyProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        {verifyDone && verifyProgress?.allChanges?.length > 0 && (
          <div className="mt-2 text-xs text-green-400">
            ✓ Updated {verifyProgress.allChanges.length} URL{verifyProgress.allChanges.length !== 1 ? 's' : ''}:{' '}
            {verifyProgress.allChanges.slice(0, 5).map(c => c.name).join(', ')}
            {verifyProgress.allChanges.length > 5 ? ` +${verifyProgress.allChanges.length - 5} more` : ''}
          </div>
        )}
        {verifyDone && verifyProgress?.allChanges?.length === 0 && (
          <div className="mt-2 text-xs text-gray-400">✓ All URLs verified — no changes needed.</div>
        )}
      </div>

      {/* Search + Filters bar */}
      <div className="bg-gray-800 px-4 py-2 flex-shrink-0 flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Search churches, cities, addresses..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        <select value={dayFilter} onChange={e => setDayFilter(e.target.value)}
          className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none">
          {dayOptions.map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={cityFilter} onChange={e => setCityFilter(e.target.value)}
          className="bg-gray-700 text-white border border-gray-600 rounded px-2 py-1.5 text-sm focus:outline-none">
          <option>All Cities</option>
          {CITIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* City pills */}
      <div className="bg-gray-800 border-t border-gray-700 px-4 pb-2 flex-shrink-0 flex gap-2 flex-wrap">
        {CITIES.map((city, i) => {
          const dotColors = ['#4ade80','#fb923c','#60a5fa','#f472b6','#a78bfa','#34d399','#fbbf24'];
          const color = dotColors[i % dotColors.length];
          return (
            <button
              key={city}
              onClick={() => setCityFilter(cityFilter === city ? 'All Cities' : city)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors flex items-center gap-1.5 ${
                cityFilter === city
                  ? 'bg-white text-gray-900 border-white font-semibold'
                  : 'text-gray-300 border-gray-600 hover:border-gray-400'
              }`}
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
              {city}
            </button>
          );
        })}
      </div>

      <div className="flex flex-1 flex-col md:flex-row" style={{ overflow: 'hidden', minHeight: 0 }}>
        {/* Sidebar */}
        <div className="w-full md:w-72 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-[40vh] md:h-full min-h-0">
          <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="flex items-center gap-2 text-sm flex-wrap">
              <span className="text-gray-600">Showing <strong>{visible.length}</strong> of {churches.length}</span>
              {Object.entries(visibleByDay).sort((a, b) => a[0] - b[0]).map(([day, count]) => (
                <span key={day} className="font-medium text-xs px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: getDayColor(Number(day)) }}>
                  Day {day}: {count}
                </span>
              ))}
            </div>
            <button className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded px-2 py-1 text-gray-600 transition-colors">
              <Route size={12} />
              Route
            </button>
          </div>
          <p className="text-xs text-gray-400 text-right px-3 py-1 bg-gray-50 border-b border-gray-100">Hover markers for name · Click for details</p>
          <div className="overflow-y-auto flex-1">
            {visible.map((church) => (
              <div key={church.id} onClick={() => setSelectedChurch(church)}
                className={`flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 transition-colors cursor-pointer ${
                  selectedChurch?.id === church.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : church.visited ? 'bg-green-50' : 'hover:bg-gray-50'
                }`}>
                <div
                  onClick={e => { e.stopPropagation(); setSelectedChurch(church); }}
                  title="Open details"
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold cursor-pointer ring-0 hover:ring-2 hover:ring-offset-1 hover:ring-gray-400 transition-shadow"
                  style={{ backgroundColor: church.visited ? '#9ca3af' : getDayColor(church.routeDay) }}
                >
                  {church.visited ? '✓' : church.routeStop}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    onClick={e => { e.stopPropagation(); setNotesChurch(church); }}
                    title="Open notes"
                    className={`text-sm font-semibold leading-tight truncate cursor-pointer ${church.visited ? 'line-through text-gray-400' : 'text-gray-800'}`}
                  >{church.name}</p>
                  <a
                    href={`https://maps.apple.com/?ll=${church.lat},${church.lng}&q=${encodeURIComponent(church.name)}`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-xs text-gray-500 hover:text-blue-600 hover:underline"
                  >{church.city} · Day {church.routeDay} · {church.scheduledTime}
                  {isOptimized && (() => {
                    const idx = churchesWithDays.findIndex(c => c.id === church.id);
                    const next = churchesWithDays[idx + 1];
                    if (next && next.routeDay === church.routeDay && church.lat && church.lng && next.lat && next.lng) {
                      const d = haversineDistance(church.lat, church.lng, next.lat, next.lng);
                      return <span className="ml-1 text-blue-500">→ {d.toFixed(1)} mi</span>;
                    }
                    return null;
                  })()}
                  </a>
                  <a
                    href={`https://maps.apple.com/?ll=${church.lat},${church.lng}&q=${encodeURIComponent(church.name)}`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-xs text-gray-400 truncate block hover:text-blue-600 hover:underline"
                  >{church.address}</a>
                  {church.website && (
                    <a href={church.website} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs font-medium" style={{ color: '#b5622c' }}>
                      Website ↗
                    </a>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={!!church.visited}
                  onChange={e => { e.stopPropagation(); toggleVisited(church); }}
                  className="flex-shrink-0 w-4 h-4 cursor-pointer accent-green-700"
                  title="Mark as visited"
                />
                <button
                  onClick={e => { e.stopPropagation(); dismissChurch(church); }}
                  className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                  title="Remove from list"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {visible.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-10">No churches found.</p>
            )}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative" style={{ height: 'calc(100vh - 210px)', minHeight: 420 }}>
          <MapContainer
            center={[33.38, -84.79]}
            zoom={11}
            style={{ height: '100%', width: '100%' }}
          >
            <MapAutoResize />
            <TileLayer
              key="openstreetmap-standard"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              referrerPolicy="strict-origin-when-cross-origin"
            />
            {countyGeo && (
              <GeoJSON
                data={countyGeo}
                style={{ color: '#3b82f6', weight: 2.5, fill: true, fillColor: '#3b82f6', fillOpacity: 0.06 }}
              />
            )}
            {visible.map(church => (
              <Marker
                key={church.id}
                position={[church.lat, church.lng]}
                icon={getNumberedIcon(church.routeStop, church.routeDay, !!church.visited)}
                eventHandlers={{ click: () => setSelectedChurch(church) }}
              >
                <Tooltip direction="top" offset={[0, -36]}>{church.name}</Tooltip>
              </Marker>
            ))}
          </MapContainer>

          {/* Detail Panel */}
          {selectedChurch && (
            <div className="absolute bottom-0 left-0 right-0 md:top-0 md:right-0 md:left-auto md:w-80 bg-white shadow-2xl z-[1000] flex flex-col" style={{ maxHeight: '60%' }}>
              <div className="flex items-start justify-between px-4 py-3 border-b" style={{ backgroundColor: getDayColor(selectedChurch.routeDay) }}>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-white bg-opacity-20 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {selectedChurch.routeStop}
                  </div>
                  <h2 className="text-white font-bold text-sm leading-tight">{selectedChurch.name}</h2>
                </div>
                <button onClick={() => setSelectedChurch(null)} className="text-white opacity-75 hover:opacity-100 ml-2 flex-shrink-0">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1 space-y-3">
                <div className="flex items-start gap-2 text-sm text-gray-700">
                  <MapPin size={15} className="flex-shrink-0 mt-0.5 text-gray-400" />
                  <span>{selectedChurch.address}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Clock size={15} className="flex-shrink-0 text-gray-400" />
                  <span>{selectedChurch.scheduledTime}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <Calendar size={15} className="flex-shrink-0 text-gray-400" />
                  <span>Day {selectedChurch.routeDay} · Stop {selectedChurch.routeStop} · {selectedChurch.city}</span>
                </div>
                {selectedChurch.phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <Phone size={15} className="flex-shrink-0 text-gray-400" />
                    <a href={`tel:${selectedChurch.phone}`} className="hover:underline">{selectedChurch.phone}</a>
                  </div>
                )}
                {selectedChurch.website && selectedChurch.website_check && (
                  <div className="flex items-start gap-2 text-xs text-green-700 bg-green-50 rounded px-2 py-1.5">
                    <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
                    <span>Website verified: {selectedChurch.website_check}</span>
                  </div>
                )}
                {selectedChurch.address_approx && (
                  <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                    {selectedChurch.location_note || 'No street number on file — map pin is from OpenStreetMap; confirm the address before visiting.'}
                  </div>
                )}
                <div className="pt-2 flex flex-col gap-2">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedChurch.address)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-white text-sm font-semibold"
                    style={{ backgroundColor: getDayColor(selectedChurch.routeDay) }}
                  >
                    <Navigation size={15} />
                    Get Directions
                  </a>
                  {selectedChurch.website && (
                    <a
                      href={selectedChurch.website} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50"
                    >
                      <Globe size={15} />
                      Visit Website
                    </a>
                  )}
                  <button
                    onClick={() => setNotesChurch(selectedChurch)}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors"
                    style={selectedChurch.notes ? { borderColor: '#b5622c', color: '#b5622c' } : undefined}
                  >
                    <NotebookPen size={15} />
                    {selectedChurch.notes ? 'Edit Notes' : 'Add Notes'}
                  </button>
                  <button
                    onClick={() => openSeeTheNeed(selectedChurch)}
                    className="flex items-center justify-center gap-2 w-full py-2 rounded-lg border text-sm font-semibold hover:bg-rose-50 transition-colors"
                    style={{ borderColor: '#e11d48', color: '#e11d48' }}
                    title="Copy this church's address to clipboard and open seetheneed.org (paste into the search box)"
                  >
                    <Heart size={15} />
                    See the Need
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={() => toggleVisited(selectedChurch)}
                      className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-semibold transition-colors"
                      style={{
                        backgroundColor: selectedChurch.visited ? '#f0fdf4' : 'white',
                        borderColor: selectedChurch.visited ? '#16a34a' : '#d1d5db',
                        color: selectedChurch.visited ? '#16a34a' : '#374151'
                      }}
                    >
                      <CheckCircle2 size={14} />
                      {selectedChurch.visited ? 'Visited ✓' : 'Mark Visited'}
                    </button>
                    <button
                      onClick={() => dismissChurch(selectedChurch)}
                      className="py-2 px-3 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-300 transition-colors"
                      title="Remove from route"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {notesChurch && (
        <ChurchNotesModal
          church={notesChurch}
          onClose={() => setNotesChurch(null)}
          onSaved={handleNotesSaved}
        />
      )}
    </div>
  );
}
