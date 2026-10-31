import { createHash, randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { readFile } from "./read-file";
import { workspacePath } from "./workspace-path";

export const contentHash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export type ReadVersion = {
  text: string;
  hash: string;
  dev: number;
  ino: number;
  mode: number;
  mtimeMs: number;
};
/** 版本只由一次已授权的真实读取建立，不接受模型自报的文件身份。 */
export async function readVersion(
  root: string,
  path: string,
  signal: AbortSignal,
): Promise<ReadVersion> {
  const location = await workspacePath(root, path, signal);
  const text = await readFile(root, path, signal);
  const after = await location.verify();
  if (
    location.stat.ino !== after.ino ||
    location.stat.dev !== after.dev ||
    location.stat.mtimeMs !== after.mtimeMs ||
    location.stat.size !== after.size
  )
    throw new Error("文件在读取期间改变，请重新读取");
  return {
    text,
    hash: contentHash(text),
    dev: after.dev,
    ino: after.ino,
    mode: after.mode,
    mtimeMs: after.mtimeMs,
  };
}
export class EditError extends Error {
  constructor(
    public code: "file_conflict" | "write_unknown",
    message: string,
  ) {
    super(message);
  }
}
/** 单文件替换：意图由调用方先落盘。最终校验不能替代OS隔离，也不是跨文件事务。 */
export async function applyEdit(
  root: string,
  path: string,
  base: ReadVersion,
  after: string,
  signal: AbortSignal,
) {
  if (
    Buffer.byteLength(after, "utf8") > 32768 ||
    after.includes("\0") ||
    new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(after)) !==
      after
  )
    throw new Error("候选内容必须是不超过32KiB的UTF-8文本");
  const location = await workspacePath(root, path, signal);
  const temporary = join(
    dirname(location.target),
    `.agent-edit-${randomUUID()}.tmp`,
  );
  let replaced = false;
  try {
    const file = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(after, "utf8");
      await file.chmod(base.mode & 0o777);
      await file.sync();
    } finally {
      await file.close();
    }
    const current = await readVersion(root, path, signal);
    if (
      current.hash !== base.hash ||
      current.dev !== base.dev ||
      current.ino !== base.ino ||
      current.mtimeMs !== base.mtimeMs ||
      current.mode !== base.mode
    )
      throw new EditError(
        "file_conflict",
        "文件已变化，未应用修改；请重新读取并审批",
      );
    await location.verify();
    signal.throwIfAborted();
    await rename(temporary, location.target);
    replaced = true;
    // rename之后不再接受取消来抹去已发生的事实，先完成持久化与结果核对。
    const directory = await open(dirname(location.target), constants.O_RDONLY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (replaced)
      throw new EditError(
        "write_unknown",
        "文件可能已经替换，持久化结果未确认；请核对文件",
      );
    throw error;
  } finally {
    if (!replaced)
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT")
          console.warn("[edit] temporary_cleanup_failed", { code: error.code });
      });
  }
}
