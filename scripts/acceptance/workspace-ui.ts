/** 隔离受控集成入口。使用真实Sessions/Worker/React，仅Provider与桌面桥接为替身。
 * 临时数据库和Git仓库不接触正式userData，不加载凭据，不发起网络请求。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtemp, writeFile, copyFile, mkdir, realpath, unlink } from "node:fs/promises";
import { mkdtempSync, realpathSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    plugins:async()=>({plugins:[]}),
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
    async function executeStage<T>(label: string, script: string): Promise<T> {
      try { return await window.webContents.executeJavaScript(script) as T; }
      catch (error) { throw new Error(`${label}: ${String(error)}`); }
    }
    const captured = new Map<string, string>();
    /** 截图必须等待目标状态真正绘制，并拒绝不同状态复用同一帧缓存。 */
    async function captureState(name: string, visibleExpression: string) {
      const deadline = Date.now() + 5000;
      while (!await window.webContents.executeJavaScript(`Boolean(${visibleExpression})`)) {
        if (Date.now() > deadline) throw new Error(`${name} visual state did not become visible`);
        await new Promise(r => setTimeout(r, 50));
      }
      // DOM `.click()` 不会像真实鼠标一样更新输入模态，关闭弹层后可能把伪键盘焦点环留在触发器上。
      // 键盘可发现性由独立断言覆盖；视觉证据在绘制前清除这类自动化残留焦点。
      await window.webContents.executeJavaScript(`document.activeElement instanceof HTMLElement && document.activeElement.blur()`);
      await window.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
      window.webContents.invalidate();
      await new Promise(r => setTimeout(r, 200));
      const png = (await window.webContents.capturePage()).toPNG();
      const hash = createHash("sha256").update(png).digest("hex");
      for (const [previous, previousHash] of captured)
        assert.notEqual(hash, previousHash, `${name} screenshot duplicated ${previous}`);
      captured.set(name, hash);
      await writeFile(join(root, `docs/evidence/workspace-ui/${name}.png`), png);
    }
    let ui = await inspect();
    assert.equal(ui.replyHeadings, 0);
    assert.ok(ui.details > 0);
    assert.equal(ui.textarea, "重启恢复草稿");
    assert.ok(!ui.body.includes("无已确认修改"));
    checks.push("real renderer plain reply, folded model, restored draft");
    await sessions.command({ type: "list_sessions", page: 0, query: "___visual_no_results___" });
    await new Promise(r => setTimeout(r, 120));
    assert.ok(sessions.snapshot().sessions.length <= 1);
    await mkdir(join(root, "docs/evidence/workspace-ui"), {
      recursive: true
    });
    await captureState("default", `document.querySelector('.chat-workspace.has-messages')`);
    const minimapRestingOpacity = await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.conversation-minimap')).opacity`);
    assert.equal(minimapRestingOpacity, "0");
    await window.webContents.executeJavaScript(`document.querySelector('.minimap-rail')?.focus()`);
    await new Promise(r => setTimeout(r, 160));
    const minimapFocusedOpacity = await window.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.conversation-minimap')).opacity`);
    assert.equal(minimapFocusedOpacity, "1");
    await window.webContents.executeJavaScript(`document.querySelector('.minimap-rail')?.blur()`);
    checks.push("conversation minimap stays hidden at rest and remains keyboard discoverable");
    // 空态必须来自真实的新会话投影；截图后切回原会话，避免后续链路改用视觉替身。
    await sessions.command({ type: "new" });
    await new Promise(r => setTimeout(r, 150));
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.chat-workspace.is-empty')!==null`));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const shell=document.querySelector('.desktop-shell'); const toggle=document.querySelector('.sidebar-toggle')?.getBoundingClientRect(); return { mac:shell.classList.contains('platform-macos'), safe:!!toggle && toggle.left>=76 && toggle.right<=116 }; })()`), { mac: true, safe: true });
    await sessions.command({ type: "list_sessions", page: 0, query: "___visual_no_results___" });
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`({added:document.querySelector('.git-added')?.textContent,removed:document.querySelector('.git-removed')?.textContent})`), { added: "+–", removed: "-–" });
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const rows=[...document.querySelectorAll('.project-list-preview .project-row-main')]; return { count:rows.length, disabled:rows.every(row=>row.disabled), marked:rows.every(row=>row.textContent.includes('Mock')) }; })()`), { count: 5, disabled: true, marked: true });
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const actual=document.querySelector('.workspace-link'); return { actualIcon:actual?.querySelectorAll('.project-folder-icon').length, mockIcons:document.querySelectorAll('.project-list-preview .project-folder-icon').length, unstableGlyph:actual?.textContent.includes('▱') }; })()`), { actualIcon: 1, mockIcons: 5, unstableGlyph: false });
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const menus=[...document.querySelectorAll('.project-row-more')]; const actual=document.querySelector('.sidebar-context > .project-row .project-row-main'); const menu=actual?.parentElement?.querySelector('.project-row-more'); return { count:menus.length, enabled:menus.every(button=>!button.disabled), hidden:menu ? getComputedStyle(menu).visibility : '' }; })()`), { count: 6, enabled: true, hidden: "hidden" });
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar-context > .project-row .project-row-more')?.click()`);
    await new Promise(r => setTimeout(r, 80));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const menu=document.querySelector('#project-actions-menu'); const buttons=[...menu.querySelectorAll('button')]; return { open:menu.matches(':popover-open'), role:menu.getAttribute('role'), labels:buttons.map(button=>button.textContent.trim()), disabled:buttons.every(button=>button.disabled) }; })()`), {
      open: true,
      role: "menu",
      labels: ["项目设置 Mock", "移除项目 Mock"],
      disabled: true
    });
    await captureState("project-actions", `document.querySelector('#project-actions-menu')?.matches(':popover-open')`);
    await window.webContents.executeJavaScript(`document.querySelector('#project-actions-menu')?.hidePopover()`);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(await window.webContents.executeJavaScript(`[...document.querySelectorAll('.task-more')].every(button=>getComputedStyle(button).visibility==='hidden')`), true);
    await window.webContents.executeJavaScript(`document.querySelector('.task-row .task-more')?.click()`);
    await new Promise(r => setTimeout(r, 80));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const menu=document.querySelector('#chat-actions-menu'); const buttons=[...menu.querySelectorAll('button')]; return { open:menu.matches(':popover-open'), role:menu.getAttribute('role'), labels:buttons.map(button=>button.textContent.trim()), disabled:buttons.map(button=>button.disabled) }; })()`), {
      open: true,
      role: "menu",
      labels: ["重命名", "置顶 Mock", "归档 Mock"],
      disabled: [false, true, true]
    });
    await captureState("chat-actions", `document.querySelector('#chat-actions-menu')?.matches(':popover-open')`);
    await window.webContents.executeJavaScript(`document.querySelector('#chat-actions-menu button:not(:disabled)')?.click()`);
    await new Promise(r => setTimeout(r, 80));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.task-rename input[aria-label="聊天名称"]')!==null`), true);
    await window.webContents.executeJavaScript(`document.querySelector('.task-rename button[aria-label="取消重命名"]')?.click()`);
    const emptyMetrics = await window.webContents.executeJavaScript(`(() => {
      const sidebar=document.querySelector('.sidebar').getBoundingClientRect();
      const main=document.querySelector('.workspace-surface').getBoundingClientRect();
      const wrap=document.querySelector('.composer-wrap').getBoundingClientRect();
      const input=document.querySelector('.composer').getBoundingClientRect();
      const color=selector=>getComputedStyle(document.querySelector(selector)).backgroundColor;
      return { sidebarRatio:sidebar.width/innerWidth, composerRatio:wrap.width/main.width, composerTopRatio:wrap.top/innerHeight,
        inputHeight:input.height, canvas:color('.chat-workspace'), composer:color('.composer-wrap'), context:color('.composer-context'),
        border:getComputedStyle(document.querySelector('.composer-wrap')).borderTopColor,
        sidebar:getComputedStyle(document.querySelector('.sidebar')).backgroundImage };
    })()`);
    assert.ok(Math.abs(emptyMetrics.sidebarRatio - 0.2293) <= 0.003, `sidebar ratio drifted: ${emptyMetrics.sidebarRatio}`);
    assert.ok(Math.abs(emptyMetrics.composerRatio - 0.7089) <= 0.002, `composer width ratio drifted: ${emptyMetrics.composerRatio}`);
    assert.ok(Math.abs(emptyMetrics.composerTopRatio - 0.4278) <= 0.003, `composer top ratio drifted: ${emptyMetrics.composerTopRatio}`);
    assert.equal(emptyMetrics.inputHeight, 96);
    assert.deepEqual({ canvas: emptyMetrics.canvas, composer: emptyMetrics.composer, context: emptyMetrics.context }, { canvas: "rgb(17, 17, 17)", composer: "rgb(38, 38, 38)", context: "rgb(24, 24, 24)" });
    assert.equal(emptyMetrics.border, "rgb(59, 61, 68)");
    assert.ok(emptyMetrics.sidebar.includes("rgb(44, 51, 68)") && emptyMetrics.sidebar.includes("rgb(34, 41, 68)"), `dark sidebar gradient drifted: ${emptyMetrics.sidebar}`);
    await captureState("empty", `document.querySelector('.chat-workspace.is-empty')`);
    // 浅色空态与官方基础截图内容同构，避免用有消息页面推断空态颜色和层级。
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
    const lightTokens = await window.webContents.executeJavaScript(`(() => { const style=selector=>getComputedStyle(document.querySelector(selector)); return { canvas:style('.chat-workspace').backgroundColor, composer:style('.composer-wrap').backgroundColor, context:style('.composer-context').backgroundColor, sidebar:style('.sidebar').backgroundImage }; })()`);
    assert.deepEqual({ canvas: lightTokens.canvas, composer: lightTokens.composer, context: lightTokens.context }, { canvas: "rgb(255, 255, 255)", composer: "rgb(245, 245, 245)", context: "rgb(245, 245, 245)" });
    assert.ok(lightTokens.sidebar.includes("rgb(240, 243, 247)") && lightTokens.sidebar.includes("rgb(218, 226, 247)"), `light sidebar gradient drifted: ${lightTokens.sidebar}`);
    await captureState("empty-light", `document.documentElement.dataset.theme==='light' && document.querySelector('.chat-workspace.is-empty')`);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar-toggle')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const shell=document.querySelector('.desktop-shell'); const main=document.querySelector('.workspace-surface')?.getBoundingClientRect(); const controls=getComputedStyle(document.querySelector('.app-controls')); const settings=document.querySelector('.settings-trigger')?.getBoundingClientRect(); return { collapsed:shell.classList.contains('sidebar-collapsed'), sidebarHidden:document.querySelector('.sidebar').hidden, mainFull:!!main && main.left<=1 && main.right>=innerWidth-1 && main.top<=1 && main.bottom>=innerHeight-1, controls:controls.position, compactSettings:!!settings && settings.width===32 && settings.height===32 }; })()`), { collapsed: true, sidebarHidden: true, mainFull: true, controls: "fixed", compactSettings: true });
    await captureState("sidebar-collapsed", `document.querySelector('.desktop-shell.sidebar-collapsed') && document.querySelector('.sidebar')?.hidden`);
    await window.webContents.executeJavaScript(`document.querySelector('.sidebar-toggle')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await sessions.command({ type: "select", sessionId: projectSession });
    await new Promise(r => setTimeout(r, 150));
    await sessions.command({ type: "list_sessions", page: 0, query: "___visual_no_results___" });
    await new Promise(r => setTimeout(r, 100));
    checks.push("real dark, light and collapsed empty-session Codex workspace screenshots and official geometry/color gates captured");
    window.setSize(1000, 680);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';document.querySelector('.composer-expand').click()`);
    await new Promise(r => setTimeout(r, 300));
    await captureState("minimum", `document.querySelector('.composer-expand[aria-expanded="true"]')`);
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
    // 最小窗口是独立验收状态；后续桌面截图恢复标准尺寸和紧凑Composer，不能让临时状态污染其余证据。
    window.setSize(1320, 860);
    await window.webContents.executeJavaScript(`document.querySelector('.composer-expand[aria-expanded="true"]')?.click()`);
    await new Promise(r => setTimeout(r, 250));
    assert.deepEqual(await window.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,expanded:document.querySelector('.composer-expand')?.getAttribute('aria-expanded')})`), { width: 1320, height: 828, expanded: "false" });
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
    await captureState("light", `document.documentElement.dataset.theme==='light'`);
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="打开终端"]')?.click()`);
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await window.webContents.executeJavaScript(`(() => { const main=document.querySelector('.workspace-surface')?.getBoundingClientRect(); const panel=document.querySelector('.developer-panel-terminal')?.getBoundingClientRect(); return !!main && !!panel && panel.top>=main.bottom-1 && Math.abs(panel.left-main.left)<=1 && Math.abs(panel.width-main.width)<=1; })()`), true);
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const header=document.querySelector('.developer-panel-terminal .terminal-panel-header'); return { title:header?.querySelector('.terminal-drawer-title strong')?.textContent, shell:header?.querySelector('.terminal-drawer-title small')?.textContent, tabs:header?.querySelectorAll('nav button').length, controls:header?.querySelectorAll(':scope > div:last-child button').length }; })()`), { title: "Terminal", shell: "本机 Shell", tabs: 0, controls: 1 });
    await captureState("terminal", `document.querySelector('.terminal-panel')`);
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => {
      const empty=document.querySelector('.terminal-empty');
      return { visible:!!empty && !!empty.offsetParent, button:!!empty?.querySelector('button'), overflow:empty ? empty.scrollWidth > empty.clientWidth : true };
    })()`), { visible: true, button: true, overflow: false });
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
    await captureState("terminal-dark", `document.documentElement.dataset.theme==='dark' && document.querySelector('.terminal-empty')`);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
    await executeStage("open change review", `document.querySelector('[aria-label="打开改动审阅"]')?.click()`);
    await waitFor(() => !!sessions.snapshot().changes, "top change-review entry did not load a file snapshot");
    await new Promise(r => setTimeout(r, 100));
    assert.ok(await executeStage("find change panel", `document.querySelector('[aria-label="工作区改动"]')!==null`));
    assert.equal(await executeStage("count changed files", `document.querySelectorAll('.change-file-list .change-file').length`), 4);
    assert.deepEqual(await executeStage("read unknown change statistics", `({added:document.querySelector('.git-added')?.textContent,removed:document.querySelector('.git-removed')?.textContent})`), { added: "+–", removed: "-–" });
    await sessions.command({ type: "workspace_changes", sessionId: projectSession, path: "tracked.txt" });
    await waitFor(() => !!sessions.snapshot().changes?.detail, "selected change-file contract did not load detail");
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await executeStage("measure compact review header", `(() => { const title=document.querySelector('.workspace-header > span')?.getBoundingClientRect(); const commit=document.querySelector('.git-action-mock')?.getBoundingClientRect(); return { titleWide:!!title && title.width>=80, compactCommit:!!commit && commit.width<=31 }; })()`), { titleWide: true, compactCommit: true });
    assert.deepEqual(await executeStage("read review scopes", `(() => { const bar=document.querySelector('.review-scope-bar'); const selected=bar?.querySelector('[aria-current="page"]'); const mocks=Array.from(bar?.querySelectorAll('button') ?? []); return { selected:selected?.textContent, labels:mocks.map(button=>button.textContent), disabled:mocks.every(button=>button.disabled), marked:bar?.querySelector('small')?.textContent, overflow:bar ? bar.scrollWidth > bar.clientWidth : true }; })()`), {
      selected: "全部改动",
      labels: ["Last turn", "未暂存", "已暂存", "main"],
      disabled: true,
      marked: "Mock",
      overflow: false
    });
    assert.equal(await executeStage("read selected change file", `document.querySelector('.change-file-list li.selected .change-file')?.getAttribute('aria-current')`), "true");
    assert.deepEqual(await executeStage("read inline review mock", `(() => { const comment=document.querySelector('.inline-review-comment'); const dismiss=comment?.querySelector('button'); return { visible:!!comment && !!comment.offsetParent, marked:comment?.textContent.includes('Mock'), dismissDisabled:dismiss?.disabled }; })()`), { visible: true, marked: true, dismissDisabled: true });
    assert.equal(sessions.snapshot().changes?.detail.includes("评论预览"), false);
    assert.deepEqual(await executeStage("read change statistics", `({added:document.querySelector('.git-added')?.textContent,removed:document.querySelector('.git-removed')?.textContent})`), { added: "+2", removed: "-2" });
    checks.push("Git header distinguishes unread statistics from real diff line counts");
    checks.push("real change-panel rendering with explicit workspace, Last turn, staged, unstaged and main scopes");
    const opensBefore = terminalOpens;
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="打开终端"]')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="打开改动审阅"]')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(terminalOpens, opensBefore);
    checks.push("terminal screenshot captured and view switching does not request another PTY");
    await captureState("changes", `document.querySelector('[aria-label="工作区改动"]')`);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
    const diffColors = await executeStage("read dark diff semantics", `(() => {
      const style = selector => getComputedStyle(document.querySelector(selector));
      return {
        added: style('.diff-line.added').backgroundColor,
        removed: style('.diff-line.removed').backgroundColor,
        hunk: style('.diff-line.hunk').color,
        meta: style('.diff-line.meta').color,
      };
    })()`);
    assert.notEqual(diffColors.added, diffColors.removed);
    assert.notEqual(diffColors.hunk, diffColors.meta);
    await captureState("changes-dark", `document.documentElement.dataset.theme==='dark' && document.querySelector('.diff-line.added') && document.querySelector('.diff-line.removed') && document.querySelector('.diff-line.hunk')`);
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
    checks.push("dark change review renders distinct added, removed and hunk semantics");
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.terminal-panel-header nav button')].find(b=>b.textContent==='文件')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const panel=document.querySelector('.workspace-files-preview'); const scroll=panel?.querySelector('.workspace-files-scroll'); return { panelOverflow:panel ? getComputedStyle(panel).overflow : '', scrollOverflow:scroll ? getComputedStyle(scroll).overflow : '', expanded:panel?.querySelector('[aria-expanded="true"]')?.textContent.trim(), collapsed:panel?.querySelectorAll('[aria-expanded="false"]').length }; })()`), { panelOverflow: "hidden", scrollOverflow: "auto", expanded: "project", collapsed: 3 });
    await captureState("files", `document.querySelector('.workspace-files-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.terminal-panel-header nav button')].find(b=>b.textContent==='预览')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const panel=document.querySelector('.artifact-preview-mock'); const canvas=panel?.querySelector('.artifact-workspace'); return { current:panel?.querySelector('[aria-current="page"]')?.textContent, panelOverflow:panel ? getComputedStyle(panel).overflow : '', canvasOverflow:canvas ? getComputedStyle(canvas).overflow : '', header:!!panel?.querySelector('header'), footer:!!panel?.querySelector('footer') }; })()`), { current: "1", panelOverflow: "hidden", canvasOverflow: "auto", header: true, footer: true });
    await captureState("preview", `document.querySelector('.artifact-preview-mock')`);
    checks.push("file tree and artifact preview mock screenshots captured");
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="关闭开发者面板"]')?.click()`);
    await new Promise(r => setTimeout(r, 100));
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
      await window.webContents.executeJavaScript(`(() => {
        const expand=document.querySelector('.composer-expand');
        if(expand?.getAttribute('aria-expanded')==='true') expand.click();
        const viewport=document.querySelector('.conversation-scroll');
        if(viewport) viewport.scrollTop=viewport.scrollHeight;
      })()`);
      await new Promise(r => setTimeout(r, 100));
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='展开 参数与执行结果').click()`);
      await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent==='复制完整命令').click()`);
      await new Promise(r => setTimeout(r, 30));
      assert.equal(await window.webContents.executeJavaScript(`window.__fixtureCopied`), "printf fixture && true");
      return pending;
    }
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark'`);
    const approval = await requestApproval();
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const status=document.querySelector('.run-status'); const box=status?.getBoundingClientRect(); const style=status ? getComputedStyle(status) : null; return { inside:!!box && box.right<=innerWidth && box.left>=0, overflow:style?.overflow, ellipsis:style?.textOverflow, fullCommand:document.body.textContent.includes('printf fixture && true') }; })()`), { inside: true, overflow: "hidden", ellipsis: "ellipsis", fullCommand: true });
    await captureState("approval", `document.documentElement.dataset.theme==='dark' && document.querySelector('.interaction-title')?.textContent==='需要你的批准'`);
    checks.push("real approval interaction screenshot captured");
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
    let questionStep = 0;
    globalThis.fetch = async () => {
      if (questionStep++ === 0) {
        return new Response("data: " + JSON.stringify({
          choices: [{
            index: 0,
            delta: { tool_calls: [{
              index: 0,
              id: "fixture-question",
              type: "function",
              function: {
                name: "request_user_input",
                arguments: JSON.stringify({
                  question: "你希望先处理哪个界面？",
                  options: ["工作区", "设置", "插件"]
                })
              }
            }] },
            finish_reason: "tool_calls"
          }],
          usage: { prompt_tokens: 80, completion_tokens: 15 }
        }) + "\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("data: " + JSON.stringify({
        choices: [{ index: 0, delta: { content: "收到，将先处理工作区。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 90, completion_tokens: 12 }
      }) + "\n\ndata: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    };
    await sessions.command({ type: "send", sessionId: projectSession, text: "需要澄清优先级" }, {
      root: project,
      config: { model: "fixture", apiKey: "fixture-only" }
    });
    await waitFor(() => sessions.snapshot().chat.interaction?.kind === "input", "question did not appear");
    await window.webContents.executeJavaScript(`(() => {const viewport=document.querySelector('.conversation-scroll');if(viewport) viewport.scrollTop=viewport.scrollHeight;})()`);
    await new Promise(r => setTimeout(r, 80));
    assert.equal(await window.webContents.executeJavaScript(`(() => { const row=document.querySelector('.goal-progress-mock'); return !!row && [...row.querySelectorAll('button')].length===3 && [...row.querySelectorAll('button')].every(button=>button.disabled); })()`), true);
    // Runtime 尚无 Queue/Steer 协议：仅验证可编辑的未发送草稿及官方确认的队列行位置/操作结构，不能伪造已排队状态。
    await window.webContents.executeJavaScript(`(() => {const input=document.querySelector('textarea[aria-label="消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'当前轮次完成后继续检查最小窗口');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await new Promise(r => setTimeout(r, 80));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const input=document.querySelector('textarea[aria-label="消息"]'); const row=document.querySelector('.followup-draft-preview'); return { editable:!input.disabled, above:!!row && row.getBoundingClientRect().bottom <= document.querySelector('.composer-wrap').getBoundingClientRect().top, label:row?.querySelector('small')?.textContent, actions:Array.from(row?.querySelectorAll('button') ?? []).map(button=>({text:button.textContent,disabled:button.disabled})), mode:document.querySelector('.active-followup-mock button')?.textContent }; })()`), {
      editable: true,
      above: true,
      label: "未发送 · Mock",
      actions: [
        { text: "编辑", disabled: true },
        { text: "↕", disabled: true },
        { text: "发送", disabled: true },
        { text: "×", disabled: true }
      ],
      mode: "排队 ⌄ · Mock"
    });
    await captureState("followup", `document.querySelector('.followup-draft-preview')?.querySelector('small')?.textContent==='未发送 · Mock'`);
    await window.webContents.executeJavaScript(`(() => {const input=document.querySelector('textarea[aria-label="消息"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await new Promise(r => setTimeout(r, 80));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.followup-draft-preview')===null`), true);
    await captureState("question", `document.querySelector('.interaction-title')?.textContent==='需要你的回答'`);
    const question = sessions.snapshot().chat;
    await sessions.command({
      type: "answer",
      sessionId: projectSession,
      runId: question.runId!,
      interactionId: question.interaction!.id,
      answer: "工作区"
    });
    await waitFor(() => sessions.snapshot().chat.state === "completed", "question answer did not complete");
    globalThis.fetch = textProvider;
    checks.push("official queue placement represented as unsent Mock draft without faking runtime delivery");
    checks.push("real input interaction screenshot and answer continuation completed");
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
    globalThis.fetch = async () => new Response("controlled provider failure", { status: 500 });
    await sessions.command({ type: "send", sessionId: projectSession, text: "受控错误恢复场景" }, {
      root: project,
      config: { model: "fixture", apiKey: "fixture-only" }
    });
    await waitFor(() => sessions.snapshot().chat.state === "failed", "controlled error did not fail");
    await window.webContents.executeJavaScript(`(() => {const viewport=document.querySelector('.conversation-scroll');if(viewport) viewport.scrollTop=viewport.scrollHeight;})()`);
    await new Promise(r => setTimeout(r, 80));
    await captureState("error", `document.documentElement.dataset.theme==='dark' && document.body.innerText.includes('DeepSeek 请求失败（HTTP 500）')`);
    globalThis.fetch = textProvider;
    checks.push("real controlled provider error screenshot captured");
    await window.webContents.executeJavaScript(`document.documentElement.dataset.theme='light'`);
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
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="设置"]').click()`);
    await new Promise(r => setTimeout(r, 50));
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('模型设置'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.provider-panel')!==null`));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const key=document.querySelector('input[aria-label="API Key"]'); const api=[...document.querySelectorAll('.provider-detail input')].find(input=>input.value.includes('api.deepseek.com')); return { providers:document.querySelectorAll('.provider-selected').length, keyType:key?.type, keyValue:key?.value, autocomplete:key?.autocomplete, placeholder:key?.placeholder, apiReadOnly:api?.readOnly }; })()`), { providers: 1, keyType: "password", keyValue: "", autocomplete: "off", placeholder: "已保存，留空保持不变", apiReadOnly: true });
    await captureState("settings", `document.querySelector('.provider-panel')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('通用'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("general", `document.querySelector('.general-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('个人资料'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => ({ metrics:[...document.querySelectorAll('.profile-stats small')].map(node=>node.textContent), activity:document.querySelector('.profile-token-activity')?.getAttribute('aria-label'), bars:document.querySelectorAll('.profile-token-chart i').length, unknown:[...document.querySelectorAll('.profile-stats strong')].every(node=>node.textContent==='—') }))()`), {
      metrics: ["累计 Tokens", "峰值 Tokens", "连续使用", "最长任务"],
      activity: "Token 活动 · Mock",
      bars: 24,
      unknown: true
    });
    await captureState("profile", `document.querySelector('.profile-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.includes('键盘快捷键'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("shortcuts", `document.querySelector('.shortcut-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('通知'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("notifications", `document.querySelector('.notification-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('浏览器'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("browser", `document.querySelector('.browser-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.includes('Computer Use'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("computer-use", `document.querySelector('.computer-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('个性化'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("personalization", `document.querySelector('.personalization-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('建议提示'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("suggested-prompts", `document.querySelector('.suggested-prompts-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('记忆'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("memories", `document.querySelector('.memories-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('Pets'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("pets", `document.querySelector('.pets-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('MCP 服务'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("mcp-services", `document.querySelector('.mcp-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('连接'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("connections", `document.querySelector('.connections-settings-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.trim().startsWith('Git'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("git-settings", `document.querySelector('.git-settings-preview')`);
    assert.equal(await window.webContents.executeJavaScript(`(() => {const box=[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.includes('返回工作区'))?.getBoundingClientRect();return !!box && box.top>=0 && box.bottom<=innerHeight;})()`), true);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.sidebar .nav-item')].find(b=>b.textContent.includes('插件'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.plugin-settings')!==null`));
    await captureState("plugins", `document.querySelector('.plugin-directory-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.plugin-page-tabs button')].find(b=>b.textContent.includes('Skills'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("skills", `document.querySelector('.skills-directory-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.plugin-page-tabs button')].find(b=>b.textContent==='本地插件')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.ok(await window.webContents.executeJavaScript(`document.querySelector('.plugin-warning')!==null`));
    await captureState("plugins-local", `document.querySelector('.plugin-warning')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.includes('外观'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const trigger=document.querySelector('.appearance-layout .theme-trigger-labelled'); const choices=[...document.querySelectorAll('#appearance-theme-menu [aria-pressed]')]; return { global:document.querySelectorAll('#theme-menu').length, appearance:document.querySelectorAll('#appearance-theme-menu').length, label:trigger?.querySelector('.theme-current-label')?.textContent, enabled:!trigger?.disabled, choices:choices.length, selected:choices.filter(choice=>choice.getAttribute('aria-pressed')==='true').length }; })()`), {global:1, appearance:1, label:"跟随系统", enabled:true, choices:3, selected:1});
    await captureState("appearance", `document.querySelector('.appearance-preview')`);
    const settingsMinimum = await window.webContents.executeJavaScript(`(() => {
      const current=document.querySelector('.settings-navigation [aria-current="page"]')?.getBoundingClientRect();
      const back=[...document.querySelectorAll('.settings-navigation button')].find(button=>button.textContent.includes('返回工作区'))?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        currentVisible: !!current && current.top >= 0 && current.bottom <= innerHeight,
        backVisible: !!back && back.top >= 0 && back.bottom <= innerHeight,
      };
    })()`);
    assert.deepEqual(settingsMinimum, { overflow: false, currentVisible: true, backVisible: true });
    checks.push("minimum settings navigation keeps current page and back action visible without horizontal overflow");
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.includes('Worktrees'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.handoff-preview')===null`), true);
    await captureState("worktrees", `document.querySelector('.worktree-preview')`);
    await window.webContents.executeJavaScript(`document.querySelector('.handoff-preview-trigger')?.click()`);
    await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(await window.webContents.executeJavaScript(`(() => { const dialog=document.querySelector('.handoff-preview'); const buttons=[...dialog.querySelectorAll('button')]; return { modal:dialog.getAttribute('aria-modal'), cancelEnabled:!buttons[0].disabled, handoffDisabled:buttons[1].disabled }; })()`), { modal: "true", cancelEnabled: true, handoffDisabled: true });
    await captureState("handoff", `document.querySelector('.handoff-preview[aria-modal="true"]')`);
    await window.webContents.executeJavaScript(`document.querySelector('.handoff-preview footer button:not(:disabled)')?.click()`);
    await new Promise(r => setTimeout(r, 80));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.handoff-preview')===null`), true);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.startsWith('环境'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("cloud", `document.querySelector('.cloud-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.includes('返回工作区'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.workspace-primary-nav button')].find(b=>b.textContent.includes('自动化'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    const automationMetrics = await window.webContents.executeJavaScript(`(() => { const stage=document.querySelector('.automation-stage'); const card=document.querySelector('.automation-card'); const box=card?.getBoundingClientRect(); return { outer:getComputedStyle(stage).backgroundColor, backdrop:getComputedStyle(stage,'::before').backgroundColor, card:getComputedStyle(card).backgroundColor, ratio:box ? box.width/box.height : 0, disabled:[...card.querySelectorAll('button')].every(button=>button.disabled), textarea:card.querySelector('textarea')?.disabled }; })()`);
    assert.deepEqual({ outer: automationMetrics.outer, backdrop: automationMetrics.backdrop, card: automationMetrics.card, disabled: automationMetrics.disabled, textarea: automationMetrics.textarea }, { outer: "rgb(0, 0, 0)", backdrop: "rgb(35, 35, 35)", card: "rgb(36, 36, 36)", disabled: true, textarea: true });
    assert.ok(Math.abs(automationMetrics.ratio - 2.2) <= 0.05, `automation card ratio drifted: ${automationMetrics.ratio}`);
    await captureState("automations", `document.querySelector('.automation-preview')`);
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.workspace-primary-nav button')].find(b=>b.textContent.includes('搜索'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await window.webContents.executeJavaScript(`(() => {const input=document.querySelector('input[aria-label="搜索聊天"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'唯一搜索词');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await new Promise(r => setTimeout(r, 450));
    await captureState("search", `document.querySelector('.search-page') && document.querySelector('input[aria-label="搜索聊天"]')?.value==='唯一搜索词'`);
    await window.webContents.executeJavaScript(`document.querySelector('[aria-label="设置"]')?.click()`);
    await new Promise(r => setTimeout(r, 50));
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('模型设置'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await window.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-navigation button')].find(b=>b.textContent.includes('已归档聊天'))?.click()`);
    await new Promise(r => setTimeout(r, 100));
    await captureState("archived", `document.querySelector('.archived-preview')`);
    checks.push("general, profile, keyboard shortcuts, notifications, browser, computer use, personalization, suggested prompts, memories, pets, MCP, connections, git, model, plugin, appearance, worktree, automations, search and archived pages screenshots captured");
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
    if (window?.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    if (sessions!) await sessions.close().catch(() => {});
    await mkdir(join(root, "docs/evidence/workspace-ui"), {
      recursive: true
    });
    await writeFile(join(root, "docs/evidence/workspace-ui/controlled.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    // 原生Popover可能让隐藏的受控窗口继续留在AppKit事件循环；验收必须显式释放窗口资源。
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(process.exitCode ?? 0);
  }
}
void run().catch(error => {
  console.error(error);
  app.exit(1);
});
