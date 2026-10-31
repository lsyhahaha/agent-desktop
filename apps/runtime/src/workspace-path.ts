import { lstat, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";

// 仅Runtime启动代码登记应用数据目录；模型和renderer没有放宽此列表的接口。
const protectedRoots = new Set<string>();
export function protectRuntimeDirectory(path: string) {
  protectedRoots.add(resolve(path));
}
export function protectedRuntimePaths(): string[] {
  return [...protectedRoots];
}
function isProtected(path: string) {
  return [...protectedRoots].some(
    (root) => path === root || path.startsWith(root + sep),
  );
}

/** 仅由Runtime完成模式/单次审批后注入；不得接受模型自报该字段。 */
export type PathAccess = "workspace" | "approved" | "full";
/** 目录/读取/编辑工具共用路径策略。rootOnly 只用于目录工具的“.”，不能用于读取文件。 */
export function validatePath(path: string, rootOnly = false): string[] {
  if (rootOnly && path === ".") return [];
  if (
    isAbsolute(path) ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes(String.fromCharCode(92)) ||
    path.includes("\0")
  )
    throw new Error("只允许工作区相对路径");
  const parts = path.split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === ".." ||
        p === "." ||
        p.startsWith(".") ||
        ["node_modules", "vendor"].includes(p) ||
        /\.(pem|key|p12|pfx|keystore)$/i.test(p) ||
        /^(credentials|id_rsa|id_ed25519)$/i.test(p),
    )
  )
    throw new Error("路径越界或属于禁止读取的隐藏/凭据目录");
  return parts;
}
/** 校验路径的每一级，拒绝链接和跨设备挂载；无法代替OS沙箱抵抗恶意并发改名。 */
export async function workspacePath(
  root: string,
  path: string,
  signal: AbortSignal,
  rootOnly = false,
  access: PathAccess = "workspace",
) {
  if (path.includes("\0") || path.length > 1024) throw new Error("无效路径");
  signal.throwIfAborted();
  const canonical = await realpath(root);
  // 绝对路径仍以规范工作区为边界；不能因为路径写法改变授权范围。
  const workspaceRelative = isAbsolute(path)
    ? relative(canonical, resolve(path)) || "."
    : path;
  const parts =
    access === "workspace" ? validatePath(workspaceRelative, rootOnly) : [];
  const rootStat = await lstat(canonical);
  if (!rootStat.isDirectory()) throw new Error("工作区不是目录");
  const target =
    access === "workspace"
      ? resolve(canonical, ...parts)
      : resolve(canonical, path);
  const verify = async () => {
    signal.throwIfAborted();
    let current = canonical;
    for (const part of parts) {
      current = resolve(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink() || info.dev !== rootStat.dev)
        throw new Error("禁止符号链接或跨设备访问");
    }
    const real = await realpath(target),
      rel = relative(canonical, real);
    if (access !== "full" && isProtected(real))
      throw new Error("禁止工具访问应用自己的会话数据目录");
    if (
      access === "workspace" &&
      ((!rootOnly && !rel) ||
        rel === ".." ||
        rel.startsWith(".." + sep) ||
        isAbsolute(rel))
    )
      throw new Error("路径超出工作区");
    signal.throwIfAborted();
    const info = await lstat(target);
    if (info.isSymbolicLink()) throw new Error("不支持符号链接目标");
    return info;
  };
  return { canonical, target, verify, stat: await verify() };
}
