type Waiter = {
  resolve: (frame: Uint8Array) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class FrameQueue {
  private items: Uint8Array[] = []
  private waiters: Waiter[] = []

  push(frame: Uint8Array): void {
    const waiter = this.waiters.shift()
    if (!waiter) {
      this.items.push(frame)
      return
    }
    clearTimeout(waiter.timer)
    waiter.resolve(frame)
  }

  fail(err: Error): void {
    const pending = this.waiters.splice(0)
    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(err)
    }
    this.items = []
  }

  next(timeoutMs: number): Promise<Uint8Array> {
    const queued = this.items.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter)
          reject(new Error('Délai dépassé'))
        }, Math.max(1, timeoutMs)),
      }
      this.waiters.push(waiter)
    })
  }
}
