import React, { memo, useMemo } from 'react';
import { Handle, Position, NodeProps, useEdges, useNodes, Node } from 'reactflow';
import { PSDNodeData } from '../types';
import { getSemanticThemeObject } from '../services/psdService';

export const TemplateSplitterNode = memo(({ id }: NodeProps) => {
  const edges = useEdges();
  const nodes = useNodes();

  // Find the source node connected to this node's input handle
  const sourceNode = useMemo(() => {
    const edge = edges.find(e => e.target === id);
    if (!edge) return null;
    return nodes.find(n => n.id === edge.source) as Node<PSDNodeData> | undefined;
  }, [edges, nodes, id]);

  const template = sourceNode?.data?.template;
  
  // SORT LOGIC: Alphabetical
  const sortedContainers = useMemo(() => {
      if (!template?.containers) return [];
      return [...template.containers].sort((a, b) => a.name.localeCompare(b.name));
  }, [template]);

  // Helper to check if a specific container handle is connected
  const isHandleConnected = (handleId: string) => {
    return edges.some(e => e.source === id && e.sourceHandle === handleId);
  };

  return (
    <div className="min-w-[200px] bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden font-sans">
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="!w-3 !h-3 !top-8 !bg-blue-500 !border-2 !border-slate-800"
      />

      {/* Header */}
      <div className="bg-slate-900 p-2 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
          <span className="text-sm font-semibold text-slate-200">Template Splitter</span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono px-1">DEMUX</span>
      </div>

      {/* Body */}
      <div className="p-2 space-y-2 bg-slate-800">
        {!sourceNode || !template ? (
          <div className="flex flex-col items-center justify-center py-4 text-slate-500">
             <span className="text-xs italic">No Template Detected</span>
          </div>
        ) : (
          sortedContainers.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-2">
              Template has no containers
            </div>
          ) : (
            <div className="flex flex-col space-y-1">
              {sortedContainers.map((container, index) => {
                const theme = getSemanticThemeObject(container.name, index);
                const isConnected = isHandleConnected(container.name);
                
                return (
                  <div 
                    key={container.id} 
                    className={`relative flex items-center justify-between p-2 rounded border border-slate-700/50 bg-slate-900/30 group hover:border-slate-600 transition-colors`}
                  >
                    <div className="flex items-center space-x-2 overflow-hidden">
                       <div className={`w-2 h-2 rounded-full ${theme.dot} shrink-0`}></div>
                       <span className={`text-xs font-medium truncate ${theme.text}`} title={container.name}>
                         {container.name}
                       </span>
                    </div>
                    
                    {/* Output Handle for specific container */}
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={container.name} // ID identifies the container output
                      className={`!w-3 !h-3 !border-2 transition-colors duration-300 ${isConnected ? '!bg-emerald-500 !border-emerald-200' : '!bg-slate-600 !border-slate-400 group-hover:!border-white'}`}
                      style={{ right: -6, top: '50%', transform: 'translateY(-50%)' }} // Vertical centering
                    />
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
});