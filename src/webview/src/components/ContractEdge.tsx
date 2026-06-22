import React from 'react';
import { BaseEdge, EdgeLabelRenderer, EdgeProps, getSmoothStepPath } from 'reactflow';
import { useGraphStore } from '../store/useGraphStore';

export const ContractEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  target,
}) => {
  const edgeId: string = (data as any)?.originalId ?? id;
  const offset: number = (data as any)?.edgeOffset ?? 0;

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY: sourceY + offset,
    sourcePosition,
    targetX,
    targetY: targetY + offset,
    targetPosition,
    borderRadius: 16,
  });

  const diffState = useGraphStore(state => state.diffState);
  const isRemoved = (data as any)?.isRemoved === true;
  const isAdded = (diffState?.addedEdges.includes(edgeId) ?? false) && !isRemoved;
  const isBroken = data?.isBroken === true || data?.isBrokenTarget === true || target?.startsWith('broken_contract:') === true || target?.startsWith('MISSING_API:') === true;

  const defaultStyle: React.CSSProperties = {
    ...style,
    strokeWidth: isBroken ? 2.5 : 3,
    stroke: isRemoved ? '#ef4444' : isAdded ? '#22c55e' : isBroken ? '#ef4444' : 'url(#contract-gradient)',
    strokeDasharray: isRemoved ? '10 6' : isBroken ? '8 4' : isAdded ? '8 4' : undefined,
    opacity: isRemoved ? 1 : undefined,
    animation: isRemoved ? 'fadeOut 1.5s ease-out forwards' : isAdded ? 'dash 2s linear forwards' : undefined,
  };

  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="contract-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
      </svg>

      <BaseEdge
        id={id}
        path={edgePath}
        style={defaultStyle}
        markerEnd={markerEnd}
      />

      {isBroken && !isRemoved && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              boxShadow: '0 0 8px #ef4444aa',
              border: '2px solid #fff2',
            }}
          >
            ⚠️
          </div>
        </EdgeLabelRenderer>
      )}

      <style>{`
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes dash {
          from { stroke-dashoffset: 100; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </>
  );
};
