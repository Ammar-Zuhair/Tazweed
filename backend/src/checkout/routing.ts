import { z } from "zod";
import type { Config } from "../config.js";
export type Point = { latitude: number; longitude: number };
export type RoadRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: { type: "LineString"; coordinates: number[][] };
  source: string;
  dataVersion: string | null;
};
export class RoutingError extends Error {
  constructor(
    readonly code:
      | "ROUTING_UNCONFIGURED"
      | "ROUTING_UNAVAILABLE"
      | "NO_ROUTE"
      | "SNAP_TOO_FAR",
  ) {
    super(code);
  }
}
export interface RoutingProvider {
  readonly mode: "unconfigured" | "osrm" | "test";
  route(from: Point, to: Point): Promise<RoadRoute>;
}
const coordinate = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const result = z.object({
  code: z.literal("Ok"),
  data_version: z.string().max(100).optional(),
  routes: z
    .array(
      z.object({
        distance: z.number().finite().min(0).max(2147483647),
        duration: z.number().finite().min(0).max(31536000),
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(coordinate).min(2).max(10000),
        }),
      }),
    )
    .min(1)
    .max(5),
  waypoints: z
    .array(
      z.object({ distance: z.number().finite().min(0), location: coordinate }),
    )
    .length(2),
});
export class OsrmProvider implements RoutingProvider {
  readonly mode = "osrm" as const;
  constructor(
    private config: Pick<
      Config,
      | "ROUTING_BASE_URL"
      | "ROUTING_API_KEY"
      | "ROUTING_PROFILE"
      | "ROUTING_TIMEOUT_MS"
      | "ROUTING_MAX_SNAP_M"
    >,
    private transport: typeof fetch = fetch,
  ) {}
  async route(from: Point, to: Point): Promise<RoadRoute> {
    const c = this.config,
      url = new URL(c.ROUTING_BASE_URL!);
    url.pathname =
      url.pathname.replace(/\/$/, "") +
      `/route/v1/${c.ROUTING_PROFILE}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    url.search = new URLSearchParams({
      alternatives: "false",
      steps: "false",
      geometries: "geojson",
      overview: "simplified",
      generate_hints: "false",
      radiuses: `${c.ROUTING_MAX_SNAP_M};${c.ROUTING_MAX_SNAP_M}`,
    }).toString();
    try {
      const response = await this.transport(url, {
        headers: c.ROUTING_API_KEY
          ? { Authorization: "Bearer " + c.ROUTING_API_KEY }
          : {},
        signal: AbortSignal.timeout(c.ROUTING_TIMEOUT_MS),
        redirect: "error",
      });
      const reader = response.body?.getReader();
      if (!reader) throw new RoutingError("ROUTING_UNAVAILABLE");
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const v = await reader.read();
          if (v.done) break;
          size += v.value.length;
          if (size > 512 * 1024) {
            await reader.cancel();
            throw new RoutingError("ROUTING_UNAVAILABLE");
          }
          parts.push(v.value);
        }
      } finally {
        reader.releaseLock();
      }
      const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (data.code === "NoRoute" || data.code === "NoSegment")
        throw new RoutingError("NO_ROUTE");
      if (!response.ok) throw new RoutingError("ROUTING_UNAVAILABLE");
      const v = result.safeParse(data);
      if (!v.success) throw new RoutingError("ROUTING_UNAVAILABLE");
      if (v.data.waypoints.some((w) => w.distance > c.ROUTING_MAX_SNAP_M))
        throw new RoutingError("SNAP_TOO_FAR");
      const route = v.data.routes[0]!;
      return {
        distanceMeters: route.distance,
        durationSeconds: route.duration,
        geometry: route.geometry,
        source: "osrm",
        dataVersion: v.data.data_version ?? null,
      };
    } catch (e) {
      if (e instanceof RoutingError) throw e;
      throw new RoutingError("ROUTING_UNAVAILABLE");
    }
  }
}
export function routingFromConfig(c: Config): RoutingProvider {
  if (c.ROUTING_PROVIDER === "UNCONFIGURED")
    return {
      mode: "unconfigured",
      async route() {
        throw new RoutingError("ROUTING_UNCONFIGURED");
      },
    };
  return new OsrmProvider(c);
}
// Coverage filter only. Never used as a priced road distance.
export function coverageMeters(a: Point, b: Point) {
  const rad = (n: number) => (n * Math.PI) / 180,
    dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
