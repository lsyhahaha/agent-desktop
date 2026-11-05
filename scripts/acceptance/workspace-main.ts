/** 生产Main/preload/utility Runtime集成验收。仅原生目录选择与系统打开动作使用替身。 */
import { app, BrowserWindow, dialog, shell } from "electron";
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const temp = realpathSync(mkdtempSync(join(tmpdir(), "workspace-main-")));
mkdirSync(join(temp, "profile"));
mkdirSync(join(temp, "project"));
app.setPath("userData", join(temp, "profile"));
const project = join(temp, "project");
writeFileSync(join(project, "source.ts"), "export const fixture = true;\n");
let opened = "";
dialog.showOpenDialog = (async () => ({
  canceled: false,
  filePaths: [project]
})) as typeof dialog.showOpenDialog;
shell.openPath = async path => {
  opened = path;
  return "";
};
async function run() {
  const result: {
    status: string;
    checks: string[];
    error?: string;
  } = {
    status: "running",
    checks: []
  };
  try {
    await import(pathToFileURL(resolve("out/main/index.js")).href);
    let window: BrowserWindow | undefined;
    const deadline = Date.now() + 15000;
    while (!(window = BrowserWindow.getAllWindows()[0]) || window.webContents.isLoading()) {
      if (Date.now() > deadline) throw new Error("production window startup timeout");
      await new Promise(r => setTimeout(r, 50));
    }
    async function js(code: string) {
      return window!.webContents.executeJavaScript(code);
    }
    let snapshot = await js("window.desktop.chat({type:'snapshot'})");
    const first = snapshot.sessionId;
    await js(`window.desktop.chat(${JSON.stringify({
      type: "save_draft",
      sessionId: first,
      text: "真实跨进程草稿"
    })})`);
    await js("window.desktop.selectWorkspace()");
    snapshot = await js("window.desktop.chat({type:'snapshot'})");
    assert.equal(snapshot.workspace.path, project);
    assert.equal(snapshot.draft, "");
    const id = snapshot.sessionId;
    result.checks.push("production handshake, native selection and draft isolation");
    await js(`window.desktop.openWorkspaceFile(${JSON.stringify({
      sessionId: id,
      path: "source.ts"
    })})`);
    assert.equal(opened, join(project, "source.ts"));
    for (const input of [{
      sessionId: first,
      path: "source.ts"
    }, {
      sessionId: id,
      path: "../source.ts"
    }, {
      sessionId: id,
      path: "run.command"
    }]) {
      const rejected = await js(`window.desktop.openWorkspaceFile(${JSON.stringify(input)}).then(()=>false,()=>true)`);
      assert.equal(rejected, true);
    }
    result.checks.push("production file-open route and stale-session/traversal/executable denial");
    await js("window.desktop.chat({type:'no_project'})");
    snapshot = await js("window.desktop.chat({type:'snapshot'})");
    assert.equal(snapshot.draft, "真实跨进程草稿");
    result.checks.push("production no-project draft restore");
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.error = String(error);
    process.exitCode = 1;
  } finally {
    mkdirSync(resolve("docs/evidence/workspace-ui"), {
      recursive: true
    });
    writeFileSync(resolve("docs/evidence/workspace-ui/production-chain.json"), JSON.stringify({
      ...result,
      mode: "controlled",
      replaced: ["native folder picker", "system openPath"],
      temp
    }, null, 2));
    console.log(JSON.stringify(result, null, 2));
    app.quit();
  }
}
void run();
