import React, { useState, useEffect, useRef } from 'react';
import { useGraphStore } from '../store/useGraphStore';
import { useReactFlow } from 'reactflow';

export const SearchCommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { nodes, setSelectedNodeId } = useGraphStore();
  const { setCenter } = useReactFlow();
  const inputRef = useRef<HTMLInputElement>(null);
  const nodeLookup = useRef(new Map<string, (typeof nodes)[number]>());

  useEffect(() => {
    nodeLookup.current = new Map(nodes.map(node => [node.id, node]));
  }, [nodes]);

  const getAbsolutePosition = (nodeId: string) => {
    let current = nodeLookup.current.get(nodeId);
    let x = 0;
    let y = 0;

    while (current) {
      x += current.position?.x ?? 0;
      y += current.position?.y ?? 0;

      const parentId = current.parentNode;
      if (!parentId) break;
      current = nodeLookup.current.get(parentId);
    }

    return { x, y };
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const searchableNodes = nodes.filter(node => {
    if (node.type === 'clusterOverflowNode') return false;
    return node.type === 'clusterNode' || node.type === 'codeNode' || node.type === 'brokenNode';
  });

  const filteredNodes = searchableNodes.filter(node => {
    const label = String(node.data?.label ?? '').toLowerCase();
    const filePath = String(node.data?.filePath ?? '').toLowerCase();
    if (normalizedQuery.length === 0) return true;
    return label.includes(normalizedQuery) || filePath.includes(normalizedQuery);
  }).slice(0, 10);

  const handleSelect = (nodeId: string, x: number, y: number) => {
    setSelectedNodeId(nodeId);
    const absolute = getAbsolutePosition(nodeId);
    setCenter(absolute.x + 125, absolute.y + 40, { zoom: 1, duration: 800 });
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-start justify-center pt-[20vh] bg-black/50 backdrop-blur-sm">
      <div className="w-[500px] bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <input 
          ref={inputRef}
          type="text" 
          className="w-full bg-transparent border-b border-[var(--vscode-panel-border)] p-4 text-white outline-none placeholder-gray-500"
          placeholder="Search files... (Cmd+K to close)"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <div className="max-h-[300px] overflow-y-auto">
          {filteredNodes.length > 0 ? (
            filteredNodes.map(node => (
              <div 
                key={node.id} 
                onClick={() => handleSelect(node.id, node.position.x, node.position.y)}
                className="p-3 hover:bg-[var(--vscode-list-hoverBackground)] cursor-pointer flex flex-col border-b border-[var(--vscode-panel-border)]/50"
              >
                <span className="text-white font-semibold">{node.data.label}</span>
                <span className="text-gray-400 text-xs truncate">{node.data.filePath}</span>
              </div>
            ))
          ) : (
            <div className="p-4 text-gray-500 text-sm text-center">No results found.</div>
          )}
        </div>
      </div>
    </div>
  );
};
