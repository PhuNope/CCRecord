'use strict';

/**
 * Transport adapter: injects the Inspector integration into the Editor main
 * window only. No changes to app.asar or Cocos modules on disk.
 *
 * The host owns the window lifecycle; the Inspector owns DOM lifecycle.
 */
class WindowHookHost {
  constructor({browserWindow, readScript, log = console, intervalMs = 1400, schedule = setInterval, cancel = clearInterval}) {
    this.browserWindow = browserWindow;
    this.readScript = readScript;
    this.log = log;
    this.intervalMs = intervalMs;
    this.schedule = schedule;
    this.cancel = cancel;
    this.entries = new Map();
    this.enabled = false;
    this.timer = null;
    this.script = '';
  }

  start() {
    this.script = this.readScript();
    this.enabled = true;
    this.scan();
    if (!this.timer) this.timer = this.schedule(() => this.scan(), this.intervalMs);
  }

  scan(force = false) {
    if (!this.enabled) return;
    for (const window of this.browserWindow.getAllWindows()) {
      const wc = window && window.webContents;
      if (!wc || wc.isDestroyed() || this.entries.has(wc.id)) continue;
      const entry = {wc, installed:false, injecting:false, skip:false};
      entry.onLoad = () => {
        entry.installed = false;
        entry.skip = false;
        void this.inject(entry);
      };
      entry.onDestroyed = () => {
        this.entries.delete(wc.id);
      };
      wc.on('did-finish-load', entry.onLoad);
      wc.on('destroyed', entry.onDestroyed);
      this.entries.set(wc.id, entry);
      void this.inject(entry);
    }
    for (const entry of this.entries.values()) {
      if (force) entry.skip = false;
      void this.inject(entry, force);
    }
  }

  async inject(entry, force = false) {
    const wc = entry.wc;
    if (!this.enabled || entry.injecting || wc.isDestroyed() || wc.isLoading()) return;
    if (!force && (entry.installed || entry.skip)) return;
    entry.injecting = true;
    try {
      const result = await wc.executeJavaScript(this.script, true);
      if (result?.status === 'not-main') entry.skip = true;
      else if (result?.status === 'running') entry.installed = true;
      else this.log.warn('[CCRecord] Inspector renderer not ready', result);
    } catch (error) {
      this.log.warn('[CCRecord] Inspector injection failed:', String(error));
    } finally {
      entry.injecting = false;
    }
  }

  async stop({unload = false} = {}) {
    this.enabled = false;
    if (this.timer) this.cancel(this.timer);
    this.timer = null;
    await Promise.all([...this.entries.values()].map(async ({wc,installed}) => {
      if (!installed || wc.isDestroyed()) return;
      try { await wc.executeJavaScript('window.__CCRECORD_INSPECTOR_HOOK__?.stop?.()', true); }
      catch (error) { this.log.warn('[CCRecord] Uninstall in renderer failed', String(error)); }
    }));
    for (const entry of this.entries.values()) {
      entry.installed = false;
      if (unload && !entry.wc.isDestroyed()) {
        entry.wc.removeListener('did-finish-load',entry.onLoad);
        entry.wc.removeListener('destroyed',entry.onDestroyed);
      }
    }
    if (unload) this.entries.clear();
  }

  async reload() {
    await this.stop();
    this.start();
  }

  async diagnose() {
    const reports = [];
    for (const {wc} of this.entries.values()) {
      if (wc.isDestroyed()) continue;
      try {
        const stats = await wc.executeJavaScript(`(() => ({
          isMain: document.body?.getAttribute('name') === 'main',
          inspector: window.__CCRECORD_INSPECTOR_HOOK__?.stats?.() ?? null
        }))()`, true);
        reports.push({webContentsId:wc.id, ...stats});
      } catch (error) { reports.push({webContentsId:wc.id,error:String(error)}); }
    }
    return reports;
  }
}
module.exports = {WindowHookHost};
