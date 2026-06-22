# Blueprint Architecture Map Tool Documentation

## Overview

Blueprint is a VS Code extension that turns a workspace into a live architecture map.

It parses source files, builds a graph of files and relationships, and renders that graph in a webview so developers can inspect:

- file imports
- API routes and API calls
- broken API contract calls
- folder-based clusters
- diagnostics and syntax errors
- blast-radius impact paths
- search and selection across the graph
- quiz prompts based on the graph

Blueprint is optimized for understanding large codebases, especially when you need to answer questions like:

- What depends on this file?
- Which route satisfies this API call?
- Which endpoint is missing?
- Which folder contains the error?
- What is the blast radius if this file changes?

## Runtime Surfaces

Blueprint has two runtime halves:

1. The backend extension host
2. The webview frontend

The backend parses and maintains graph state. The webview renders and interacts with that graph.

---

## Build And Launch

### Build flow

The extension build now compiles both halves:

- `npm run compile`
- `npm run vscode:prepublish`

Both scripts run:

1. `npm run build:webview`
2. `tsc -p tsconfig.extension.json`

That means a normal compile now produces:

- `dist/extension.js`
- `dist/webview/index.html`
- `dist/webview/assets/index.js`
- `dist/webview/assets/index.css`

### Launch flow

The VS Code launch configuration runs the `compile` task before starting the extension host.

That keeps the backend bundle and webview assets in sync during local development.

### Important note

There are currently no automated test files in the repository, so `npm test` exits with "No test files found".

---

## Backend Architecture

### `src/extension.ts`

This is the extension entry point.

It:

- logs activation
- constructs `ExtensionManager`
- calls `ExtensionManager.activate(context)`
- delegates cleanup to `ExtensionManager.deactivate()`

### `src/backend/ExtensionManager.ts`

`ExtensionManager` wires together the backend services and VS Code integration points.

It is responsible for:

- reading workspace-level TypeScript and JavaScript configuration
- loading `baseUrl` and `paths` alias settings
- initializing the workspace watcher for each workspace root
- registering commands
- listening for diagnostics changes
- listening for active editor changes
- listening for live typing updates
- cleaning up state on deactivate

Commands registered:

- `blueprint.openPanel`
- `blueprint.openpanel`
- `blueprint.refreshGraph`

The lowercase alias exists so both variants resolve.

### `src/backend/WorkspaceWatcher.ts`

`WorkspaceWatcher` is the main incremental update engine.

It manages:

- per-workspace-root file watchers
- queued file updates
- debounced typing changes
- route and call indices
- contract reconciliation
- graph broadcasts
- delete handling

Important behaviors:

- one watcher is created per workspace folder
- file changes are processed through an ordered queue
- repeated typing is debounced
- contract reconciliation is also debounced
- ignored paths such as `node_modules`, `.git`, `dist`, `build`, and config files are skipped

Workspace roots are namespaced when cluster IDs are created so multi-root workspaces do not collapse into the same folder cluster namespace.

### `src/backend/ParserEngine.ts`

`ParserEngine` parses source files and extracts semantic information.

It is responsible for:

- file metadata
- import extraction
- alias-aware import resolution
- API route extraction
- API call extraction
- React component detection
- parse caching

It supports:

- relative imports
- `tsconfig.json` and `jsconfig.json` path aliases
- `baseUrl`
- wildcard alias patterns
- static string resolution from string literals, template literals, concatenations, and some identifier-bound values

If parsing or resolution fails, it falls back safely and returns an empty or partial structure instead of breaking the extension.

### `src/backend/GraphManager.ts`

`GraphManager` is the in-memory canonical graph store.

It uses Graphology to manage:

- file nodes
- import edges
- contract edges
- graph snapshots
- blast radius queries

It also keeps dummy broken-contract nodes isolated from cluster parenting so they remain visible.

### `src/backend/ContractMatcher.ts`

`ContractMatcher` compares API calls to API routes.

It uses route bucketing to avoid scanning every route for every call when possible.

Matching behavior:

- routes are grouped into prefix buckets
- calls search the most likely buckets first
- if the heuristic bucket search misses, a full scan is used as a correctness fallback

This keeps the common case faster without risking incorrect contract resolution.

### `src/backend/DiffEngine.ts`

`DiffEngine` compares graph snapshots and produces a diff.

The diff is used by the webview to animate additions and removals without forcing every update to look like a full reset.

### `src/backend/MessageBroker.ts`

`MessageBroker` is the IPC bridge between backend and webview.

It handles:

- sending initial graph loads
- sending incremental graph updates
- sending diagnostics payloads
- answering blast-radius requests
- receiving debug logs from the webview

### IPC Validation

`src/IpcValidator.ts` validates the message types accepted by the backend and webview.

This keeps the message channel from accepting unexpected payload types.

---

## Backend Data Model

### File metadata

Each parsed file produces metadata such as:

- file path
- line count
- whether it looks like a React component
- last modified time

### File nodes

Each parsed file becomes a graph node.

Node data typically includes:

- `id`
- `label`
- `metadata`
- `clusterId`

### Broken contract nodes

Missing API endpoints are represented as dummy nodes so the UI can render them explicitly instead of dropping the failure.

These nodes use IDs like:

- `broken_contract:<hash>`

They are intentionally not assigned to clusters.

### Edge types

The graph currently uses two primary edge types:

- `IMPORT`
- `CONTRACT`

---

## Workspace Flow

### Startup flow

1. VS Code activates the extension.
2. `ExtensionManager` reads alias configs.
3. `WorkspaceWatcher` initializes one watcher per workspace root.
4. Every source file is parsed.
5. `GraphManager` receives nodes and import edges.
6. `ContractMatcher` resolves API call to route relationships.
7. The backend sends a snapshot to the webview.
8. The webview converts the snapshot into React Flow data.
9. The graph is laid out and rendered.

### Live typing flow

1. A file changes in the editor.
2. The document change event is debounced.
3. The file is reparsed.
4. The node and import edges are updated.
5. Contract reconciliation is queued if route or call signatures changed.
6. A diff and updated graph snapshot are sent to the webview.

### Delete flow

1. A file or folder is deleted.
2. The backend removes matching nodes and contract edges.
3. Dirty route and call indices are cleared.
4. A full contract reconcile is scheduled.
5. The updated snapshot is broadcast.

---

## Webview Architecture

### `src/webview/src/App.tsx`

`App.tsx` is the main webview bootstrap and message router.

It:

- receives backend messages
- validates IPC payloads
- converts backend nodes and edges into React Flow objects
- lays out the graph with Dagre
- injects cluster nodes and overflow nodes
- preserves node positions when possible
- stores final rendered state in Zustand
- applies diagnostics and diff state

Current layout behavior:

- the graph uses a two-pass Dagre layout
- first pass lays out children inside each cluster
- second pass lays out clusters and standalone nodes at the top level
- on incremental updates, previously rendered positions are preserved when possible
- if layout fails, the webview falls back to a simpler render and requests a fit view

Important reality check:

- this is position-preserving incremental rendering
- it is not yet a true subgraph-only relayout engine

### `src/webview/src/pages/GraphViewContainer.tsx`

This component renders the React Flow canvas and the top-level controls.

It manages:

- visible nodes and edges
- cluster expansion and collapse
- broken-edge visibility
- node hover blast-radius requests
- center and fit controls
- node selection

### `src/webview/src/store/useGraphStore.ts`

This Zustand store is the frontend state container.

It stores:

- nodes
- edges
- removed edge ghosts
- selected node
- active editor path
- broken contracts
- diff state
- expanded clusters
- quiz activity
- quiz score
- question history
- blast-radius highlight state
- edge visibility toggles

State persistence:

- quiz score is stored in `localStorage`
- question history is stored in `localStorage`
- question history is capped to the most recent 10 hashes

### Visual Components

Key rendering components:

- `src/webview/src/components/CodeNode.tsx`
- `src/webview/src/components/BrokenContractNode.tsx`
- `src/webview/src/components/ClusterNode.tsx`
- `src/webview/src/components/ClusterOverflowNode.tsx`
- `src/webview/src/components/ContractEdge.tsx`
- `src/webview/src/components/DependencyEdge.tsx`

These components define how files, clusters, overflow indicators, broken endpoints, and edge styles appear in the graph.

---

## Graph Rendering Pipeline

### 1. Backend snapshot

The backend sends a serialized graph containing:

- nodes
- edges
- broken contract markers

### 2. React Flow conversion

The frontend converts backend records into React Flow nodes and edges.

This conversion determines:

- node type
- edge type
- cluster membership
- broken node handling
- marker styling

### 3. Dagre layout

The graph is laid out with a two-pass Dagre strategy:

1. Layout the children of each cluster
2. Layout cluster representatives and standalone nodes together

This keeps folder groups readable while still preserving dependencies.

### 4. Cluster injection

`injectClusters()` creates the cluster container nodes and attaches children to them.

For larger clusters it can also create an overflow node to represent hidden files.

### 5. Render and interact

React Flow renders:

- file nodes
- cluster containers
- overflow nodes
- broken contract nodes
- import edges
- contract edges

The user can then:

- expand or collapse clusters
- search for nodes
- highlight blast radius
- open the quiz
- center the graph manually

---

## Architecture Features

### Import graph

Blueprint renders file-to-file import relationships to show structural coupling.

### API contract graph

Blueprint extracts API endpoints and API calls, then links them with contract edges.

If a call matches a route:

- a contract edge is shown

If a call does not match:

- a broken dummy node is created
- a red contract edge points to it

### Diagnostics

VS Code diagnostics are collected and pushed into the graph UI.

This lets file nodes and folders surface syntax or type errors directly in context.

### Folder clusters

Files are grouped by folder path inside a workspace-root namespace.

Cluster behavior:

- cluster nodes represent folders
- cluster nodes can be expanded or collapsed
- large clusters can show an overflow summary

### Hover blast radius

Hovering a node can trigger a backend blast-radius calculation.

The backend returns reachable node and edge IDs, and the frontend highlights the affected path.

### Search and selection

The graph supports selection and search-oriented interactions so users can jump directly to specific files.

---

## Quiz System

### Goal

The quiz is not trivia. It is intended to test whether the graph is helping the developer build a real mental model of the codebase.

### Question categories

The generator currently supports:

1. Blast radius prediction
2. Data flow trace
3. Architectural smell detection

### Anti-repetition

The quiz system now avoids repeating recently used questions by:

- hashing question text
- storing question hashes in `questionHistory`
- limiting history to the most recent 10 hashes
- refusing to regenerate a question if its hash already exists

### Answer shuffling

Answer options are shuffled with a Fisher-Yates shuffle before rendering.

That keeps answer positions from becoming predictable.

### Quiz state

The quiz modal:

- generates a new question when the graph or selection changes
- records score locally
- highlights the relevant graph path after answering
- clears the highlight after a short delay

Files:

- `src/webview/src/quiz/QuizGenerator.ts`
- `src/webview/src/quiz/QuizModal.tsx`

---

## Performance And Safety

Blueprint uses several safeguards to avoid breaking the graph experience.

### Debounced typing

Typing events are debounced so the parser does not run on every keystroke.

### Debounced contract reconciliation

API contract matching is also debounced to avoid repeated workspace-wide churn.

### Route bucketing

The contract matcher buckets routes by path prefix to reduce the amount of work per call.

### Cached parsing

`ParserEngine` hashes file content and reuses cached parse results when the file has not changed.

### Ignored paths

The watcher ignores common generated and irrelevant directories such as:

- `node_modules`
- `.next`
- `out`
- `build`
- `dist`
- `.git`
- `.vscode`
- `coverage`

It also ignores common config files like:

- `vite.config.*`
- `webpack.config.*`
- `rollup.config.*`
- `esbuild.config.*`
- `*.config.*`

### Safe fallback behavior

When a parse, resolution, or layout step fails, the code falls back to a safe empty or simplified result rather than breaking the extension lifecycle.

---

## Implementation Notes

### Implemented from the upgrade spec

The following capabilities are implemented in the current codebase:

- alias-aware import resolution
- multi-root workspace support
- namespaced folder clustering
- incremental file update processing
- route and call indexing
- bucketed contract matching
- quiz anti-repetition
- memory cleanup on deactivate
- build flow that includes the webview bundle

### Partially implemented

Some behaviors are present, but not in the exact form described by the upgrade spec:

- the layout still recomputes with Dagre for each snapshot
- previous positions are preserved where possible
- there is not yet a true subgraph-only incremental layout pass

### Validation status

Current validation results:

- `npm.cmd run compile` passes
- `npm.cmd test` fails because there are no test files in the repository

---

## File Map

### Backend

- `src/extension.ts`
- `src/backend/ExtensionManager.ts`
- `src/backend/WorkspaceWatcher.ts`
- `src/backend/ParserEngine.ts`
- `src/backend/GraphManager.ts`
- `src/backend/ContractMatcher.ts`
- `src/backend/DiffEngine.ts`
- `src/backend/MessageBroker.ts`
- `src/IpcValidator.ts`

### Webview

- `src/webview/src/App.tsx`
- `src/webview/src/pages/GraphViewContainer.tsx`
- `src/webview/src/store/useGraphStore.ts`
- `src/webview/src/components/CodeNode.tsx`
- `src/webview/src/components/BrokenContractNode.tsx`
- `src/webview/src/components/ClusterNode.tsx`
- `src/webview/src/components/ClusterOverflowNode.tsx`
- `src/webview/src/components/ContractEdge.tsx`
- `src/webview/src/components/DependencyEdge.tsx`
- `src/webview/src/quiz/QuizGenerator.ts`
- `src/webview/src/quiz/QuizModal.tsx`

---

## Summary

Blueprint works by:

1. scanning the workspace
2. parsing files into graph data
3. resolving imports and API relationships
4. matching calls to routes
5. broadcasting graph snapshots and diffs
6. rendering the result in a React Flow webview
7. keeping interactions safe with debounced updates and fallbacks

The current implementation is strong on workspace indexing, contract resolution, and UX state management. The main remaining architectural gap is true subgraph incremental layout.
