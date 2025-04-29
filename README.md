# markdown-export-link-renamer

An Obsidian plugin to automatically rename link names when exporting Markdown files.

ObsidianのMarkdownエクスポート時にリンク名を自動でリネームするプラグインです。

## Overview / 概要
This plugin provides a feature to automatically rename link names during Markdown export in Obsidian.

ObsidianでMarkdownをエクスポートする際に、リンク名を自動でリネームする機能を提供します。

## Usage (English)
1. Extract the `markdown-export-link-renamer` folder and place it into your Obsidian plugins directory.
2. Enable the plugin from Obsidian's settings.
3. If necessary, you can set the export directory from the plugin settings. By default, an `export` folder will be created in the root directory.
4. Select the text you want to process, then right-click and choose "Export Markdown and linked files" from the context menu.
5. A modal will appear with the message "Rename image files?" and two buttons:
    - **Rename**: Image file names will be renamed automatically during export.
    - **Keep original**: Image files will be exported with their original names.
6. You can also add styles to control line breaks for external editors and image sizes when renaming. Please turn on the checkboxes as needed.

## 使い方（日本語）
1. `markdown-export-link-renamer`フォルダを取り出し、Obsidianのプラグインディレクトリに配置します。
2. Obsidianの設定からプラグインを有効化します。
3. 必要に応じて、プラグインの設定からエクスポート先ディレクトリを指定できます。デフォルトではルートディレクトリに`export`フォルダが作成されます。
4. エクスポートしたいテキストを選択し、右クリックメニューから「Export Markdown and linked files」を選択します。
5. モーダルが表示され、「Rename image files?」と表示されます。2つのボタンがあります。：
    - **Rename**：画像ファイル名が自動でリネームされてエクスポートされます。
    - **Keep original**：画像ファイル名は元のままエクスポートされます。
6. リネーム時に外部エディタ用の改行や画像サイズ制御のスタイルも追加できます。必要に応じて各チェックボックスをONにしてください。

### For Developers (English)
- TypeScript source code is in the `src/` directory.
- Run `npm install` to install dependencies.
- Run `npm run build` to generate `main.js`.

### 開発者向け（日本語）
- TypeScriptのソースコードは`src/`ディレクトリにあります。
- 依存パッケージのインストールには`npm install`を実行してください。
- `main.js`を生成するには`npm run build`を実行してください。

## License
MIT
