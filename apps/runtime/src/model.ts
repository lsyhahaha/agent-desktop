import { z } from "zod";
import { toolDefinitions } from "./tools";
export type Call = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Call[];
  tool_call_id?: string;
};
export class ModelError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const Chunk = z
  .object({
    error: z.unknown().optional(),
    choices: z
      .array(
        z.object({
          index: z.number(),
          delta: z
            .object({
              content: z.string().nullable().optional(),
              tool_calls: z
                .array(
                  z.object({
                    index: z.number().int().min(0).max(11),
                    id: z.string().optional(),
                    function: z
                      .object({
                        name: z.string().optional(),
                        arguments: z.string().optional(),
                      })
                      .optional(),
                  }),
                )
                .optional(),
            })
            .passthrough(),
          finish_reason: z.string().nullable().optional(),
        }),
      )
      .optional(),
    usage: z
      .object({
        prompt_tokens: z.number().nonnegative(),
        completion_tokens: z.number().nonnegative(),
      })
      .nullable()
      .optional(),
  })
  .passthrough();
export async function modelStep(
  config: { model: string; apiKey: string },
  messages: Message[],
  tools: boolean,
  signal: AbortSignal,
  onText: (text: string) => void,
  options: {
    noTools?: boolean;
    maxTokens?: number;
    allowedToolNames?: readonly string[];
  } = {},
): Promise<{
  text: string;
  calls: Call[];
  usage: { input: number; output: number } | null;
}> {
  const timeout = AbortSignal.timeout(60000);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      redirect: "error",
      signal: combined,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        thinking: { type: "disabled" },
        max_tokens: options.maxTokens ?? 4096,
        ...(options.noTools
          ? {}
          : {
              tools: tools
                ? toolDefinitions.filter(
                    (tool) =>
                      !options.allowedToolNames ||
                      options.allowedToolNames.includes(tool.function.name),
                  )
                : toolDefinitions.filter((tool) =>
                    ["update_plan", "request_user_input"].includes(
                      tool.function.name,
                    ),
                  ),
            }),
      }),
    });
  } catch {
    signal.throwIfAborted();
    throw new ModelError(
      timeout.aborted ? "timeout" : "network",
      timeout.aborted ? "模型请求超时" : "无法连接 DeepSeek，请检查网络",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ModelError(
      "http_" + response.status,
      (
        {
          401: "API Key 无效或已过期",
          402: "账户余额不足",
          429: "请求受限，请稍后重试",
        } as Record<number, string>
      )[response.status] ?? `DeepSeek 请求失败（HTTP ${response.status}）`,
    );
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    await response.body?.cancel();
    throw new ModelError("protocol", "DeepSeek 未返回预期的流式响应");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "",
    text = "",
    finish: string | null = null,
    done = false,
    usage: { input: number; output: number } | null = null,
    total = 0;
  const calls = new Map<number, Call>();
  const frame = (data: string) => {
    if (data === "[DONE]") {
      done = true;
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      throw new ModelError("protocol", "模型返回了无效JSON");
    }
    const value = Chunk.parse(raw);
    if (value.error) throw new ModelError("provider", "DeepSeek 流返回错误");
    if (value.usage)
      usage = {
        input: value.usage.prompt_tokens,
        output: value.usage.completion_tokens,
      };
    for (const choice of value.choices ?? []) {
      if (choice.index !== 0) continue;
      const delta = choice.delta;
      if (delta.content) {
        text += delta.content;
        if (text.length > 65536)
          throw new ModelError("output_limit", "回答超出输出上限");
        onText(delta.content);
      }
      for (const c of delta.tool_calls ?? []) {
        let item = calls.get(c.index);
        if (!item) {
          item = {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          };
          calls.set(c.index, item);
        }
        if (c.id) item.id += c.id;
        if (c.function?.name) item.function.name += c.function.name;
        if (c.function?.arguments)
          item.function.arguments += c.function.arguments;
        if (
          item.function.arguments.length > 200000 ||
          item.id.length > 256 ||
          item.function.name.length > 100
        )
          throw new ModelError("tool_limit", "工具参数超出上限");
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  };
  try {
    while (!done) {
      const idle = AbortSignal.timeout(30000);
      let cleanup = () => {};
      const stalled = new Promise<never>((_, reject) => {
        const cb = () =>
          reject(new ModelError("stream_timeout", "模型流超过30秒未响应"));
        idle.addEventListener("abort", cb, { once: true });
        cleanup = () => idle.removeEventListener("abort", cb);
      });
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await Promise.race([reader.read(), stalled]);
      } finally {
        cleanup();
      }
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 4 * 1024 * 1024)
        throw new ModelError("stream_limit", "模型流超出大小上限");
      pending = (
        pending + decoder.decode(next.value, { stream: true })
      ).replace(/\r\n/g, "\n");
      if (pending.length > 262144)
        throw new ModelError("protocol", "模型流帧过大");
      let pos;
      while ((pos = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, pos);
        pending = pending.slice(pos + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) frame(data);
        if (done) break;
      }
    }
    signal.throwIfAborted();
    if (!done || !finish)
      throw new ModelError(
        "stream_interrupted",
        "模型流提前结束，未获得完整结果",
      );
    if (!["stop", "tool_calls"].includes(finish))
      throw new ModelError("model_" + finish, "模型未正常完成：" + finish);
    const list = [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1]);
    if (
      finish === "tool_calls" &&
      (!list.length ||
        list.some((c) => !c.id || !c.function.name) ||
        new Set(list.map((c) => c.id)).size !== list.length)
    )
      throw new ModelError("protocol", "工具调用结构无效");
    if (finish === "stop" && list.length)
      throw new ModelError("protocol", "工具调用结束原因不一致");
    if (finish === "stop" && !text.trim())
      throw new ModelError("empty_response", "模型没有返回回答文本");
    return { text, calls: list, usage };
  } catch (error) {
    signal.throwIfAborted();
    if (timeout.aborted) throw new ModelError("timeout", "模型请求超过60秒");
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
