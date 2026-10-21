/** Where a city's label sits relative to its pin, so neighbouring labels don't collide. */
export type LabelSide = "left" | "right" | "above" | "below";

export interface City {
  /** Short label shown on the map, e.g. "NYC". */
  code: string;
  name: string;
  country?: string;
  /** IANA time zone name. */
  timeZone: string;
  lat: number;
  lon: number;
  label: LabelSide;
}

export const DEFAULT_CITIES: City[] = [
  { code: "SEA", name: "Seattle", country: "United States", timeZone: "America/Los_Angeles", lat: 47.61, lon: -122.33, label: "left" },
  { code: "SLC", name: "Salt Lake City", country: "United States", timeZone: "America/Denver", lat: 40.76, lon: -111.89, label: "below" },
  { code: "CHI", name: "Chicago", country: "United States", timeZone: "America/Chicago", lat: 41.88, lon: -87.63, label: "above" },
  { code: "NYC", name: "New York", country: "United States", timeZone: "America/New_York", lat: 40.71, lon: -74.01, label: "below" },
  { code: "BRN", name: "Bern", country: "Switzerland", timeZone: "Europe/Zurich", lat: 46.95, lon: 7.45, label: "right" },
  { code: "LAG", name: "Lagos", country: "Nigeria", timeZone: "Africa/Lagos", lat: 6.52, lon: 3.38, label: "left" },
  { code: "NAI", name: "Nairobi", country: "Kenya", timeZone: "Africa/Nairobi", lat: -1.29, lon: 36.82, label: "right" },
  { code: "DXB", name: "Dubai", country: "United Arab Emirates", timeZone: "Asia/Dubai", lat: 25.2, lon: 55.27, label: "right" },
];

/** A label position for a newly added city: to the right, unless that would run off the east edge. */
export function defaultLabelSide(lon: number): LabelSide {
  return lon > 140 ? "left" : "right";
}

/** A short map label from a city name: initials for multi-word names ("Hong Kong" → "HK"), else the first three letters. */
export function makeCode(name: string): string {
  const words = name.normalize("NFD").replace(/[^A-Za-z\s]/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  return (words[0] ?? "").slice(0, 3).toUpperCase();
}
