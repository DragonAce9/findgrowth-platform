import { rmSync } from "node:fs";
import { join } from "node:path";

/** On-disk artifacts for one tenant. Optional. The app does not require object storage. */
export function tenantArtifactRoot(): string {
  if (process.env.FG_ARTIFACT_DIR) return process.env.FG_ARTIFACT_DIR;
  return join(process.cwd(), "data", "artifacts");
}

export function tenantArtifactDir(tenantId: string): string {
  if (!/^[\w.-]+$/.test(tenantId)) throw new Error("bad tenant id");
  return join(tenantArtifactRoot(), tenantId);
}

export function removeTenantArtifacts(tenantId: string): void {
  rmSync(tenantArtifactDir(tenantId), { recursive: true, force: true });
}
