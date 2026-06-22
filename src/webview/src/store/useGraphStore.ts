import { create } from 'zustand';
import { Node, Edge, OnNodesChange, OnEdgesChange, applyNodeChanges, applyEdgeChanges } from 'reactflow';

interface GraphState {
  nodes: Node[];
  edges: Edge[];
  removedEdgeGhosts: Edge[];
  selectedNodeId: string | null;
  activeEditorPath: string | null;
  brokenContracts: string[];
  diffState: {
    addedEdges: string[];
    removedEdges: string[];
  } | null;


  // Edge toggles
  showDependencyEdges: boolean;
  showContractEdges: boolean;
  setShowDependencyEdges: (show: boolean) => void;
  setShowContractEdges: (show: boolean) => void;

  // Improvement 4: blast radius hover
  highlightedNodeIds: string[];
  highlightedEdgeIds: string[];
  setBlastHighlight: (nodeIds: string[], edgeIds: string[]) => void;
  clearBlastHighlight: () => void;



  // Improvement 3: folder clustering
  expandedClusters: string[]; // store as array for zustand serialization
  setExpandedClusters: (clusterIds: string[]) => void;
  toggleCluster: (clusterId: string) => void;







  isQuizActive: boolean;
  quizScore: { correct: number; incorrect: number };
  questionHistory: string[];
  diagnostics: Record<string, import('../../../types').NodeDiagnostic>;
  setGraphData: (nodes: Node[], edges: Edge[]) => void;
  setRemovedEdgeGhosts: (edges: Edge[]) => void;
  setDiagnostics: (diagnostics: Record<string, import('../../../types').NodeDiagnostic>) => void;
  setSelectedNodeId: (id: string | null) => void;
  setActiveEditorPath: (path: string | null) => void;
  setBrokenContracts: (contracts: string[]) => void;
  setDiffState: (diff: { addedEdges: string[], removedEdges: string[] } | null) => void;
  setQuizActive: (active: boolean) => void;
  incrementQuizScore: (correct: boolean) => void;
  resetQuizScore: () => void;
  addQuestionHistory: (questionHash: string) => void;
  fitViewRequest: number;
  requestFitView: () => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
}

const readQuizScore = (): { correct: number; incorrect: number } => {
  try {
    const raw = window.localStorage.getItem('blueprint.quizScore');
    if (!raw) return { correct: 0, incorrect: 0 };
    const parsed = JSON.parse(raw);
    return {
      correct: Number(parsed.correct) || 0,
      incorrect: Number(parsed.incorrect) || 0,
    };
  } catch {
    return { correct: 0, incorrect: 0 };
  }
};

const persistQuizScore = (score: { correct: number; incorrect: number }) => {
  try {
    window.localStorage.setItem('blueprint.quizScore', JSON.stringify(score));
  } catch {
    // ignore storage errors in restricted environments
  }
};

const readQuestionHistory = (): string[] => {
  try {
    const raw = window.localStorage.getItem('blueprint.questionHistory');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
};

const persistQuestionHistory = (history: string[]) => {
  try {
    window.localStorage.setItem('blueprint.questionHistory', JSON.stringify(history.slice(-10)));
  } catch {
    // ignore storage errors in restricted environments
  }
};

export const useGraphStore = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  removedEdgeGhosts: [],
  selectedNodeId: null,
  activeEditorPath: null,
  brokenContracts: [],
  diffState: null,

  expandedClusters: [],
  quizScore: readQuizScore(),
  questionHistory: readQuestionHistory(),
  fitViewRequest: 0,

  // When the graph initially loads, we want at least one folder cluster expanded
  // so users see real code nodes (not only containers).
  // App.tsx will also expand clusters based on incoming graph data.
  showDependencyEdges: true,
  showContractEdges: true,
  setShowDependencyEdges: (show) => set({ showDependencyEdges: show }),
  setShowContractEdges: (show) => set({ showContractEdges: show }),

  highlightedNodeIds: [],
  highlightedEdgeIds: [],
  setBlastHighlight: (nodeIds, edgeIds) => {
    set({ highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds });
  },
  clearBlastHighlight: () => {
    set({ highlightedNodeIds: [], highlightedEdgeIds: [] });
  },
  setExpandedClusters: (clusterIds: string[]) => {
    set({ expandedClusters: Array.from(new Set(clusterIds)) });
  },

  toggleCluster: (clusterId) => {

    const expanded = new Set(get().expandedClusters);
    if (expanded.has(clusterId)) {
      expanded.delete(clusterId);
    } else {
      expanded.add(clusterId);
    }
    set({ expandedClusters: Array.from(expanded) });
  },

  isQuizActive: false,
  diagnostics: {},
  setGraphData: (nodes, edges) => set({ nodes, edges }),
  setRemovedEdgeGhosts: (removedEdgeGhosts) => set({ removedEdgeGhosts }),
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setActiveEditorPath: (path) => set({ activeEditorPath: path }),
  setBrokenContracts: (contracts) => set({ brokenContracts: contracts }),
  setDiffState: (diff) => set({ diffState: diff }),
  setQuizActive: (active) => set({ isQuizActive: active }),
  incrementQuizScore: (correct) => {
    const next = correct
      ? { ...get().quizScore, correct: get().quizScore.correct + 1 }
      : { ...get().quizScore, incorrect: get().quizScore.incorrect + 1 };
    set({ quizScore: next });
    persistQuizScore(next);
  },
  resetQuizScore: () => {
    const next = { correct: 0, incorrect: 0 };
    set({ quizScore: next });
    persistQuizScore(next);
  },
  addQuestionHistory: (questionHash) => {
    const next = Array.from(new Set([...get().questionHistory, questionHash])).slice(-10);
    set({ questionHistory: next });
    persistQuestionHistory(next);
  },
  requestFitView: () => {
    set({ fitViewRequest: get().fitViewRequest + 1 });
  },
  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },
}));
