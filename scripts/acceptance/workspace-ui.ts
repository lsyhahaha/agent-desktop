/** 隔离受控集成入口。使用真实Sessions/Worker/React，仅Provider与桌面桥接为替身。
 * 临时数据库和Git仓库不接触正式userData，不加载凭据，不发起网络请求。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtemp, writeFile, copyFile, mkdir, realpath, unlink } from "node:fs/promises";
import { mkdtempSync, realpathSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { protectRuntimeDirectory } from "../../apps/runtime/src/workspace-path";
import { Sessions } from "../../apps/runtime/src/sessions";
async function run() {
  const root = resolve(".");
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "workspace-ui-")));
  mkdirSync(join(temp, "profile"));
  app.setPath("userData", join(temp, "profile"));
  const evidence: Record<string, unknown> = {
    mode: "controlled",
    replaced: ["Provider", "desktop bridge", "PTY", "clipboard"],
    checks: [],
    temp
  };
  const checks = evidence.checks as string[];
  let sessions: Sessions;
  let window: BrowserWindow;
  globalThis.fetch = async () => new Response('data: ' + JSON.stringify({
    choices: [{
      index: 0,
      delta: {
        content: "你好！这是受控验收回复。\n\n```ts\nconst answer = 42;\n```"
      },
      finish_reason: "stop"
    }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20
    }
  }) + '\n\ndata: [DONE]\n\n', {
    headers: {
      "content-type": "text/event-stream"
    }
  });
  async function waitFor(predicate: () => boolean, message: string) {
    const deadline = Date.now() + 12000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(message);
      await new Promise(r => setTimeout(r, 50));
    }
  }
  try {
    await app.whenReady();
    const project = join(temp, "project");
    await mkdir(project);
    const git = (...args: string[]) => execFileSync("git", ["-C", project, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null"
      }
    });
    git("init");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    await writeFile(join(project, "tracked.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "fixture");
    sessions = new Sessions(snapshot => window?.webContents.send("fixture:snapshot", snapshot), join(temp, "data", "sessions.sqlite"));
    await sessions.initialize();
    let state = sessions.snapshot();
    const noProject = state.sessionId;
    await sessions.command({
      type: "save_draft",
      sessionId: noProject,
      text: "保留草稿中文"
    });
    await sessions.command({
      type: "new"
    }, undefined, {
      name: "project",
      path: project
    });
    state = sessions.snapshot();
    assert.equal(state.draft, "");
    checks.push("project draft isolation");
    const projectSession = state.sessionId;
    await sessions.command({
      type: "send",
      sessionId: projectSession,
      text: "唯一搜索词 验收"
    }, {
      root: project,
      config: {
        model: "fixture",
        apiKey: "fixture-only"
      }
    });
    await waitFor(() => sessions.snapshot().chat.state === "completed", "controlled run did not finish");
    await sessions.command({
      type: "list_sessions",
      page: 0,
      query: "唯一搜索词"
    });
    assert.equal(sessions.snapshot().sessions[0].id, projectSession);
    assert.ok(sessions.snapshot().sessions[0].matchedRunId);
    checks.push("SQLite body search and run identity");
    await sessions.command({
      type: "no_project"
    });
    assert.equal(sessions.snapshot().draft, "保留草稿中文");
    await sessions.command({
      type: "new"
    }, undefined, {
      name: "project",
      path: project
    });
    assert.equal(sessions.snapshot().sessionId, projectSession);
    checks.push("project recent restore and no-project restore");
    for (let index = 0; index < 21; index++) {
      await sessions.command({
        type: "new"
      });
      await sessions.command({
        type: "save_draft",
        sessionId: sessions.snapshot().sessionId,
        text: `分页草稿${index}`
      });
    }
    await sessions.command({
      type: "list_sessions",
      page: 0,
      query: ""
    });
    const firstPage = sessions.snapshot().sessions.map(item => item.id);
    assert.equal(firstPage.length, 20);
    assert.equal(sessions.snapshot().hasMoreSessions, true);
    await sessions.command({
      type: "list_sessions",
      page: 1
    });
    assert.ok(sessions.snapshot().sessions.length > 0);
    assert.ok(sessions.snapshot().sessions.every(item => !firstPage.includes(item.id)));
    await sessions.command({
      type: "list_sessions",
      page: 0,
      query: "唯一搜索词"
    });
    assert.equal(sessions.snapshot().sessions.length, 1);
    await sessions.command({
      type: "select",
      sessionId: projectSession
    });
    checks.push("project pagination, nonempty draft preservation and body search across pages");
    await writeFile(join(project, "tracked.txt"), "staged\n");
    git("add", "tracked.txt");
    await writeFile(join(project, "tracked.txt"), "unstaged\n");
    await writeFile(join(project, "new.txt"), "new evidence\n");
    await sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "tracked.txt"
    });
    assert.match(sessions.snapshot().changes!.detail, /staged/);
    assert.match(sessions.snapshot().changes!.detail, /unstaged/);
    await sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "new.txt"
    });
    assert.match(sessions.snapshot().changes!.detail, /new evidence/);
    await assert.rejects(() => sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "../escape"
    }));
    checks.push("Git mixed-index and untracked content, traversal denied");
    await unlink(join(project, "tracked.txt"));
    await sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "tracked.txt"
    });
    assert.match(sessions.snapshot().changes!.detail, /deleted file mode/);
    await writeFile(join(project, "tracked.txt"), "unstaged\n");
    await writeFile(join(project, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await assert.rejects(() => sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "binary.bin"
    }));
    await unlink(join(project, "binary.bin"));
    checks.push("Git deletion and binary untracked rejection");
    await mkdir(join(project, "nested"));
    await writeFile(join(project, "nested", "added.ts"), "export const added = 1;\n");
    await sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "nested/added.ts"
    });
    assert.ok(sessions.snapshot().changes!.files.some(file => file.path === "nested/added.ts"));
    assert.match(sessions.snapshot().changes!.detail, /added = 1/);
    checks.push("nested untracked files listed and readable");
    await mkdir(join(project, "guarded"));
    await writeFile(join(project, "guarded", "session.txt"), "protected fixture");
    protectRuntimeDirectory(join(project, "guarded"));
    await assert.rejects(() => sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "guarded/session.txt"
    }));
    checks.push("Git content query cannot bypass protected runtime directory");
    await sessions.command({
      type: "save_draft",
      sessionId: projectSession,
      text: "重启恢复草稿"
    });
    await sessions.close();
    sessions = new Sessions(snapshot => window?.webContents.send("fixture:snapshot", snapshot), join(temp, "data", "sessions.sqlite"));
    await sessions.initialize();
    assert.equal(sessions.snapshot().draft, "重启恢复草稿");
    checks.push("draft cold restore");
    // 在已关闭的隔离库副本上模拟旧格式，验证迁移保留已有消息。
    await sessions.close();
    await mkdir(join(temp, "legacy-data"));
    const legacyPath = join(temp, "legacy-data", "sessions.sqlite");
    await copyFile(join(temp, "data", "sessions.sqlite"), legacyPath);
    const legacyDb = new DatabaseSync(legacyPath);
    legacyDb.exec("DROP TABLE session_drafts; DROP TABLE project_navigation; PRAGMA user_version=6;");
    legacyDb.close();
    const legacy = new Sessions(() => {}, legacyPath);
    await legacy.initialize();
    assert.ok(legacy.snapshot().chat.messages.length > 0);
    assert.equal(legacy.snapshot().draft, "");
    await legacy.close();
    sessions = new Sessions(snapshot => window?.webContents.send("fixture:snapshot", snapshot), join(temp, "data", "sessions.sqlite"));
    await sessions.initialize();
    checks.push("v6 to v7 migration preserves history and defaults absent draft");
    await sessions.command({
      type: "list_sessions",
      page: 0,
      query: ""
    });
    const preload = join(temp, "preload.cjs");
    await writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('desktop',{
    chat:v=>ipcRenderer.invoke('fixture:chat',v),onChat:f=>{const l=(_,v)=>f(v);ipcRenderer.on('fixture:snapshot',l);return()=>ipcRenderer.removeListener('fixture:snapshot',l)},
    getStatus:async()=>({appVersion:'fixture',electronVersion:process.versions.electron,runtime:{state:'ready'}}),
    getSettings:async()=>({model:'fixture',hasKey:true}),saveSettings:async()=>({model:'fixture',hasKey:true}),selectWorkspace:async()=>null,
    terminal:v=>ipcRenderer.invoke('fixture:terminal',v),onTerminal:()=>()=>{}
  });`);
    let terminalOpens = 0;
    ipcMain.handle("fixture:terminal", (_event, value) => {
      if (value.type === "open") terminalOpens++;
      return {
        terminal: null,
        terminals: []
      };
    });
    let delayedDrafts = false;
    ipcMain.handle("fixture:chat", async (_event, value) => {
      if (delayedDrafts && value.type === "save_draft")
        await new Promise((resolve) => setTimeout(resolve, value.text ? 20 : 800));
      return sessions.command(value, value.type === "send" ? {root:project,config:{model:"fixture",apiKey:"fixture-only"}} : undefined);
    });
    window = new BrowserWindow({
      width: 1320,
      height: 860,
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    await window.loadFile(join(root, "out/renderer/index.html"));
    await new Promise(r => setTimeout(r, 1300));
    const inspect = () => window.webContents.executeJavaScript(`({body:document.body.innerText, replyHeadings:document.querySelectorAll('.type-message .timeline-heading').length, details:document.querySelectorAll('details.routine-execution').length, textarea:document.querySelector('textarea[aria-label="消息"]')?.value})`);
    let ui = await inspect();
    assert.equal(ui.replyHeadings, 0);
    assert.ok(ui.details > 0);
    assert.equal(ui.textarea, "重启恢复草稿");
    assert.ok(!ui.body.includes("无已确认修改"));
    checks.push("real renderer plain reply, folded model, restored draft");
    await mkdir(join(root, "docs/evidence/workspace-ui"), {
      recursive: true
    });
    await writeFile(join(root, "docs/evidence/workspace-ui/default.png"), (await window.webContents.capturePage()).toPNG());
    window.setSize(1000, 680);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';document.querySelector('.composer-expand').click()`);
    await new Promise(r => setTimeout(r, 300));
    await writeFile(join(root, "docs/evidence/workspace-ui/minimum.png"), (await window.webContents.capturePage()).toPNG());
    checks.push("default and minimum renderer screenshots captured");
    const layout = await window.webContents.executeJavaScript(`(() => {
    const send=document.querySelector('[aria-label="发送消息"]'), box=send.getBoundingClientRect();
    return { visible:box.bottom<=innerHeight && box.top>=0, overflow:document.documentElement.scrollWidth>innerWidth,
      codeCopies:[...document.querySelectorAll('button')].filter(b=>b.textContent==='复制代码').length };
  })()`);
    assert.equal(layout.visible, true);
    assert.equal(layout.overflow, false);
    assert.equal(layout.codeCopies, 1);
    checks.push("minimum send reachability, no document overflow, code copy entry");
    await window.webContents.executeJavaScript(`Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__fixtureCopied=text}},configurable:true});[...document.querySelectorAll('button')].find(b=>b.textContent==='复制代码').click()`);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(await window.webContents.executeJavaScript(`window.__fixtureCopied`), "const answer = 42;\n");
    checks.push("code copy exact text through controlled clipboard");
    const beforeIme = sessions.snapshot().chat.runId;
    await window.webContents.executeJavaScript(`document.querySelector('textarea[aria-label="消息"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}))`);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(sessions.snapshot().chat.runId, beforeIme);
    checks.push("IME composing shortcut does not send");
    await window.webContents.executeJavaScript(`document.querySelector('details.routine-execution > summary').click()`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('details.routine-execution').open`), true);
    await sessions.command({
      type: "save_draft",
      sessionId: projectSession,
      text: "更新后的草稿"
    });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('details.routine-execution').open`), true);
    checks.push("execution disclosure survives authoritative snapshot refresh");
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
    await writeFile(join(root, "docs/evidence/workspace-ui/light.png"), (await window.webContents.capturePage()).toPNG());
    await sessions.command({
      type: "workspace_changes",
      sessionId: projectSession,
      path: "tracked.txt"
    });
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="打开终端"]')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='改动')?.click()`);
    await new Promise(r => setTimeout(r, 200));
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="工作区改动"]')!==null`));
    checks.push("real change-panel rendering");
    const opensBefore = terminalOpens;
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='终端').click()`);
    await new Promise(r => setTimeout(r, 100));
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='改动').click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(terminalOpens, opensBefore);
    checks.push("terminal view switching does not request another PTY");
    await writeFile(join(root, "docs/evidence/workspace-ui/changes.png"), (await window.webContents.capturePage()).toPNG());
    // 真实Agent审批与取消链路，Provider仅提出工具，拒绝/取消后不会执行命令。
    const textProvider = globalThis.fetch;
    let readProposed = false;
    globalThis.fetch = async () => {
      const delta = readProposed ? {
        content: "已读取[新增文件](new.txt)。"
      } : {
        tool_calls: [{
          index: 0,
          id: "fixture-read",
          type: "function",
          function: {
            name: "read_file",
            arguments: JSON.stringify({
              path: "new.txt"
            })
          }
        }]
      };
      const finish = readProposed ? "stop" : "tool_calls";
      readProposed = true;
      return new Response("data: " + JSON.stringify({
        choices: [{
          index: 0,
          delta,
          finish_reason: finish
        }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20
        }
      }) + "\n\ndata: [DONE]\n\n", {
        headers: {
          "content-type": "text/event-stream"
        }
      });
    };
    await sessions.command({
      type: "send",
      sessionId: projectSession,
      text: "读取新增文件并给出引用"
    }, {
      root: project,
      config: {
        model: "fixture",
        apiKey: "fixture-only"
      }
    });
    await waitFor(() => sessions.snapshot().chat.state === "completed", "read reference did not finish");
    assert.ok(sessions.snapshot().chat.tools.some(tool => tool.name === "read_file" && tool.state === "success"));
    await new Promise(r => setTimeout(r, 100));
    await window.webContents.executeJavaScript(`document.querySelector('a[href^="#file-ref="]').click()`);
    assert.equal(await window.webContents.executeJavaScript(`document.activeElement.dataset.filePath`), "new.txt");
    globalThis.fetch = textProvider;
    checks.push("relative file reference locates existing same-run read record");
    async function requestApproval() {
      let proposed = false;
      globalThis.fetch = async (...args) => {
        if (proposed) return textProvider(...args);
        proposed = true;
        return new Response("data: " + JSON.stringify({
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: "fixture-approval",
                type: "function",
                function: {
                  name: "exec_command",
                  arguments: JSON.stringify({
                    command: "printf fixture && true",
                    path: "."
                  })
                }
              }]
            },
            finish_reason: "tool_calls"
          }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20
          }
        }) + "\n\ndata: [DONE]\n\n", {
          headers: {
            "content-type": "text/event-stream"
          }
        });
      };
      await sessions.command({
        type: "send",
        sessionId: projectSession,
        text: "受控审批场景"
      }, {
        root: project,
        config: {
          model: "fixture",
          apiKey: "fixture-only"
        }
      });
      await waitFor(() => !!sessions.snapshot().chat.interaction, "approval did not appear");
      await assert.rejects(() => sessions.command({
        type: "no_project"
      }));
      const pending = sessions.snapshot().chat;
      assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.timeline-interaction')!==null`));
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='展开 参数与执行结果').click()`);
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='复制完整命令').click()`);
      await new Promise(r => setTimeout(r, 30));
      assert.equal(await window.webContents.executeJavaScript(`window.__fixtureCopied`), "printf fixture && true");
      return pending;
    }
    const approval = await requestApproval();
    await sessions.command({
      type: "approve",
      sessionId: projectSession,
      runId: approval.runId!,
      interactionId: approval.interaction!.id,
      allow: false
    });
    await waitFor(() => sessions.snapshot().chat.state === "completed", "denied run did not finish");
    assert.ok(sessions.snapshot().chat.tools.some(tool => tool.state === "denied"));
    checks.push("approval visible, full command copy, active project switch denied, refusal retained");
    const cancelled = await requestApproval();
    await sessions.command({
      type: "cancel",
      sessionId: projectSession,
      runId: cancelled.runId!
    });
    await waitFor(() => sessions.snapshot().chat.state === "cancelled", "cancel did not settle");
    globalThis.fetch = textProvider;
    checks.push("pending approval cancellation settles without command execution");
    delayedDrafts = true;
    await new Promise(r=>setTimeout(r,50));
    await window.webContents.executeJavaScript(`(() => {const input=document.querySelector('textarea[aria-label="消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'延迟保存不能恢复旧草稿');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await new Promise(r=>setTimeout(r,20));
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="发送消息"]').click()`);
    await new Promise(r=>setTimeout(r,50));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('textarea[aria-label="消息"]').disabled`),true);
    await waitFor(()=>sessions.snapshot().chat.state === "completed" && sessions.snapshot().draft === "", "delayed send did not clear draft");
    await new Promise(r=>setTimeout(r,700));
    assert.equal(sessions.snapshot().draft, "");
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('textarea[aria-label="消息"]').value`),"");
    delayedDrafts = false;
    checks.push("composer locked during delayed draft send and late debounce cannot resurrect sent text");
    const plain = join(temp, "plain");
    await mkdir(plain);
    await sessions.command({
      type: "new"
    }, undefined, {
      name: "plain",
      path: plain
    });
    await sessions.command({
      type: "workspace_changes",
      sessionId: sessions.snapshot().sessionId
    });
    assert.equal(sessions.snapshot().changes!.git, false);
    await sessions.command({
      type: "new"
    }, undefined, {
      name: "project",
      path: project
    });
    assert.equal(sessions.snapshot().sessionId, projectSession);
    checks.push("non-Git scope fallback and project navigation restore");
    await sessions.close();
    await mkdir(join(temp, "fault-data"));
    const faultPath = join(temp, "fault-data", "sessions.sqlite");
    await copyFile(join(temp, "data", "sessions.sqlite"), faultPath);
    const faultDb = new DatabaseSync(faultPath);
    faultDb.exec("CREATE TRIGGER refuse_draft BEFORE INSERT ON session_drafts BEGIN SELECT RAISE(ABORT,'controlled draft failure'); END;");
    faultDb.close();
    const fault = new Sessions(() => {}, faultPath);
    await fault.initialize();
    const retained = fault.snapshot().draft;
    await assert.rejects(() => fault.command({
      type: "save_draft",
      sessionId: fault.snapshot().sessionId,
      text: "不得伪报成功"
    }));
    assert.equal(fault.snapshot().draft, retained);
    assert.ok(fault.snapshot().storageError);
    await fault.close();
    checks.push("SQLite draft write failure retains confirmed draft and reports storage error");
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = String(error);
    process.exitCode = 1;
  } finally {
    if (sessions!) await sessions.close().catch(() => {});
    await mkdir(join(root, "docs/evidence/workspace-ui"), {
      recursive: true
    });
    await writeFile(join(root, "docs/evidence/workspace-ui/controlled.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    app.exit(process.exitCode ?? 0);
  }
}
void run().catch(error => {
  console.error(error);
  app.exit(1);
});
