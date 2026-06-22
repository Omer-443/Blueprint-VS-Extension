import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { useGraphStore } from '../store/useGraphStore';

export type ClusterNodeData = {
  clusterId: string;
  label: string;
  isCollapsed: boolean;
  childCount: number;
  errorCount?: number;
  childFilePaths?: string[];
  toggleCluster: (clusterId: string) => void;
};

export const ClusterNode: React.FC<NodeProps<ClusterNodeData>> = ({ data }) => {
  const expandedClusters = useGraphStore(state => state.expandedClusters);
  const diagnostics = useGraphStore(state => state.diagnostics);
  const isCollapsed = !expandedClusters.includes(data.clusterId);
  // Derive the current badge count from live diagnostics only.
  // This avoids stale folder badges sticking around after a syntax error is fixed.
  const childErrorCount = (data.childFilePaths ?? []).reduce((count, filePath) => {
    const diag = diagnostics[filePath];
    return count + (diag?.errorCount ?? 0);
  }, 0);
  const hasChildError = childErrorCount > 0;

  console.log(
    '[ClusterNode][RENDER] clusterId=',
    data.clusterId,
    'label=',
    data.label,
    'isCollapsed=',
    isCollapsed,
    'expanded=',
    expandedClusters
  );

  return (
    <div
      className="w-full h-full rounded-xl border border-white/10 bg-black/20 backdrop-blur-md shadow-lg overflow-hidden"
      style={{
        minHeight: 120,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        onPointerDown={e => {
          e.stopPropagation();
        }}
        onClick={e => {
          e.stopPropagation();
          e.preventDefault();
          data.toggleCluster(data.clusterId);
        }}
        className="w-full text-left px-3 py-2 flex items-center justify-between"
        style={{
          background: 'rgba(0,0,0,0.15)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          pointerEvents: 'auto',
        }}
      >
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-300">Folder Cluster</div>
          <div className="text-sm font-semibold text-white truncate max-w-[320px]">{data.label}</div>
        </div>
        <div className="flex items-center gap-2">
          {hasChildError && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-200 border border-red-500/30">
              {childErrorCount} err
            </span>
          )}
          <div className="text-xs text-gray-200">{data.isCollapsed ? '▶' : '▼'}</div>
        </div>
      </button>

      <div className="px-3 py-3 flex-1">
        <div className="text-xs text-gray-300">
          {data.isCollapsed ? 'Collapsed' : 'Expanded'} • {data.childCount} nodes
        </div>
        <div className="mt-2 h-[3px] bg-white/10 rounded-full overflow-hidden">
          <div
            style={{
              width: data.isCollapsed ? '35%' : '75%',
              height: '100%',
              background: 'linear-gradient(90deg, rgba(34,211,238,0.8), rgba(168,85,247,0.8))',
            }}
          />
        </div>
      </div>

      <Handle type="source" position={Position.Top} className="w-2 h-2 !bg-gray-400 opacity-0" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 !bg-gray-400 opacity-0" />
    </div>
  );
};
