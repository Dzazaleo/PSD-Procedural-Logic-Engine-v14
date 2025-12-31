import React, { memo, useState, useEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useEdges, useNodes, Node } from 'reactflow';
import { SerializableLayer, PSDNodeData } from '../types';

interface LayerItemProps {
  node: SerializableLayer;
  depth?: number;
}

const LayerItem: React.FC<LayerItemProps> = ({ node, depth = 0 }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isGroup = node.type === 'group';
  const hasChildren = isGroup && node.children && node.children.length > 0;

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) setIsOpen(!isOpen);
  };

  return (
    <div className="select-none">
      <div 
        className={`flex items-center py-1 pr-2 hover:bg-slate-700/50 rounded cursor-default ${!node.isVisible ? 'opacity-50' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={toggleOpen}
      >
        <div className="mr-1.5 w-4 flex justify-center shrink-0">
          {hasChildren ? (
             <svg 
               className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} 
               fill="none" viewBox="0 0 24 24" stroke="currentColor"
             >
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
             </svg>
          ) : (
            <div className="w-3" />
          )}
        </div>

        <div className="mr-2 text-slate-400 shrink-0">
           {isGroup ? (
             <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
               <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
             </svg>
           ) : (
             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
             </svg>
           )}
        </div>

        <span className="text-xs text-slate-200 truncate">{node.name}</span>
        
        {!node.isVisible && (
           <svg className="w-3 h-3 ml-auto text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
           </svg>
        )}
      </div>

      {isOpen && hasChildren && (
        <div className="border-l border-slate-700 ml-[15px]">
          {/* REVERSED: Render top-most children first */}
          {[...node.children!].reverse().map((child) => (
            <LayerItem key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const DesignInfoNode = memo(({ id }: NodeProps) => {
  const edges = useEdges();
  const nodes = useNodes();
  
  // Find the source node connected to this node's handle
  // We assume the edge connects to the 'target' handle of this node
  const sourceNode = React.useMemo(() => {
    const edge = edges.find(e => e.target === id);
    if (!edge) return null;
    return nodes.find(n => n.id === edge.source) as Node<PSDNodeData> | undefined;
  }, [edges, nodes, id]);

  const designLayers = sourceNode?.data?.designLayers;

  return (
    <div className="w-64 bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden font-sans flex flex-col h-auto max-h-96">
      {/* Input Handle - Matching TargetSplitter Location */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !top-8 !bg-blue-500 !border-2 !border-slate-800"
        title="Input"
      />

      {/* Header Container */}
      <div className="bg-slate-900 p-2 border-b border-slate-700 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-sm font-semibold text-slate-200">Design Info</span>
        </div>
      </div>

      {/* Content */}
      <div className="overflow-y-auto custom-scrollbar flex-1 bg-slate-800 p-1">
        {!sourceNode ? (
          <div className="flex flex-col items-center justify-center h-24 text-slate-500 p-4 text-center">
            <svg className="w-8 h-8 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span className="text-xs">Connect a Loaded PSD Node</span>
          </div>
        ) : !designLayers ? (
          <div className="flex flex-col items-center justify-center h-24 text-slate-500 text-xs">
            <span>No design layers found.</span>
          </div>
        ) : (
          <div className="py-1">
             {/* REVERSED: Render top-most layers first (Photoshop Style) */}
             {[...designLayers].reverse().map(layer => (
               <LayerItem key={layer.id} node={layer} />
             ))}
          </div>
        )}
      </div>
    </div>
  );
});