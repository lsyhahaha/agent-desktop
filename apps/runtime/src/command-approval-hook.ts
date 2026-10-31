import { ExecInput, PollInput } from "./exec-command";

// 只信任系统自带、不会执行用户代码的少量查询命令。不能加入git、find、
// sed、awk、rg（preprocessor）、包管理器或解释器：它们可能间接执行删除。
const queries = new Set([
  "pwd",
  "echo",
  "printf",
  "true",
  "false",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "basename",
  "dirname",
  "uname",
  "whoami",
  "id",
]);

/** 不是Shell解析器：仅识别由独立字面量构成的一条简单查询。
 * 重定向、替换、转义、控制运算符、注释及任何未覆盖语法一律不自动放行。
 * 通过正向窄子集避免“正则没看到rm，所以安全”的错误授权。
 */
function isLiteralQuery(command: string): boolean {
  if (/[\r\n\0]/.test(command)) return false;
  const words: string[] = [];
  let offset = 0;
  const token = /(?:[a-zA-Z0-9_./,:=@%+\-]+|'[^'\r\n]*'|"[^"$`\\\r\n]*")/y;
  while (offset < command.length) {
    while (command[offset] === " " || command[offset] === "\t") offset++;
    if (offset === command.length) break;
    token.lastIndex = offset;
    const match = token.exec(command);
    if (!match) return false;
    const raw = match[0];
    // 命令名不允许引号/拼接；参数可使用完整的单/双引号字面量。
    if (!words.length && /['"]/.test(raw)) return false;
    words.push(
      raw.startsWith("'") || raw.startsWith('"') ? raw.slice(1, -1) : raw,
    );
    offset = token.lastIndex;
    if (offset < command.length && !/[ \t]/.test(command[offset])) return false;
  }
  if (!words.length) return false;
  const executable = words[0];
  const name = executable.replace(/^\/(?:usr\/)?bin\//, "");
  if (
    !queries.has(name) ||
    (executable.includes("/") &&
      executable !== `/bin/${name}` &&
      executable !== `/usr/bin/${name}`)
  )
    return false;
  // bash printf -v可对数组下标求值，不能当作纯输出；即使参数被引用也一样。
  return (
    name !== "printf" || !words.slice(1).some((word) => word.startsWith("-"))
  );
}

/** 返回强制人工审批理由；null仅表示通过保守的无删除子集检查，不授予宿主权限。
 * 所有模式均调用本钩子，独立模型不能代批。非空stdin也可能包含后续脚本。
 * 系统二进制/宿主可信为前提；不承诺抵抗恶意宿主替换系统程序。
 */
export function manualCommandReason(
  tool: string,
  input: unknown,
): string | null {
  if (tool === "write_stdin")
    return PollInput.parse(input).chars.length ? "stdin_requires_review" : null;
  if (tool !== "exec_command") return null;
  const { command } = ExecInput.parse(input);
  if (isLiteralQuery(command)) return null;
  return /(?:^|[\s/;|&])(rm|rmdir|unlink)(?:\s|$)|-delete\b|\bgit\s+(?:clean|rm)\b|\b(?:rmtree|remove|unlink)\s*\(/.test(
    command,
  )
    ? "deletion_requires_review"
    : "unverified_command_requires_review";
}
