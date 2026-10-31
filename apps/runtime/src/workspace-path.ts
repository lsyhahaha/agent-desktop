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

/** 两个只读工具共用路径策略。rootOnly 只用于目录工具的“.”，不能用于读取文件。 */
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
) {
  const parts = validatePath(path, rootOnly);
  signal.throwIfAborted();
  const canonical = await realpath(root);
  const rootStat = await lstat(canonical);
  if (!rootStat.isDirectory()) throw new Error("工作区不是目录");
  const target = resolve(canonical, ...parts);
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
    if (isProtected(real))
      throw new Error("禁止工具访问应用自己的会话数据目录");
    if (
      (!rootOnly && !rel) ||
      rel === ".." ||
      rel.startsWith(".." + sep) ||
      isAbsolute(rel)
    )
      throw new Error("路径超出工作区");
    signal.throwIfAborted();
    return lstat(target);
  };
  return { canonical, target, verify, stat: await verify() };
}
