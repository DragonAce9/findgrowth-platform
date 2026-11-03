import { dueJobs, enqueueJob, markJobDone, markJobFailed, markJobRetry, markJobRunning, type SqliteJob } from "./platform-db";

export interface TickOptions {
  now?: string;
  backoffMs?: number;
}

/**
 * Default queue. State lives in the SQLite jobs table.
 * A thrown handler is caught here: the web process keeps running, and the row is retried with backoff.
 */
export async function tickJobs(
  handlers: Record<string, (payload: unknown) => void | Promise<void>>,
  options?: TickOptions,
): Promise<number> {
  const now = options?.now ?? new Date().toISOString();
  const backoffMs = options?.backoffMs ?? 1000;
  const due = dueJobs(now);
  let ran = 0;
  for (const job of due) {
    const attempts = markJobRunning(job.id, now);
    if (!attempts) continue;
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error(`no handler for ${job.kind}`);
      await handler(job.payloadJson ? JSON.parse(job.payloadJson) : null);
      markJobDone(job.id, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempts >= job.maxAttempts) markJobFailed(job.id, message, now);
      else {
        const wait = backoffMs * 2 ** (attempts - 1);
        const runAfter = new Date(Date.parse(now) + wait).toISOString();
        markJobRetry(job.id, message, runAfter, now);
      }
    }
    ran += 1;
  }
  return ran;
}

export function enqueueSqliteJob(input: { id: string; kind: string; payload: unknown; maxAttempts?: number; now?: string }): SqliteJob {
  return enqueueJob(input);
}
