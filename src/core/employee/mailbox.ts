/**
 * 信箱 / 唤醒信号，用于「goroutine 风格」调度。
 *
 * - Mailbox<T>：可携带消息（如 CEO 的 trigger 需要 'run' | founder 消息）。
 * - 员工侧不存 taskId：待办列表以 DB（EmployeeService.getTodoQueue）为准，
 *   此处只做「有活可干」的唤醒信号（push 后员工被唤醒，再去 DB 取待办）。
 */

export class Mailbox<T> {
  private queue: T[] = [];
  private wait: (() => void) | null = null;
  private stopped = false;

  /** 投递一条消息，若有等待中的消费者会立即被唤醒 */
  push(value: T): void {
    if (this.stopped) return;
    this.queue.push(value);
    if (this.wait) {
      this.wait();
      this.wait = null;
    }
  }

  /** 停止：后续 next() 会 resolve 为 null */
  stop(): void {
    this.stopped = true;
    if (this.wait) {
      this.wait();
      this.wait = null;
    }
  }

  /** 取一条消息；若已 stop 则返回 null */
  async next(): Promise<T | null> {
    for (;;) {
      if (this.stopped) return null;
      if (this.queue.length > 0) {
        const v = this.queue.shift()!;
        return v;
      }
      await new Promise<void>((resolve) => {
        this.wait = resolve;
      });
    }
  }
}

/**
 * 纯唤醒信号（无负载）：用于员工「有待办时被唤醒」。
 * 待办列表唯一来源是 EmployeeService.getTodoQueue，此处只负责唤醒。
 */
export class WakeSignal {
  private wait: (() => void) | null = null;
  private signaled = false;
  private stopped = false;

  /** 唤醒一次等待中的 next() */
  push(): void {
    if (this.stopped) return;
    this.signaled = true;
    if (this.wait) {
      this.wait();
      this.wait = null;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.wait) {
      this.wait();
      this.wait = null;
    }
  }

  /** 等待被唤醒；返回 false 表示已 stop，应退出循环 */
  async next(): Promise<boolean> {
    for (;;) {
      if (this.stopped) return false;
      if (this.signaled) {
        this.signaled = false;
        return true;
      }
      await new Promise<void>((resolve) => {
        this.wait = resolve;
      });
    }
  }
}
