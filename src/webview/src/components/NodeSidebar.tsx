import React, { useMemo } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { QuizModal } from '../quiz/QuizModal';



export const NodeSidebar: React.FC = () => {
  const { nodes, edges, selectedNodeId, setSelectedNodeId, diagnostics, isQuizActive, setQuizActive } = useGraphStore();

  const nodeDiagnostics = selectedNodeId ? diagnostics[selectedNodeId] : null;

  const selectedNode = useMemo(() => {
    return nodes.find(n => n.id === selectedNodeId);
  }, [nodes, selectedNodeId]);

  const imports = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter(e => e.source === selectedNodeId && e.type !== 'contractEdge').map(e => e.target);
  }, [edges, selectedNodeId]);

  const dependents = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter(e => e.target === selectedNodeId && e.type !== 'contractEdge').map(e => e.source);
  }, [edges, selectedNodeId]);

  const apiCallsOut = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter(e => e.source === selectedNodeId && e.type === 'contractEdge');
  }, [edges, selectedNodeId]);

  const apiEndpointsIn = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges.filter(e => e.target === selectedNodeId && e.type === 'contractEdge');
  }, [edges, selectedNodeId]);

  if (!selectedNode) return null;

  const data = selectedNode.data;

  return (
    <div className="absolute right-4 top-4 bottom-4 w-80 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-6 flex flex-col z-50 animate-in slide-in-from-right-8 duration-300">
      <div className="flex justify-between items-start mb-6">
        <h2 className="text-xl font-bold text-white tracking-tight break-all">
          {data.label}
        </h2>
        <button 
          onClick={() => setSelectedNodeId(null)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          ✕
        </button>
      </div>

      <div className="mb-4">
        <button
          onClick={() => setQuizActive(true)}
          className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-sm text-white"
        >
          Test My Knowledge
        </button>
      </div>

      {isQuizActive && (
        <QuizModal
          onClose={() => {
            setQuizActive(false);
          }}
        />
      )}

      <div className="space-y-6 overflow-y-auto pr-2 custom-scrollbar">
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Details</h3>
          <div className="bg-black/30 rounded-lg p-3 space-y-2 border border-white/5">
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Type</span>
              <span className="text-white text-sm font-medium">
                {data.isReactComponent ? 'React Component' : 'File'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 text-sm">Lines</span>
              <span className="text-white text-sm font-medium">{data.lineCount}</span>
            </div>
            <div className="flex flex-col mt-2 pt-2 border-t border-white/10">
              <span className="text-gray-400 text-xs mb-1">Absolute Path</span>
              <span className="text-gray-300 text-xs break-all font-mono bg-black/50 p-1.5 rounded">{data.filePath}</span>
            </div>
          </div>
        </div>

        {nodeDiagnostics && (nodeDiagnostics.errorCount > 0 || nodeDiagnostics.warningCount > 0) && (
          <div>
            <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">VS Code Diagnostics</h3>
            <div className="bg-red-900/20 rounded-lg p-3 space-y-2 border border-red-500/20">
              <div className="flex gap-2 mb-2">
                <span className="text-red-400 text-xs font-bold px-2 py-0.5 bg-red-900/50 rounded">{nodeDiagnostics.errorCount} Errors</span>
                <span className="text-yellow-400 text-xs font-bold px-2 py-0.5 bg-yellow-900/50 rounded">{nodeDiagnostics.warningCount} Warnings</span>
              </div>
              <ul className="list-disc list-inside text-xs text-red-200 space-y-1">
                {nodeDiagnostics.messages.map((msg, idx) => (
                  <li key={idx} className="break-words">{msg}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Imports ({imports.length})</h3>
          {imports.length > 0 ? (
            <div className="flex flex-col gap-1">
              {imports.map(imp => (
                <div key={imp} className="text-sm text-blue-300 bg-blue-900/20 px-2 py-1 rounded truncate border border-blue-500/20" title={imp}>
                  {imp.split(/[/\\]/).pop() || imp}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">No dependencies</div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Imported By ({dependents.length})</h3>
          {dependents.length > 0 ? (
            <div className="flex flex-col gap-1">
              {dependents.map(dep => (
                <div key={dep} className="text-sm text-green-300 bg-green-900/20 px-2 py-1 rounded truncate border border-green-500/20" title={dep}>
                  {dep.split(/[/\\]/).pop() || dep}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 italic">No dependents</div>
          )}
        </div>

        {apiCallsOut.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">API Calls Made ({apiCallsOut.length})</h3>
            <div className="flex flex-col gap-1">
              {apiCallsOut.map(call => (
                <div key={call.id} className="text-sm text-purple-300 bg-purple-900/20 px-2 py-1 rounded truncate border border-purple-500/20" title={call.target}>
                  <span className="font-mono text-[10px] mr-2">OUT</span>
                  {call.data?.endpoint || call.target}
                </div>
              ))}
            </div>
          </div>
        )}

        {apiEndpointsIn.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-2">API Endpoints ({apiEndpointsIn.length})</h3>
            <div className="flex flex-col gap-1">
              {apiEndpointsIn.map(endpoint => (
                <div key={endpoint.id} className="text-sm text-cyan-300 bg-cyan-900/20 px-2 py-1 rounded truncate border border-cyan-500/20" title={endpoint.source}>
                  <span className="font-mono text-[10px] mr-2">IN</span>
                  {endpoint.data?.endpoint || endpoint.source}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
