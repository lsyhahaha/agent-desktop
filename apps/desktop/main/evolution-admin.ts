import { app } from "electron";
import { readBounded } from "./maintenance-files";
import { join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ReadingStrategyId } from "@protocol";
import { StrategyEvaluation } from "../../runtime/src/strategy-evaluation";
import { EvolutionDraft } from "../../runtime/src/evolution-record";
import { SessionStore } from "../../runtime/src/storage";
import { workspacePath } from "../../runtime/src/workspace-path";

/** 本机维护CLI与主应用共享实例锁：已有应用运行时拒绝另开数据库写者，不强杀或切换数据目录。 */
app.setName("agent-desktop");
const option = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const testData = option("user-data");
app.setPath(
  "userData",
  testData ? resolve(testData) : join(app.getPath("appData"), "agent-desktop"),
);
const selection = option("select-strategy");
const file = option("import"),
  getId = option("get"),
  list = process.argv.includes("--list");

async function main() {
  if (
    Number(!!file) + Number(!!getId) + Number(list) + Number(!!selection) !==
    1
  )
    throw new Error(
      "Usage: npm run evolution -- --import=/absolute/record.json OR --list --project=/absolute/project OR --get=UUID --project=/absolute/project OR --select-strategy=ID --project=/absolute/project --evaluation=/absolute/report.json --human-reviewed --rationale=TEXT",
    );
  if (!app.requestSingleInstanceLock())
    throw new Error(
      "Agent Desktop is running; quit it normally before maintenance. No database opened.",
    );
  await app.whenReady();
  let draft: EvolutionDraft | undefined;
  if (file) {
    draft = EvolutionDraft.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readBounded(resolve(file), 131072),
        ),
      ),
    );
    draft.projectPath = await realpath(draft.projectPath);
    // 证据只允许项目普通文件，复用既有路径策略；哈希只证明导入时文件对应，不证明实验结论正确。
    for (const evidence of draft.evidence) {
      const location = await workspacePath(
        draft.projectPath,
        evidence.path,
        AbortSignal.timeout(5000),
      );
      const bytes = await readBounded(location.target, 2 * 1024 * 1024);
      await location.verify();
      if (createHash("sha256").update(bytes).digest("hex") !== evidence.sha256)
        throw new Error("Evidence digest mismatch; record not imported");
    }
  }
  const project =
    draft?.projectPath ?? (await realpath(option("project") ?? ""));
  if (!draft && !option("project")) throw new Error("Project path is required");
  const database = join(app.getPath("userData"), "storage/sessions.sqlite");
  const store = new SessionStore(database, () => {});
  try {
    if (selection) {
      if (!process.argv.includes("--human-reviewed"))
        throw new Error("Explicit human review required");
      const strategyId = ReadingStrategyId.parse(selection),
        reportPath = option("evaluation");
      const report = reportPath
        ? StrategyEvaluation.parse(
            JSON.parse(
              (await readBounded(resolve(reportPath), 1024 * 1024)).toString(
                "utf8",
              ),
            ),
          )
        : null;
      const result = await store.selectReadingStrategy(
        project,
        strategyId,
        report,
        option("rationale") ?? "",
      );
      console.log(
        JSON.stringify({
          database,
          project,
          strategyId: result,
          reviewer: "operator",
        }),
      );
    } else if (draft) {
      const record = await store.appendEvolution(draft);
      console.log(
        JSON.stringify({
          database,
          id: record.id,
          key: record.data.key,
          createdAt: record.createdAt,
          provenance: record.provenance,
        }),
      );
    } else if (getId)
      console.log(JSON.stringify(await store.getEvolution(project, getId)));
    else
      console.log(
        JSON.stringify(
          await store.evolutionPage(project, Number(option("after") ?? 0), 20),
        ),
      );
  } finally {
    await store.close();
  }
}
void main()
  .then(() => app.exit(0))
  .catch((error) => {
    // 不打印Zod输入值、原始记录或错误堆栈；仅给出固定维护失败信息。
    console.error(
      error instanceof Error &&
        (error.message.startsWith("Usage:") ||
          error.message.startsWith("Agent Desktop is running"))
        ? error.message
        : "Evolution maintenance failed: check input, evidence hashes and database. No success was confirmed.",
    );
    app.exit(1);
  });
