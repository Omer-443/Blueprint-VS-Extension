import React from 'react';
import { BaseEdge, EdgeProps, getSmoothStepPath } from 'reactflow';
import { useGraphStore } from '../store/useGraphStore';

export const DependencyEdge: React.FC<EdgeProps> = ({
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
}) => {
  const edgeId: string = (data as any)?.originalId ?? id;
  const edgeOffset: number = (data as any)?.edgeOffset ?? 0;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY: sourceY + edgeOffset,
    sourcePosition,
    targetX,
    targetY: targetY + edgeOffset,
    targetPosition,
    borderRadius: 16,
  });

  const diffState = useGraphStore(state => state.diffState);
  const isAdded = diffState?.addedEdges.includes(edgeId);
  const isRemoved = (data as any)?.isRemoved === true || diffState?.removedEdges.includes(edgeId);

  const highlightedEdgeIds = useGraphStore(state => state.highlightedEdgeIds);
  const highlightedNodeIds = useGraphStore(state => state.highlightedNodeIds);
  const isInBlast = highlightedEdgeIds.includes(id);
  const dimNonBlast = highlightedNodeIds.length > 0 || highlightedEdgeIds.length > 0;


  let customStyle = { ...style, stroke: 'var(--vscode-editorLineNumber-foreground)', strokeWidth: 2 };


  if (isAdded) {
    customStyle.stroke = '#22c55e'; // green-500
    customStyle.strokeDasharray = '100';
    customStyle.animation = 'dash 2s linear forwards';
  } else if (isRemoved) {
    customStyle.stroke = '#ef4444'; // red-500
    customStyle.opacity = 1;
    customStyle.strokeDasharray = '10 6';
    customStyle.animation = 'fadeOut 1.5s ease-out forwards';
  }

  // Blast radius dim/glow
  if (dimNonBlast) {
    if (!isInBlast) {
      customStyle.opacity = 0.15;
      customStyle.strokeWidth = Math.min(customStyle.strokeWidth as number, 1.2);
    } else {
      customStyle.opacity = 1;
      customStyle.stroke = '#22d3ee';
      customStyle.strokeWidth = Math.max(customStyle.strokeWidth as number, 3.2);
    }
  }


  return (

    <>
      <style>
        {`
          @keyframes dash {
            from {
              stroke-dashoffset: 100;
            }
            to {
              stroke-dashoffset: 0;
            }
          }
          @keyframes fadeOut {
            from {
              opacity: 1;
            }
            to {
              opacity: 0;
            }
          }
        `}
      </style>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={customStyle} />
    </>
  );
};
