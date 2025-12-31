import React, { memo, useMemo, useEffect, useCallback } from 'react';
import { Handle, Position, NodeProps, useNodes, useEdges, Node, useReactFlow } from 'reactflow';
import { PSDNodeData } from '../types';
import { createContainerContext } from '../services/psdService';
import { usePsdResolver, ResolverStatus } from '../hooks/usePsdResolver';
import { useProceduralStore } from '../store/ProceduralContext';

interface ChannelState {
  index: number;
  status: 'idle' | 'resolved' | 'warning' | 'error';
  containerName?: string;
  layerCount: number;
  message?: string;
  debugCode?: ResolverStatus;
  resolvedContext?: any;
}

export const ContainerResolverNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  // Read channel count from persistent data, default to 10 if new/undefined
  const channelCount = data.channelCount || 10;
  
  const nodes = useNodes();
  const edges = useEdges();
  const { setNodes } = useReactFlow();
  
  // Store Hooks
  const { registerResolved, unregisterNode } = useProceduralStore();
  
  // Use specialized hook for resolution logic
  const { resolveLayer } = usePsdResolver();

  // 1. Retrieve Global Data Source (LoadPSDNode)
  const loadPsdNode = nodes.find(n => n.type === 'loadPsd') as Node<PSDNodeData>;
  const designLayers = loadPsdNode?.data?.designLayers || null;
  const globalTemplate = loadPsdNode?.data?.template || null;

  // Cleanup
  useEffect(() => {
      return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // 2. Compute Channel Data
  const channels: ChannelState[] = useMemo(() => {
    return Array.from({ length: channelCount }).map((_, index) => {
      const targetHandleId = `target-${index}`;
      
      // Find connection to this handle
      const edge = edges.find(e => e.target === id && e.targetHandle === targetHandleId);

      if (!edge) {
        return { index, status: 'idle', layerCount: 0 };
      }

      if (!globalTemplate) {
         return { 
             index, 
             status: 'error', 
             layerCount: 0, 
             message: 'Source Data Locked', 
             debugCode: 'DATA_LOCKED' 
         };
      }

      const containerName = edge.sourceHandle || '';
      const containerContext = createContainerContext(globalTemplate, containerName);
      
      if (!containerContext) {
        return { 
            index, 
            status: 'error', 
            layerCount: 0, 
            message: 'Invalid Container Ref',
            debugCode: 'UNKNOWN_ERROR'
        };
      }

      // RESOLUTION LOGIC
      const result = resolveLayer(containerContext.containerName, designLayers);

      // Map ResolverStatus to UI Status
      let uiStatus: ChannelState['status'] = 'idle';
      
      switch (result.status) {
        case 'RESOLVED':
          uiStatus = 'resolved';
          break;
        case 'CASE_MISMATCH':
        case 'EMPTY_GROUP':
          uiStatus = 'warning';
          break;
        case 'MISSING_DESIGN_GROUP':
        case 'DATA_LOCKED':
        case 'NO_NAME':
        default:
          uiStatus = 'error';
          break;
      }

      // Use deep count if available, otherwise fall back to direct children
      const childCount = result.totalCount !== undefined ? result.totalCount : (result.layer?.children?.length || 0);

      return {
        index,
        status: uiStatus,
        containerName: containerContext.containerName,
        layerCount: childCount,
        message: result.message,
        debugCode: result.status,
        // Include raw context data for registration
        resolvedContext: result.layer && containerContext ? {
            container: containerContext,
            layers: result.layer.children || [],
            status: 'resolved',
            message: result.message
        } : null
      };
    });
  }, [channelCount, edges, designLayers, globalTemplate, id, resolveLayer]);

  // 3. Register Resolved Data in Store
  useEffect(() => {
    channels.forEach(channel => {
        if (channel.resolvedContext) {
            // Register as source-{index} to match the output handle
            registerResolved(id, `source-${channel.index}`, channel.resolvedContext as any);
        }
    });
  }, [channels, id, registerResolved]);

  const addChannel = useCallback(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              channelCount: (node.data.channelCount || 10) + 1,
            },
          };
        }
        return node;
      })
    );
  }, [id, setNodes]);

  return (
    // Removed overflow-hidden to allow handles to "dock" on the edges without clipping
    <div className="min-w-[320px] bg-slate-800 rounded-lg shadow-xl border border-slate-600 font-sans flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 p-2 border-b border-slate-700 flex items-center justify-between rounded-t-lg">
        <div className="flex items-center space-x-2">
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <span className="text-sm font-semibold text-slate-200">Container Resolver</span>
        </div>
        <span className="text-[10px] text-slate-500 font-mono">MULTI-MAPPER</span>
      </div>

      {!loadPsdNode && (
        <div className="bg-red-900/20 text-red-300 text-[10px] p-1 text-center border-b border-red-900/30">
          Waiting for PSD Source...
        </div>
      )}

      {/* Channels List */}
      <div className="flex flex-col">
        {channels.map((channel) => (
          <div 
            key={channel.index} 
            className={`relative flex items-center h-10 border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
              channel.status === 'resolved' ? 'bg-emerald-900/10' : 
              channel.status === 'warning' ? 'bg-orange-900/10' : ''
            }`}
          >
            {/* Input Handle - Docked Left */}
            <Handle
              type="target"
              position={Position.Left}
              id={`target-${channel.index}`}
              className={`!w-3 !h-3 !-left-1.5 transition-colors duration-200 z-50 ${
                channel.status === 'resolved' ? '!bg-emerald-500 !border-white' :
                channel.status === 'warning' ? '!bg-orange-500 !border-white' :
                channel.status === 'error' ? '!bg-red-500 !border-white' :
                '!bg-slate-600 !border-slate-400'
              }`}
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            />

            {/* Input Index Label (Small, docked next to handle) */}
            <span className="absolute left-3 text-[9px] font-mono text-slate-500 pointer-events-none select-none">
              IN {channel.index}
            </span>

            {/* Main Channel Content */}
            <div className="flex-1 flex items-center justify-between px-8 w-full">
              <div className="flex items-center space-x-2 overflow-hidden min-w-0 flex-1">
                {channel.status === 'idle' ? (
                  <span className="text-xs text-slate-500 italic truncate">Unconnected Slot</span>
                ) : (
                  <div className="flex flex-col leading-tight min-w-0">
                    <div className="flex items-center space-x-1">
                       <span className="text-xs font-semibold text-slate-200 truncate">{channel.containerName}</span>
                       <svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                       </svg>
                    </div>
                    {channel.status !== 'resolved' && (
                        <span className="text-[9px] text-slate-500 truncate">{channel.debugCode}</span>
                    )}
                  </div>
                )}
              </div>

              {channel.status !== 'idle' && (
                <div className={`text-[9px] px-1.5 py-0.5 rounded border ml-2 whitespace-nowrap shrink-0 ${
                    channel.status === 'resolved' ? 'border-emerald-800 bg-emerald-900/40 text-emerald-300' :
                    channel.status === 'warning' ? 'border-orange-800 bg-orange-900/40 text-orange-300' :
                    'border-red-800 bg-red-900/40 text-red-300'
                }`}>
                  {channel.message}
                </div>
              )}
            </div>

            {/* Output Index Label */}
            <span className="absolute right-3 text-[9px] font-mono text-slate-500 pointer-events-none select-none">
              OUT
            </span>

            {/* Output Handle - Docked Right */}
            <Handle
              type="source"
              position={Position.Right}
              id={`source-${channel.index}`}
              className={`!w-3 !h-3 !-right-1.5 transition-colors duration-200 z-50 ${
                channel.status === 'resolved' ? '!bg-blue-500 !border-white' : '!bg-slate-700 !border-slate-500'
              }`}
              style={{ top: '50%', transform: 'translateY(-50%)' }}
            />
          </div>
        ))}
      </div>

      <button 
        onClick={addChannel}
        className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 border-t border-slate-700 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center space-x-1 rounded-b-lg"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span className="text-[10px] font-medium uppercase tracking-wider">Add Channel</span>
      </button>
    </div>
  );
});