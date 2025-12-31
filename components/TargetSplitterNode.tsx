import React, { memo, useMemo, useEffect } from 'react';
import { Handle, Position, NodeProps, useEdges, useNodes, Node } from 'reactflow';
import { PSDNodeData } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { getSemanticThemeObject } from '../services/psdService';

export const TargetSplitterNode = memo(({ id }: NodeProps) => {
  const edges = useEdges();
  
  // Connect to Store
  const { templateRegistry, registerTemplate, unregisterNode } = useProceduralStore();

  // 1. Identify Upstream TargetTemplate Node ID
  const upstreamNodeId = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'template-input');
    return edge ? edge.source : null;
  }, [edges, id]);

  // 2. Fetch Template from Store
  const template = upstreamNodeId ? templateRegistry[upstreamNodeId] : null;

  // 3. Broadcast Template as "Self" to Store
  useEffect(() => {
    if (template) {
        registerTemplate(id, template);
    }
  }, [id, template, registerTemplate]);

  // Cleanup
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // SORT LOGIC: Alphabetical
  const sortedContainers = useMemo(() => {
      if (!template?.containers) return [];
      return [...template.containers].sort((a, b) => a.name.localeCompare(b.name));
  }, [template]);

  // 4. Identify connected content slots (UI logic)
  const connectedSlots = useMemo(() => {
    const connected = new Set<string>();
    edges.forEach(e => {
        if (e.target === id && e.targetHandle && e.targetHandle !== 'template-input') {
            connected.add(e.targetHandle);
        }
    });
    return connected;
  }, [edges, id]);

  const isTemplateConnected = !!template;

  return (
    <div className="min-w-[260px] bg-slate-800 rounded-lg shadow-xl border border-slate-600 overflow-hidden font-sans">
       {/* Input Handle for Template Definition */}
       <Handle
        type="target"
        position={Position.Left}
        id="template-input"
        className="!w-3 !h-3 !top-8 !bg-emerald-500 !border-2 !border-slate-800"
        title="Input: Target Template Metadata"
      />

      {/* Header */}
      <div className="bg-emerald-900 p-2 border-b border-emerald-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-sm font-semibold text-emerald-100">Target Splitter</span>
        </div>
        <span className="text-[10px] text-emerald-300/70 font-mono px-1">ASSEMBLY</span>
      </div>

      {/* Body */}
      <div className="p-2 space-y-2 bg-slate-800">
        
        {/* State: No Template Connected */}
        {!isTemplateConnected && (
          <div className="flex flex-col items-center justify-center py-6 px-4 text-slate-500 border border-dashed border-slate-700 rounded bg-slate-900/30">
             <svg className="w-8 h-8 mb-2 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
             </svg>
             <span className="text-xs text-center">Connect Target Template to initialize slots</span>
          </div>
        )}

        {/* State: Template Connected, Render Slots */}
        {isTemplateConnected && (
          <div className="flex flex-col space-y-3">
             <div className="text-[10px] text-slate-400 font-medium px-1 flex justify-between">
                <span>SLOT DEFINITIONS</span>
                <span>{connectedSlots.size} / {sortedContainers.length} Filled</span>
             </div>

             <div className="space-y-1">
               {sortedContainers.length === 0 ? (
                 <div className="text-xs text-slate-500 p-2 italic">Target has no containers</div>
               ) : (
                 sortedContainers.map((container, index) => {
                   const isFilled = connectedSlots.has(container.name);
                   const theme = getSemanticThemeObject(container.name, index);
                   
                   return (
                     <div 
                       key={container.id} 
                       className={`relative flex items-center justify-between p-2 pl-4 rounded border transition-colors ${
                         isFilled 
                           ? `${theme.bg.replace('/20', '/10')} ${theme.border.replace('border-', 'border-opacity-30 border-')}` 
                           : 'bg-slate-900/30 border-slate-700/50'
                       }`}
                     >
                       {/* Input Handle for specific slot (Assembly In) */}
                       <Handle
                         type="target"
                         position={Position.Left}
                         id={container.name} 
                         className={`!w-3 !h-3 !-left-1.5 transition-colors duration-300 ${
                           isFilled 
                             ? `${theme.dot} !border-white` 
                             : '!bg-slate-700 !border-slate-500 hover:!bg-slate-600'
                         }`}
                         style={{ top: '50%', transform: 'translateY(-50%)' }}
                       />

                       <div className="flex flex-col leading-tight overflow-hidden w-full mr-4">
                          <span className={`text-xs font-medium truncate ${isFilled ? theme.text : 'text-slate-400'}`}>
                            {container.name}
                          </span>
                          <span className="text-[9px] text-slate-600 font-mono">
                             {Math.round(container.normalized.w * 100)}% x {Math.round(container.normalized.h * 100)}%
                          </span>
                       </div>

                       {/* Output Handle for Bounds (Coords Out) */}
                       <Handle
                         type="source"
                         position={Position.Right}
                         id={`slot-bounds-${container.name}`}
                         className={`!w-3 !h-3 !-right-1.5 transition-colors duration-300 !bg-emerald-500 !border-white hover:!bg-emerald-400`}
                         style={{ top: '50%', transform: 'translateY(-50%)' }}
                         title={`Export Bounds: ${container.name}`}
                       />
                     </div>
                   );
                 })
               )}
             </div>
          </div>
        )}
      </div>
    </div>
  );
});