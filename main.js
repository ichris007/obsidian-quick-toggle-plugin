const { Plugin, PluginSettingTab, Setting, SuggestModal, Notice } = require('obsidian');

class PluginToggleSuggestModal extends SuggestModal {
  constructor(app, items) {
    super(app);
    this.items = items;
  }
  getSuggestions(query) {
    return this.items.filter(it =>
      it.display.toLowerCase().includes(query.toLowerCase()));
  }
  renderSuggestion(item, el) { el.setText(item.display); }
  onChooseSuggestion(item) { this.resolve(item.id); }
  openAsync() { return new Promise(res => { this.resolve = res; this.open(); }); }
}

module.exports = class QuickTogglePlugin extends Plugin {
  async onload() {
    this.settings = Object.assign(
      { pluginIds: [] }, // 默认空列表
      await this.loadData()
    );

    this.addCommand({
      id: 'quick-toggle-plugin',
      name: 'Quick Toggle Community Plugins',
      callback: () => this.openMenu()
    });

    this.addSettingTab(new QuickToggleSettingTab(this.app, this));
  }

  async saveSettings() { await this.saveData(this.settings); }

  async openMenu() {
    const ids = this.settings.pluginIds;
    if (!ids || ids.length === 0) {
      new Notice('⚠️ 尚未在设置中选择要切换的插件');
      return;
    }

    const cfgPath = '.obsidian/community-plugins.json';
    const enabledList = JSON.parse(await this.app.vault.adapter.read(cfgPath));

    const items = ids.map(id => {
      const manifest = this.app.plugins.manifests[id];
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

/* 设置页 */
class QuickToggleSettingTab extends PluginSettingTab {
  constructor(app, plugin) { 
    super(app, plugin); 
    this.plugin = plugin; 
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const allPluginIds = Object.keys(this.app.plugins.manifests);
    const totalPlugins = allPluginIds.length;
    const selectedCount = this.plugin.settings.pluginIds.length;

    // 异步读取 community-plugins.json 获取启用列表
    this.app.vault.adapter.read('.obsidian/community-plugins.json').then(enabledListRaw => {
      const enabledList = JSON.parse(enabledListRaw);
      const disabledCount = totalPlugins - enabledList.length;

      containerEl.createEl('div', {
        text: `插件安装总数: ${totalPlugins} | 禁用插件数量: ${disabledCount} | 加入快捷开关列表的插件数量: ${selectedCount}`,
        cls: 'setting-item-description',
        attr: { style: 'margin-bottom: 1em; font-weight: bold;' }
      });

      containerEl.createEl('h2', { text: '快速开关社区插件设置（点选加入快速开关列表）' });

      const allManifests = Object.entries(this.app.plugins.manifests)
        .filter(([id]) => id !== this.plugin.manifest.id) // 排除自身插件
        .sort((a, b) => a[1].name.localeCompare(b[1].name)); // 按名字排序

      allManifests.forEach(([id, manifest]) => {
        new Setting(containerEl)
          .setName(manifest.name || id)
          .addToggle(toggle => {
            toggle
              .setValue(this.plugin.settings.pluginIds.includes(id))
              .onChange(async val => {
                const ids = this.plugin.settings.pluginIds;
                if (val && !ids.includes(id)) ids.push(id);
                if (!val) this.plugin.settings.pluginIds = ids.filter(pid => pid !== id);
                await this.plugin.saveSettings();
                // 更新统计信息后重新渲染
                this.display();
              });
          });
      });
    });
  }
}
