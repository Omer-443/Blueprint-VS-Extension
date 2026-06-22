import { Edge, Node } from 'reactflow';

export type QuizType = 'BLAST_RADIUS' | 'DATA_FLOW_TRACE' | 'ARCHITECTURAL_SMELL';

export type QuizOption = {
  id: string;
  label: string;
};

export type QuizQuestion = {
  id: string;
  type: QuizType;
  questionText: string;
  options: QuizOption[];
  correctAnswerIds: string[];
  explanation: string;
  focusNodeIds: string[];
  focusEdgeIds: string[];
};

type NodeData = {
  label?: string;
  filePath?: string;
  isReactComponent?: boolean;
  clusterId?: string;
  alwaysVisible?: boolean;
};

type GraphNode = Node<NodeData>;
type GraphEdge = Edge & { data?: { endpoint?: string; isBroken?: boolean; isBrokenTarget?: boolean } };

function pickRandom<T>(arr: T[], count: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (copy.length && out.length < count) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function hashQuestionText(questionText: string): string {
  let hash = 2166136261;
  for (let i = 0; i < questionText.length; i++) {
    hash ^= questionText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isCodeNode(node: GraphNode): boolean {
  return node.type === 'codeNode' || !node.type;
}

function pathLabel(node: GraphNode): string {
  return node.data?.label || node.data?.filePath || node.id;
}

function filePath(node: GraphNode): string {
  return node.data?.filePath || node.id;
}

function segmentMatch(value: string, segment: string): boolean {
  return value.toLowerCase().includes(segment);
}

function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  edges.forEach(edge => {
    if (!map.has(edge.source)) map.set(edge.source, []);
    map.get(edge.source)!.push(edge.target);
  });
  return map;
}

function buildReverseAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  edges.forEach(edge => {
    if (!map.has(edge.target)) map.set(edge.target, []);
    map.get(edge.target)!.push(edge.source);
  });
  return map;
}

function bfsPath(start: string, target: string, adjacency: Map<string, string[]>): string[] {
  if (start === target) return [start];

  const queue: string[] = [start];
  const visited = new Set([start]);
  const parent = new Map<string, string>();

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      parent.set(next, current);
      if (next === target) {
        const path: string[] = [target];
        let cursor = target;
        while (cursor !== start) {
          cursor = parent.get(cursor)!;
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(next);
    }
  }

  return [];
}

function descendantsFrom(start: string, adjacency: Map<string, string[]>): string[] {
  const queue = [start];
  const visited = new Set<string>([start]);
  const out: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      out.push(next);
      queue.push(next);
    }
  }

  return out;
}

function ancestorChain(start: string, reverseAdjacency: Map<string, string[]>): string[] {
  const queue = [start];
  const visited = new Set<string>([start]);
  const out: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    for (const prev of reverseAdjacency.get(current) ?? []) {
      if (visited.has(prev)) continue;
      visited.add(prev);
      out.push(prev);
      queue.push(prev);
    }
  }

  return out;
}

function edgeIdsForPath(path: string[], edges: GraphEdge[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const current = path[i];
    const next = path[i + 1];
    const match = edges.find(e => e.source === current && e.target === next);
    if (match) out.push(match.id);
  }
  return out;
}

export class QuizGenerator {
  public generateQuiz(nodes: Node[], edges: Edge[], selectedNodeId: string | null, questionHistory: string[] = []): QuizQuestion | null {
    const graphNodes = nodes.filter(isCodeNode) as GraphNode[];
    const graphEdges = edges as GraphEdge[];
    if (graphNodes.length === 0) return null;

    const selectedNode = selectedNodeId ? graphNodes.find(n => n.id === selectedNodeId) ?? null : null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const smell = this.generateArchitecturalSmellQuestion(graphNodes, graphEdges, questionHistory);
      if (smell) return smell;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const dataFlow = this.generateDataFlowTraceQuestion(graphNodes, graphEdges, selectedNode, questionHistory);
      if (dataFlow) return dataFlow;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const blast = this.generateBlastRadiusQuestion(graphNodes, graphEdges, selectedNode, questionHistory);
      if (blast) return blast;
    }

    return null;
  }

  private generateBlastRadiusQuestion(nodes: GraphNode[], edges: GraphEdge[], selectedNode: GraphNode | null, questionHistory: string[]): QuizQuestion | null {
    const dependencyEdges = edges.filter(e => e.type !== 'contractEdge');
    const adjacency = buildAdjacency(dependencyEdges);

    const candidates = nodes.filter(node => {
      const descendants = descendantsFrom(node.id, adjacency);
      const ancestors = ancestorChain(node.id, buildReverseAdjacency(dependencyEdges));
      return descendants.length >= 2 && ancestors.length >= 1;
    });

    const target = selectedNode && candidates.some(n => n.id === selectedNode.id)
      ? selectedNode
      : candidates[Math.floor(Math.random() * candidates.length)] ?? null;
    if (!target) return null;

    const descendants = descendantsFrom(target.id, adjacency)
      .map(id => nodes.find(n => n.id === id))
      .filter((n): n is GraphNode => !!n && isCodeNode(n));

    if (descendants.length === 0) return null;

    const correctNode = descendants[0];
    const distractors = nodes.filter(n =>
      n.id !== target.id &&
      n.id !== correctNode.id &&
      !descendants.some(d => d.id === n.id)
    );

    const optionNodes = unique([
      correctNode.id,
      ...pickRandom(distractors, 3).map(n => n.id),
    ]).map(id => {
      const node = nodes.find(n => n.id === id)!;
      return { id, label: pathLabel(node) };
    });

    const focusNodeIds = unique([target.id, correctNode.id]);
    const focusEdgeIds = edgeIdsForPath(bfsPath(target.id, correctNode.id, adjacency), dependencyEdges);

    const question: QuizQuestion = {
      id: `quiz-${target.id}-blast`,
      type: 'BLAST_RADIUS',
      questionText: `If ${pathLabel(target)} is deleted, which downstream file is immediately impacted?`,
      options: shuffleArray(optionNodes),
      correctAnswerIds: [correctNode.id],
      explanation: `${pathLabel(target)} depends on ${pathLabel(correctNode)} through the import graph.`,
      focusNodeIds,
      focusEdgeIds,
    };

    return questionHistory.includes(hashQuestionText(question.questionText)) ? null : question;
  }

  private generateDataFlowTraceQuestion(nodes: GraphNode[], edges: GraphEdge[], selectedNode: GraphNode | null, questionHistory: string[]): QuizQuestion | null {
    const contractEdges = edges.filter(e => e.type === 'contractEdge');
    const dependencyEdges = edges.filter(e => e.type !== 'contractEdge');
    const adjacency = buildAdjacency(dependencyEdges);

    const componentCandidates = nodes.filter(node =>
      node.data?.isReactComponent === true || /component/i.test(filePath(node))
    );

    const component = selectedNode && componentCandidates.some(n => n.id === selectedNode.id)
      ? selectedNode
      : componentCandidates[Math.floor(Math.random() * componentCandidates.length)] ?? null;
    if (!component) return null;

    const firstHop = contractEdges.find(edge => edge.source === component.id);
    if (!firstHop) return null;

    const routeNode = nodes.find(n => n.id === firstHop.target) ?? null;
    if (!routeNode) return null;

    const routeDescendants = descendantsFrom(routeNode.id, adjacency)
      .map(id => nodes.find(n => n.id === id))
      .filter((n): n is GraphNode => !!n && isCodeNode(n));

    const modelCandidate = routeDescendants.find(node =>
      /model|database|db|schema|repository|service/i.test(filePath(node))
    ) ?? routeDescendants[0];
    if (!modelCandidate) return null;

    const distractors = nodes.filter(n =>
      n.id !== modelCandidate.id &&
      n.id !== component.id &&
      n.id !== routeNode.id &&
      !routeDescendants.some(d => d.id === n.id)
    );

    const optionNodes = unique([
      modelCandidate.id,
      ...pickRandom(distractors, 3).map(n => n.id),
    ]).map(id => {
      const node = nodes.find(n => n.id === id)!;
      return { id, label: pathLabel(node) };
    });

    const path = bfsPath(routeNode.id, modelCandidate.id, adjacency);
    const focusNodeIds = unique([component.id, routeNode.id, modelCandidate.id]);
    const focusEdgeIds = unique([firstHop.id, ...edgeIdsForPath(path, dependencyEdges)]);

    const question: QuizQuestion = {
      id: `quiz-${component.id}-dataflow`,
      type: 'DATA_FLOW_TRACE',
      questionText: `When ${pathLabel(component)} loads, which database or service file is ultimately reached?`,
      options: shuffleArray(optionNodes),
      correctAnswerIds: [modelCandidate.id],
      explanation: `${pathLabel(component)} calls ${pathLabel(routeNode)}, which eventually reaches ${pathLabel(modelCandidate)}.`,
      focusNodeIds,
      focusEdgeIds,
    };

    return questionHistory.includes(hashQuestionText(question.questionText)) ? null : question;
  }

  private generateArchitecturalSmellQuestion(nodes: GraphNode[], edges: GraphEdge[], questionHistory: string[]): QuizQuestion | null {
    const smellEdges = edges.filter(edge => {
      const source = nodes.find(n => n.id === edge.source);
      const target = nodes.find(n => n.id === edge.target);
      if (!source || !target) return false;

      const sourcePath = filePath(source).replace(/\\/g, '/').toLowerCase();
      const targetPath = filePath(target).replace(/\\/g, '/').toLowerCase();

      const sourceIsUI = sourcePath.includes('/components/') || sourcePath.includes('/pages/') || sourcePath.includes('/ui/');
      const targetIsData = targetPath.includes('/database/') || targetPath.includes('/db/') || targetPath.includes('/models/') || targetPath.includes('/data/') || targetPath.includes('/repositories/');
      return sourceIsUI && targetIsData;
    });

    if (smellEdges.length === 0) return null;

    const offendingEdge = smellEdges[Math.floor(Math.random() * smellEdges.length)];
    const offendingNode = nodes.find(n => n.id === offendingEdge.source);
    if (!offendingNode) return null;

    const candidates = nodes.filter(n => {
      const p = filePath(n).replace(/\\/g, '/').toLowerCase();
      return p.includes('/components/') || p.includes('/pages/') || p.includes('/ui/');
    });

    const distractors = candidates.filter(n => n.id !== offendingNode.id && n.id !== offendingEdge.target);
    const optionNodes = unique([
      offendingNode.id,
      ...pickRandom(distractors, 3).map(n => n.id),
    ]).map(id => {
      const node = nodes.find(n => n.id === id)!;
      return { id, label: pathLabel(node) };
    });

    const question: QuizQuestion = {
      id: `quiz-${offendingNode.id}-smell`,
      type: 'ARCHITECTURAL_SMELL',
      questionText: `Which file violates clean architecture by directly depending on the data layer?`,
      options: shuffleArray(optionNodes),
      correctAnswerIds: [offendingNode.id],
      explanation: `${pathLabel(offendingNode)} imports from ${pathLabel(nodes.find(n => n.id === offendingEdge.target) ?? offendingNode)}.`,
      focusNodeIds: [offendingNode.id, offendingEdge.target],
      focusEdgeIds: [offendingEdge.id],
    };

    return questionHistory.includes(hashQuestionText(question.questionText)) ? null : question;
  }
}
