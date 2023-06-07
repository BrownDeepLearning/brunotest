import * as vscode from "vscode";
import { ChaffEditorProvider } from "./ChaffEditor";

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(ChaffEditorProvider.register(context));
}

export function deactivate() {}
