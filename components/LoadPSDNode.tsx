import React, { memo, useCallback, useState, useRef, useEffect } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { parsePsdFile, extractTemplateMetadata, mapLayersToContainers, getCleanLayerTree, getSemanticTheme } from '../services/psdService';
import { PSDNodeData, TemplateMetadata } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';

// Sub-component for visualizing the template structure
const TemplatePreview: React.FC<{ metadata: TemplateMetadata }> = ({ metadata }) => {
  const { canvas, containers } = metadata;
  
  // Calculate aspect ratio for the container div
  const aspectRatio = canvas.height / canvas.width;
  
  // w-56 is 224px in Tailwind
  const PREVIEW_WIDTH = 224;
  const previewHeight = PREVIEW_WIDTH * aspectRatio;

  return (
    <div className="w-full mt-2 flex flex-col items-center">
      <div className="w-full flex justify-between items-end mb-1 px-1">
        <span className="text-[10px] uppercase text-slate-500 font-semibold tracking-wider">Template Preview</span>
        <span className="text-[9px] text-slate-600">{canvas.width} x {canvas.height}</span>
      </div>
      
      {/* Canvas container with fixed width of 224px (w-56) and calculated height */}
      <div 
        className="relative w-56 bg-black/40 border border-slate-700 rounded overflow-hidden shadow-sm"
        style={{ height: `${previewHeight}px` }}
      >
        <div className="absolute inset-0">
          {containers.length === 0 && (
            <div className="flex items-center justify-center h-full w-full text-slate-600 text-[10px]">
              No !!TEMPLATE group found
            </div>
          )}
          
          {containers.map((container, index) => (
            <div
              key={container.id}
              className={`absolute border flex flex-col justify-start items-start overflow-hidden transition-opacity hover:opacity-100 opacity-80 ${getSemanticTheme(container.originalName, index)}`}
              style={{
                top: `${container.normalized.y * 100}%`,
                left: `${container.normalized.x * 100}%`,
                width: `${container.normalized.w * 100}%`,
                height: `${container.normalized.h * 100}%`,
              }}
              title={`${container.name} (${container.bounds.w}x${container.bounds.h})`}
            >
              <div className="px-1 py-0.5 bg-black/40 text-[8px] whitespace-nowrap truncate w-full leading-none">
                {container.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const LoadPSDNode = memo(({ data, id }: NodeProps<PSDNodeData>) => {
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setNodes } = useReactFlow();
  
  // Connect to Procedural Store
  const { psdRegistry, registerPsd, registerTemplate, unregisterNode, triggerGlobalRefresh } = useProceduralStore();

  // Determine State
  const isDataLoaded = !!data.template;
  const hasBinary = !!psdRegistry[id];
  const isDehydrated = isDataLoaded && !hasBinary;

  // Cleanup on unmount
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset state
    setIsLoading(true);
    setLocalError(null);

    try {
      console.log(`Parsing file: ${file.name}...`);
      const parsedPsd = await parsePsdFile(file);
      
      console.log(`Parsed PSD: ${parsedPsd.width}x${parsedPsd.height}, children: ${parsedPsd.children?.length}`);

      // Extract template metadata
      const templateData = extractTemplateMetadata(parsedPsd);
      
      // Validate procedural rules
      const validationReport = mapLayersToContainers(parsedPsd, templateData);

      // Extract clean visual design layer hierarchy
      const designLayers = parsedPsd.children ? getCleanLayerTree(parsedPsd.children) : [];

      // REGISTER WITH STORE
      registerPsd(id, parsedPsd);
      registerTemplate(id, templateData);
      
      // Trigger global refresh to notify downstream logic of new binary availability
      triggerGlobalRefresh();

      // Update the node data in the global graph state
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                fileName: file.name,
                template: templateData,
                validation: validationReport,
                designLayers: designLayers, // This reference update helps downstream hooks re-run
                error: null,
              },
            };
          }
          return node;
        })
      );
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to parse PSD';
      setLocalError(errorMessage);
      console.error("PSD processing error:", err);
      
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: {
                ...node.data,
                // On error, if we were re-hydrating, we might want to keep the old metadata visible?
                // For now, let's show the error state.
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
  }, [id, setNodes, registerPsd, registerTemplate, triggerGlobalRefresh]);

  const handleBoxClick = () => {
    fileInputRef.current?.click();
  };

  return (
    // Removed overflow-hidden to prevent clipping of the output handle
    <div className={`w-72 rounded-lg shadow-xl border font-sans transition-colors relative ${isDehydrated ? 'bg-orange-950/30 border-orange-500/50' : 'bg-slate-800 border-slate-600'}`}>
      {/* Title Header - Added rounded-t-lg since parent overflow is no longer hidden */}
      <div className={`p-2 border-b flex items-center justify-between rounded-t-lg ${isDehydrated ? 'bg-orange-900/50 border-orange-700' : 'bg-slate-900 border-slate-700'}`}>
        <div className="flex items-center space-x-2">
          {isDehydrated ? (
             <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
             </svg>
          ) : (
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          )}
          <span className={`text-sm font-semibold ${isDehydrated ? 'text-orange-100' : 'text-slate-200'}`}>
             {isDehydrated ? 'Missing Binary Data' : 'Load PSD'}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        <input
          type="file"
          accept=".psd"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />

        {/* RE-HYDRATION UI */}
        {isDehydrated && !isLoading && (
            <div className="flex flex-col space-y-3">
                <div className="text-[11px] text-orange-200/90 leading-tight bg-orange-900/20 p-2 rounded border border-orange-500/20">
                   <strong>Binary Data Missing.</strong><br/>
                   The project structure was loaded, but the heavy binary data is needed to proceed.
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
          <div 
            onClick={handleBoxClick}
            className="group cursor-pointer border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-md p-6 flex flex-col items-center justify-center transition-colors bg-slate-800/50 hover:bg-slate-700/50"
          >
            <svg className="w-10 h-10 text-slate-500 group-hover:text-blue-400 mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-xs text-slate-400 group-hover:text-slate-300 text-center font-medium">
              Click to select .psd file
            </span>
          </div>
        )}

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm text-slate-300">Parsing structure...</span>
          </div>
        )}

        {isDataLoaded && !isLoading && !isDehydrated && (
          <div className="bg-slate-900/50 rounded p-3 border border-slate-700">
            <div className="flex items-center space-x-2 mb-3">
              <div className="bg-green-500/20 text-green-400 p-1 rounded-full shrink-0">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-xs font-medium text-slate-200 truncate" title={data.fileName || 'file.psd'}>
                {data.fileName}
              </span>
            </div>
            
            {data.template && <TemplatePreview metadata={data.template} />}

            {/* Validation Report */}
            {data.validation && (
              <div className={`mt-3 p-2 rounded border text-[10px] ${data.validation.isValid ? 'border-green-800 bg-green-900/20 text-green-300' : 'border-orange-800 bg-orange-900/20 text-orange-200'}`}>
                <div className="flex items-center space-x-1 mb-1">
                  <span className="font-bold uppercase tracking-wider">{data.validation.isValid ? 'Structure Valid' : 'Violations Detected'}</span>
                </div>
                {!data.validation.isValid && (
                  <ul className="list-disc pl-3 space-y-0.5 opacity-90">
                    {data.validation.issues.slice(0, 3).map((issue, i) => (
                      <li key={i} className="leading-tight">{issue.message}</li>
                    ))}
                    {data.validation.issues.length > 3 && (
                      <li className="italic text-orange-400">...and {data.validation.issues.length - 3} more</li>
                    )}
                  </ul>
                )}
              </div>
            )}
            
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
          <div className="mt-2 p-3 bg-red-900/30 border border-red-800 rounded text-xs text-red-200 break-words">
            <span className="font-semibold block mb-1 text-red-100">Error Parsing File</span>
            {localError || data.error}
            <button 
              onClick={handleBoxClick} 
              className="block mt-2 underline text-red-300 hover:text-white"
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
        id="psd-output"
        isConnectable={isDataLoaded}
        title="Output: Serializable Template Metadata & Design Layers"
        className={`!w-3 !h-3 !border-2 transition-colors duration-300 ${isDataLoaded ? '!bg-blue-500 !border-white hover:!bg-blue-400' : '!bg-slate-600 !border-slate-400'}`}
        style={{ right: -6, top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  );
});