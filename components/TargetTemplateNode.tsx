import React, { memo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { parsePsdFile, extractTemplateMetadata, getSemanticTheme } from '../services/psdService';
import { PSDNodeData, TemplateMetadata } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';

const TargetTemplatePreview: React.FC<{ metadata: TemplateMetadata }> = ({ metadata }) => {
  const { canvas, containers } = metadata;
  const aspectRatio = canvas.height / canvas.width;
  // w-56 is 224px
  const PREVIEW_WIDTH = 224;
  const previewHeight = PREVIEW_WIDTH * aspectRatio;

  return (
    <div className="w-full mt-2 flex flex-col items-center">
      <div className="w-full flex justify-between items-end mb-1 px-1">
        <span className="text-[10px] uppercase text-emerald-400 font-semibold tracking-wider">Target Layout</span>
        <span className="text-[9px] text-emerald-600/70">{canvas.width} x {canvas.height}</span>
      </div>
      <div 
        className="relative w-56 bg-black/40 border border-emerald-900/50 rounded overflow-hidden shadow-inner"
        style={{ height: `${previewHeight}px` }}
      >
        <div className="absolute inset-0">
          {containers.map((container, index) => (
            <div
              key={container.id}
              className={`absolute border border-dashed flex items-center justify-center transition-opacity hover:opacity-100 opacity-70 ${getSemanticTheme(container.originalName, index)}`}
              style={{
                top: `${container.normalized.y * 100}%`,
                left: `${container.normalized.x * 100}%`,
                width: `${container.normalized.w * 100}%`,
                height: `${container.normalized.h * 100}%`,
              }}
              title={`${container.name} (${container.bounds.w}x${container.bounds.h})`}
            >
              <div className="text-[8px] font-mono truncate px-0.5 bg-black/40 rounded">{container.name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const TargetTemplateNode = memo(({ data, id }: NodeProps<PSDNodeData>) => {
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setNodes } = useReactFlow();

  // Connect to store
  const { psdRegistry, registerPsd, registerTemplate, unregisterNode } = useProceduralStore();

  // Determine State
  const isDataLoaded = !!data.template;
  const hasBinary = !!psdRegistry[id];
  const isDehydrated = isDataLoaded && !hasBinary;

  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLocalError(null);

    try {
      console.log(`Parsing Target PSD: ${file.name}...`);
      // Optimization: Skip layer image data as we only need structure/metadata for the target
      // However, for Export assembly, we might need the original canvas state or specific layers if user demands.
      // For now, we keep it lightweight as requested.
      const parsedPsd = await parsePsdFile(file, { skipLayerImageData: true, skipThumbnail: true });
      const templateData = extractTemplateMetadata(parsedPsd);

      // Validation: Logic requirement
      if (templateData.containers.length === 0) {
        throw new Error("INVALID TARGET: No !!TEMPLATE Group Found");
      }

      // REGISTER WITH STORE
      registerPsd(id, parsedPsd);
      registerTemplate(id, templateData);

      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                fileName: file.name,
                template: templateData,
                validation: null, // Not applicable for target
                designLayers: null, // Not applicable for target
                error: null,
              },
            };
          }
          return node;
        })
      );
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to parse Target PSD';
      setLocalError(errorMessage);
      console.error("Target PSD Error:", err);
      
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                fileName: file.name,
                template: null,
                error: errorMessage,
              },
            };
          }
          return node;
        })
      );
    } finally {
      setIsLoading(false);
    }
  }, [id, setNodes, registerPsd, registerTemplate]);

  const handleBoxClick = () => fileInputRef.current?.click();
  const isConnectable = isDataLoaded && hasBinary;

  return (
    // Removed overflow-hidden to prevent clipping of the output handle
    <div className={`w-72 rounded-lg shadow-xl border font-sans transition-colors relative ${isDehydrated ? 'bg-orange-950/30 border-orange-500/50' : 'bg-slate-800 border-slate-600'}`}>
      {/* Header - Added rounded-t-lg since parent overflow is no longer hidden */}
      <div className={`p-2 border-b flex items-center justify-between rounded-t-lg ${isDehydrated ? 'bg-orange-900/50 border-orange-700' : 'bg-emerald-900 border-emerald-800'}`}>
        <div className="flex items-center space-x-2">
           {isDehydrated ? (
             <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
             </svg>
          ) : (
            <svg className="w-4 h-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          )}
          <span className={`text-sm font-semibold ${isDehydrated ? 'text-orange-100' : 'text-emerald-100'}`}>
            {isDehydrated ? 'Binary Data Missing' : 'Target Template'}
          </span>
        </div>
      </div>

      <div className="p-4">
        <input type="file" accept=".psd" className="hidden" ref={fileInputRef} onChange={handleFileChange} />

        {/* RE-HYDRATION UI */}
        {isDehydrated && !isLoading && (
            <div className="flex flex-col space-y-3">
                <div className="text-[11px] text-orange-200/90 leading-tight bg-orange-900/20 p-2 rounded border border-orange-500/20">
                   <strong>Structure loaded, binary missing.</strong><br/>
                   The target structure is known, but the binary PSD file is needed to construct the final export.
                   <br/><br/>
                   Please re-upload: <span className="font-mono text-orange-100 bg-black/20 px-1 rounded">{data.fileName}</span>
                </div>
                
                <button 
                  onClick={handleBoxClick}
                  className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-xs font-bold uppercase tracking-wider shadow-lg transition-colors flex items-center justify-center space-x-2"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <span>Re-upload File</span>
                </button>
            </div>
        )}

        {!isDataLoaded && !isLoading && !isDehydrated && (
          <div onClick={handleBoxClick} className="group cursor-pointer border-2 border-dashed border-slate-600 hover:border-emerald-500 rounded-md p-6 flex flex-col items-center justify-center transition-colors bg-slate-800/50 hover:bg-slate-700/50"
          >
             <svg className="w-8 h-8 text-slate-500 group-hover:text-emerald-400 mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
             </svg>
             <span className="text-xs text-slate-400 group-hover:text-slate-300 text-center font-medium">
               Load Target .psd
             </span>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <svg className="animate-spin h-6 w-6 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-xs text-slate-300">Analyzing target structure...</span>
          </div>
        )}

        {isDataLoaded && !isLoading && !isDehydrated && (
           <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
              <div className="flex items-center space-x-2 mb-2">
                 <div className="bg-emerald-500/20 text-emerald-400 p-1 rounded-full shrink-0">
                   <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                 </div>
                 <span className="text-xs font-medium text-slate-200 truncate" title={data.fileName || 'target.psd'}>{data.fileName}</span>
              </div>
              
              {data.template && <TargetTemplatePreview metadata={data.template} />}
              
              <div className="flex justify-end mt-2">
                <button 
                  onClick={handleBoxClick} 
                  className="py-1 px-3 bg-slate-700 hover:bg-slate-600 text-[10px] text-slate-300 rounded transition-colors uppercase font-medium tracking-wide"
                >
                  Replace
                </button>
              </div>
           </div>
        )}

        {(localError || data.error) && !isLoading && (
          <div className="mt-2 p-3 bg-red-900/30 border border-red-800 rounded text-[10px] text-red-200">
            <span className="font-bold block mb-1">Error Loading Target</span>
            {localError || data.error}
            <button 
              onClick={handleBoxClick} 
              className="block mt-2 underline opacity-80 hover:opacity-100 hover:text-white"
            >
              Try Another File
            </button>
          </div>
        )}
      </div>

      {/* Output Handle - Centered Right */}
      <Handle
        type="source"
        position={Position.Right}
        id="target-metadata-out"
        isConnectable={isConnectable}
        title="Output: Target Template Metadata"
        className={`!w-3 !h-3 !border-2 transition-colors duration-300 ${isConnectable ? '!bg-emerald-500 !border-white' : '!bg-slate-600 !border-slate-400'}`}
        style={{ right: -6, top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  );
});