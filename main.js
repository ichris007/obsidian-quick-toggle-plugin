// == main.js ==

const { Plugin, PluginSettingTab, Setting, SuggestModal, Notice } = require('obsidian');

class PluginToggleSuggestModal extends SuggestModal {
  constructor(app, items) {
    super(app);
    this.items = items;
    this.resolve = null;
    this.numberMap = new Map();
  }

  getSuggestions(query) {
    return this.items.filter(it =>
      it.display.toLowerCase().includes(query.toLowerCase()));
  }

  renderSuggestion(item, el) {
    const index = this.items.indexOf(item);
    const label = index < 9 ? `【${index + 1}】` : (index === 9 ? `【0】` : `   `);
    el.setText(`${label} ${item.display}`);
    this.numberMap.set((index + 1).toString(), item.id);
    if (index === 9) this.numberMap.set('0', item.id);
  }

  onChooseSuggestion(item) {
    this.resolve(item.id);
  }

  openAsync() {
    return new Promise(res => {
      this.resolve = res;
      this.open();
    });
  }

  onOpen() {
    super.onOpen();
    for (let i = 0; i <= 9; i++) {
      const key = i.toString();
      this.scope.register([], key, () => this.selectByNumber(key));
    }
  }

  selectByNumber(key) {
    const id = this.numberMap.get(key);
    if (id) {
      this.close();
      this.resolve(id);
    }
  }
}

module.exports = class QuickTogglePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({ pluginIds: [] }, await this.loadData());

    this.addCommand({
      id: 'quick-toggle-plugin',
      name: 'Quick Toggle Community Plugins',
      callback: () => this.openMenu()
    });

    this.addSettingTab(new QuickToggleSettingTab(this.app, this));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async openMenu() {
    let ids = this.settings.pluginIds;
    if (!ids || ids.length === 0) {
      new Notice('⚠️ 尚未在设置中选择要切换的插件');
      return;
    }

    // 🔍 修复：过滤掉已经删除或无效的插件 ID
    const manifests = this.app.plugins.manifests;
    ids = ids.filter(id => manifests[id]);
    if (ids.length === 0) {
      new Notice('⚠️ 所有已选插件均不存在或已被删除');
      this.settings.pluginIds = []; // 清理脏数据
      await this.saveSettings();
      return;
    }

    const cfgPath = '.obsidian/community-plugins.json';
    const enabledList = JSON.parse(await this.app.vault.adapter.read(cfgPath));

    const items = ids.map(id => {
      const manifest = manifests[id];
      const enabled = enabledList.includes(id);
      const name = manifest?.name || id;
      return { id, display: `${enabled ? '✅' : '⛔'} ${name} (${id})` };
    });

    const modal = new PluginToggleSuggestModal(this.app, items);
    const chosenId = await modal.openAsync();
    if (chosenId) await this.togglePlugin(chosenId);
  }

  async togglePlugin(pluginId) {
    const cfgPath = '.obsidian/community-plugins.json';
    let enabledList = JSON.parse(await this.app.vault.adapter.read(cfgPath));
    const isEnabled = enabledList.includes(pluginId);
    const name = this.app.plugins.manifests[pluginId]?.name || pluginId;

    try {
      if (isEnabled) {
        await this.app.plugins.disablePlugin(pluginId);
        enabledList = enabledList.filter(p => p !== pluginId);
        new Notice(`🔴 已禁用插件：${name}`);
      } else {
        await this.app.plugins.enablePlugin(pluginId);
        enabledList.push(pluginId);
        new Notice(`💡 已启用插件：${name}`);
      }
      await this.app.vault.adapter.write(cfgPath, JSON.stringify(enabledList, null, 2));
    } catch (err) {
      new Notice('⚠️ 切换失败: ' + err.message);
    }
  }
};

class QuickToggleSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.filterQuery = '';
    this.sortByList = null;
    this.sortByStatus = null;
  }

  async display() {
    const { containerEl } = this;
    containerEl.empty();

    this.statContainer = containerEl.createDiv();
    this.searchInput = containerEl.createEl('input', {
      type: 'text',
      placeholder: '🔍 搜索插件名称',
    });

    this.searchInput.style.cssText = `
      margin: 1em 0;
      width: 100%;
      padding: 6px 10px;
      border: 1px solid var(--interactive-accent);
      border-radius: 6px;
      font-size: 14px;
      outline: none;
    `;

    this.searchInput.addEventListener('input', () => {
      this.filterQuery = this.searchInput.value.trim().toLowerCase();
      this.renderPluginList();
    });

    containerEl.createEl('h2', {
      text: '快速开关社区插件设置',
      attr: { style: 'margin-bottom: 0.2em; color: var(--interactive-accent);' }
    });
    containerEl.createEl('ul', {
      attr: { style: 'margin-bottom: 1em; padding-left: 1.2em; color: var(--text-muted); font-size: 0.9em;' }
    }).innerHTML = `
      <li>在“加入列表”列点选将插件加入快速开关列表；</li>
      <li>“插件状态”为插件当前状态，点击可“启用/禁用”插件；</li>
      <li>点击“加入列表”和“插件状态”可快速分类插件。</li>
    `;

    this.listContainer = containerEl.createDiv();

    await this.refreshData();
    this.updateStats();
    this.renderPluginList();
  }

  async refreshData() {
    const enabledListRaw = await this.app.vault.adapter.read('.obsidian/community-plugins.json');
    this.enabledList = JSON.parse(enabledListRaw);
  }

  updateStats() {
    const allPluginIds = Object.keys(this.app.plugins.manifests);
    const totalPlugins = allPluginIds.length;
    const selectedCount = this.plugin.settings.pluginIds.filter(id => allPluginIds.includes(id)).length;
    const disabledCount = allPluginIds.filter(id => !this.enabledList.includes(id)).length;

    this.statContainer.empty();
    this.statContainer.createEl('div', {
      text: `插件安装总数: ${totalPlugins} | 禁用插件数量: ${disabledCount} | 加入快捷开关列表的插件数量: ${selectedCount}`,
      cls: 'setting-item-description',
      attr: { style: 'margin-bottom: 1em; font-weight: bold; color: var(--text-muted);' }
    });
  }

  renderPluginList() {
    this.listContainer.empty();

    const header = this.listContainer.createDiv();
    header.style.cssText = `
      display: flex; justify-content: space-between;
      font-weight: bold; padding: 6px 12px;
      border-bottom: 2px solid var(--background-modifier-border);
    `;

    const getArrow = (sortState) => sortState === null ? '' : (sortState ? ' ▲' : ' ▼');

    const nameHeader = header.createDiv({ text: '插件名称', attr: { style: 'flex:3;' } });
    const toggleHeader = header.createDiv({ text: '加入列表' + getArrow(this.sortByList), attr: { style: 'flex:1;text-align:center;cursor:pointer;' } });
    const statusHeader = header.createDiv({ text: '插件状态' + getArrow(this.sortByStatus), attr: { style: 'flex:1;text-align:center;cursor:pointer;' } });

    toggleHeader.onclick = () => {
      this.sortByList = this.sortByList === null ? true : !this.sortByList;
      this.sortByStatus = null;
      this.renderPluginList();
    };
    statusHeader.onclick = () => {
      this.sortByStatus = this.sortByStatus === null ? true : !this.sortByStatus;
      this.sortByList = null;
      this.renderPluginList();
    };

    let all = Object.entries(this.app.plugins.manifests)
      .filter(([id]) => id !== this.plugin.manifest.id)
      .filter(([id, manifest]) => (manifest.name || id).toLowerCase().includes(this.filterQuery));

    if (this.sortByList !== null) {
      all.sort(([idA], [idB]) => {
        const inListA = this.plugin.settings.pluginIds.includes(idA);
        const inListB = this.plugin.settings.pluginIds.includes(idB);
        return this.sortByList ? inListA - inListB : inListB - inListA;
      });
    } else if (this.sortByStatus !== null) {
      all.sort(([idA], [idB]) => {
        const enA = this.enabledList.includes(idA);
        const enB = this.enabledList.includes(idB);
        return this.sortByStatus ? enA - enB : enB - enA;
      });
    } else {
      all.sort(([, a], [, b]) => a.name.localeCompare(b.name));
    }

    all.forEach(([id, manifest]) => {
      const row = this.listContainer.createDiv({ cls: 'plugin-row' });
      row.style.cssText = `
        display: flex; align-items: center;
        padding: 6px 12px;
        border-bottom: 1px solid var(--background-modifier-border);
        transition: background 0.2s ease;
      `;
      row.onmouseover = () => row.style.background = 'var(--background-modifier-hover)';
      row.onmouseout = () => row.style.background = '';

      row.createDiv({ text: `${manifest.name} (${manifest.version})`, attr: { style: 'flex:3;' } });

      const toggleDiv = row.createDiv({ attr: { style: 'flex:1; text-align:center;' } });
      new Setting(toggleDiv)
        .addToggle(tg => {
          tg.setValue(this.plugin.settings.pluginIds.includes(id))
            .onChange(async val => {
              const list = this.plugin.settings.pluginIds;
              if (val && !list.includes(id)) list.push(id);
              else if (!val) this.plugin.settings.pluginIds = list.filter(x => x !== id);
              await this.plugin.saveSettings();
              this.updateStats();
            });
        }).settingEl.querySelector('.setting-item-name')?.remove();

      const statusDiv = row.createDiv({ attr: { style: 'flex:1; text-align:center;' } });
      const iconBtn = statusDiv.createEl('button', {
        text: this.enabledList.includes(id) ? '✅' : '⛔',
        attr: {
          style: `
            cursor: pointer;
            padding: 2px 6px;
            font-size: 14px;
            border: 1px solid var(--interactive-accent);
            background: var(--background-modifier-form);
            border-radius: 5px;
          `
        }
      });

      iconBtn.onclick = async () => {
        await this.plugin.togglePlugin(id);
        await this.refreshData();
        iconBtn.setText(this.enabledList.includes(id) ? '✅' : '⛔');
        this.updateStats();
      };
    });
  }
}
