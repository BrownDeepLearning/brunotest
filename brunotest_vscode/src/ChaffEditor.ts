import * as vscode from "vscode";
import { getHighlighter } from "shiki";
import { basename, dirname, join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";
import { readdir } from "fs/promises";

export class ChaffEditorProvider implements vscode.CustomTextEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    //* NOTE: Must match the name exposed in package.json *//
    public static readonly viewType = "brunotest-preview.chaff";

    public static readonly regionStartString = "### Region: ";

    public static readonly regionEndString = "### EndRegion";

    public static readonly templateDirectory = "code";

    public static readonly syntaxHighlightDarkTheme = "github-dark";

    public static readonly syntaxHighlightLightTheme = "github-light";

    public static register(
        context: vscode.ExtensionContext
    ): vscode.Disposable {
        const provider = new ChaffEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            ChaffEditorProvider.viewType,
            provider
        );
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const subscriptions: vscode.Disposable[] = [];
        const templateDirectory = join(
            dirname(document.uri.fsPath),
            ChaffEditorProvider.templateDirectory
        );
        let selectedDocument: string | undefined = undefined;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "src"),
            ],
        };

        const updateWebview = () => {
            this.getHTMLForWebview(
                document,
                webviewPanel.webview,
                templateDirectory,
                selectedDocument
            ).then((html) => {
                webviewPanel.webview.html = html;
            });
        };

        // Open the document in the default text editor
        vscode.window.showTextDocument(document, vscode.ViewColumn.One);

        // Create and show the webview panel
        webviewPanel.reveal(vscode.ViewColumn.Two);
        updateWebview();

        const inTemplateDirectory = (documentFsPath: vscode.Uri) => {
            return (
                dirname(documentFsPath.with({ scheme: "file" }).fsPath) ===
                templateDirectory
            );
        };

        const isThisChaffDocument = (documentURI: vscode.Uri) => {
            return documentURI.toString() === document.uri.toString();
        };

        subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(async (e) => {
                if (isThisChaffDocument(e.document.uri)) {
                    updateWebview();
                }
            })
        );

        vscode.workspace.onDidSaveTextDocument(async (savedDocument) => {
            if (inTemplateDirectory(savedDocument.uri)) {
                updateWebview();
            }
        });

        subscriptions.push(
            vscode.workspace.onDidCreateFiles(async (e) => {
                if (e.files.some((uri) => inTemplateDirectory(uri))) {
                    // TODO: Check if nested directories is supported
                    updateWebview();
                }
            })
        );

        subscriptions.push(
            vscode.workspace.onDidDeleteFiles(async (e) => {
                if (e.files.some((uri) => inTemplateDirectory(uri))) {
                    // TODO: Handle the case where you delete the file you are currently viewing
                    updateWebview();
                }
            })
        );

        subscriptions.push(
            vscode.workspace.onDidRenameFiles(async (e) => {
                if (e.files.some(({ newUri }) => inTemplateDirectory(newUri))) {
                    // TODO: Update the selected document name
                    updateWebview();
                }
            })
        );

        webviewPanel.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "selectedFileChange":
                    selectedDocument = message.selectedDocument;
                    updateWebview();
            }
        });

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            subscriptions.forEach((subscription) => subscription.dispose());
        });
    }

    private walk(dirName: string): string[] {
        const files = [];
        const items = readdirSync(dirName, { withFileTypes: true });

        for (const item of items) {
            if (item.isDirectory()) {
                files.push(...this.walk(`${dirName}/${item.name}`));
            } else {
                files.push(`${dirName}/${item.name}`);
            }
        }

        return files;
    }

    private async getHTMLForWebview(
        chaffDocument: vscode.TextDocument,
        webview: vscode.Webview,
        templateDirectory: string,
        selectedDocument?: string
    ): Promise<string> {
        const isDarkMode =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        const highlightTheme = isDarkMode
            ? ChaffEditorProvider.syntaxHighlightDarkTheme
            : ChaffEditorProvider.syntaxHighlightLightTheme;

        if (!existsSync(templateDirectory)) {
            return this.wrapHTMLBoilerplate(
                webview,
                "<h1>No <code>code</code> directory found!</h1>"
            );
        }

        const dropdownOptions = this.walk(templateDirectory)
            .map((file) => file.replace(`${templateDirectory}/`, ""))
            .map(
                (file) =>
                    `<option ${
                        selectedDocument === file ? "selected" : ""
                    }>${file}</option>`
            );

        const fileDropdown = `
            <select id="file-dropdown" class="monaco-select-box monaco-select-box-dropdown-padding">
                <option disabled ${
                    selectedDocument ? "" : "selected"
                }>Choose File!</option>
                ${dropdownOptions.join("\n")}
            </select>`;

        const dropdownEventListener = `
        <script>
            const vscode = acquireVsCodeApi();
            const dropdown = document.getElementById("file-dropdown");

            dropdown.addEventListener("change", () => {
                vscode.postMessage({
                    command: "selectedFileChange",
                    selectedDocument: dropdown.value
                });
            });
        </script>`;

        if (!selectedDocument) {
            return this.wrapHTMLBoilerplate(
                webview,
                `${fileDropdown}\n${dropdownEventListener}`
            );
        }

        const selectedFileContents = readFileSync(
            join(templateDirectory, selectedDocument),
            "utf-8"
        );

        const replacements = this.parseChaffFile(chaffDocument.getText());

        const modifiedFileContents = this.compileTemplateFile(
            selectedFileContents,
            replacements
        );

        return this.wrapHTMLBoilerplate(
            webview,
            `
            ${fileDropdown}
            ${await getHighlighter({ theme: highlightTheme })
                .then((highligher) =>
                    highligher.codeToHtml(modifiedFileContents, {
                        lang: "python",
                    })
                )
                .catch((err) => console.error(err))}
            ${dropdownEventListener}
            `
        );
    }

    private wrapHTMLBoilerplate(webview: vscode.Webview, html: string) {
        const webviewCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "webview.css")
        );

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">

            <link rel="stylesheet" href="https://unpkg.com/monaco-editor@latest/min/vs/editor/editor.main.css">
            <link rel="stylesheet" href="${webviewCssUri}" />
            <title>Brunotest Preview</title>
        </head>
        <body>
        ${html}
        </body>
        </html>
        `;
    }

    private findRegion(
        template: string,
        searchStart: number = 0
    ): [number, number, string] | null {
        const regionStartIndex = template.indexOf(
            ChaffEditorProvider.regionStartString,
            searchStart
        );

        if (regionStartIndex === -1) {
            return null;
        }

        const regionEndIndex = template.indexOf(
            ChaffEditorProvider.regionEndString,
            regionStartIndex
        );

        const regionName = template
            .slice(
                regionStartIndex + ChaffEditorProvider.regionStartString.length,
                template.indexOf("\n", regionStartIndex)
            )
            .trim();

        return [regionStartIndex, regionEndIndex, regionName];
    }

    private parseChaffFile(fileContents: string) {
        const replacements = new Map();

        while (true) {
            const region = this.findRegion(fileContents);
            if (!region) {
                return replacements;
            }

            const [regionStartIndex, regionEndIndex, regionName] = region;
            const nextLineIdx =
                fileContents.indexOf("\n", regionStartIndex) + 1;

            replacements.set(
                regionName,
                fileContents.slice(nextLineIdx, regionEndIndex).trim()
            );

            fileContents = fileContents.slice(
                regionEndIndex + ChaffEditorProvider.regionEndString.length
            );
        }
    }

    private compileTemplateFile(
        templateContents: string,
        replacements: Map<string, string>
    ) {
        let searchStart = 0;
        while (true) {
            const region = this.findRegion(templateContents, searchStart);

            if (!region) {
                return templateContents;
            }

            const [regionStartIndex, regionEndIndex, regionName] = region;
            const lastNewlineIdx = templateContents.lastIndexOf(
                "\n",
                regionStartIndex
            );
            const indentation = templateContents.slice(
                lastNewlineIdx + 1,
                regionStartIndex
            );

            if (!replacements.has(regionName)) {
                searchStart =
                    regionEndIndex + ChaffEditorProvider.regionEndString.length;
                continue;
            }

            const replacement = replacements
                .get(regionName)
                ?.replaceAll("\n", "\n" + indentation);

            templateContents =
                templateContents.slice(0, regionStartIndex) +
                replacement +
                templateContents.slice(
                    regionEndIndex + ChaffEditorProvider.regionEndString.length
                );

            searchStart =
                regionEndIndex + ChaffEditorProvider.regionEndString.length;
        }
    }
}
