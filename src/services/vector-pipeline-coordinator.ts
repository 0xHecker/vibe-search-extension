type PipelineOperation = "embedding" | "compaction";

class VectorPipelineCoordinator {
  private tail: Promise<void> = Promise.resolve();
  private activeOperation: PipelineOperation | null = null;

  public getActiveOperation(): PipelineOperation | null {
    return this.activeOperation;
  }

  public async runExclusive<T>(
    operation: PipelineOperation,
    task: () => Promise<T> | T
  ): Promise<T> {
    const run = this.tail.then(async () => {
      this.activeOperation = operation;
      try {
        return await task();
      } finally {
        this.activeOperation = null;
      }
    });

    this.tail = run.then(
      () => undefined,
      () => undefined
    );

    return run;
  }
}

export const vectorPipelineCoordinator = new VectorPipelineCoordinator();
export type { PipelineOperation };
