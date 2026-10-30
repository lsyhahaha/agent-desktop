import { z } from "zod";
export const channels = {
  status: "desktop:status",
  workspace: "desktop:select-workspace",
} as const;
export const RuntimeRequest = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    type: z.literal("runtime.ping"),
  })
  .strict();
export const RuntimeStatus = z
  .object({
    state: z.literal("ready"),
    pid: z.number().int().positive(),
    nodeVersion: z.string(),
    uptimeSeconds: z.number().nonnegative(),
  })
  .strict();
export const RuntimeResponse = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    type: z.literal("runtime.status"),
    payload: RuntimeStatus,
  })
  .strict();
export const DesktopStatus = z
  .object({
    appVersion: z.string(),
    electronVersion: z.string(),
    runtime: RuntimeStatus,
  })
  .strict();
export const WorkspaceSelection = z
  .object({ name: z.string(), path: z.string() })
  .strict()
  .nullable();
export type DesktopStatus = z.infer<typeof DesktopStatus>;
export type WorkspaceSelection = z.infer<typeof WorkspaceSelection>;
export interface DesktopBridge {
  getStatus(): Promise<DesktopStatus>;
  selectWorkspace(): Promise<WorkspaceSelection>;
}
