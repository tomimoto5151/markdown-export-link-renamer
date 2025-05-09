import { App, Plugin, Notice, Modal, Setting, TFile } from 'obsidian';
import { PluginSettingTab } from "obsidian";

/**
 * 画像リネーム確認用モーダル
 */
class RenameConfirmModal extends Modal {
  private onSubmit: (rename: boolean, insertStyle: boolean, insertLineBreaks: boolean) => void;
  constructor(app: App, onSubmit: (rename: boolean, insertStyle: boolean, insertLineBreaks: boolean) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: "Rename image files?" });
    let insertStyle = false;
    let insertLineBreaks = false;
    // スタイル用チェックボックス
    const styleSetting = new Setting(contentEl)
      .setName('Insert compatibility style for images');
    const checkbox = contentEl.createEl('input', { type: 'checkbox' });
    checkbox.checked = false;
    checkbox.style.marginRight = '8px';
    styleSetting.settingEl.prepend(checkbox);
    checkbox.onchange = () => {
      insertStyle = checkbox.checked;
    };
    // 改行用チェックボックス
    const lbSetting = new Setting(contentEl)
      .setName('Insert compatibility line breaks for images');
    const lbCheckbox = contentEl.createEl('input', { type: 'checkbox' });
    lbCheckbox.checked = false;
    lbCheckbox.style.marginRight = '8px';
    lbSetting.settingEl.prepend(lbCheckbox);
    lbCheckbox.onchange = () => {
      insertLineBreaks = lbCheckbox.checked;
    };
    new Setting(contentEl)
      .addButton(btn =>
        btn.setButtonText("Rename")
          .setCta()
          .onClick(() => {
            this.close();
            this.onSubmit(true, insertStyle, insertLineBreaks);
          })
      )
      .addButton(btn =>
        btn.setButtonText("Keep original")
          .onClick(() => {
            this.close();
            this.onSubmit(false, insertStyle, insertLineBreaks);
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
              .setTitle('Export Markdown and linked files')
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
    new RenameConfirmModal(this.app, async (doRename, insertStyle, insertLineBreaks) => {
      const mdContent = await this.app.vault.read(activeFile);
      const mdLinks = this.extractLinks(mdContent);
      await this.exportWithLinks(activeFile, mdContent, mdLinks, exportDir, doRename, insertStyle, insertLineBreaks, new Set());
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

  async exportWithLinks(activeFile: TFile, mdContent: string, mdLinks: { images: string[]; mdFiles: string[] }, exportDir: string, doRename: boolean, insertStyle: boolean, insertLineBreaks: boolean, exportedSet: Set<string>) {
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

      // 画像名マッピング（rename有効時はリネーム名、無効時は元名）
      const imageNameMap: Record<string, string> = {};
      mdLinks.images.forEach((origImg, idx) => {
        let ext = origImg.match(/\.[^.]+$/)?.[0] || '';
        if (doRename) {
          const num = String(idx + 1).padStart(2, '0');
          imageNameMap[origImg] = `image${num}${ext}`;
        } else {
          imageNameMap[origImg] = origImg;
        }
      });

      // 画像出力先ディレクトリ
      const imagesFolderName = "images"; // ←linked-imagesにしたい場合はここを変更
      const imagesDir = path.join(exportDir, imagesFolderName);
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      // 画像コピー＆リンク書き換え
      for (const origImg of mdLinks.images) {
        let imgFile: TFile | null = null;
        let candidatePath = '';
        // 画像リンクがパス付き（/や../含む）なら、そのままVault直下から参照
        if (origImg.includes('/') || origImg.startsWith('.')) {
          candidatePath = path.normalize(origImg);
          imgFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
        } else {
          // よくあるディレクトリで探す
          for (const dir of ['', 'attachments', 'Assets', 'asset', 'images', 'image']) {
            candidatePath = dir ? `${dir}/${origImg}` : origImg;
            imgFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
            if (imgFile) break;
          }
        }
        // Vault全体でbasename一致で探す
        if (!imgFile) {
          const files = this.app.vault.getFiles();
          imgFile = files.find(f => f.name === origImg) || null;
        }
        if (imgFile instanceof TFile) {
          try {
            new Notice(`Copying image file: ${imgFile.path} → ${imagesFolderName}/${imageNameMap[origImg]}`);
            const data = await this.app.vault.readBinary(imgFile);
            if (data) {
              const outPath = path.join(imagesDir, imageNameMap[origImg]);
              fs.writeFileSync(outPath, Buffer.from(data));
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

      // 画像リンク書き換え（rename後のファイル名でMarkdown標準型に統一）
      for (const origImg of mdLinks.images) {
        const renamed = imageNameMap[origImg];
        // Obsidian型 → Markdown標準型へ変換
        mdContent = mdContent.split(`![[${origImg}]]`).join(`![](./${imagesFolderName}/${renamed})`);
        // Markdown標準型も同じく統一
        mdContent = mdContent.replace(
          new RegExp(`!\\[[^\\]]*\\]\\(${origImg.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}\\)`, 'g'),
          `![](./${imagesFolderName}/${renamed})`
        );
      }

      // --- YAML frontmatter検出＆各行末スペース2つ付与（---行は除外） ---
      let yamlFront = '';
      let restContent = mdContent;
      if (mdContent.startsWith('---')) {
        const endIdx = mdContent.indexOf('\n---', 3);
        if (endIdx !== -1) {
          yamlFront = mdContent.slice(0, endIdx + 4);
          restContent = mdContent.slice(endIdx + 4);
          // --- で囲まれた部分を取得し、1行目と閉じ---以外にスペース2つ付与
          const yamlLines = yamlFront.split('\n');
          yamlFront = yamlLines.map((line, idx) => {
            // 最初と最後（---）はそのまま
            if (idx === 0 || idx === yamlLines.length - 1) return line;
            // すでにスペース2つ以上ならそのまま
            if (/\s{2,}$/.test(line)) return line.replace(/\s+$/, '  ');
            // 1つだけスペースのときは2つに揃える
            if (/\s$/.test(line)) return line.replace(/\s+$/, '  ');
            // 末尾スペースがない場合は2つ追加
            return line + '  ';
          }).join('\n');
        }
      }
      // --- styleタグをYAML frontmatterの直後（空行なし）に挿入。styleタグ末尾にスペース2つ付与 ---
      let afterYaml = '';
      if (yamlFront) {
        if (insertStyle) {
          afterYaml = '<style>img { max-width:900px; max-height:400px; }</style>  '; // 空行は絶対に入れない
        } else {
          afterYaml = '';
        }
      } else {
        if (insertStyle) {
          afterYaml = '<style>img { max-width:900px; max-height:400px; }</style>  ';
        } else {
          afterYaml = '';
        }
      }
      // --- 本文側にも行末スペース2つ付与 ---
      if (insertLineBreaks) {
        restContent = restContent
          .split('\n')
          .map(line => {
            if (
              line.trim() === '' ||
              line.trim().startsWith('```') ||
              line.trim().startsWith('|') ||
              /^\s*[-*+] /.test(line) ||
              /^\s*\d+\. /.test(line)
            ) {
              return line;
            }
            // すでにスペース2つ以上ならそのまま
            if (/\s{2,}$/.test(line)) return line.replace(/\s+$/, '  ');
            // 1つだけスペースのときは2つに揃える
            if (/\s$/.test(line)) return line.replace(/\s+$/, '  ');
            // 末尾スペースがない場合は2つ追加
            return line + '  ';
          })
          .join('\n');
      }
      // --- 組み立て ---
      if (yamlFront) {
        if (afterYaml) {
          mdContent = yamlFront + '\n' + afterYaml + '\n' + restContent.replace(/^\n+/, '');
        } else {
          mdContent = yamlFront + '\n' + restContent.replace(/^\n+/, '');
        }
      } else {
        if (afterYaml) {
          mdContent = afterYaml + '\n' + restContent.replace(/^\n+/, '');
        } else {
          mdContent = restContent.replace(/^\n+/, '');
        }
      }
      // --- ここまで ---
      // mdファイル出力（画像リンク書き換え後）
      fs.writeFileSync(outMdPath, mdContent, 'utf-8');

      // mdリンクを再帰的にエクスポート
      for (const mdLink of mdLinks.mdFiles) {
        let linkMdFile: TFile | null = null;
        let candidatePath = '';
        // まず相対パスで探す
        candidatePath = mdLink + '.md';
        linkMdFile = this.app.vault.getAbstractFileByPath(candidatePath) as TFile;
        // attachments等のよくあるディレクトリで探す
        if (!linkMdFile) {
          for (const dir of ['', 'attachments', 'Assets', 'asset', 'images', 'image']) {
            candidatePath = dir ? `${dir}/${mdLink}.md` : `${mdLink}.md`;
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
          await this.exportWithLinks(linkMdFile, linkMdContent, linkMdLinks, subDir, doRename, insertStyle, insertLineBreaks, exportedSet);
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
