/**
 * Optional BullMQ mirror. The web process does not load this file unless FG_REDIS_URL is set.
 * Redis and the bullmq package are not required to boot. The SQLite jobs table stays the default.
 */
export function redisJobsEnabled(): boolean {
  return Boolean(process.env.FG_REDIS_URL);
}

export async function mirrorJob(jobId: string): Promise<void> {
  const url = process.env.FG_REDIS_URL;
  if (!url) return;
  try {
    const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
      Queue?: new (name: string, options: { connection: { url: string } }) => {
        add: (name: string, data: unknown) => Promise<unknown>;
        close: () => Promise<void>;
      };
    }>;
    const loaded = await importer("bullmq");
    if (!loaded.Queue) return;
    const queue = new loaded.Queue("findgrowth", { connection: { url } });
    await queue.add("cut-build", { id: jobId });
    await queue.close();
  } catch {
    // Redis is down or bullmq is not installed. The SQLite row is already the job of record.
  }
}
