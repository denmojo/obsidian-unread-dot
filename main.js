'use strict';

const obsidian = require('obsidian');

const UNREAD_CLASS = 'unread-dot-mark';
const MODIFIED_CLASS = 'unread-dot-modified';

const DEFAULT_SETTINGS = {
  ignoredExtensions: '',
  ignoredPathPrefixes: '',
};

class UnreadDotPlugin extends obsidian.Plugin {
  async onload() {
    const data = (await this.loadData()) || {};
    this.unread = new Set(Array.isArray(data.unread) ? data.unread : []);
    this.modified = new Set(Array.isArray(data.modified) ? data.modified : []);
    this.initialized = data.initialized === true;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    this.layoutReady = false;
    this.recomputeIgnoreRules();

    this.registerEvent(this.app.vault.on('create', (file) => {
      if (!this.layoutReady) return;
      if (!(file instanceof obsidian.TFile)) return;
      if (this.isIgnored(file.path, file.extension)) return;
      this.unread.add(file.path);
      this.persist();
      this.scheduleRefresh();
    }));

    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (!this.layoutReady) return;
      if (!(file instanceof obsidian.TFile)) return;
      if (this.isIgnored(file.path, file.extension)) return;
      if (this.unread.has(file.path)) return;
      if (this.isFileOpen(file.path)) return;
      if (this.modified.has(file.path)) return;
      this.modified.add(file.path);
      this.persist();
      this.scheduleRefresh();
    }));

    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!file) return;
      let changed = false;
      if (this.unread.has(file.path)) { this.unread.delete(file.path); changed = true; }
      if (this.modified.has(file.path)) { this.modified.delete(file.path); changed = true; }
      if (changed) {
        this.persist();
        this.scheduleRefresh();
      }
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      let changed = false;
      if (this.unread.has(oldPath)) {
        this.unread.delete(oldPath);
        if (!this.isIgnored(file.path, file.extension)) this.unread.add(file.path);
        changed = true;
      }
      if (this.modified.has(oldPath)) {
        this.modified.delete(oldPath);
        if (!this.isIgnored(file.path, file.extension)) this.modified.add(file.path);
        changed = true;
      }
      if (changed) {
        this.persist();
        this.scheduleRefresh();
      }
    }));

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof obsidian.TFile)) return;
      if (this.isIgnored(file.path, file.extension)) return;
      const isMarked = this.unread.has(file.path) || this.modified.has(file.path);
      menu.addItem((item) => {
        item
          .setTitle(isMarked ? 'Mark as read' : 'Mark as unread')
          .setIcon(isMarked ? 'check-circle' : 'circle')
          .onClick(async () => {
            if (isMarked) {
              this.unread.delete(file.path);
              this.modified.delete(file.path);
            } else {
              this.unread.add(file.path);
            }
            await this.persist();
            this.scheduleRefresh();
          });
      });
    }));

    this.registerEvent(this.app.vault.on('delete', (file) => {
      let changed = false;
      if (this.unread.has(file.path)) { this.unread.delete(file.path); changed = true; }
      if (this.modified.has(file.path)) { this.modified.delete(file.path); changed = true; }
      if (changed) this.persist();
    }));

    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      if (!this.initialized) {
        this.initialized = true;
        this.persist();
      }
      this.attachObservers();
      this.scheduleRefresh();
    });

    this.addCommand({
      id: 'mark-all-read',
      name: 'Mark all notes as read',
      callback: async () => {
        this.unread.clear();
        this.modified.clear();
        await this.persist();
        this.scheduleRefresh();
        new obsidian.Notice('Unread Dot: cleared all unread and modified marks');
      },
    });

    this.addCommand({
      id: 'mark-current-unread',
      name: 'Mark current note as unread',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file) return false;
        if (this.isIgnored(file.path, file.extension)) return false;
        if (checking) return true;
        this.unread.add(file.path);
        this.modified.delete(file.path);
        this.persist();
        this.scheduleRefresh();
      },
    });

    this.addSettingTab(new UnreadDotSettingTab(this.app, this));
  }

  onunload() {
    if (this.observers) {
      for (const o of this.observers) o.disconnect();
      this.observers = null;
    }
    if (this.clickBindings) {
      for (const { container, handler } of this.clickBindings) {
        container.removeEventListener('click', handler, true);
      }
      this.clickBindings = null;
    }
    document.querySelectorAll('.' + UNREAD_CLASS).forEach((el) => el.classList.remove(UNREAD_CLASS));
    document.querySelectorAll('.' + MODIFIED_CLASS).forEach((el) => el.classList.remove(MODIFIED_CLASS));
  }

  isFileOpen(path) {
    let found = false;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const v = leaf.view;
      if (v && v.file && v.file.path === path) found = true;
    });
    return found;
  }

  attachObservers() {
    this.observers = [];
    this.clickBindings = [];
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    for (const leaf of leaves) {
      const container = leaf.view && leaf.view.containerEl;
      if (!container) continue;
      const obs = new MutationObserver(() => this.scheduleRefresh());
      obs.observe(container, { childList: true, subtree: true });
      this.observers.push(obs);

      const handler = (e) => {
        const titleEl = e.target.closest('.nav-file-title');
        if (!titleEl || !container.contains(titleEl)) return;
        const path = titleEl.getAttribute('data-path');
        if (!path) return;
        let changed = false;
        if (this.unread.has(path)) { this.unread.delete(path); changed = true; }
        if (this.modified.has(path)) { this.modified.delete(path); changed = true; }
        if (changed) {
          this.persist();
          this.scheduleRefresh();
        }
      };
      container.addEventListener('click', handler, true);
      this.clickBindings.push({ container, handler });
    }
  }

  scheduleRefresh() {
    if (this.refreshPending) return;
    this.refreshPending = true;
    window.requestAnimationFrame(() => {
      this.refreshPending = false;
      this.refreshExplorer();
    });
  }

  refreshExplorer() {
    const leaves = this.app.workspace.getLeavesOfType('file-explorer');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (!view || !view.fileItems) continue;
      for (const path in view.fileItems) {
        const item = view.fileItems[path];
        const el = item.selfEl || item.titleEl;
        if (!el) continue;
        const wantUnread = this.unread.has(path);
        const wantModified = !wantUnread && this.modified.has(path);
        const hasUnread = el.classList.contains(UNREAD_CLASS);
        const hasModified = el.classList.contains(MODIFIED_CLASS);
        if (wantUnread !== hasUnread) el.classList.toggle(UNREAD_CLASS, wantUnread);
        if (wantModified !== hasModified) el.classList.toggle(MODIFIED_CLASS, wantModified);
      }
    }
  }

  recomputeIgnoreRules() {
    this.ignoredExtSet = new Set(
      this.settings.ignoredExtensions
        .split(',')
        .map((s) => s.trim().replace(/^\./, '').toLowerCase())
        .filter(Boolean)
    );
    this.ignoredPathList = this.settings.ignoredPathPrefixes
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => obsidian.normalizePath(s));
  }

  isIgnored(path, extension) {
    const ext = (extension || '').toLowerCase();
    if (ext && this.ignoredExtSet.has(ext)) return true;
    for (const prefix of this.ignoredPathList) {
      if (path === prefix || path.startsWith(prefix + '/')) return true;
    }
    return false;
  }

  pruneIgnoredFromUnread() {
    let changed = false;
    for (const set of [this.unread, this.modified]) {
      for (const path of Array.from(set)) {
        const file = this.app.vault.getAbstractFileByPath(path);
        const ext = file && file.extension ? file.extension : path.split('.').pop();
        if (this.isIgnored(path, ext)) {
          set.delete(path);
          changed = true;
        }
      }
    }
    if (changed) this.persist();
    this.scheduleRefresh();
  }

  async persist() {
    await this.saveData({
      unread: Array.from(this.unread),
      modified: Array.from(this.modified),
      initialized: this.initialized,
      settings: this.settings,
    });
  }
}

class UnreadDotSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName('Ignored extensions')
      .setDesc('Comma-separated, no leading dot. Files with these extensions will not be marked unread or modified. Example: png, jpg, pdf, opus')
      .addText((text) =>
        text
          .setPlaceholder('png, jpg, pdf')
          .setValue(this.plugin.settings.ignoredExtensions)
          .onChange(async (value) => {
            this.plugin.settings.ignoredExtensions = value;
            this.plugin.recomputeIgnoreRules();
            await this.plugin.persist();
            this.plugin.pruneIgnoredFromUnread();
          })
      );

    new obsidian.Setting(containerEl)
      .setName('Ignored path prefixes')
      .setDesc('One path per line. Files whose path starts with any of these will not be marked. Example: Attachments/ or Archive/')
      .addTextArea((ta) => {
        ta.setPlaceholder('Attachments/\nArchive/')
          .setValue(this.plugin.settings.ignoredPathPrefixes)
          .onChange(async (value) => {
            this.plugin.settings.ignoredPathPrefixes = value;
            this.plugin.recomputeIgnoreRules();
            await this.plugin.persist();
            this.plugin.pruneIgnoredFromUnread();
          });
        ta.inputEl.rows = 6;
        ta.inputEl.style.width = '100%';
      });

    new obsidian.Setting(containerEl)
      .setName('Clear all marks')
      .setDesc('Remove every unread and modified dot in the vault.')
      .addButton((btn) =>
        btn.setButtonText('Mark all read').onClick(async () => {
          this.plugin.unread.clear();
          this.plugin.modified.clear();
          await this.plugin.persist();
          this.plugin.scheduleRefresh();
          new obsidian.Notice('Unread Dot: cleared all unread and modified marks');
        })
      );
  }
}

module.exports = UnreadDotPlugin;
