import { z } from "zod";
/** 会话配置与Run冻结快照分离；只能由用户命令修改，该枚举本身不是授权凭证。 */
export const PermissionMode = z.enum(["ask", "auto_review", "full_access"]);
export type PermissionMode = z.infer<typeof PermissionMode>;
