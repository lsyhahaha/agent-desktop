import { app, safeStorage } from "electron";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SaveSettings } from "@protocol";
import { z } from "zod";
const Saved = z
  .object({
    model: z.string().min(1).max(100),
    encryptedKey: z.string().max(10000),
  })
  .strict();
export class Settings {
  private value = { model: "deepseek-flash", encryptedKey: "" };
  private saving = false;
  /** 仅可信本机评估入口可指定读取目录；凭据仍只在Main解密，不传给renderer。 */
  constructor(private readonly directory = app.getPath("userData")) {}
  private get path() {
    return join(this.directory, "deepseek-settings.json");
  }
  async load() {
    try {
      const bytes = await readFile(this.path);
      if (bytes.length > 20000) throw new Error("配置文件过大");
      this.value = Saved.parse(JSON.parse(bytes.toString()));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("模型配置损坏，请检查应用数据目录");
    }
  }
  view() {
    return { model: this.value.model, hasKey: !!this.value.encryptedKey };
  }
  async save(raw: unknown) {
    if (this.saving) throw new Error("配置正在保存");
    this.saving = true;
    try {
      const input = SaveSettings.parse(raw);
      let encryptedKey = this.value.encryptedKey;
      if (input.apiKey) {
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error("系统凭据加密不可用");
        if (
          process.platform === "linux" &&
          safeStorage.getSelectedStorageBackend() === "basic_text"
        )
          throw new Error("系统未提供安全凭据存储");
        encryptedKey = (
          await safeStorage.encryptStringAsync(input.apiKey)
        ).toString("base64");
      }
      if (!encryptedKey) throw new Error("请输入 API Key");
      const next = { model: input.model, encryptedKey };
      await mkdir(app.getPath("userData"), { recursive: true });
      await writeFile(this.path + ".tmp", JSON.stringify(next), {
        mode: 0o600,
      });
      await rename(this.path + ".tmp", this.path);
      this.value = next;
      return this.view();
    } finally {
      this.saving = false;
    }
  }
  async credentials() {
    if (!this.value.encryptedKey) throw new Error("请先配置 DeepSeek API Key");
    const key = await safeStorage.decryptStringAsync(
      Buffer.from(this.value.encryptedKey, "base64"),
    );
    return { model: this.value.model, apiKey: key.result };
  }
}
