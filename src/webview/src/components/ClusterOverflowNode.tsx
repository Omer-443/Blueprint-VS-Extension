import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

export type ClusterOverflowNodeData = {
  clusterId: string;
  hiddenCount: number;
  toggleCluster: (clusterId: string) => void;
};

export const ClusterOverflowNode: React.FC<NodeProps<ClusterOverflowNodeData>> = ({ data }) => {
  return (
    <div
      className="w-full h-full rounded-xl border border-dashed border-cyan-400/40 bg-cyan-500/10 backdrop-blur-md shadow-lg overflow-hidden"
      style={{
        minHeight: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        onPointerDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          e.preventDefault();
          data.toggleCluster(data.clusterId);
        }}
        className="w-full h-full px-4 py-3 text-center text-cyan-100 hover:text-white transition-colors"
      >
        <div className="text-xs uppercase tracking-wider text-cyan-200/80">Cluster Overflow</div>
        <div className="text-sm font-semibold mt-1">+ {data.hiddenCount} more files</div>
        <div className="text-[11px] text-cyan-100/70 mt-1">Click to expand all</div>
      </button>
      <Handle type="source" position={Position.Top} className="w-2 h-2 !bg-cyan-300 opacity-0" />
      <Handle type="target" position={Position.Bottom} className="w-2 h-2 !bg-cyan-300 opacity-0" />
    </div>
  );
};
