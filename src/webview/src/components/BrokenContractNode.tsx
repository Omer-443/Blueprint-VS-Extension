import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

export const BrokenContractNode: React.FC<NodeProps> = ({ data }) => {
  // The label comes in as "⚠ /api/v1/missing-data" — strip the leading "⚠ " if present
  const rawLabel: string = data.endpoint || data.label || 'Unknown endpoint';
  const endpoint = rawLabel.replace(/^[⚠\s]+/, '');

  return (
    <div
      style={{
        background: 'rgba(239,68,68,0.08)',
        border: '2px solid #ef4444',
        borderRadius: 10,
        width: 260,
        overflow: 'hidden',
        boxShadow: '0 0 18px rgba(239,68,68,0.4)',
        animation: 'brokenPulse 2s ease-in-out infinite',
      }}
    >
      <style>{`
        @keyframes brokenPulse {
          0%, 100% { box-shadow: 0 0 12px rgba(239,68,68,0.35); }
          50%       { box-shadow: 0 0 26px rgba(239,68,68,0.75); }
        }
      `}</style>

      {/* Red header bar */}
      <div style={{
        background: 'linear-gradient(90deg, #ef4444, #dc2626)',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 12, letterSpacing: '0.05em' }}>
          BROKEN API CALL
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <p style={{ color: 'var(--vscode-editor-foreground)', opacity: 0.75, fontSize: 11, margin: 0 }}>
          No backend route matches:
        </p>
        <code style={{
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.4)',
          borderRadius: 4,
          padding: '4px 6px',
          color: '#f87171',
          fontFamily: 'monospace',
          fontSize: 11,
          wordBreak: 'break-all',
          display: 'block',
        }}>
          {endpoint}
        </code>
        <p style={{ color: 'var(--vscode-descriptionForeground)', fontSize: 10, margin: 0, opacity: 0.7 }}>
          Implement this route in your backend, or fix the URL.
        </p>
      </div>

      {/* Handles — target on top (receives edges), source on bottom */}
      <Handle type="target" position={Position.Top}
        style={{ width: 10, height: 10, background: '#ef4444', border: '2px solid #fff2' }} />
      <Handle type="target" position={Position.Left}
        style={{ width: 10, height: 10, background: '#ef4444', border: '2px solid #fff2' }} />
      <Handle type="source" position={Position.Bottom}
        style={{ width: 10, height: 10, background: '#ef4444', border: '2px solid #fff2' }} />
      <Handle type="source" position={Position.Right}
        style={{ width: 10, height: 10, background: '#ef4444', border: '2px solid #fff2' }} />
    </div>
  );
};
