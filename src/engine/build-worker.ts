import { parentPort } from "node:worker_threads";
import { buildWorkspace, type WorkspaceInput } from "./pipeline";

if (parentPort) {
  parentPort.on("message", (input: WorkspaceInput) => {
    try {
      const workspace = buildWorkspace(input);
      parentPort?.postMessage({ ok: true, workspace });
    } catch (error) {
      parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
