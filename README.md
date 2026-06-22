# Blueprint Architecture Map

Blueprint is a VS Code extension that turns a workspace into an interactive architecture map.

It scans source files, builds a graph of imports and API relationships, and renders that graph in a webview so developers can inspect:

- file-to-file imports
- API routes and API calls
- broken API contract calls
- folder-based clusters
- syntax and diagnostic warnings from the editor
- blast-radius impact paths
- search and selection across the graph
- quiz prompts based on the graph

This repository currently represents a testing and preview build of Blueprint.
It is useful for validation, iteration, and internal experimentation, but it should not be treated as a finished production release.

## What Blueprint Tries To Show

Blueprint is designed to answer questions like:

- What depends on this file?
- Which route satisfies this API call?
- Which endpoint is missing?
- Which folder contains the error?
- What is the blast radius if this file changes?

## Current Status

The project currently includes:

- a backend extension host that scans and maintains graph state
- a webview frontend that renders the architecture map
- alias-aware import resolution
- folder clustering
- broken contract markers
- diagnostics overlays
- incremental workspace updates
- build output for both backend and webview bundles

Important note:

- automated tests are still limited in this repository
- some behaviors are intentionally experimental
- the repo is being presented as a testing version, not a production promise

## Repository Layout

- `src/extension.ts` - extension entry point
- `src/backend/` - backend parsing, graph storage, contract matching, and workspace watching
- `src/webview/src/` - React Flow frontend, graph state, and visual components
- `dist/` - generated build output
- `TOOL_DOCUMENTATION.md` - internal architecture notes and implementation summary

## Build And Run

Requirements:

- Node.js
- VS Code

Typical local workflow:

1. Install dependencies with `npm install`
2. Build the extension with `npm run compile`
3. Open the project in VS Code and launch the extension host

On Windows, `npm.cmd` can be used if PowerShell execution policy blocks `npm`.

Build scripts:

- `npm run compile`
- `npm run vscode:prepublish`

Both scripts build the webview bundle and then compile the extension host TypeScript.

## Notes On Ignored Files

The repository keeps generated and non-production files out of Git through `.gitignore`.

That includes:

- `node_modules/`
- `dist/`
- temporary logs and cache files
- local debug helpers
- ad hoc test scripts
- scratch planning notes
- fixture folders used for local experimentation

## Development Notes

The architecture map is still evolving.
When you use it, expect a testing-oriented workflow with a focus on:

- correctness of graph extraction
- visible diagnostics
- stable incremental updates
- safe fallback behavior when parsing fails

If you are looking for a polished release note:

- this repository is not claiming that yet
- it is a working testing build that can be improved and hardened over time

## License

No license has been added yet.
If you plan to publish the repository publicly, add an explicit license before distributing it.

