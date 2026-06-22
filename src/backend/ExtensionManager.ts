import * as vscode from 'vscode';
import JSON5 from 'json5';
import { MessageBroker } from './MessageBroker';
import { ParserEngine, PathAliasConfig } from './ParserEngine';
import { GraphManager } from './GraphManager';
import { WorkspaceWatcher } from './WorkspaceWatcher';

export class ExtensionManager {
  private panel: vscode.WebviewPanel | undefined;
  private messageBroker: MessageBroker;
  private parserEngine: ParserEngine;
  private graphManager: GraphManager;
  private workspaceWatcher: WorkspaceWatcher;
  private typingDebounceMap: Map<string, NodeJS.Timeout> = new Map();
  private brokerDisposable: vscode.Disposable | undefined;

  constructor() {
    this.parserEngine = new ParserEngine();
    this.graphManager = new GraphManager();
    this.messageBroker = new MessageBroker(this.graphManager);
    this.workspaceWatcher = new WorkspaceWatcher(this.parserEngine, this.graphManager, this.messageBroker);
  }

  public async activate(context: vscode.ExtensionContext) {
    try {
      const openPanelCommand = vscode.commands.registerCommand('blueprint.openPanel', () => {
        this.openPanel(context);
      });

      const openPanelAliasCommand = vscode.commands.registerCommand('blueprint.openpanel', () => {
        this.openPanel(context);
      });

      const refreshGraphCommand = vscode.commands.registerCommand('blueprint.refreshGraph', async () => {
        try {
          this.typingDebounceMap.forEach(timeout => clearTimeout(timeout));
          this.typingDebounceMap.clear();
          await this.workspaceWatcher.refreshWorkspace();
          vscode.window.showInformationMessage('Blueprint: Graph refreshed.');
        } catch (error: any) {
          console.error('Blueprint refresh failed:', error);
          vscode.window.showErrorMessage('Blueprint: Refresh failed - ' + (error?.message ?? String(error)));
        }
      });

      const diagnosticsDisposable = vscode.languages.onDidChangeDiagnostics(() => {
        const diagnosticsMap: Record<string, import('../types').NodeDiagnostic> = {};

        vscode.workspace.textDocuments.forEach(doc => {
          const diags = vscode.languages.getDiagnostics(doc.uri);
          if (diags.length > 0) {
            const errorCount = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Error).length;
            const warningCount = diags.filter(d => d.severity === vscode.DiagnosticSeverity.Warning).length;
            const messages = diags.map(d => d.message);

            if (errorCount > 0 || warningCount > 0) {
              diagnosticsMap[doc.uri.fsPath] = { errorCount, warningCount, messages };
            }
          }
        });

        this.messageBroker.broadcastDiagnostics(diagnosticsMap);
      });

      const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.messageBroker.sendMessageToWebview('ACTIVE_EDITOR_CHANGED', { filePath: editor.document.uri.fsPath });
        } else {
          this.messageBroker.sendMessageToWebview('ACTIVE_EDITOR_CHANGED', { filePath: null });
        }
      });

      const liveTypingDisposable = vscode.workspace.onDidChangeTextDocument(e => {
        // Ignore output panels, terminals, or non-file schemes
        if (e.document.uri.scheme === 'file') {
          const filePath = e.document.uri.fsPath;
          if (filePath.match(/\.(js|jsx|ts|tsx)$/)) {
            const content = e.document.getText();
            const existingTimeout = this.typingDebounceMap.get(filePath);
            if (existingTimeout) {
              clearTimeout(existingTimeout);
            }

            const timeout = setTimeout(() => {
              void this.workspaceWatcher.processFile(filePath, content);
              this.typingDebounceMap.delete(filePath);
            }, 150);

            this.typingDebounceMap.set(filePath, timeout);
          }
        }
      });

      context.subscriptions.push(
        openPanelCommand,
        openPanelAliasCommand,
        refreshGraphCommand,
        diagnosticsDisposable,
        activeEditorDisposable,
        liveTypingDisposable,
      );

      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      void this.initializeWorkspace(workspaceFolders);
    } catch (error: any) {
      console.error('Blueprint activation failed:', error);
      vscode.window.showErrorMessage('Blueprint: Activation failed - ' + (error?.message ?? String(error)));
    }
  }

  public deactivate() {
    try {
      if (this.panel) {
        this.panel.dispose();
      }
      if (this.brokerDisposable) {
        this.brokerDisposable.dispose();
        this.brokerDisposable = undefined;
      }
      this.typingDebounceMap.forEach(timeout => clearTimeout(timeout));
      this.typingDebounceMap.clear();
      this.workspaceWatcher.dispose();
      this.parserEngine.clearCache();
      this.graphManager.clear();
    } catch (error) {
      console.error('Blueprint deactivate cleanup failed:', error);
    }
  }

  private async loadAliasConfigs(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<PathAliasConfig[]> {
    const configs: PathAliasConfig[] = [];

    for (const folder of workspaceFolders) {
      for (const candidate of ['tsconfig.json', 'jsconfig.json']) {
        try {
          const uri = vscode.Uri.joinPath(folder.uri, candidate);
          const bytes = await vscode.workspace.fs.readFile(uri);
          const parsed = JSON5.parse(new TextDecoder('utf-8').decode(bytes));
          const compilerOptions = parsed?.compilerOptions ?? {};
          const baseUrl = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : undefined;
          const paths = compilerOptions.paths && typeof compilerOptions.paths === 'object'
            ? compilerOptions.paths as Record<string, string[]>
            : {};

          if (baseUrl || Object.keys(paths).length > 0) {
            configs.push({
              rootPath: folder.uri.fsPath,
              baseUrl,
              paths,
            });
          }
        } catch {
          // Missing config or invalid JSON is normal in many workspaces.
        }
      }
    }

    return configs;
  }

  private async initializeWorkspace(workspaceFolders: readonly vscode.WorkspaceFolder[]) {
    try {
      const aliasConfigs = await this.loadAliasConfigs(workspaceFolders);
      this.parserEngine.setAliasConfigs(aliasConfigs);

      if (workspaceFolders.length > 0) {
        await this.workspaceWatcher.initializeWatchers(workspaceFolders);
      }
    } catch (error: any) {
      console.error('Blueprint workspace initialization failed:', error);
      vscode.window.showErrorMessage('Blueprint: Workspace initialization failed - ' + (error?.message ?? String(error)));
    }
  }

  private openPanel(context: vscode.ExtensionContext) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'blueprintMap',
      'Blueprint Architecture Map',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')]
      }
    );

    this.panel.webview.html = this.getHtmlForWebview(context, this.panel.webview);

    this.brokerDisposable = this.messageBroker.initializeBroker(this.panel);
    context.subscriptions.push(this.brokerDisposable);

    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.brokerDisposable = undefined;
      },
      null,
      context.subscriptions
    );
  }

  private getHtmlForWebview(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const indexJsUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'assets', 'index.js'));
    const indexCssUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview', 'assets', 'index.css'));
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blueprint Map</title>
    <link href="${indexCssUri}" rel="stylesheet">
</head>
<body>
    <script>
      const vscode = acquireVsCodeApi();
      window.onerror = function(message, source, lineno, colno, error) {
        vscode.postMessage({ type: 'DEBUG_LOG', payload: 'WEBVIEW ERROR: ' + message + ' at ' + source + ':' + lineno + ':' + colno + '\n' + (error ? error.stack : '') });
      };
      window.addEventListener('unhandledrejection', function(event) {
        vscode.postMessage({ type: 'DEBUG_LOG', payload: 'WEBVIEW PROMISE REJECTION: ' + event.reason });
      });
      vscode.postMessage({ type: 'DEBUG_LOG', payload: 'Webview HTML loaded, CSP passed, waiting for React...' });
    </script>
    <div id="root"></div>
    <script type="module" src="${indexJsUri}"></script>
</body>
</html>`;
  }
}
