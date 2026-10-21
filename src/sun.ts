const RAD = Math.PI / 180;

export interface SunPosition {
  /** Latitude where the sun is directly overhead (the solar declination), in degrees. */
  lat: number;
  /** Longitude where the sun is directly overhead, in degrees (-180..180). */
  lon: number;
}

/** Subsolar point, using the low-precision formulas from the Astronomical Almanac (good to ~0.01°). */
export function sunPosition(date: Date): SunPosition {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const meanAnomaly = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const eclipticLon = (meanLon + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;

  return {
    lat: declination / RAD,
    lon: normalizeLon(rightAscension / RAD - gmstHours * 15),
  };
}

/** The sun's height above the horizon at a place, in degrees (negative below it). */
export function solarElevation(lat: number, lon: number, sun: SunPosition): number {
  const sinElevation =
    Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) +
    Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD);
  return Math.asin(Math.max(-1, Math.min(1, sinElevation))) / RAD;
}

/** True when the sun is above the horizon at the given place. */
export function isDaylight(lat: number, lon: number, sun: SunPosition): boolean {
  return solarElevation(lat, lon, sun) > 0;
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  /** Evening golden hour starts when the sun sinks below 6°. */
  goldenHour: Date | null;
}

/** Sunrise, sunset and evening golden hour during the 24 hours from `dayStart` (a local midnight). */
export function sunTimes(lat: number, lon: number, dayStart: Date): SunTimes {
  const HORIZON = -0.833; // standard refraction-corrected sunrise/sunset altitude
  const STEP = 2 * 60_000;
  const result: SunTimes = { sunrise: null, sunset: null, goldenHour: null };
  let prev: number | null = null;
  for (let t = dayStart.getTime(); t <= dayStart.getTime() + 86_400_000; t += STEP) {
    const e = solarElevation(lat, lon, sunPosition(new Date(t)));
    if (prev !== null) {
      if (prev < HORIZON && e >= HORIZON) result.sunrise = new Date(t);
      if (prev >= HORIZON && e < HORIZON) result.sunset = new Date(t);
      if (prev >= 6 && e < 6) result.goldenHour = new Date(t);
    }
    prev = e;
  }
  return result;
}

/**
 * SVG path covering the night side, in map coordinates where x = longitude and y = -latitude.
 * It traces the terminator from west to east, then closes around whichever pole is in darkness.
 */
export function nightPath(sun: SunPosition, step = 1): string {
  // At the equinoxes the declination is ~0 and the terminator becomes vertical; nudge it to avoid dividing by zero.
  const decl = Math.abs(sun.lat) < 0.1 ? (sun.lat < 0 ? -0.1 : 0.1) : sun.lat;
  const tanDecl = Math.tan(decl * RAD);

  const points: string[] = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const lat = Math.atan(-Math.cos((lon - sun.lon) * RAD) / tanDecl) / RAD;
    points.push(`${lon},${(-lat).toFixed(2)}`);
  }
  const darkPoleY = decl > 0 ? 90 : -90;
  return `M${points.join(" L")} L180,${darkPoleY} L-180,${darkPoleY} Z`;
}

function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
