import * as vscode from 'vscode';
import { IPCMessage, BackendMessageType } from '../types';
import { GraphManager } from './GraphManager';
import { IpcValidator } from '../IpcValidator';

export class MessageBroker {
  private panel: vscode.WebviewPanel | undefined;
  private graphManager: GraphManager;

  constructor(graphManager: GraphManager) {
    this.graphManager = graphManager;
  }

  public initializeBroker(panel: vscode.WebviewPanel): vscode.Disposable {
    this.panel = panel;
    return panel.webview.onDidReceiveMessage(
      (message: IPCMessage) => this.handleWebviewMessage(message),
      undefined,
      [] // We can attach context.subscriptions later inside ExtensionManager
    );
  }

  public broadcastGraphUpdate() {
    if (this.panel) {
      const snapshot = this.graphManager.getGraphSnapshot();
      this.sendMessageToWebview('INCREMENTAL_GRAPH_UPDATE', {
        nodes: snapshot.nodes,
        edges: snapshot.edges,
        brokenContracts: snapshot.brokenContracts || [],
        diff: null
      });
    }
  }

  public broadcastDiagnostics(diagnostics: Record<string, import('../types').NodeDiagnostic>) {
    if (this.panel) {
      this.sendMessageToWebview('UPDATE_DIAGNOSTICS', diagnostics);
    }
  }

  private handleWebviewMessage(message: IPCMessage) {
    try {
      if (!IpcValidator.isValidMessage(message)) return;

      console.log(`[Backend] Received message: ${message.type}`);
      switch (message.type) {
        case 'WEBVIEW_READY': {
          const snapshot = this.graphManager.getGraphSnapshot();
          this.sendMessageToWebview('INITIAL_GRAPH_LOAD', {
            nodes: snapshot.nodes,
            edges: snapshot.edges,
            brokenContracts: snapshot.brokenContracts || [],
            diff: null
          });
          break;
        }
        case 'REQUEST_NODE_METADATA': {
          // Send a dummy response back to test the return trip
          const meta = {
            filePath: '/mock/path.ts',
            lineCount: 100,
            isEntryFile: false,
            isReactComponent: true,
            lastModified: Date.now()
          };
          this.sendMessageToWebview('NODE_METADATA_RESPONSE', meta);
          vscode.window.showInformationMessage(`Blueprint: Requesting Metadata for ${message.payload.nodeId}`);
          break;
        }
        case 'REQUEST_FULL_REFRESH':
          break;
        case 'REQUEST_QUIZ_DATA':
          break;
        case 'REQUEST_BLAST_RADIUS': {
          const nodeId: string = message.payload?.nodeId;
          const result = this.graphManager.calculateBlastRadius(nodeId);
          this.sendMessageToWebview('BLAST_RADIUS_RESPONSE', {
            nodeIds: Array.from(result.nodeIds),
            edgeIds: Array.from(result.edgeIds),
          });
          break;
        }

        case 'DEBUG_LOG':
          console.log(`[Webview Debug] ${message.payload}`);
          break;
        default:
          console.warn(`[Backend] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[MessageBroker] Failed to handle webview message:', error);
    }
  }

  public sendMessageToWebview(type: BackendMessageType, payload: any) {
    if (this.panel) {
      this.panel.webview.postMessage({ type, payload } as IPCMessage);
    }
  }
}
