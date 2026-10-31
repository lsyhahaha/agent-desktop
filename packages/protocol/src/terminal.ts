import { z } from "zod";
/** PTY能力只向用户界面开放；renderer不能指定shell、环境、路径或PID；用户手动终端与Agent权限独立。 */
const size = {
  cols: z.number().int().min(20).max(400),
  rows: z.number().int().min(5).max(200),
};
const scope = { sessionId: z.string().uuid() };
export const TerminalProfile = z
  .object({
    shell: z.enum(["/bin/zsh", "/bin/bash"]),
    home: z.string().min(1).max(4096),
    path: z.string().max(8192),
    user: z.string().max(256),
    lang: z.string().max(100),
    tmp: z.string().max(4096),
  })
  .strict();
export type TerminalProfile = z.infer<typeof TerminalProfile>;
export const TerminalCommand = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("watch"), ...scope, enabled: z.boolean() })
    .strict(),
  z
    .object({
      type: z.literal("paste"),
      ...scope,
      terminalId: z.string().uuid(),
    })
    .strict(),
  z.object({ type: z.literal("open"), ...scope, ...size }).strict(),
  z
    .object({
      type: z.literal("snapshot"),
      ...scope,
      terminalId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ type: z.literal("list"), ...scope }).strict(),
  z.object({ type: z.literal("close_all"), ...scope }).strict(),
  z
    .object({
      type: z.literal("remove"),
      ...scope,
      terminalId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("write"),
      ...scope,
      terminalId: z.string().uuid(),
      data: z.string().min(1).max(8192),
    })
    .strict(),
  z
    .object({
      type: z.literal("resize"),
      ...scope,
      terminalId: z.string().uuid(),
      ...size,
    })
    .strict(),
  z
    .object({
      type: z.literal("interrupt"),
      ...scope,
      terminalId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("close"),
      ...scope,
      terminalId: z.string().uuid(),
    })
    .strict(),
]);
export const TerminalSnapshot = z
  .object({
    terminalId: z.string().uuid(),
    sessionId: z.string().uuid(),
    cwd: z.string().max(4096),
    shell: z.string().max(100),
    state: z.enum(["running", "stopping", "exited", "failed"]),
    seq: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    output: z.string().max(65536),
    truncated: z.boolean(),
    cols: z.number().int(),
    rows: z.number().int(),
    exitCode: z.number().int().nullable(),
    error: z.string().max(500).nullable(),
  })
  .strict();
export const TerminalTab = TerminalSnapshot.pick({
  terminalId: true,
  sessionId: true,
  cwd: true,
  shell: true,
  state: true,
  exitCode: true,
});
export type TerminalTab = z.infer<typeof TerminalTab>;
export const TerminalReply = z
  .object({
    terminal: TerminalSnapshot.nullable(),
    terminals: z.array(TerminalTab).max(4).optional(),
  })
  .strict();
export type TerminalCommand = z.infer<typeof TerminalCommand>;
export type TerminalSnapshot = z.infer<typeof TerminalSnapshot>;
