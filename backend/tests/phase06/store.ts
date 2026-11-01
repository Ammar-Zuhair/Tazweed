import type { ObjectStore } from "../../src/catalog/media.js";
// In-process test transport only, never imported by production server or native applications.
export class TestStore implements ObjectStore {
  readonly mode = "test" as const;
  files = new Map<string, Buffer>();
  async presignPut(k: string) {
    return "https://isolated.test/upload/" + k;
  }
  async read(k: string) {
    const b = this.files.get(k);
    if (!b) throw Error("Missing test object");
    return b;
  }
  async write(k: string, b: Buffer) {
    this.files.set(k, b);
  }
  async remove(k: string) {
    this.files.delete(k);
  }
  async access(k: string, v: string) {
    return "https://isolated.test/" + v + "/" + k;
  }
}
