import * as vscode from "vscode";
import { getHighlighter } from "shiki";
import { dirname, join } from "path";
import { existsSync, readFileSync, readdirSync } from "fs";

export class StencilChaffEditorProvider
    implements vscode.CustomTextEditorProvider
{
    constructor(private readonly context: vscode.ExtensionContext) {}

    //* NOTE: Must match the name exposed in package.json *//
    public static readonly viewType = "brunotest-preview.stencilchaff";

    public static register(
        context: vscode.ExtensionContext
    ): vscode.Disposable {
        const provider = new StencilChaffEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            StencilChaffEditorProvider.viewType,
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
                // this event is fired when the webview changes as well, so this prevents an infinite loop
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
        document: vscode.TextDocument,
        webview: vscode.Webview,
        selectedDocument?: string
    ): Promise<string> {
        const isDarkMode =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        const highlightTheme = isDarkMode ? "github-dark" : "github-light";

        const codeDirectory = join(dirname(document.uri.fsPath), "code");

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

        const x = this.wrapHTMLBoilerplate(
            webview,
            `
            ${fileDropdown}
            ${await getHighlighter({ theme: highlightTheme })
                .then((highligher) =>
                    highligher.codeToHtml(selectedFileContents, {
                        lang: "python",
                    })
                )
                .catch((err) => console.error(err))}
            ${dropdownEventListener}
            `
        );

        return x;
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
}
