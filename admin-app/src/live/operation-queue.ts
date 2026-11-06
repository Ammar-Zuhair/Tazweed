export type Command = { path: string; body: unknown; key: string };
export type Snapshot = {
  command: Command | null;
  busy: boolean;
  ready: boolean;
};
export type Storage = {
  read: () => Promise<Command | null>;
  write: (command: Command) => Promise<void>;
  remove: () => Promise<void>;
};
/** One controller per authenticated account, shared across screens. Persist before sending. */
export class OperationQueue {
  private command: Command | null = null;
  private busy = false;
  private erased = false;
  private settling: Promise<void> = Promise.resolve();
  private ready = false;
  private loading: Promise<void> | null = null;
  private listeners = new Set<(state: Snapshot) => void>();
  constructor(
    private storage: Storage,
    private send: (c: Command) => Promise<any>,
    private key: () => string,
  ) {}
  snapshot(): Snapshot {
    return { command: this.command, busy: this.busy, ready: this.ready };
  }
  subscribe(fn: (state: Snapshot) => void) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    for (const fn of this.listeners) fn(this.snapshot());
  }
  restore() {
    if (!this.loading)
      this.loading = (async () => {
        try {
          const saved = await this.storage.read();
          if (!this.erased) this.command = saved;
          this.ready = !this.erased;
          this.emit();
        } catch (e) {
          this.loading = null;
          throw e;
        }
      })();
    return this.loading;
  }
  async erase() {
    this.erased = true;
    this.ready = false;
    this.emit();
    await this.loading?.catch(() => {});
    await this.settling;
    await this.storage.remove();
    this.command = null;
    this.emit();
  }
  async execute(path?: string, body?: unknown) {
    if (this.erased || !this.ready || this.busy)
      throw Error("انتظر انتهاء العملية الحالية");
    if (
      this.command &&
      path &&
      (path !== this.command.path ||
        JSON.stringify(body) !== JSON.stringify(this.command.body))
    )
      throw Error("توجد عملية غير محسومة؛ أعد المحاولة المحفوظة أولًا");
    const command = this.command ?? { path: path!, body, key: this.key() };
    if (!command.path) throw Error("لا توجد عملية معلقة");
    // Synchronous lock and command assignment precede the first storage await (including native double taps).
    this.busy = true;
    let finish!: () => void;
    this.settling = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.command = command;
    this.emit();
    try {
      await this.storage.write(command);
      if (this.erased) throw Error("تم مسح عمليات الحساب بعد طلب حذفه");
      const result = await this.send(command);
      await this.storage.remove();
      this.command = null;
      return result;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429
      ) {
        await this.storage.remove();
        this.command = null;
      }
      throw e;
    } finally {
      this.busy = false;
      finish();
      this.emit();
    }
  }
}
