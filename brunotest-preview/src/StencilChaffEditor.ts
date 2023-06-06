import * as vscode from "vscode";
import { getHighlighter } from "shiki";
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
        webviewPanel.webview.html = await this.getHTMLForWebview(
            document,
            webviewPanel.webview
        );
        webviewPanel.reveal(vscode.ViewColumn.Two);

        const changeDocumentSubscription =
            vscode.workspace.onDidChangeTextDocument(async (e) => {
                // this event is fired when the webview changes as well, so this prevents an infinite loop
                if (e.document.uri.toString() === document.uri.toString()) {
                    webviewPanel.webview.html = await this.getHTMLForWebview(
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

    private async getHTMLForWebview(
        document: vscode.TextDocument,
        webview: vscode.Webview
    ): Promise<string> {
        const webviewCssUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "webview.css")
        );

        const nonce = getNonce();

        const isDarkMode =
            vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        const highlightTheme = isDarkMode ? "github-dark" : "github-light";

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
            ${(await getHighlighter({ theme: highlightTheme })).codeToHtml(
                document.getText(),
                { lang: "python" }
            )}
        </body>
        </html>
        `;
    }
}
