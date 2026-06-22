export interface FileMetadata {
  filePath: string;
  lineCount: number;
  isEntryFile: boolean;
  isReactComponent: boolean;
  lastModified: number;
}

export interface NodeDiagnostic {
  errorCount: number;
  warningCount: number;
  messages: string[];
}

export interface ImportNode {
  source: string; // e.g., './components/Button'
  resolvedPath: string | null;
}

export interface ApiRoute {
  path: string;
  method: string;
  filePath: string;
}

export interface ApiCall {
  url: string;
  method: string;
  filePath: string;
}

export interface FileASTData {
  filePath: string;
  metadata: FileMetadata;
  imports: ImportNode[];
  apiRoutes: ApiRoute[];
  apiCalls: ApiCall[];
}

export interface SerializedNode {
  id: string;
  label: string;
  metadata: FileMetadata;
  clusterId?: string;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  type?: 'IMPORT' | 'CONTRACT';
  endpoint?: string;
}

export interface SerializedGraph {
  nodes: SerializedNode[];
  edges: SerializedEdge[];
}

export interface GraphDiff {
  addedNodes: SerializedNode[];
  removedNodes: string[];
  addedEdges: SerializedEdge[];
  removedEdges: string[];
  modifiedNodes: SerializedNode[];
  modifiedEdges: SerializedEdge[];
}

export interface HighlightPayload {
  pulseNodeIds: string[];
  animateEdgeIds: string[];
}

export interface BlastRadiusPayload {
  nodeIds: string[];
  edgeIds: string[];
}


export interface QuizQuestion {
  id: string;
  type: 'DEPENDENCY_PATH' | 'ISOLATION';
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

// IPC Protocol Typing
export type BackendMessageType = 
  | 'INITIAL_GRAPH_LOAD' 
  | 'INCREMENTAL_GRAPH_UPDATE' 
  | 'NODE_METADATA_RESPONSE' 
  | 'ACTIVE_EDITOR_CHANGED'
  | 'UPDATE_DIAGNOSTICS'
  | 'BLAST_RADIUS_RESPONSE';


export type FrontendMessageType = 
  | 'WEBVIEW_READY' 
  | 'REQUEST_NODE_METADATA' 
  | 'REQUEST_FULL_REFRESH' 
  | 'REQUEST_QUIZ_DATA'
  | 'REQUEST_BLAST_RADIUS'
  | 'DEBUG_LOG';


export interface IPCMessage {
  type: BackendMessageType | FrontendMessageType;
  payload: any;
}
