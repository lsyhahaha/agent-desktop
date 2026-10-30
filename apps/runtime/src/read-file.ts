import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
export const ReadInput = z
  .object({ path: z.string().min(1).max(1024) })
  .strict();
import { lstat, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep } from "node:path";

/** 只读文件入口的路径策略，不接受隐藏、凭据、穿越或链接路径。 */
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

/** 只读普通UTF-8文件。保留32KiB、链接、身份变化与取消检查，调用方负责逐次审批。 */
export async function readFile(
  root: string,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const {
    target,
    stat: before,
    verify: check,
  } = await workspacePath(root, path, signal);
  if (!before.isFile() || before.nlink !== 1 || before.size > 32768)
    throw new Error("只支持不超过32KiB的普通文本文件，不允许硬链接");
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (stat.dev !== before.dev || stat.ino !== before.ino)
      throw new Error("文件身份发生变化");
    const bytes = Buffer.alloc(32769);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    signal.throwIfAborted();
    const after = await check();
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      bytesRead > 32768
    )
      throw new Error("文件在读取期间改变或超出上限");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, bytesRead),
    );
    if (text.includes("\0")) throw new Error("不支持二进制文件");
    return text;
  } finally {
    await file.close();
  }
}
