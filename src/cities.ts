/** Where a city's label sits relative to its pin, so neighbouring labels don't collide. */
export type LabelSide = "left" | "right" | "above" | "below";

export interface City {
  /** Short label shown on the map, e.g. "NYC". */
  code: string;
  name: string;
  /** IANA time zone name. */
  timeZone: string;
  lat: number;
  lon: number;
  label: LabelSide;
}

export const DEFAULT_CITIES: City[] = [
  { code: "SEA", name: "Seattle", timeZone: "America/Los_Angeles", lat: 47.61, lon: -122.33, label: "left" },
  { code: "SLC", name: "Salt Lake City", timeZone: "America/Denver", lat: 40.76, lon: -111.89, label: "below" },
  { code: "CHI", name: "Chicago", timeZone: "America/Chicago", lat: 41.88, lon: -87.63, label: "above" },
  { code: "NYC", name: "New York", timeZone: "America/New_York", lat: 40.71, lon: -74.01, label: "below" },
  { code: "BRN", name: "Bern", timeZone: "Europe/Zurich", lat: 46.95, lon: 7.45, label: "right" },
  { code: "LAG", name: "Lagos", timeZone: "Africa/Lagos", lat: 6.52, lon: 3.38, label: "left" },
  { code: "NAI", name: "Nairobi", timeZone: "Africa/Nairobi", lat: -1.29, lon: 36.82, label: "right" },
  { code: "DXB", name: "Dubai", timeZone: "Asia/Dubai", lat: 25.2, lon: 55.27, label: "right" },
];
