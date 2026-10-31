import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { validatePath, type PathAccess } from "./workspace-path";
/** 只分类已声明的权限需求；不根据命令关键词判断shell是否安全。 */
export async function pathNeedsApproval(root: string, path: string) {
  const canonical = await realpath(root),
    target = resolve(canonical, path),
    rel = relative(canonical, target);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    return true;
  try {
    validatePath(rel || ".", true);
    return false;
  } catch {
    return true;
  }
}
export function permittedPathAccess(
  full: boolean,
  needsApproval: boolean,
): PathAccess {
  return full ? "full" : needsApproval ? "approved" : "workspace";
}
