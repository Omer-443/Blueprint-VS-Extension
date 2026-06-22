import React, { useEffect, useRef } from 'react';
import type { IPCMessage, SerializedNode, SerializedEdge } from '../../types';
import { useGraphStore } from './store/useGraphStore';
import { ThemeSyncWrapper } from './components/ThemeSyncWrapper';
import { GraphViewContainer } from './pages/GraphViewContainer';
import { Node, Edge, MarkerType, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css';


declare global {
  interface Window {
    vscode?: { postMessage: (message: IPCMessage) => void };
  }
}

declare function acquireVsCodeApi(): {
  postMessage: (message: IPCMessage) => void;
};

const vscode = window.vscode || acquireVsCodeApi();
window.vscode = vscode;

import * as dagre from 'dagre';
import { IpcValidator } from '../../IpcValidator';

// ─── Layout constants ───────────────────────────────────────────────────────
const NODE_W = 260;
const NODE_H = 80;
const CLUSTER_PADDING = 60;   // padding inside a cluster bounding box
const CLUSTER_TOP_PAD = 90;   // extra top room for the cluster header bar
const CLUSTER_GAP = 120;      // minimum gap between adjacent cluster boxes

/**
 * Two-pass hierarchical layout:
 *
 * Pass 1 – intra-cluster: for each folder cluster, run a compact dagre
 *           sub-graph to position its children relative to (0,0).
 *
 * Pass 2 – inter-cluster: create one virtual "representative" node per
 *           cluster sized to the cluster's bounding box, run a top-level
 *           dagre graph to place representatives so they never overlap,
 *           then offset each cluster's children by the representative position.
 *
 * Stand-alone nodes (no clusterId) are included in the top-level graph
 * directly alongside the representatives.
 */
const getLayoutedElements = (
  nodes: Node[],
  edges: Edge[]
): {
  nodes: Node[];
  edges: Edge[];
  clusterOrigins: Map<string, { x: number; y: number }>;
  clusterBounds: Map<string, { w: number; h: number }>;
} => {
  // ── Group nodes by cluster ──────────────────────────────────────────────
  const clusterMap = new Map<string, Node[]>();   // clusterId → children
  const standaloneNodes: Node[] = [];

  nodes.forEach(n => {
    const cid = n.data?.clusterId as string | undefined;
    if (cid) {
      if (!clusterMap.has(cid)) clusterMap.set(cid, []);
      clusterMap.get(cid)!.push(n);
    } else {
      standaloneNodes.push(n);
    }
  });

  // Build a fast edge lookup: source → targets, target → sources
  const edgesBySrc = new Map<string, string[]>();
  const edgesByTgt = new Map<string, string[]>();
  edges.forEach(e => {
    if (!edgesBySrc.has(e.source)) edgesBySrc.set(e.source, []);
    edgesBySrc.get(e.source)!.push(e.target);
    if (!edgesByTgt.has(e.target)) edgesByTgt.set(e.target, []);
    edgesByTgt.get(e.target)!.push(e.source);
  });

  // ── Pass 1: layout children within each cluster ─────────────────────────
  // Returns Map<nodeId, {x,y}> with positions relative to (0,0) of the cluster
  const clusterLocalPositions = new Map<string, Map<string, { x: number; y: number }>>();
  const clusterSizes = new Map<string, { w: number; h: number }>();

  clusterMap.forEach((children, clusterId) => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80, marginx: CLUSTER_PADDING, marginy: CLUSTER_PADDING });

    children.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));

    // Only add intra-cluster edges for Pass 1
    edges.forEach(e => {
      const srcCluster = nodes.find(n => n.id === e.source)?.data?.clusterId;
      const tgtCluster = nodes.find(n => n.id === e.target)?.data?.clusterId;
      if (srcCluster === clusterId && tgtCluster === clusterId) {
        g.setEdge(e.source, e.target);
      }
    });

    dagre.layout(g);

    const localPos = new Map<string, { x: number; y: number }>();
    let maxX = 0, maxY = 0;

    children.forEach(n => {
      const pos = g.node(n.id);
      const lx = pos.x - NODE_W / 2;
      const ly = pos.y - NODE_H / 2 + CLUSTER_TOP_PAD;
      localPos.set(n.id, { x: lx, y: ly });
      if (lx + NODE_W > maxX) maxX = lx + NODE_W;
      if (ly + NODE_H > maxY) maxY = ly + NODE_H;
    });

    clusterLocalPositions.set(clusterId, localPos);
    clusterSizes.set(clusterId, {
      w: maxX + CLUSTER_PADDING,
      h: maxY + CLUSTER_PADDING,
    });
  });

  // ── Pass 2: layout clusters + standalone nodes at the top level ──────────
  const topG = new dagre.graphlib.Graph();
  topG.setDefaultEdgeLabel(() => ({}));
  topG.setGraph({ rankdir: 'TB', nodesep: CLUSTER_GAP, ranksep: CLUSTER_GAP * 1.5 });

  // Add a representative node for each cluster
  clusterMap.forEach((_, clusterId) => {
    const sz = clusterSizes.get(clusterId)!;
    topG.setNode(clusterId, { width: sz.w, height: sz.h });
  });

  // Add standalone nodes
  standaloneNodes.forEach(n => {
    topG.setNode(n.id, { width: NODE_W, height: NODE_H });
  });

  // Add inter-cluster edges (collapse intra-cluster edges to cluster→cluster)
  const addedTopEdges = new Set<string>();
  edges.forEach(e => {
    const srcCluster = nodes.find(n => n.id === e.source)?.data?.clusterId ?? e.source;
    const tgtCluster = nodes.find(n => n.id === e.target)?.data?.clusterId ?? e.target;
    if (srcCluster === tgtCluster) return; // skip intra-cluster
    const key = `${srcCluster}→${tgtCluster}`;
    if (addedTopEdges.has(key)) return;
    addedTopEdges.add(key);
    // Only add the edge if both nodes exist in the top graph
    if (topG.hasNode(srcCluster) && topG.hasNode(tgtCluster)) {
      topG.setEdge(srcCluster, tgtCluster);
    }
  });

  dagre.layout(topG);

  // ── Assemble final positions ─────────────────────────────────────────────
  const finalPositions = new Map<string, { x: number; y: number }>();

  clusterMap.forEach((children, clusterId) => {
    const rep = topG.node(clusterId);
    const sz = clusterSizes.get(clusterId)!;
    const clusterOriginX = rep.x - sz.w / 2;
    const clusterOriginY = rep.y - sz.h / 2;

    // Store cluster origin so injectClusters can use it
    finalPositions.set(clusterId, { x: clusterOriginX, y: clusterOriginY });

    const localPos = clusterLocalPositions.get(clusterId)!;
    children.forEach(n => {
      const lp = localPos.get(n.id) ?? { x: 0, y: 0 };
      finalPositions.set(n.id, { x: lp.x, y: lp.y }); // relative to cluster, used by injectClusters
    });
  });

  standaloneNodes.forEach(n => {
    const rep = topG.node(n.id);
    finalPositions.set(n.id, { x: rep.x - NODE_W / 2, y: rep.y - NODE_H / 2 });
  });

  // ── Produce output node array ────────────────────────────────────────────
  const layoutedNodes = nodes.map(n => ({
    ...n,
    position: finalPositions.get(n.id) ?? n.position,
  }));

  // clusterOrigins and clusterBounds are the two maps injectClusters needs
  // to place cluster frame nodes at the right absolute positions.
  const clusterOrigins = new Map<string, { x: number; y: number }>();
  const clusterBounds = new Map<string, { w: number; h: number }>();

  clusterMap.forEach((_, clusterId) => {
    clusterOrigins.set(clusterId, finalPositions.get(clusterId) ?? { x: 0, y: 0 });
    clusterBounds.set(clusterId, clusterSizes.get(clusterId) ?? { w: 400, h: 300 });
  });

  return { nodes: layoutedNodes, edges, clusterOrigins, clusterBounds };
};

const convertBackendNodesToReactFlow = (backendNodes: SerializedNode[]): Node[] => {
  return backendNodes.map((bNode) => {
    const isBroken = bNode.id.startsWith('broken_contract:') || bNode.id.startsWith('MISSING_API:');
    return {
      id: bNode.id,
      type: isBroken ? 'brokenNode' : 'codeNode',
      position: { x: 0, y: 0 },
      data: {
        label: bNode.label,
        filePath: bNode.metadata?.filePath,
        isReactComponent: bNode.metadata?.isReactComponent,
        lineCount: bNode.metadata?.lineCount,
        // Broken/dummy nodes MUST NOT have a clusterId — they should always be
        // standalone visible nodes regardless of cluster collapse state.
        clusterId: isBroken ? undefined : bNode.clusterId,
        alwaysVisible: isBroken,
      }
    };
  });
};


const convertBackendEdgesToReactFlow = (backendEdges: SerializedEdge[]): Edge[] => {
  return backendEdges.map(bEdge => {
    const isBroken = bEdge.target.startsWith('MISSING_API:') || bEdge.target.startsWith('broken_contract:');
    return {
      id: bEdge.id,
      source: bEdge.source,
      target: bEdge.target,
      // smoothstep gives clean orthogonal L-shaped routing — edges never cut through nodes
      type: bEdge.type === 'CONTRACT' ? 'contractEdge' : 'dependencyEdge',
      data: { endpoint: bEdge.endpoint, isBroken },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isBroken ? '#ef4444' : bEdge.type === 'CONTRACT' ? '#22d3ee' : 'var(--vscode-editorLineNumber-foreground)'
      },
      // pathOptions tells smoothstep to use a generous border radius
      pathOptions: { borderRadius: 20 },
    };
  });
};

const collectChangedNodeIds = (diff: any): Set<string> => {
  const ids = new Set<string>();
  if (!diff) return ids;

  (diff.addedNodes ?? []).forEach((node: any) => node?.id && ids.add(node.id));
  (diff.removedNodes ?? []).forEach((id: string) => id && ids.add(id));
  (diff.modifiedNodes ?? []).forEach((node: any) => node?.id && ids.add(node.id));
  (diff.addedEdges ?? []).forEach((edge: any) => {
    if (edge?.source) ids.add(edge.source);
    if (edge?.target) ids.add(edge.target);
  });
  (diff.removedEdges ?? []).forEach((edgeId: string) => edgeId && ids.add(edgeId));
  (diff.modifiedEdges ?? []).forEach((edge: any) => {
    if (edge?.source) ids.add(edge.source);
    if (edge?.target) ids.add(edge.target);
  });

  return ids;
};

const collectAffectedClusters = (nodes: Node[], changedNodeIds: Set<string>): Set<string> => {
  const affected = new Set<string>();
  if (changedNodeIds.size === 0) return affected;

  nodes.forEach(node => {
    if (!changedNodeIds.has(node.id)) return;
    const clusterId = node.data?.clusterId as string | undefined;
    if (clusterId) {
      affected.add(clusterId);
    }
    if (node.type === 'clusterNode') {
      affected.add(node.id);
    }
  });

  return affected;
};

/**
 * injectClusters – wraps layouted child nodes inside ReactFlow parent (clusterNode) nodes.
 *
 * After the two-pass layout, child node positions are already LOCAL (relative to the
 * cluster origin stored in clusterOrigins). We just need to:
 *  1. Create the clusterNode at the cluster origin with the right bounding-box size.
 *  2. Set each child's parentNode and keep its already-relative position.
 */
const injectClusters = (
  nodes: Node[],
  toggleCluster: (id: string) => void,
  clusterOrigins: Map<string, { x: number; y: number }>,
  clusterBounds: Map<string, { w: number; h: number }>,
  expandedClusterIds: string[],
  diagnostics: Record<string, import('../../types').NodeDiagnostic>
): Node[] => {
  const clusterGroups = new Map<string, Node[]>();
  const nonClusterNodes: Node[] = [];

  nodes.forEach(n => {
    const cid = n.data?.clusterId as string | undefined;
    if (cid) {
      if (!clusterGroups.has(cid)) clusterGroups.set(cid, []);
      clusterGroups.get(cid)!.push(n);
    } else {
      nonClusterNodes.push(n);
    }
  });

  const finalNodes: Node[] = [];

  clusterGroups.forEach((children, clusterId) => {
    const origin = clusterOrigins.get(clusterId) ?? { x: 0, y: 0 };
    const bounds = clusterBounds.get(clusterId) ?? { w: 400, h: 300 };
    const MAX_VISIBLE_CHILDREN = 10;
    const hasOverflow = children.length > 15;
    const visibleChildren = hasOverflow ? children.slice(0, MAX_VISIBLE_CHILDREN) : children;
    const hiddenCount = hasOverflow ? children.length - MAX_VISIBLE_CHILDREN : 0;
    const isCollapsed = !expandedClusterIds.includes(clusterId);
    const childFilePaths = children
      .map(child => child.data?.filePath)
      .filter((filePath): filePath is string => Boolean(filePath));
    const childErrorCount = children.reduce((count, child) => {
      const filePath = child.data?.filePath;
      const diag = filePath ? diagnostics[filePath] : undefined;
      return count + (diag?.errorCount ?? 0);
    }, 0);

    const clusterNode: Node = {
      id: clusterId,
      type: 'clusterNode',
      position: origin,
      data: {
        clusterId,
        label: clusterId.split('::cluster:').pop() || clusterId.replace('cluster:', ''),
        childCount: children.length,
        errorCount: childErrorCount,
        childFilePaths,
        isCollapsed,
        toggleCluster,
      },
      style: {
        width: bounds.w,
        height: bounds.h,
        zIndex: -1,
      },
      // Prevent cluster containers from being dragged into weird places by user
      selectable: true,
      draggable: true,
    };

    finalNodes.push(clusterNode);

    visibleChildren.forEach(child => {
      finalNodes.push({
        ...child,
        parentNode: clusterId,
        extent: 'parent',
        // position is already local (relative to cluster origin) from two-pass layout
        style: { ...child.style, zIndex: 1 },
      });
    });

    if (hasOverflow) {
      finalNodes.push({
        id: `${clusterId}::__overflow`,
        type: 'clusterOverflowNode',
        position: { x: 20, y: bounds.h - 130 },
        parentNode: clusterId,
        extent: 'parent',
        data: {
          clusterId,
          hiddenCount,
          toggleCluster,
        },
        style: { zIndex: 2 },
        selectable: true,
        draggable: false,
      } as Node);
    }
  });

  return [...finalNodes, ...nonClusterNodes];
};

const App: React.FC = () => {
  const { setGraphData, setDiagnostics, toggleCluster } = useGraphStore();
  const previousBackendSignatureRef = useRef<string>('');
  const previousFinalPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    console.log('[webview] App mounted');
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as IPCMessage;
      if (!IpcValidator.isValidMessage(message)) return;
      
      console.log(`[Webview] Received message: ${message.type}`, message.payload?.diff ? 'with diff' : 'full snapshot');
      if (message.type === 'INITIAL_GRAPH_LOAD' || message.type === 'INCREMENTAL_GRAPH_UPDATE') {
        vscode.postMessage({ type: 'DEBUG_LOG', payload: `Received ${message.type} with ${message.payload.nodes?.length} backend nodes and ${message.payload.edges?.length} backend edges` } as any);
        try {
          const rfNodes = convertBackendNodesToReactFlow(message.payload.nodes);
          const rfEdges = convertBackendEdgesToReactFlow(message.payload.edges);
          vscode.postMessage({ type: 'DEBUG_LOG', payload: `Converted to ${rfNodes.length} ReactFlow nodes` } as any);
          const diagnostics = useGraphStore.getState().diagnostics;
          const expandedClusters = useGraphStore.getState().expandedClusters;
          const previousRenderedNodes = useGraphStore.getState().nodes;
          const currentBackendSignature = [...rfNodes.map(n => n.id)].sort().join('|');
          const previousPositions = previousFinalPositionsRef.current;
          const preserveAllLayout = previousBackendSignatureRef.current === currentBackendSignature && previousBackendSignatureRef.current.length > 0;
          const changedNodeIds = collectChangedNodeIds(message.payload?.diff);
          const affectedClusters = collectAffectedClusters([...rfNodes, ...previousRenderedNodes], changedNodeIds);
          const initialClusterIds = Array.from(new Set(rfNodes.map(n => n.data.clusterId).filter(Boolean))) as string[];
          const renderExpandedClusters = message.type === 'INITIAL_GRAPH_LOAD'
            ? initialClusterIds
            : expandedClusters;

          if (message.type === 'INITIAL_GRAPH_LOAD') {
            useGraphStore.getState().setExpandedClusters(initialClusterIds);
          }

          let finalNodes: Node[] = rfNodes as any;
          let finalEdges: Edge[] = rfEdges as any;

          try {
            const { nodes: layoutedNodes, edges: layoutedEdges, clusterOrigins, clusterBounds } = getLayoutedElements(rfNodes, rfEdges);
            vscode.postMessage({ type: 'DEBUG_LOG', payload: `Layouted ${layoutedNodes.length} nodes across ${clusterOrigins.size} clusters` } as any);

            const injectedNodes = injectClusters(layoutedNodes as any, toggleCluster, clusterOrigins, clusterBounds, renderExpandedClusters, diagnostics);
            if (preserveAllLayout) {
              injectedNodes.forEach(node => {
                const prev = previousPositions.get(node.id);
                if (prev) {
                  node.position = prev;
                }
              });
            } else if (previousPositions.size > 0 && message.type === 'INCREMENTAL_GRAPH_UPDATE' && message.payload?.diff) {
              injectedNodes.forEach(node => {
                const prev = previousPositions.get(node.id);
                if (!prev) return;

                const clusterId = node.data?.clusterId as string | undefined;
                const isClusterContainer = node.type === 'clusterNode';
                const shouldPreserve = isClusterContainer
                  ? !affectedClusters.has(node.id)
                  : clusterId
                    ? !affectedClusters.has(clusterId)
                    : !changedNodeIds.has(node.id);

                if (shouldPreserve) {
                  node.position = prev;
                }
              });
            }

            finalNodes = injectedNodes;
            finalEdges = layoutedEdges;
          } catch (layoutError: any) {
            vscode.postMessage({ type: 'DEBUG_LOG', payload: `Incremental layout failed, using fallback render: ${layoutError?.message ?? layoutError}` } as any);
            finalNodes = rfNodes.map(node => ({
              ...node,
              position: previousPositions.get(node.id) ?? node.position,
            }));
            finalEdges = rfEdges;
            useGraphStore.getState().requestFitView();
          }
          const previousEdges = useGraphStore.getState().edges;
          const removedGhostEdges = message.payload.diff?.removedEdges?.length
            ? previousEdges
                .filter((edge: any) => message.payload.diff.removedEdges.includes(edge.id))
                .map((edge: any) => ({
                  ...edge,
                  id: `${edge.id}::__ghost`,
                  data: { ...edge.data, originalId: edge.id, isRemoved: true },
                }))
            : [];

          // Render all nodes directly - skip cluster gating which was hiding nodes
          requestAnimationFrame(() => {
            setGraphData(finalNodes as any, finalEdges as any);
            useGraphStore.getState().setRemovedEdgeGhosts(removedGhostEdges as any);
          });
          previousBackendSignatureRef.current = currentBackendSignature;
          previousFinalPositionsRef.current = new Map(finalNodes.map(node => [node.id, node.position]));
          vscode.postMessage({ type: 'DEBUG_LOG', payload: `Called setGraphData successfully` } as any);
        } catch (e: any) {
          vscode.postMessage({ type: 'DEBUG_LOG', payload: `Error during graph rendering: ${e.message} \n ${e.stack}` } as any);
        }



        if (message.payload.brokenContracts) {
          useGraphStore.getState().setBrokenContracts(message.payload.brokenContracts);
        }
        if (message.payload.diff) {
          const addedEdgeIds = message.payload.diff.addedEdges.map((e: any) => e.id);
          const removedEdgeIds = message.payload.diff.removedEdges;
          useGraphStore.getState().setDiffState({ addedEdges: addedEdgeIds, removedEdges: removedEdgeIds });
          
          // clear diff after 2 seconds (animation duration)
          setTimeout(() => {
            useGraphStore.getState().setDiffState(null);
            useGraphStore.getState().setRemovedEdgeGhosts([]);
          }, 2000);
        } else {
          useGraphStore.getState().setRemovedEdgeGhosts([]);
        }
      } else if (message.type === 'BLAST_RADIUS_RESPONSE') {
        // Backend returns ids to highlight (blast radius)
        const nodeIds: string[] = message.payload?.nodeIds ?? [];
        const edgeIds: string[] = message.payload?.edgeIds ?? [];
        useGraphStore.getState().setBlastHighlight(nodeIds, edgeIds);
      } else if (message.type === 'UPDATE_DIAGNOSTICS') {
        setDiagnostics(message.payload);
      } else if (message.type === 'ACTIVE_EDITOR_CHANGED') {
        useGraphStore.getState().setActiveEditorPath(message.payload.filePath);
      }

    };

    window.addEventListener('message', handleMessage);
    
    // Notify backend we are ready
    vscode.postMessage({ type: 'WEBVIEW_READY', payload: null });

    return () => window.removeEventListener('message', handleMessage);
  }, [setGraphData]);

  return (
    <ReactFlowProvider>
      <ThemeSyncWrapper>
        <GraphViewContainer />
      </ThemeSyncWrapper>
    </ReactFlowProvider>
  );
};

export default App;
