export interface PhaseResult {
  name: string;
  ms: number;
}

export interface TimerSnapshot {
  ms: number;
  phases: PhaseResult[];
}

export class Timer {
  private starts: Map<string, number> = new Map();
  private results: PhaseResult[] = [];

  start(name: string): void {
    if (this.starts.has(name)) {
      throw new Error(`phase "${name}" already started`);
    }
    this.starts.set(name, performance.now());
  }

  end(name: string): void {
    const start = this.starts.get(name);
    if (start === undefined) {
      throw new Error(`phase "${name}" has no matching start`);
    }
    this.starts.delete(name);
    this.results.push({ name, ms: performance.now() - start });
  }

  phases(): PhaseResult[] {
    return [...this.results];
  }

  total(): number {
    return this.results.reduce((sum, p) => sum + p.ms, 0);
  }

  snapshot(): TimerSnapshot {
    return { ms: this.total(), phases: this.phases() };
  }
}
