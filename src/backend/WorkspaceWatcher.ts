import * as vscode from 'vscode';
import * as _ from 'lodash';
import * as path from 'path';
import { ParserEngine } from './ParserEngine';
import { GraphManager } from './GraphManager';
import { MessageBroker } from './MessageBroker';
import { DiffEngine } from './DiffEngine';
import { ContractMatcher } from './ContractMatcher';
import { SerializedGraph, ApiRoute, ApiCall } from '../types';

export class WorkspaceWatcher {
  private watchers: vscode.FileSystemWatcher[] = [];
  private workspaceFolders: readonly vscode.WorkspaceFolder[] = [];
  private parser: ParserEngine;
  private graph: GraphManager;
  private broker: MessageBroker;
  private diffEngine: DiffEngine;
  private previousSnapshot: SerializedGraph | null = null;

  // EXT-10: Event Queue with Ordering
  private updateQueue: Map<string, { seq: number, content?: string }> = new Map();
  private processingSet: Set<string> = new Set();
  private globalSeq = 0;
  private refreshGeneration = 0;
  private bulkScanActive = false;

  // EXT-03: Incremental Contract Resolution
  private routeIndex: Map<string, ApiRoute[]> = new Map();
  private callIndex: Map<string, ApiCall[]> = new Map();
  private brokenNodeIdsBySource: Map<string, string[]> = new Map();
  private pendingDirtySources: Set<string> = new Set();
  private pendingFullReconcile = false;

  private debouncedHandleChange: _.DebouncedFunc<(uri: vscode.Uri) => void>;
  private debouncedReconcileContracts: _.DebouncedFunc<() => void>;

  constructor(parser: ParserEngine, graph: GraphManager, broker: MessageBroker) {
    this.parser = parser;
    this.graph = graph;
    this.broker = broker;
    this.diffEngine = new DiffEngine();

    this.debouncedHandleChange = _.debounce((uri: vscode.Uri) => {
      void this.processFile(uri.fsPath);
    }, 300);

    this.debouncedReconcileContracts = _.debounce(() => {
      void this.flushContractReconcile();
    }, 200);
  }

  private shouldIgnorePath(filePath: string): boolean {
    const ignoredDirs = ['node_modules', '.next', 'out', 'build', 'dist', '.git', '.vscode', 'coverage'];
    if (ignoredDirs.some(pattern => filePath.includes(`/${pattern}/`) || filePath.includes(`\\${pattern}\\`))) {
      return true;
    }

    const baseName = filePath.split(/[\\/]/).pop() || filePath;
    if (/^(vite|esbuild|webpack|rollup)\.config\.(js|cjs|mjs|ts|mts|cts)$/i.test(baseName)) {
      return true;
    }

    if (/\.config\.(js|cjs|mjs|ts|mts|cts)$/i.test(baseName)) {
      return true;
    }

    return false;
  }

  private normalizeIdFragment(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private stableHash(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  private getWorkspaceFolderForPath(filePath: string): vscode.WorkspaceFolder | undefined {
    const normalized = filePath.toLowerCase();
    return [...this.workspaceFolders]
      .filter(folder => normalized.startsWith(folder.uri.fsPath.toLowerCase()))
      .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)[0];
  }

  private getClusterIdForFile(filePath: string): string | undefined {
    const folder = this.getWorkspaceFolderForPath(filePath);
    if (!folder) return undefined;

    const relativePath = path.relative(folder.uri.fsPath, filePath);
    const parentFolder = path.basename(path.dirname(relativePath)) || folder.name;
    const namespace = this.normalizeIdFragment(folder.name || path.basename(folder.uri.fsPath));
    const bucket = this.normalizeIdFragment(parentFolder || folder.name || 'root');
    return `${namespace}::cluster:${bucket}`;
  }

  private serializeRoutes(routes: ApiRoute[]): string {
    return routes
      .map(route => `${route.method}|${route.path}|${route.filePath}`)
      .sort()
      .join('||');
  }

  private serializeCalls(calls: ApiCall[]): string {
    return calls
      .map(call => `${call.method}|${call.url}|${call.filePath}`)
      .sort()
      .join('||');
  }

  public async initializeWatchers(workspaceFolders: readonly vscode.WorkspaceFolder[]) {
    try {
      this.disposeWatchersOnly();
      this.workspaceFolders = [...workspaceFolders];
      this.bulkScanActive = true;

      for (const folder of workspaceFolders) {
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*.{js,jsx,ts,tsx}'));
        watcher.onDidChange(uri => this.debouncedHandleChange(uri));
        watcher.onDidCreate(uri => this.debouncedHandleChange(uri));
        watcher.onDidDelete(uri => this.handleFileDelete(uri));
        this.watchers.push(watcher);
      }

      for (const folder of workspaceFolders) {
        const files = await vscode.workspace.findFiles(
          new vscode.RelativePattern(folder, '**/*.{js,jsx,ts,tsx}'),
          '**/{node_modules,.next,out,build,dist,.git,.vscode,coverage}/**'
        );
        for (const file of files) {
          if (this.shouldIgnorePath(file.fsPath)) continue;
          try {
            await this.executeFileUpdate(file.fsPath);
          } catch (e) {
            console.error(`[Watcher] Failed to process ${file.fsPath}`, e);
          }
        }
      }

      this.bulkScanActive = false;
      await this.reconcileAllContracts();
      this.broadcastCurrentSnapshot();

      console.log(`[WorkspaceWatcher] Initial scan complete. Nodes: ${this.graph.getNodeCount()}, Edges: ${this.graph.getEdgeCount()}`);
    } catch (error) {
      this.bulkScanActive = false;
      console.error('[WorkspaceWatcher] Failed to initialize watchers:', error);
    }
  }

  public async refreshWorkspace() {
    try {
      this.debouncedHandleChange.cancel();
      this.debouncedReconcileContracts.cancel();
      this.refreshGeneration++;
      this.updateQueue.clear();
      this.processingSet.clear();
      this.pendingDirtySources.clear();
      this.pendingFullReconcile = false;
      this.bulkScanActive = false;
      this.parser.clearCache();
      this.graph.clear();
      this.routeIndex.clear();
      this.callIndex.clear();
      this.brokenNodeIdsBySource.clear();
      this.previousSnapshot = null;
      await this.initializeWatchers(this.workspaceFolders);
    } catch (error) {
      console.error('[WorkspaceWatcher] Failed to refresh workspace:', error);
    }
  }

  public async processFile(filePath: string, contentOverride?: string) {
    try {
      if (this.shouldIgnorePath(filePath)) return;

      this.globalSeq++;
      this.updateQueue.set(filePath, { seq: this.globalSeq, content: contentOverride });
      this.pumpQueue();
    } catch (error) {
      console.error(`[WorkspaceWatcher] Failed to queue ${filePath}:`, error);
    }
  }

  private async pumpQueue() {
    for (const [filePath, pending] of this.updateQueue.entries()) {
      if (this.processingSet.has(filePath)) continue;

      this.processingSet.add(filePath);
      this.updateQueue.delete(filePath);

      try {
        await this.executeFileUpdate(filePath, pending.content);
      } catch (e) {
        console.error(`[Watcher] Failed to process ${filePath}`, e);
      } finally {
        this.processingSet.delete(filePath);
        if (this.updateQueue.has(filePath)) {
          void this.pumpQueue();
        }
      }
    }
  }

  private scheduleContractReconcile(filePath: string, routeChanged: boolean, callChanged: boolean) {
    if (routeChanged) {
      this.pendingFullReconcile = true;
      this.pendingDirtySources.delete(filePath);
    } else if (callChanged) {
      this.pendingDirtySources.add(filePath);
    }

    if (this.bulkScanActive) {
      return;
    }

    this.debouncedReconcileContracts();
  }

  private async executeFileUpdate(filePath: string, contentOverride?: string) {
    try {
      const generation = this.refreshGeneration;
      const previousRoutes = this.routeIndex.get(filePath) ?? [];
      const previousCalls = this.callIndex.get(filePath) ?? [];
      const previousRouteSignature = this.serializeRoutes(previousRoutes);
      const previousCallSignature = this.serializeCalls(previousCalls);

      const data = await this.parser.parseFile(filePath, contentOverride);
      if (generation !== this.refreshGeneration) return;

      const clusterId = this.getClusterIdForFile(filePath);
      this.graph.upsertNode(filePath, data.metadata, data.apiRoutes, data.apiCalls, undefined, clusterId);

      const resolvedPaths = data.imports.map(imp => imp.resolvedPath).filter(Boolean) as string[];
      this.graph.rebuildEdges(filePath, resolvedPaths);

      this.routeIndex.set(filePath, data.apiRoutes);
      this.callIndex.set(filePath, data.apiCalls);

      const nextRouteSignature = this.serializeRoutes(data.apiRoutes);
      const nextCallSignature = this.serializeCalls(data.apiCalls);
      const routeChanged = previousRouteSignature !== nextRouteSignature;
      const callChanged = previousCallSignature !== nextCallSignature;

      if (routeChanged || callChanged) {
        this.scheduleContractReconcile(filePath, routeChanged, callChanged);
      }
    } catch (error) {
      console.error(`[WorkspaceWatcher] Failed to execute update for ${filePath}:`, error);
    }
  }

  private broadcastCurrentSnapshot() {
    try {
      const currentSnapshot = this.graph.getGraphSnapshot();

      if (this.previousSnapshot) {
        const diff = this.diffEngine.calculateDiff(this.previousSnapshot, currentSnapshot);
        this.broker.sendMessageToWebview('INCREMENTAL_GRAPH_UPDATE', {
          nodes: currentSnapshot.nodes,
          edges: currentSnapshot.edges,
          brokenContracts: currentSnapshot.brokenContracts,
          diff,
        });
      } else {
        this.broker.sendMessageToWebview('INCREMENTAL_GRAPH_UPDATE', {
          nodes: currentSnapshot.nodes,
          edges: currentSnapshot.edges,
          brokenContracts: currentSnapshot.brokenContracts || [],
          diff: null,
        });
      }

      this.previousSnapshot = currentSnapshot;
    } catch (error) {
      console.error('[WorkspaceWatcher] Failed to broadcast snapshot:', error);
    }
  }

  private makeBrokenNodeId(source: string, endpoint: string): string {
    return `broken_contract:${this.stableHash(source)}:${this.stableHash(endpoint)}`;
  }

  private removeContractsForSource(source: string) {
    this.graph.removeContractEdgesFromSource(source);
    const brokenNodeIds = this.brokenNodeIdsBySource.get(source) ?? [];
    brokenNodeIds.forEach(nodeId => this.graph.removeNode(nodeId));
    this.brokenNodeIdsBySource.delete(source);
  }

  private async reconcileSources(sources: string[]) {
    try {
      const matcher = new ContractMatcher();
      const allRoutes = Array.from(this.routeIndex.values()).flat();
      const brokenContracts: string[] = [];
      let matchedCount = 0;

      for (const source of sources) {
        try {
          this.removeContractsForSource(source);
          const calls = this.callIndex.get(source) ?? [];
          if (calls.length === 0) {
            this.brokenNodeIdsBySource.set(source, []);
            continue;
          }

          const result = matcher.matchContracts(allRoutes, calls);
          matchedCount += result.matched.length;

          result.matched.forEach(contract => {
            this.graph.upsertNodeAndConnect(contract.source, contract.target, contract.endpoint);
          });

          const brokenIds: string[] = [];
          result.broken.forEach(broken => {
            const dummyId = this.makeBrokenNodeId(broken.source, broken.endpoint);
            brokenIds.push(dummyId);
            brokenContracts.push(dummyId);
            this.graph.upsertNode(
              dummyId,
              {
                filePath: dummyId,
                lineCount: 0,
                isEntryFile: false,
                isReactComponent: false,
                lastModified: 0
              },
              undefined,
              undefined,
              `⚠ ${broken.endpoint}`
            );
            if (!this.graph.hasNode(broken.source)) {
              this.graph.upsertNode(broken.source, {
                filePath: broken.source,
                lineCount: 0,
                isEntryFile: false,
                isReactComponent: false,
                lastModified: 0
              });
            }
            this.graph.addContractEdge(broken.source, dummyId, broken.endpoint);
          });

          this.brokenNodeIdsBySource.set(source, brokenIds);
        } catch (error) {
          console.error(`[WorkspaceWatcher] Failed to reconcile contracts for ${source}:`, error);
        }
      }

      (this.graph as any).brokenContracts = brokenContracts;
      console.log(`[Blueprint:Contracts] Matched: ${matchedCount}, Broken: ${brokenContracts.length}`);
    } catch (error) {
      console.error('[WorkspaceWatcher] Contract reconciliation failed:', error);
    }
  }

  private async reconcileAllContracts() {
    try {
      this.graph.clearContractEdges();
      this.brokenNodeIdsBySource.clear();
      await this.reconcileSources(Array.from(this.callIndex.keys()));
    } catch (error) {
      console.error('[WorkspaceWatcher] Full contract reconciliation failed:', error);
    }
  }

  private async flushContractReconcile() {
    try {
      if (this.pendingFullReconcile) {
        this.pendingFullReconcile = false;
        this.pendingDirtySources.clear();
        await this.reconcileAllContracts();
        this.broadcastCurrentSnapshot();
        return;
      }

      const dirtySources = Array.from(this.pendingDirtySources);
      this.pendingDirtySources.clear();
      if (dirtySources.length === 0) return;

      await this.reconcileSources(dirtySources);
      this.broadcastCurrentSnapshot();
    } catch (error) {
      console.error('[WorkspaceWatcher] Failed to flush contract updates:', error);
    }
  }

  private handleFileDelete(uri: vscode.Uri) {
    try {
      const fsPath = uri.fsPath;
      console.log(`[Watcher] File or Folder deleted: ${fsPath}`);

      this.routeIndex.delete(fsPath);
      this.callIndex.delete(fsPath);
      this.removeContractsForSource(fsPath);
      this.graph.removeNode(fsPath);

      const sep = fsPath.includes('\\') ? '\\' : '/';
      const normalizedFsPath = fsPath.endsWith(sep) ? fsPath : fsPath + sep;

      const nodesToRemove = this.graph.getGraphSnapshot().nodes.filter(n => n.id.startsWith(normalizedFsPath));
      nodesToRemove.forEach(n => {
        this.routeIndex.delete(n.id);
        this.callIndex.delete(n.id);
        this.removeContractsForSource(n.id);
        this.graph.removeNode(n.id);
      });

      this.pendingFullReconcile = true;
      this.debouncedReconcileContracts();
    } catch (error) {
      console.error('[WorkspaceWatcher] Failed to handle file deletion:', error);
    }
  }

  public dispose() {
    this.debouncedHandleChange.cancel();
    this.debouncedReconcileContracts.cancel();
    this.disposeWatchersOnly();
  }

  private disposeWatchersOnly() {
    this.watchers.forEach(w => w.dispose());
    this.watchers = [];
  }
}
