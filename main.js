'use strict';

const obsidian = require('obsidian');

const MARK_CLASS = 'unread-dot-mark';

const DEFAULT_SETTINGS = {
  ignoredExtensions: '',
  ignoredPathPrefixes: '',
};

class UnreadDotPlugin extends obsidian.Plugin {
  async onload() {
    const data = (await this.loadData()) || {};
    this.unread = new Set(Array.isArray(data.unread) ? data.unread : []);
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

    this.registerEvent(this.app.workspace.on('file-open', (file) => {
      if (!file) return;
      if (this.unread.has(file.path)) {
        this.unread.delete(file.path);
        this.persist();
        this.scheduleRefresh();
      }
    }));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.unread.has(oldPath)) {
        this.unread.delete(oldPath);
        if (!this.isIgnored(file.path, file.extension)) {
          this.unread.add(file.path);
        }
        this.persist();
        this.scheduleRefresh();
      }
    }));

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof obsidian.TFile)) return;
      if (this.isIgnored(file.path, file.extension)) return;
      const isUnread = this.unread.has(file.path);
      menu.addItem((item) => {
        item
          .setTitle(isUnread ? 'Mark as read' : 'Mark as unread')
          .setIcon(isUnread ? 'check-circle' : 'circle')
          .onClick(async () => {
            if (isUnread) this.unread.delete(file.path);
            else this.unread.add(file.path);
            await this.persist();
            this.scheduleRefresh();
          });
      });
    }));

    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (this.unread.has(file.path)) {
        this.unread.delete(file.path);
        this.persist();
      }
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
        await this.persist();
        this.scheduleRefresh();
        new obsidian.Notice('Unread Dot: cleared all unread marks');
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
    document.querySelectorAll('.' + MARK_CLASS).forEach((el) => {
      el.classList.remove(MARK_CLASS);
    });
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
        if (path && this.unread.has(path)) {
          this.unread.delete(path);
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
        const shouldMark = this.unread.has(path);
        const hasMark = el.classList.contains(MARK_CLASS);
        if (shouldMark && !hasMark) el.classList.add(MARK_CLASS);
        else if (!shouldMark && hasMark) el.classList.remove(MARK_CLASS);
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
    for (const path of Array.from(this.unread)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      const ext = file && file.extension ? file.extension : path.split('.').pop();
      if (this.isIgnored(path, ext)) {
        this.unread.delete(path);
        changed = true;
      }
    }
    if (changed) this.persist();
    this.scheduleRefresh();
  }

  async persist() {
    await this.saveData({
      unread: Array.from(this.unread),
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
      .setDesc('Comma-separated, no leading dot. Files with these extensions will not be marked unread. Example: png, jpg, pdf, opus')
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
      .setName('Clear all unread marks')
      .setDesc('Remove every blue dot in the vault.')
      .addButton((btn) =>
        btn.setButtonText('Mark all read').onClick(async () => {
          this.plugin.unread.clear();
          await this.plugin.persist();
          this.plugin.scheduleRefresh();
          new obsidian.Notice('Unread Dot: cleared all unread marks');
        })
      );
  }
}

module.exports = UnreadDotPlugin;
