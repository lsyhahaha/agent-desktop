import { z } from "zod";
export const channels = {
  status: "desktop:status",
  workspace: "desktop:select-workspace",
  settingsGet: "model:settings",
  settingsSave: "model:save",
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
  getSettings(): Promise<ModelSettings>;
  saveSettings(value: unknown): Promise<ModelSettings>;
}

export const ModelSettings = z
  .object({ model: z.string().min(1).max(100), hasKey: z.boolean() })
  .strict();
export type ModelSettings = z.infer<typeof ModelSettings>;
export const SaveSettings = z
  .object({
    model: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._/-]+$/),
    apiKey: z.string().trim().max(512).optional(),
  })
  .strict();
