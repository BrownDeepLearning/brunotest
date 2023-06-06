import * as vscode from "vscode";
import { getHighlighter } from "shiki";
import { dirname, join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";

export class ChaffEditorProvider implements vscode.CustomTextEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    //* NOTE: Must match the name exposed in package.json *//
    public static readonly viewType = "brunotest-preview.chaff";
    public static readonly regionStartString = "### Region: ";
    public static readonly regionEndString = "### EndRegion";

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
        let selectedDocument: string | undefined = undefined;

        // Open the document in the default text editor
        const srcDir = vscode.Uri.joinPath(this.context.extensionUri, "src");
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [srcDir],
        };

        vscode.window.showTextDocument(document, vscode.ViewColumn.One);

        const updateWebview = () => {
            this.getHTMLForWebview(
                document,
                webviewPanel.webview,
                selectedDocument
            ).then((html) => {
                webviewPanel.webview.html = html;
                console.log(webviewPanel.webview.html);
            });
        };

        // Create and show the webview panel
        updateWebview();
        webviewPanel.reveal(vscode.ViewColumn.Two);

        const subscriptions: vscode.Disposable[] = [];

        subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(async (e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    updateWebview();
                }
            })
        );

        subscriptions.push(
            vscode.workspace.onDidCloseTextDocument(async (e) => {})
        );

        subscriptions.push(vscode.workspace.onDidCreateFiles(async (e) => {}));

        subscriptions.push(vscode.workspace.onDidDeleteFiles(async (e) => {}));

        subscriptions.push(vscode.workspace.onDidRenameFiles(async (e) => {}));

        webviewPanel.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "selectedFileChange":
                    console.log("selectedFileChange");
                    selectedDocument = message.selectedDocument;
                    updateWebview();
            }
        });

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            subscriptions.forEach((subscription) => subscription.dispose());
        });
    }

    private async getHTMLForWebview(
        chaffDocument: vscode.TextDocument,
        webview: vscode.Webview,
        selectedDocument?: string
    ): Promise<string> {
        const isDarkMode =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        const highlightTheme = isDarkMode ? "github-dark" : "github-light";

        const codeDirectory = join(dirname(chaffDocument.uri.fsPath), "code");
        if (!existsSync(codeDirectory)) {
            return this.wrapHTMLBoilerplate(
                webview,
                "<h1>No <code>code</code> directory found!</h1>"
            );
        }

        const dropdownOptions = readdirSync(codeDirectory).map(
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
            </select>
        </div>`;
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
        </script>
        `;

        if (!selectedDocument) {
            return this.wrapHTMLBoilerplate(
                webview,
                `${fileDropdown}\n${dropdownEventListener}`
            );
        }

        const selectedFileContents = readFileSync(
            join(codeDirectory, selectedDocument),
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
            ${await getHighlighter({ theme: highlightTheme })
                .then((highligher) =>
                    highligher.codeToHtml(modifiedFileContents, {
                        lang: "python",
                    })
                )
                .catch((err) => console.error(err))}
            ${fileDropdown}
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
