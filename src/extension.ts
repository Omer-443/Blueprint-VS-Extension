import * as vscode from 'vscode';
import { ExtensionManager } from './backend/ExtensionManager';

let extensionManager: ExtensionManager;

export function activate(context: vscode.ExtensionContext) {
  try {
    console.log('Blueprint extension is now active!');
    extensionManager = new ExtensionManager();
    void extensionManager.activate(context).catch(error => {
      console.error('Failed to activate Blueprint extension:', error);
      vscode.window.showErrorMessage('Failed to activate Blueprint extension: ' + error.message);
    });
  } catch (error: any) {
    console.error('Failed to activate Blueprint extension:', error);
    vscode.window.showErrorMessage('Failed to activate Blueprint extension: ' + error.message);
  }
}

export function deactivate() {
  if (extensionManager) {
    extensionManager.deactivate();
  }
}
