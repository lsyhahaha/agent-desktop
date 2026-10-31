import { opendir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { workspacePath, validatePath, type PathAccess } from "./workspace-path";
import { z } from "zod";
export const DirectoryInput = z
  .object({
    path: z.string().min(1).max(1024).default("."),
    depth: z.number().int().min(1).max(3).default(2),
  })
  .strict();

/** 有界广度优先探索：优先给出顶层结构，不跟随链接，明确告知裁剪而非伪称全量目录树。 */
export async function listDirectory(
  root: string,
  path: string,
  depth: number,
  signal: AbortSignal,
  access: PathAccess = "workspace",
) {
  const first = await workspacePath(root, path, signal, true, access);
  if (!first.stat.isDirectory()) throw new Error("目标不是目录");
  const queue = [{ path, level: 0 }];
  const entries: { path: string; type: "directory" | "file" }[] = [];
  let examined = 0,
    skipped = 0,
    truncated = false,
    outputBytes = 0;
  while (queue.length) {
    const next = queue.shift()!;
    const location = await workspacePath(root, next.path, signal, true, access);
    if (!location.stat.isDirectory()) throw new Error("目录在遍历期间改变");
    const directory = await opendir(location.target, { bufferSize: 16 });
    // for-await在正常完成、抛错或break时关闭目录句柄；每次I/O后检查取消。
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (++examined > 400 || entries.length >= 160) {
        truncated = true;
        break;
      }
      const child =
        next.path === "." ? entry.name : next.path + "/" + entry.name;
      try {
        if (access === "workspace") validatePath(child);
        if (["dist", "out", "build", "coverage"].includes(entry.name)) {
          skipped++;
          continue;
        }
        const info = await lstat(join(location.target, entry.name));
        if (
          info.isSymbolicLink() ||
          info.dev !== first.stat.dev ||
          (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
        ) {
          skipped++;
          continue;
        }
        await workspacePath(root, child, signal, false, access);
        const bytes = Buffer.byteLength(child) + 48;
        if (outputBytes + bytes > 16000) {
          truncated = true;
          break;
        }
        outputBytes += bytes;
        entries.push({
          path: child,
          type: info.isDirectory() ? "directory" : "file",
        });
        if (info.isDirectory() && next.level + 1 < depth)
          queue.push({ path: child, level: next.level + 1 });
      } catch (error) {
        signal.throwIfAborted();
        skipped++;
      }
    }
    await location.verify();
    if (truncated) break;
  }
  signal.throwIfAborted();
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    path,
    depth,
    entries,
    truncated,
    skipped,
    notice:
      "仅返回指定深度内的允许条目；条目按权限和文件类型过滤，链接与构建目录跳过。truncated=true表示达到总条目或扫描预算，请缩小path继续列目录。",
  };
}
