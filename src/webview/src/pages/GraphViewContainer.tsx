import React, { useCallback, useMemo, useEffect, useState } from 'react';
import ReactFlow, { MiniMap, Controls, Background, BackgroundVariant, NodeTypes, EdgeTypes, Node, useNodesInitialized, useReactFlow } from 'reactflow';


// acquireVsCodeApi() can only be called once per webview — App.tsx calls it first
// and stores the result on window.vscode. Use that reference here.
const vscode = (window as any).vscode as { postMessage: (message: any) => void };

// reactflow styles are imported globally in index.css / app bundling

import { useGraphStore } from '../store/useGraphStore';
import { CodeNode } from '../components/CodeNode';
import { DependencyEdge } from '../components/DependencyEdge';
import { ContractEdge } from '../components/ContractEdge';
import { BrokenContractNode } from '../components/BrokenContractNode';
import { ClusterNode } from '../components/ClusterNode';
import { ClusterOverflowNode } from '../components/ClusterOverflowNode';
import { NodeSidebar } from '../components/NodeSidebar';
import { SearchCommandPalette } from '../components/SearchCommandPalette';


class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, error }; }
  componentDidCatch(error: any, errorInfo: any) {
    vscode.postMessage({ type: 'DEBUG_LOG', payload: `React ErrorBoundary caught: ${error.message} \n ${error.stack}` } as any);
  }
  render() {
    if (this.state.hasError) {
      return <div style={{ color: 'red', padding: 20 }}>Something went wrong rendering the graph: {this.state.error?.message}</div>;
    }
    return this.props.children;
  }
}

export const GraphViewContainer: React.FC = () => {
  useEffect(() => {
    console.log('[GraphViewContainer][BOOT] mounted GraphViewContainer bundle');
  }, []);

  const { nodes, edges, removedEdgeGhosts, onNodesChange, onEdgesChange, setSelectedNodeId, activeEditorPath, expandedClusters, toggleCluster, showDependencyEdges, showContractEdges, setShowDependencyEdges, setShowContractEdges, quizScore, fitViewRequest } = useGraphStore();
  const { setCenter, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();

  const [hasFittedView, setHasFittedView] = React.useState(false);

  useEffect(() => {
    if (hasFittedView || !nodesInitialized || nodes.length === 0) return;

    // Wait for React Flow to measure the final node bounds before fitting.
    // This gives the first-open experience a true whole-project overview instead
    // of a zoomed-in slice that can happen if we fit too early.
    const rafId = requestAnimationFrame(() => {
      setTimeout(() => {
        fitView({
          duration: 900,
          padding: 0.24,
          includeHiddenNodes: true,
        });
        setHasFittedView(true);
      }, 120);
    });

    return () => cancelAnimationFrame(rafId);
  }, [nodes.length, nodesInitialized, hasFittedView, fitView]);

  useEffect(() => {
    if (fitViewRequest === 0) return;
    setTimeout(() => fitView({ duration: 500, padding: 0.12 }), 0);
  }, [fitViewRequest, fitView]);

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      codeNode: CodeNode,
      brokenNode: BrokenContractNode,
      clusterNode: ClusterNode,
      clusterOverflowNode: ClusterOverflowNode,
    }),
    []
  );


  const edgeTypes: EdgeTypes = useMemo(() => ({ dependencyEdge: DependencyEdge, contractEdge: ContractEdge }), []);


  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    // Cluster containers should toggle expansion instead of selecting like a file node.
    if ((node as any).type === 'clusterNode') {
      const clusterId = (node as any).data?.clusterId as string | undefined;
      if (clusterId) {
        toggleCluster(clusterId);
        // Give ReactFlow time to remount children before fitting the view
        setTimeout(() => fitView({ duration: 400, padding: 0.12 }), 80);
      }
      return;
    }

    setSelectedNodeId(node.id);
  }, [setSelectedNodeId, toggleCluster, fitView]);


  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const [knownBrokenIds, setKnownBrokenIds] = useState<Set<string>>(new Set());

  // Focus the camera on newly added broken contracts
  useEffect(() => {
    const brokenNodes = nodes.filter(n => n.type === 'brokenNode');
    const currentBrokenIds = new Set(brokenNodes.map(n => n.id));
    
    // Find if there are any NEW broken IDs that weren't in knownBrokenIds
    const newBrokenNodes = brokenNodes.filter(n => !knownBrokenIds.has(n.id));
    
    if (newBrokenNodes.length > 0) {
      // Focus the newly added broken node so the user can immediately see the broken contract error
      const brokenNode = newBrokenNodes[newBrokenNodes.length - 1];
      // Use a wider zoom (0.8) so they can see context, not 1.0/too large
      setCenter(brokenNode.position.x + 100, brokenNode.position.y + 40, { zoom: 0.8, duration: 800 });
    }
    
    setKnownBrokenIds(currentBrokenIds);
  }, [nodes, setCenter, knownBrokenIds]);

  // Improvement 3 minimal milestone:
  // - clusterNode renders containers, but actual backend-side clustering isn't wired yet.
  // - we hide non-cluster nodes when their computed clusterId is collapsed.
  const expandedSet = useMemo(() => new Set(expandedClusters), [expandedClusters]);

  const visibleNodes = useMemo(() => {
    return nodes.filter(n => {
      if (n.type === 'clusterNode') return true;
      if (n.data?.alwaysVisible) return true;
      const clusterId = n.data?.clusterId;
      if (!clusterId) return true;
      return expandedSet.has(clusterId);
    });
  }, [nodes, expandedSet]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes]);

  const visibleEdges = useMemo(() => {
    // Deduplicate edges that got remapped to the same (source, target, type) triple
    const seen = new Set<string>();

    const allEdges = [...edges, ...removedEdgeGhosts];

    const remapped = allEdges.map(e => {
      const srcNode = nodes.find(n => n.id === e.source);
      const tgtNode = nodes.find(n => n.id === e.target);

      let sourceId = e.source;
      let targetId = e.target;

      const isBrokenTarget = targetId.startsWith('broken_contract:') || targetId.startsWith('MISSING_API:');

      if (srcNode?.data?.clusterId && !expandedSet.has(srcNode.data.clusterId)) {

        sourceId = srcNode.data.clusterId;
      }
      if (tgtNode?.data?.clusterId && !expandedSet.has(tgtNode.data.clusterId)) {
        targetId = tgtNode.data.clusterId;
      }

      return {
        ...e,
        source: sourceId,
        target: targetId,
        data: { ...e.data, isBrokenTarget, isBroken: (e.data as any)?.isBroken === true || isBrokenTarget },
      };

    });

    const filteredEdges = remapped.filter(e => {
      // Toggle filters
      if (e.type === 'dependencyEdge' && !showDependencyEdges) return false;
      if (e.type === 'contractEdge' && !showContractEdges) return false;

      const isBrokenEdge = (e.data as any)?.isBrokenTarget === true || (e.data as any)?.isBroken === true;
      if (isBrokenEdge) {
        return true;
      }

      // Node visibility — broken target nodes are always in visibleNodeIds (alwaysVisible)
      if (!visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)) return false;

      // Deduplicate collapsed-cluster remaps
      const dedupeKey = `${e.source}|${e.target}|${e.type}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);

      return true;
    });

    // Track edges between the same (source, target) pair to offset parallel edges
    // Sort the pair to ensure A->B and B->A are grouped together
    const pairCount = new Map<string, number>();
    const pairIndex = new Map<string, number>();

    filteredEdges.forEach(e => {
      const arr = [e.source, e.target].sort();
      const key = `${arr[0]}|${arr[1]}|${e.type}`;
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
    });


    return filteredEdges.map(e => {
      // Assign a per-(source,target,type) index so we can stagger parallel edges
      const arr = [e.source, e.target].sort();
      const pairKey = `${arr[0]}|${arr[1]}|${e.type}`;
      const idx = pairIndex.get(pairKey) ?? 0;
      pairIndex.set(pairKey, idx + 1);
      const total = pairCount.get(pairKey) ?? 1;


      // Offset amount: spread edges ±20px around center when there are multiples
      const offset = total > 1 ? (idx - (total - 1) / 2) * 40 : 0;

      return {
        ...e,
        // Pass offset into data so edge components can use it
        data: { ...e.data, edgeOffset: offset },
      };
    });
  }, [edges, removedEdgeGhosts, nodes, expandedSet, visibleNodeIds, showDependencyEdges, showContractEdges]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <ErrorBoundary>
        <ReactFlow

        nodes={visibleNodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}

        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_, node) => {
          if ((node as any).type === 'clusterNode') return;
          const nodeId = node.id;
          vscode.postMessage({ type: 'REQUEST_BLAST_RADIUS', payload: { nodeId } } as any);
        }}
        onNodeMouseLeave={() => {
          useGraphStore.getState().clearBlastHighlight();
        }}
        onPaneClick={onPaneClick}
        minZoom={0.05}
        maxZoom={4}
      >

        <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="var(--vscode-editorLineNumber-foreground)" />
        <MiniMap 
          nodeStrokeColor="var(--vscode-panel-border)"
          nodeColor="var(--vscode-editor-background)"
          maskColor="var(--vscode-editorWidget-background)"
        />
        <Controls showInteractive={true} />
      </ReactFlow>
      </ErrorBoundary>
      <div style={{ position: 'absolute', top: 10, left: 10, background: 'var(--vscode-editor-background)', color: 'var(--vscode-editor-foreground)', padding: '5px 10px', border: '1px solid var(--vscode-panel-border)', zIndex: 1000, borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center' }}>
        <span>Live Map Nodes: {nodes.length}</span> <span className="ml-2 text-gray-500">(Cmd+K to search)</span>
        <span className="ml-3 text-gray-400">Score: {quizScore.correct}/{quizScore.correct + quizScore.incorrect}</span>
        <div style={{ width: '1px', height: '14px', background: 'var(--vscode-panel-border)', margin: '0 10px' }} />
        <button
          type="button"
          onClick={() => fitView({ duration: 600, padding: 0.12 })}
          className="px-2 py-1 mr-3 rounded border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
        >
          Center Graph
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', marginRight: 10 }}>
          <input type="checkbox" checked={showDependencyEdges} onChange={e => setShowDependencyEdges(e.target.checked)} />
          Folder Edges
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={showContractEdges} onChange={e => setShowContractEdges(e.target.checked)} />
          API Call Edges
        </label>
      </div>
      <NodeSidebar />
      <SearchCommandPalette />
    </div>
  );
};
