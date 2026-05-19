import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useRef } from "react";

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, shadowUrl: markerShadow });

type LocationMapProps = {
  lat: number;
  lng: number;
  label: string;
  accuracy: number | null;
};

export default function LocationMap({ lat, lng, label, accuracy }: LocationMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView([lat, lng], 16);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(label).openPopup();

    if (accuracy && accuracy < 1000) {
      L.circle([lat, lng], {
        radius: accuracy,
        color: "#1D9E75",
        fillColor: "#1D9E75",
        fillOpacity: 0.1,
        weight: 1,
      }).addTo(map);
    }

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [lat, lng, label, accuracy]);

  return (
    <div
      ref={mapRef}
      style={{ height: "200px", width: "100%", borderRadius: "8px" }}
    />
  );
}
