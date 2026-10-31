import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
export const ReadInput = z
  .object({ path: z.string().min(1).max(1024) })
  .strict();
export { validatePath } from "./workspace-path";
import { type PathAccess, workspacePath } from "./workspace-path";
/** 只读普通UTF-8文件。保留32KiB、链接、身份变化与取消检查，调用方按冻结的 Run 权限模式授权。 */
export async function readFile(
  root: string,
  path: string,
  signal: AbortSignal,
  access: PathAccess = "workspace",
): Promise<string> {
  const {
    target,
    stat: before,
    verify: check,
  } = await workspacePath(root, path, signal, false, access);
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
