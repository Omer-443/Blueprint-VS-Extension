import { SerializedGraph, SerializedNode, SerializedEdge, GraphDiff } from '../types';

export class DiffEngine {
  private hashObject(obj: any): string {
    return JSON.stringify(obj);
  }

  public calculateDiff(oldGraph: SerializedGraph, newGraph: SerializedGraph): GraphDiff {
    const oldNodesMap = new Map(oldGraph.nodes.map(n => [n.id, n]));
    const newNodesMap = new Map(newGraph.nodes.map(n => [n.id, n]));

    const oldEdgesMap = new Map(oldGraph.edges.map(e => [e.id, e]));
    const newEdgesMap = new Map(newGraph.edges.map(e => [e.id, e]));

    const addedNodes = newGraph.nodes.filter(n => !oldNodesMap.has(n.id));
    const removedNodes = oldGraph.nodes.filter(n => !newNodesMap.has(n.id)).map(n => n.id);

    const addedEdges = newGraph.edges.filter(e => !oldEdgesMap.has(e.id));
    const removedEdges = oldGraph.edges.filter(e => !newEdgesMap.has(e.id)).map(e => e.id);

    const modifiedNodes = newGraph.nodes.filter(n => {
      const oldNode = oldNodesMap.get(n.id);
      return oldNode && this.hashObject(oldNode.metadata) !== this.hashObject(n.metadata);
    });

    const modifiedEdges = newGraph.edges.filter(e => {
      const oldEdge = oldEdgesMap.get(e.id);
      if (!oldEdge) return false;
      return oldEdge.type !== e.type || oldEdge.endpoint !== e.endpoint;
    });

    return {
      addedNodes,
      removedNodes,
      addedEdges,
      removedEdges,
      modifiedNodes,
      modifiedEdges
    };
  }
}
