import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

// Keeps Leaflet's size in sync when its container resizes (sidebar, mobile layout, etc.)
export default function MapAutoResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [map]);
  return null;
}
