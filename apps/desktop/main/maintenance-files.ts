import { open } from "node:fs/promises";
import { constants } from "node:fs";

/** 固定缓冲读取普通文件，拒绝链接、硬链接、大小或读取期间身份变化，避免维护入口读入无界正文。 */
export async function readBounded(path: string, limit: number) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > limit)
      throw new Error("Input is not a bounded ordinary file");
    const bytes = Buffer.alloc(limit + 1);
    const { bytesRead } = await fd.read(bytes, 0, bytes.length, 0),
      after = await fd.stat();
    if (
      bytesRead > limit ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      bytesRead !== before.size
    )
      throw new Error("Input changed during reading");
    return bytes.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}
