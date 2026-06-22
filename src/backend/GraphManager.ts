import { MultiDirectedGraph } from 'graphology';
import { FileMetadata, SerializedGraph, SerializedNode, SerializedEdge } from '../types';

export class GraphManager {
  private graph: MultiDirectedGraph;

  constructor() {
    this.graph = new MultiDirectedGraph();
  }

  public upsertNode(
    filePath: string,
    metadata: FileMetadata,
    apiRoutes?: import('../types').ApiRoute[],
    apiCalls?: import('../types').ApiCall[],
    label?: string,
    clusterId?: string
  ) {
    const attrs: any = { metadata, apiRoutes, apiCalls };
    if (label) attrs.label = label;
    if (clusterId) attrs.clusterId = clusterId;
    if (!this.graph.hasNode(filePath)) {
      this.graph.addNode(filePath, attrs);
    } else {
      this.graph.replaceNodeAttributes(filePath, attrs);
    }
  }

  public rebuildEdges(filePath: string, resolvedImports: string[]) {
    if (this.graph.hasNode(filePath)) {
      const edgesToDrop = this.graph.outEdges(filePath).filter(edge => {
        const type = this.graph.getEdgeAttribute(edge, 'type');
        return !type || type === 'IMPORT';
      });
      edgesToDrop.forEach(edge => this.graph.dropEdge(edge));
    }

    resolvedImports.forEach(targetPath => {
      if (!this.graph.hasNode(targetPath)) {
        this.graph.addNode(targetPath, { 
          metadata: { filePath: targetPath, lineCount: 0, isEntryFile: false, isReactComponent: false, lastModified: 0 } 
        });
      }
      const key = `import:${filePath}→${targetPath}`;
      if (!this.graph.hasEdge(key)) {
        this.graph.addDirectedEdgeWithKey(key, filePath, targetPath, { type: 'IMPORT', key });
      }
    });
  }

  public removeNode(filePath: string) {
    if (this.graph.hasNode(filePath)) {
      this.graph.dropNode(filePath);
    }
  }

  public removeContractEdgesFromSource(source: string) {
    if (!this.graph.hasNode(source)) return;

    const edgesToDrop = this.graph.outEdges(source).filter(edge => this.graph.getEdgeAttribute(edge, 'type') === 'CONTRACT');
    edgesToDrop.forEach(edge => this.graph.dropEdge(edge));
  }

  public hasNode(filePath: string) {
    return this.graph.hasNode(filePath);
  }

  public getGraphSnapshot(): SerializedGraph & { brokenContracts?: string[] } {
    const nodes: SerializedNode[] = this.graph.nodes().map(node => {
      const attrs = this.graph.getNodeAttributes(node);
      // Use explicit label attribute if set (e.g. for dummy MISSING_API nodes), otherwise derive from path
      const label = attrs.label || node.split(/[\/\\]/).pop() || node;
      
      let clusterId = undefined;
      const metadata = attrs.metadata as FileMetadata;
      if (typeof attrs.clusterId === 'string' && attrs.clusterId.length > 0) {
        clusterId = attrs.clusterId;
      }
      // Broken/dummy nodes must NOT be assigned to a cluster — they are always
      // standalone so they remain visible and don't get parented to a phantom cluster.
      const isBrokenOrDummy = node.startsWith('broken_contract:') || node.startsWith('MISSING_API:');
      
      return {
        id: node,
        label,
        metadata,
        clusterId
      };
    });

    const edges: SerializedEdge[] = this.graph.edges().map(edge => {
      return {
        // Use the deterministic key stored as attribute, fallback to graphology internal id
        id: this.graph.getEdgeAttribute(edge, 'key') || edge,
        source: this.graph.source(edge),
        target: this.graph.target(edge),
        type: this.graph.getEdgeAttribute(edge, 'type') || 'IMPORT',
        endpoint: this.graph.getEdgeAttribute(edge, 'endpoint')
      };
    });

    return { nodes, edges, brokenContracts: (this as any).brokenContracts || [] };
  }

  public getAllApiRoutes(): import('../types').ApiRoute[] {
    const routes: import('../types').ApiRoute[] = [];
    this.graph.forEachNode((node, attrs) => {
      if (attrs.apiRoutes) routes.push(...attrs.apiRoutes);
    });
    return routes;
  }

  public getAllApiCalls(): import('../types').ApiCall[] {
    const calls: import('../types').ApiCall[] = [];
    this.graph.forEachNode((node, attrs) => {
      if (attrs.apiCalls) calls.push(...attrs.apiCalls);
    });
    return calls;
  }

  public addContractEdge(source: string, target: string, endpoint: string) {
    if (this.graph.hasNode(source) && this.graph.hasNode(target)) {
      // Check only for existing CONTRACT edges between this pair (not IMPORT edges)
      const existingContractEdge = this.graph.edges(source, target).find(
        e => this.graph.getEdgeAttribute(e, 'type') === 'CONTRACT' &&
             this.graph.getEdgeAttribute(e, 'endpoint') === endpoint
      );
      if (!existingContractEdge) {
        const key = `contract:${source}→${target}:${endpoint}`;
        this.graph.addDirectedEdgeWithKey(key, source, target, { type: 'CONTRACT', endpoint, key });
      }
    }
  }

  public upsertNodeAndConnect(source: string, target: string, endpoint: string) {
    if (!this.graph.hasNode(source)) {
      this.upsertNode(source, {
        filePath: source,
        lineCount: 0,
        isEntryFile: false,
        isReactComponent: false,
        lastModified: 0
      });
    }
    if (!this.graph.hasNode(target)) {
      this.upsertNode(target, {
        filePath: target,
        lineCount: 0,
        isEntryFile: false,
        isReactComponent: false,
        lastModified: 0
      });
    }
    this.addContractEdge(source, target, endpoint);
  }

  public clearContractEdges() {
    // Drop all CONTRACT edges first
    const edgesToDrop = this.graph.edges().filter(edge => 
      this.graph.getEdgeAttribute(edge, 'type') === 'CONTRACT'
    );
    edgesToDrop.forEach(edge => this.graph.dropEdge(edge));

    // Also remove orphan dummy nodes (they'll be re-added if still broken)
    const dummyNodes = this.graph.nodes().filter(n => 
      n.startsWith('MISSING_API:') || n.startsWith('broken_contract:')
    );
    dummyNodes.forEach(n => this.graph.dropNode(n));
  }

  public clear() {
    this.graph.clear();
    (this as any).brokenContracts = [];
  }

  public getNodeCount() {
    return this.graph.order;
  }

  public getEdgeCount() {
    return this.graph.size;
  }

  // Improvement 4: Blast radius (impact spotlight)
  // Returns all ancestor/descendant nodes and the edges between them.
  // Uses graphology's ancestor()/descendants() style traversal.
  public calculateBlastRadius(nodeId: string): { nodeIds: Set<string>; edgeIds: Set<string> } {
    const nodeIds = new Set<string>();

    if (!this.graph.hasNode(nodeId)) {
      return { nodeIds, edgeIds: new Set() };
    }

    // Impact = ancestors (upstream dependents) + descendants (downstream dependencies)
    // Note: MultiDirectedGraph has distinct in/out edges; we treat it directionally.
    const ancestors: string[] = (this.graph as any).ancestors ? (this.graph as any).ancestors(nodeId) : [];
    const descendants: string[] = (this.graph as any).descendants ? (this.graph as any).descendants(nodeId) : [];

    nodeIds.add(nodeId);
    for (const n of ancestors) nodeIds.add(n);
    for (const n of descendants) nodeIds.add(n);

    const edgeIds = new Set<string>();
    for (const edge of this.graph.edges()) {
      const s = this.graph.source(edge);
      const t = this.graph.target(edge);
      if (nodeIds.has(s) && nodeIds.has(t)) {
        edgeIds.add(this.graph.getEdgeAttribute(edge, 'key') || (edge as any));
      }
    }

    return { nodeIds, edgeIds };
  }
}
