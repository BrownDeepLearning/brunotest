import * as vscode from "vscode";
import { getHighlighter } from "shiki";
import { dirname, join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";

export class ChaffEditorProvider implements vscode.CustomTextEditorProvider {
    constructor(private readonly context: vscode.ExtensionContext) {}

    //* NOTE: Must match the name exposed in package.json *//
    public static readonly viewType = "brunotest-preview.chaff";
    public static readonly REGION_START_STRING = "### Region: ";
    public static readonly REGION_END_STRING = "### EndRegion";

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
        // Open the document in the default text editor
        const srcDir = vscode.Uri.joinPath(this.context.extensionUri, "src");
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [srcDir],
        };

        vscode.window.showTextDocument(document, vscode.ViewColumn.One);

        // Create and show the webview panel
        this.getHTMLForWebview(document, webviewPanel.webview).then(
            (html) => (webviewPanel.webview.html = html)
        );
        webviewPanel.reveal(vscode.ViewColumn.Two);

        let selectedDocument: string | undefined = undefined;

        const changeDocumentSubscription =
            vscode.workspace.onDidChangeTextDocument(async (e) => {
                if (e.document.uri.toString() === document.uri.toString()) {
                    this.getHTMLForWebview(
                        document,
                        webviewPanel.webview,
                        selectedDocument
                    ).then((html) => (webviewPanel.webview.html = html));
                }
            });

        webviewPanel.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "fileChange":
                    selectedDocument = message.selectedDocument;
                    this.getHTMLForWebview(
                        document,
                        webviewPanel.webview,
                        selectedDocument
                    ).then((html) => (webviewPanel.webview.html = html));
            }
        });

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
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
        <select id="file-dropdown">
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
                    command: "fileChange",
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
            ChaffEditorProvider.REGION_START_STRING,
            searchStart
        );

        if (regionStartIndex === -1) {
            return null;
        }

        const regionEndIndex = template.indexOf(
            ChaffEditorProvider.REGION_END_STRING,
            regionStartIndex
        );

        const regionName = template
            .slice(
                regionStartIndex +
                    ChaffEditorProvider.REGION_START_STRING.length,
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
                regionEndIndex + ChaffEditorProvider.REGION_END_STRING.length
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
                    regionEndIndex +
                    ChaffEditorProvider.REGION_END_STRING.length;
                continue;
            }

            const replacement = replacements
                .get(regionName)
                ?.replaceAll("\n", "\n" + indentation);

            templateContents =
                templateContents.slice(0, regionStartIndex) +
                replacement +
                templateContents.slice(
                    regionEndIndex +
                        ChaffEditorProvider.REGION_END_STRING.length
                );

            searchStart =
                regionEndIndex + ChaffEditorProvider.REGION_END_STRING.length;
        }
    }
}
