import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { readFile } from "./read-file";
import { validatePath, protectedRuntimePaths } from "./workspace-path";
import { resolve, sep } from "node:path";
const execute = promisify(execFile);
/** 固定Git只读查询，不接受命令片段；禁用外部diff、textconv、fsmonitor和hooks。
 * 查询有10秒、64KiB上限。输出是查询时快照，不能确认文件修改归属。
 */
export async function workspaceChanges(root: string, path?: string) {
  const canonical = await realpath(root);
  // UI只读查询同样遵守Runtime数据目录保护，不能经Git绕过文件工具的边界。
  function assertUnprotected(target: string) {
    if (protectedRuntimePaths().some(directory => target === directory || target.startsWith(directory + sep))) throw new Error("不能查看应用受保护的数据目录");
  }
  assertUnprotected(canonical);
  if (path) assertUnprotected(resolve(canonical, path));
  if (canonical !== root) throw new Error("工作区身份已变化，请重新选择项目");
  async function git(args: string[]) {
    const {
      stdout
    } = await execute("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", root, ...args], {
      timeout: 10000,
      maxBuffer: 65536,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: "/nonexistent",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_TERMINAL_PROMPT: "0"
      }
    });
    return stdout;
  }
  let top: string;
  try {
    top = (await git(["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return {
      git: false,
      capturedAt: Date.now(),
      files: [],
      detail: "Git不可用或该目录不是Git工作区"
    };
  }
  if ((await realpath(top)) !== canonical) throw new Error("请选择Git仓库根目录后查看改动");
  const raw = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const fields = raw.split("\0");
  const files: {
    path: string;
    index: string;
    worktree: string;
  }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (!entry) continue;
    if (files.length >= 200) throw new Error("改动超过200项，请缩小工作区后查看");
    files.push({
      path: entry.slice(3),
      index: entry[0],
      worktree: entry[1]
    });
    if (/[RC]/.test(entry.slice(0, 2))) i++; // -z重命名还有一个来源路径。
  }
  let detail = "";
  if (path) {
    validatePath(path);
    const found = files.find(file => file.path === path);
    if (!found) throw new Error("文件状态已变化，请刷新改动列表");
    if (found.index === "?") detail = await readFile(root, path, AbortSignal.timeout(10000));else {
      const args = ["--no-ext-diff", "--no-textconv", "--no-color", "--", `:(literal)${path}`];
      detail = "暂存区相对HEAD\n" + (await git(["diff", "--cached", ...args])) + "\n工作区相对暂存区\n" + (await git(["diff", ...args]));
      if (detail.length > 65536) throw new Error("差异超过64Ki字符，请在本机编辑器查看");
    }
  }
  return {
    git: true,
    capturedAt: Date.now(),
    files,
    detail
  };
}
