import { App, Plugin, Notice, Modal, Setting, TFile } from 'obsidian';
import { PluginSettingTab } from "obsidian";

/**
 * 画像リネーム確認用モーダル
 */
class RenameConfirmModal extends Modal {
  private onSubmit: (rename: boolean) => void;
  constructor(app: App, onSubmit: (rename: boolean) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: "Rename image files?" });
    new Setting(contentEl)
      .addButton(btn =>
        btn.setButtonText("Rename")
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(true);
          })
      )
      .addButton(btn =>
        btn.setButtonText("Keep original")
          .onClick(() => {
            this.close();
            this.onSubmit(false);
          })
      );
  }
  onClose() {
    this.contentEl.empty();
  }
}

const DEFAULT_SETTINGS = {
  exportDir: "export"
};

class MdExportPlugin extends Plugin {
  settings!: { exportDir: string };

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MdExporterSettingTab(this.app, this));
    this.addCommand({
      id: 'md-exporter-export-selected',
      name: 'Export selected note',
      callback: () => this.exportSelectedNote()
    });
    // ファイルメニュー（右クリック）に直接追加するイベントリスナー
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          menu.addItem((item) => {
            item
              .setTitle('Export md and linked files')
              .setIcon('paper-plane')
              .onClick(() => {
                this.exportSelectedNote(file);
              });
          });
        }
      })
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async exportSelectedNote(file?: TFile) {
    const activeFile = file ?? this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice('Please open the note to export!');
      return;
    }
    // 設定値からvault直下のパスを生成
    const vaultBase = (this.app.vault.adapter as any).basePath;
    const path = (window as any).require ? (window as any).require('path') : null;
    let exportDir = path ? path.join(vaultBase, this.settings.exportDir) : this.settings.exportDir;
    // ファイル名と同じディレクトリを追加
    if (path) {
      const baseName = activeFile.basename;
      exportDir = path.join(exportDir, baseName);
    }
    // 画像リネームモーダルだけ出す
    new RenameConfirmModal(this.app, async (doRename) => {
      const mdContent = await this.app.vault.read(activeFile);
      const mdLinks = this.extractLinks(mdContent);
      await this.exportWithLinks(activeFile, mdContent, mdLinks, exportDir, doRename, new Set());
    }).open();
  }

  extractLinks(mdContent: string): { images: string[]; mdFiles: string[] } {
    // Obsidian型: ![[...]]
    const imageLinks = Array.from(mdContent.matchAll(/!\[\[(.+?)\]\]/g)).map(match => match[1]);
    // Markdown標準: ![alt](path)
    const mdImgLinks = Array.from(mdContent.matchAll(/!\[[^\]]*\]\(([^\)]+)\)/g)).map(match => match[1]);
    // URLデコード対応
    function safeDecode(s: string): string {
      try { return decodeURIComponent(s); } catch { return s; }
    }
    const decodedImages = Array.from(new Set([
      ...imageLinks,
      ...mdImgLinks.map(safeDecode)
    ]));
    const mdLinks = Array.from(mdContent.matchAll(/\[\[(.+?)\]\]/g)).map(match => match[1]).filter(link => !link.endsWith('.png') && !link.endsWith('.jpg'));
    return { images: decodedImages, mdFiles: mdLinks };
  }

  async exportWithLinks(activeFile: TFile, mdContent: string, mdLinks: { images: string[]; mdFiles: string[] }, exportDir: string, doRename: boolean, exportedSet: Set<string>) {
    try {
      const fs = (window as any).require ? (window as any).require('fs') : null;
      const path = (window as any).require ? (window as any).require('path') : null;
      const Buffer = (window as any).require ? (window as any).require('buffer').Buffer : null;
      if (!fs || !path || !Buffer) {
        new Notice('Export failed: fs, path, or Buffer module not available.');
        return;
      }
      // 既にエクスポート済みならスキップ（循環参照防止）
      if (exportedSet.has(activeFile.path)) {
        return;
      }
      exportedSet.add(activeFile.path);

      // ディレクトリ作成
      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }
      // mdファイル出力
      const outMdPath = path.join(exportDir, activeFile.basename + '.md');
      fs.writeFileSync(outMdPath, mdContent, 'utf-8');

      // linked-images出力
      const linkedImagesDir = path.join(exportDir, 'linked-images');
      if (!fs.existsSync(linkedImagesDir)) {
        fs.mkdirSync(linkedImagesDir, { recursive: true });
      }
      const imageNameMap: { [orig: string]: string } = {};
      mdLinks.images.forEach((origImg, idx) => {
        if (doRename) {
          // image01, image02... + 拡張子
          const ext = path.extname(origImg) || '.png';
          const num = String(idx + 1).padStart(2, '0');
          imageNameMap[origImg] = `image${num}${ext}`;
        } else {
          imageNameMap[origImg] = origImg;
        }
      });
      for (const origImg of mdLinks.images) {
        let imgFile: TFile | null = null;
        let candidatePath = '';
        // 画像リンクがパス付き（/や../含む）なら、そのままVault直下から参照
        if (origImg.includes('/') || origImg.startsWith('.')) {
          candidatePath = path.normalize(origImg);
          imgFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
        }
        // ファイル名だけの場合は、ノートのディレクトリから上の階層を順にたどる
        if (!imgFile && !origImg.includes('/')) {
          const notePathParts = activeFile.path.split('/');
          notePathParts.pop(); // ノート自身を除外
          while (notePathParts.length > 0) {
            candidatePath = [...notePathParts, origImg].join('/');
            imgFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
            if (imgFile) break;
            notePathParts.pop();
          }
        }
        // attachments等のよくあるディレクトリで探す
        if (!imgFile) {
          for (const dir of ['attachments', 'Assets', 'asset', 'images', 'image']) {
            candidatePath = `${dir}/${origImg}`;
            imgFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
            if (imgFile) break;
          }
        }
        // Vault全体で検索（最初に見つかったもの）
        if (!imgFile) {
          const files = this.app.vault.getFiles();
          imgFile = files.find(f => f.name === origImg) || null;
        }
        if (imgFile instanceof TFile) {
          try {
            new Notice(`Copying image file: ${imgFile.path} → linked-images/${imageNameMap[origImg]}`);
            const data = await this.app.vault.readBinary(imgFile);
            if (data) {
              const outPath = path.join(linkedImagesDir, imageNameMap[origImg]);
              fs.writeFileSync(outPath, Buffer.from(data));
              // 画像リンクを新しいパスに書き換え
              // Obsidian型
              mdContent = mdContent.split(`![[${origImg}]]`).join(`![[linked-images/${imageNameMap[origImg]}]]`);
              // Markdown標準型
              mdContent = mdContent.replace(new RegExp(`!\\[[^\\]]*\\]\\(${origImg.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\)`, 'g'), `![](/linked-images/${imageNameMap[origImg]})`);
            } else {
              new Notice(`Image export failed: ${imgFile.path} is empty.`);
            }
          } catch (e: any) {
            new Notice(`Image export failed: ${e?.message || e}`);
          }
        } else {
          new Notice(`Image file not found: ${origImg}`);
        }
      }

      // mdリンクを再帰的にエクスポート
      for (const mdLink of mdLinks.mdFiles) {
        let linkMdFile: TFile | null = null;
        let candidatePath = '';
        // まず相対パスで探す
        candidatePath = mdLink + '.md';
        linkMdFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
        // attachments等のよくあるディレクトリで探す
        if (!linkMdFile) {
          for (const dir of ['attachments', 'Assets', 'asset', 'images', 'image']) {
            candidatePath = `${dir}/${mdLink}.md`;
            linkMdFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
            if (linkMdFile) break;
          }
        }
        // Vault全体でbasename一致で探す
        if (!linkMdFile) {
          const files = this.app.vault.getFiles();
          for (const file of files) {
            if (file.basename === mdLink) {
              linkMdFile = file;
              break;
            }
          }
        }
        if (linkMdFile instanceof TFile) {
          new Notice(`Exporting linked note: ${mdLink}.md`);
          const linkMdContent = await this.app.vault.read(linkMdFile);
          const linkMdLinks = this.extractLinks(linkMdContent);
          // サブディレクトリを作成
          const subDir = path.join(exportDir, mdLink);
          // 再帰的にエクスポート
          await this.exportWithLinks(linkMdFile, linkMdContent, linkMdLinks, subDir, doRename, exportedSet);
        } else {
          new Notice(`Linked note not found: ${mdLink}.md`);
        }
      }
      new Notice('Export completed!');
    } catch (e: any) {
      new Notice('Export failed: ' + (e?.message || e));
    }
  }
}

class MdExporterSettingTab extends PluginSettingTab {
  plugin: MdExportPlugin;
  constructor(app: App, plugin: MdExportPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Markdown Export Link Renamer Settings" });
    new Setting(containerEl)
      .setName("Export directory")
      .setDesc("Specify a relative path from the vault root (e.g., export)")
      .addText(text => text
        .setPlaceholder("export")
        .setValue(this.plugin.settings.exportDir)
        .onChange(async (value) => {
          this.plugin.settings.exportDir = value;
          await this.plugin.saveSettings();
        })
      );
  }
}

export default MdExportPlugin;
