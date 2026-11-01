import type {
  RoutingProvider,
  Point,
  RoadRoute,
} from "../../src/checkout/routing.js";
import { RoutingError } from "../../src/checkout/routing.js";
export class TestRouting implements RoutingProvider {
  readonly mode = "test" as const;
  distance = 2800;
  fail: RoutingError["code"] | null = null;
  calls: { from: Point; to: Point }[] = [];
  delay = 0;
  async route(from: Point, to: Point): Promise<RoadRoute> {
    this.calls.push({ from, to });
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    if (this.fail) throw new RoutingError(this.fail);
    return {
      distanceMeters: this.distance,
      durationSeconds: 600,
      geometry: {
        type: "LineString",
        coordinates: [
          [from.longitude, from.latitude],
          [to.longitude, to.latitude],
        ],
      },
      source: "isolated-test-road",
      dataVersion: "fixture-only",
    };
  }
  reset() {
    this.distance = 2800;
    this.fail = null;
    this.calls = [];
    this.delay = 0;
  }
}
