export type LocationStatus = "captured" | "denied" | "unavailable" | "outside_fence";

type PositionResult = {
  lat: number;
  lng: number;
  accuracy: number;
};

export function getCurrentPosition(): Promise<PositionResult> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("UNAVAILABLE"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("DENIED"));
        } else {
          reject(new Error("UNAVAILABLE"));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  });
}

export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function checkGeofence(lat: number, lng: number, officeLat: number, officeLng: number, radiusMeters: number) {
  const distance = calculateDistance(lat, lng, officeLat, officeLng);
  return { inside: distance <= radiusMeters, distanceMeters: Math.round(distance) };
}

export type OfficeLocation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
};

export function checkMultiGeofence(lat: number, lng: number, locations: OfficeLocation[]) {
  if (locations.length === 0) {
    return { inside: false, matchedLocation: null, distanceMeters: Infinity };
  }
  
  let bestMatch: OfficeLocation | null = null;
  let minDistance = Infinity;

  for (const loc of locations) {
    const distance = calculateDistance(lat, lng, loc.lat, loc.lng);
    if (distance < minDistance) {
      minDistance = distance;
      bestMatch = loc;
    }
  }

  if (bestMatch && minDistance <= bestMatch.radius_meters) {
    return { inside: true, matchedLocation: bestMatch.id, distanceMeters: Math.round(minDistance) };
  }

  return { inside: false, matchedLocation: null, distanceMeters: Math.round(minDistance) };
}

export function getLocationStatusText(status: LocationStatus | null | undefined) {
  switch (status) {
    case "captured":
      return "Location captured";
    case "denied":
      return "Location permission denied";
    case "outside_fence":
      return "Outside office location";
    case "unavailable":
    default:
      return "Location unavailable";
  }
}
