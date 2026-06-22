import React from 'react';
import { Handle, Position } from 'reactflow';
import { useGraphStore } from '../store/useGraphStore';

interface CodeNodeProps {
  id: string;
  data: {
    label: string;
    filePath: string;
    isReactComponent: boolean;
    lineCount: number;
  };
}

export const CodeNode: React.FC<CodeNodeProps> = ({ id, data }) => {
  const diagnostics = useGraphStore(state => state.diagnostics[id]);
  const activeEditorPath = useGraphStore(state => state.activeEditorPath);
  
  const hasError = diagnostics?.errorCount > 0;
  const isMissingApi = id.startsWith('MISSING_API:');
  const isActive = activeEditorPath === data.filePath;

  const highlightedNodeIds = useGraphStore(state => state.highlightedNodeIds);
  const isInBlast = highlightedNodeIds.includes(id);
  const dimNonBlast = highlightedNodeIds.length > 0;

  let baseClasses = "relative px-4 py-3 rounded-xl border shadow-lg text-sm text-white bg-white/5 backdrop-blur-md border-white/10 transition-all duration-300";

  
  if (isActive) {
    baseClasses += " ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)] animate-pulse";
  } else if (hasError || isMissingApi) {
    baseClasses += " border-red-500 shadow-red-500/20";
  } else if (data.isReactComponent) {
    baseClasses += " border-blue-500/30";
  }

  // Blast radius dim/glow
  const extraStyle: React.CSSProperties = {};
  if (dimNonBlast) {
    if (!isInBlast) {
      extraStyle.opacity = 0.15;
      extraStyle.filter = 'grayscale(0.2)';
    } else {
      extraStyle.opacity = 1;
      extraStyle.boxShadow = '0 0 18px rgba(34, 211, 238, 0.55)';
      extraStyle.borderColor = '#22d3ee';
    }
  }


  const getFileIcon = (fileName: string) => {
    if (isMissingApi) {
      return <span className="text-red-500 mr-2">⚠️</span>;
    }
    if (fileName.endsWith('.tsx') || fileName.endsWith('.jsx')) {
      return <span className="text-blue-400 mr-2">⚛️</span>;
    }
    if (fileName.endsWith('.ts') || fileName.endsWith('.js')) {
      return <span className="text-yellow-400 mr-2">🟨</span>;
    }
    if (fileName.endsWith('.py')) {
      return <span className="text-blue-500 mr-2">🐍</span>;
    }
    return <span className="text-gray-400 mr-2">📄</span>;
  };

  return (
    <div className={baseClasses} style={extraStyle}>

      {(hasError || isMissingApi) && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">
          !
        </div>
      )}
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      <div className="flex items-center">
        {getFileIcon(data.label)}
        <div className="flex flex-col">
          <div className="font-semibold truncate max-w-[200px]">{data.label}</div>
          <div className="text-[10px] opacity-60 truncate max-w-[200px]" title={data.filePath}>
            {data.filePath.split(/[/\\]/).slice(-2, -1).pop()} / {data.lineCount} lines
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
};
