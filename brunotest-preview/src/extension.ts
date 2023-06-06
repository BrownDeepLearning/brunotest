import * as vscode from "vscode";
import { StencilChaffEditorProvider } from "./StencilChaffEditor";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(StencilChaffEditorProvider.register(context));
}

export function deactivate() {}
