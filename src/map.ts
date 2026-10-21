import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Position } from "geojson";
import land110m from "world-atlas/land-110m.json";

/**
 * Coastlines from Natural Earth (public domain), via the world-atlas package, as an SVG path
 * in map coordinates where x = longitude and y = -latitude.
 */
export function landPath(): string {
  const topology = land110m as unknown as Topology<{ land: GeometryCollection }>;
  const shapes = feature(topology, topology.objects.land);
  const rings: Position[][] = [];
  for (const f of shapes.features) {
    const geometry = f.geometry;
    if (geometry.type === "Polygon") rings.push(...geometry.coordinates);
    else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => rings.push(...polygon));
  }
  return rings.map(ringPath).join(" ");
}

// Rings that cross the 180° meridian (Fiji, Chukotka) would otherwise draw a line across the whole map,
// so start a new subpath wherever consecutive points jump to the other side.
function ringPath(ring: Position[]): string {
  let d = "";
  let prevLon: number | undefined;
  for (const [lon, lat] of ring) {
    const command = prevLon === undefined || Math.abs(lon - prevLon) > 180 ? "M" : "L";
    d += `${command}${lon.toFixed(2)},${(-lat).toFixed(2)} `;
    prevLon = lon;
  }
  return d + "Z";
}
