import type { DesktopBridge } from "@protocol";
declare global {
  interface Window {
    desktop: DesktopBridge;
  }
}
export {};
