import * as vscode from "vscode";
import { getNonce } from "./util";

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
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Open the document in the default text editor
        vscode.window.showTextDocument(document, vscode.ViewColumn.One);

        // Create and show the webview panel
        webviewPanel.webview.html = this.getHTMLForWebview(
            document,
            webviewPanel.webview
        );
        webviewPanel.reveal(vscode.ViewColumn.Two);

        const changeDocumentSubscription =
            vscode.workspace.onDidChangeTextDocument((e) => {
                // this event is fired when the webview changes as well, so this prevents an infinite loop
                if (e.document.uri.toString() === document.uri.toString()) {
                    webviewPanel.webview.html = this.getHTMLForWebview(
                        document,
                        webviewPanel.webview
                    );
                }
            });

        // Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });
    }

    private getHTMLForWebview(
        document: vscode.TextDocument,
        webview: vscode.Webview
    ): string {
        const prismJsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "assets",
                "prism",
                "prism.js"
            )
        );

        const prismCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                vscode.Uri.joinPath(
                    this.context.extensionUri,
                    "assets",
                    "prism",
                    "prism.css"
                )
            )
        );

        const nonce = getNonce();

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${
                webview.cspSource
            }; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">

            <link rel="stylesheet" href="${prismCssUri}" />
            <title>Brunotest Preview</title>
        </head>
        <body>
            <pre id="view">
                <code class="language-py">
${document.getText()}
                </code>
            </pre>

            <script nonce="${nonce}" src="${prismJsUri}"></script>
        </body>
        </html>
        `;
    }
}
