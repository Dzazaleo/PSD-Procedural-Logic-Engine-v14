import React, { memo, useState, useMemo } from 'react';
import { Handle, Position, NodeProps, useEdges } from 'reactflow';
import { TransformedLayer, TransformedPayload, MappingContext } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { findLayerByPath, writePsdFile } from '../services/psdService';
import { Layer, Psd } from 'ag-psd';
import { GoogleGenAI } from "@google/genai";

// Helper: Calculate closest supported aspect ratio for Nano Banana
const getClosestAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    const targets = {
        "1:1": 1,
        "3:4": 0.75,
        "4:3": 1.333,
        "9:16": 0.5625,
        "16:9": 1.777
    };
    
    // Find closest aspect ratio key
    return Object.keys(targets).reduce((prev, curr) => 
        Math.abs(targets[curr as keyof typeof targets] - ratio) < Math.abs(targets[prev as keyof typeof targets] - ratio) ? curr : prev
    );
};

// Helper: Convert Base64 Data URI to HTMLCanvasElement
const base64ToCanvas = (base64: string, width: number, height: number): Promise<HTMLCanvasElement | null> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                // Determine crop/fit strategy (Cover)
                const targetRatio = width / height;
                const srcRatio = img.width / img.height;
                let renderW, renderH, offsetX, offsetY;

                if (srcRatio > targetRatio) {
                    renderH = height;
                    renderW = height * srcRatio;
                    offsetX = (width - renderW) / 2;
                    offsetY = 0;
                } else {
                    renderW = width;
                    renderH = width / srcRatio;
                    offsetX = 0;
                    offsetY = (height - renderH) / 2;
                }
                
                ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
                resolve(canvas);
            } else {
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = base64;
    });
};

// Helper: Create a transformed version of a standard layer canvas (Rotation/Scale baking)
const applyTransformToCanvas = (
    sourceCanvas: HTMLCanvasElement | HTMLImageElement,
    width: number,
    height: number,
    transform: { scaleX: number, scaleY: number, rotation?: number }
): HTMLCanvasElement => {
    // Create canvas based on target AABB dimensions
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    // Center of new bounds
    const cx = width / 2;
    const cy = height / 2;

    ctx.save();
    ctx.translate(cx, cy);
    if (transform.rotation) {
        ctx.rotate((transform.rotation * Math.PI) / 180);
    }
    
    // Draw centered. We assume 'width' and 'height' passed here are the destination dimensions
    // and the source should be scaled to fit? 
    // Actually, in our pipeline, 'transform.scaleX' was already applied to calculate 'width' and 'height' in the coordinates.
    // But 'sourceCanvas' is the original raw pixels.
    // So we draw sourceCanvas at -w/2, -h/2 with size w, h.
    ctx.drawImage(sourceCanvas, -width / 2, -height / 2, width, height);

    ctx.restore();
    return canvas;
};

// Helper: Generate Image using GenAI SDK
const generateLayerImage = async (
    prompt: string, 
    width: number, 
    height: number, 
    sourceReference?: string
): Promise<HTMLCanvasElement | null> => {
    try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API Key missing");

        const ai = new GoogleGenAI({ apiKey });
        
        // Construct Multi-Modal Request Parts
        const parts: any[] = [];
        
        if (sourceReference) {
            const base64Data = sourceReference.includes('base64,') 
                ? sourceReference.split('base64,')[1] 
                : sourceReference;
            
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: base64Data
                }
            });
        }
        
        parts.push({ text: prompt });

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts },
            config: {
                imageConfig: {
                    aspectRatio: getClosestAspectRatio(width, height) as any
                }
            }
        });
        
        let base64Data = null;
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                base64Data = part.inlineData.data;
                break;
            }
        }
        
        if (!base64Data) throw new Error("No image data returned from API");
        return base64ToCanvas(`data:image/png;base64,${base64Data}`, width, height);

    } catch (e) {
        console.error("Generative Fill Failed:", e);
        return null;
    }
};

export const ExportPSDNode = memo(({ id }: NodeProps) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string>('Idle');
  const [exportError, setExportError] = useState<string | null>(null);

  const edges = useEdges();
  
  // Access global registries 
  const { psdRegistry, templateRegistry, payloadRegistry, reviewerRegistry, resolvedRegistry } = useProceduralStore();

  // 1. Resolve Connected Target Template from Store via Edge Source
  const templateMetadata = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'template-input');
    if (!edge) return null;
    return templateRegistry[edge.source];
  }, [edges, id, templateRegistry]);

  const containers = templateMetadata?.containers || [];

  // 2. Map Connections to Payloads (RESTORED DIRECT LOGIC)
  const { slotConnections, validationErrors } = useMemo(() => {
    const map = new Map<string, TransformedPayload>();
    const errors: string[] = [];
    
    edges.forEach(edge => {
      if (edge.target !== id) return;
      if (!edge.targetHandle?.startsWith('input-')) return;

      const slotName = edge.targetHandle.replace('input-', '');
      
      // Lookup Strategy: Reviewer (Polished) -> Remapper (Procedural) -> Resolver (Raw)
      // This allows bypassing the review step if needed, or connecting raw logic.
      
      let payload = reviewerRegistry[edge.source]?.[edge.sourceHandle || ''];

      if (!payload) {
          payload = payloadRegistry[edge.source]?.[edge.sourceHandle || ''];
      }

      // If still no payload, check if it's a raw Resolver connection and warn/handle
      // Since Resolver outputs MappingContext, not TransformedPayload, we would strictly need
      // a remapper to make it usable. So we won't implicitly convert here to avoid complexity.
      // We assume the graph flow is enforced by connection rules in App.tsx.

      if (payload) {
         if (payload.status !== 'error') {
            map.set(slotName, payload);
         }
      }
    });

    return { slotConnections: map, validationErrors: errors };
  }, [edges, id, payloadRegistry, reviewerRegistry]);

  // 3. Status Calculation
  const totalSlots = containers.length;
  const filledSlots = slotConnections.size;
  const isTemplateReady = !!templateMetadata;
  const isExportReady = isTemplateReady && filledSlots > 0 && validationErrors.length === 0;
  
  // 4. Export Logic
  const handleExport = async () => {
    if (!templateMetadata || !isExportReady) return;
    
    setIsExporting(true);
    setExportError(null);
    setExportStatus('Analyzing procedural graph...');

    try {
      // A. Initialize New PSD Structure
      const newPsd: Psd = {
        width: templateMetadata.canvas.width,
        height: templateMetadata.canvas.height,
        children: [],
      };

      // B. Synthesis Phase: Pre-generate or Reuse AI assets
      const generatedAssets = new Map<string, HTMLCanvasElement>();
      const generationTasks: Promise<void>[] = [];

      setExportStatus('Synthesizing AI Layers...');

      for (const container of containers) {
          const payload = slotConnections.get(container.name);
          if (!payload) continue;
          
          const findGenerativeLayers = (layers: TransformedLayer[]) => {
              for (const layer of layers) {
                  // FILTER: Only process generative layers if they are CONFIRMED
                  if (layer.type === 'generative' && layer.generativePrompt && payload.isConfirmed) {
                      if (payload.previewUrl) {
                          const task = async () => {
                              try {
                                  const canvas = await base64ToCanvas(
                                      payload.previewUrl!, 
                                      layer.coords.w, 
                                      layer.coords.h
                                  );
                                  if (canvas) {
                                      generatedAssets.set(layer.id, canvas);
                                  }
                              } catch (err) {
                                  console.error(`[Export] Asset processing error: ${err}`);
                              }
                          };
                          generationTasks.push(task());
                      } else {
                          const task = async () => {
                              const canvas = await generateLayerImage(
                                  layer.generativePrompt!, 
                                  layer.coords.w, 
                                  layer.coords.h,
                                  payload.sourceReference
                              );
                              if (canvas) {
                                  generatedAssets.set(layer.id, canvas);
                              }
                          };
                          generationTasks.push(task());
                      }
                  }
                  if (layer.children) findGenerativeLayers(layer.children);
              }
          };
          
          if (payload.layers) {
              findGenerativeLayers(payload.layers);
          }
      }

      if (generationTasks.length > 0) {
          setExportStatus(`Compiling ${generationTasks.length} high-fidelity assets...`);
          await Promise.all(generationTasks);
      }

      // C. Assembly Phase: Reconstruct Hierarchy with Rotation/Scale Banking
      setExportStatus('Assembling PSD structure...');

      const reconstructHierarchy = (
        transformedLayers: TransformedLayer[], 
        sourcePsd: Psd | undefined,
        assets: Map<string, HTMLCanvasElement>
      ): Layer[] => {
        const resultLayers: Layer[] = [];

        for (const metaLayer of transformedLayers) {
            let newLayer: Layer | undefined;

            // BRANCH 1: Generative Layer (Synthetic)
            if (metaLayer.type === 'generative') {
                const asset = assets.get(metaLayer.id);
                if (asset) {
                    newLayer = {
                        name: metaLayer.name,
                        top: metaLayer.coords.y,
                        left: metaLayer.coords.x,
                        bottom: metaLayer.coords.y + metaLayer.coords.h,
                        right: metaLayer.coords.x + metaLayer.coords.w,
                        hidden: !metaLayer.isVisible,
                        opacity: metaLayer.opacity * 255,
                        canvas: asset // Inject synthetic pixel data
                    };
                }
            } 
            // BRANCH 2: Standard Layer (Clone + Raster Transform)
            else if (sourcePsd) {
                const originalLayer = findLayerByPath(sourcePsd, metaLayer.id);
                
                if (originalLayer) {
                    // Check if CARO applied overrides requiring raster bake (Rotation)
                    const hasRotation = !!metaLayer.transform.rotation && metaLayer.transform.rotation !== 0;
                    
                    let bakedCanvas = originalLayer.canvas;

                    // If rotation exists, we must re-rasterize the original canvas into a transformed state
                    if (originalLayer.canvas && (hasRotation || metaLayer.transform.scaleX !== 1)) {
                         bakedCanvas = applyTransformToCanvas(
                             originalLayer.canvas as HTMLCanvasElement, 
                             metaLayer.coords.w, 
                             metaLayer.coords.h, 
                             metaLayer.transform
                         );
                    }

                    newLayer = {
                        ...originalLayer, // Copy metadata
                        top: metaLayer.coords.y,
                        left: metaLayer.coords.x,
                        bottom: metaLayer.coords.y + metaLayer.coords.h,
                        right: metaLayer.coords.x + metaLayer.coords.w,
                        hidden: !metaLayer.isVisible,
                        opacity: metaLayer.opacity * 255,
                        children: undefined,
                        canvas: bakedCanvas
                    };
                    
                    if (metaLayer.type === 'group' && metaLayer.children) {
                        newLayer.children = reconstructHierarchy(metaLayer.children, sourcePsd, assets);
                        newLayer.opened = true;
                    }
                }
            }

            if (newLayer) {
                resultLayers.push(newLayer);
            }
        }
        return resultLayers;
      };

      const finalChildren: Layer[] = [];

      for (const container of containers) {
          const payload = slotConnections.get(container.name);
          
          if (payload) {
              const sourcePsd = psdRegistry[payload.sourceNodeId];
              
              const reconstructedContent = reconstructHierarchy(
                  payload.layers, 
                  sourcePsd, 
                  generatedAssets
              );
              
              const containerGroup: Layer = {
                  name: container.originalName,
                  children: reconstructedContent,
                  opened: true,
                  top: container.bounds.y,
                  left: container.bounds.x,
                  bottom: container.bounds.y + container.bounds.h,
                  right: container.bounds.x + container.bounds.w,
              };

              finalChildren.push(containerGroup);
          }
      }

      newPsd.children = finalChildren;

      // D. Write to File
      setExportStatus('Finalizing binary...');
      await writePsdFile(newPsd, `PROCEDURAL_EXPORT_${Date.now()}.psd`);
      setExportStatus('Done');

    } catch (e: any) {
        console.error("Export Failed:", e);
        setExportError(e.message || "Unknown export error");
    } finally {
        setIsExporting(false);
        setTimeout(() => setExportStatus('Idle'), 3000);
    }
  };

  return (
    <div className="min-w-[300px] bg-slate-900 rounded-lg shadow-2xl border border-indigo-500 overflow-hidden font-sans">
      
      {/* Header Area */}
      <div className="relative bg-slate-800/50 p-2 border-b border-slate-700">
         <div className="flex items-center space-x-2 mb-2">
             <div className="p-1.5 bg-indigo-500/20 rounded-full border border-indigo-500/50">
                 <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                 </svg>
             </div>
             <div>
                <h3 className="text-sm font-bold text-slate-100 leading-none">Export PSD</h3>
                <span className="text-[10px] text-slate-400">Synthesis Engine</span>
             </div>
         </div>
         
         <div className="relative pl-4 py-1 flex items-center">
             <Handle 
               type="target" 
               position={Position.Left} 
               id="template-input" 
               className="!w-3 !h-3 !-left-1.5 !bg-emerald-500 !border-2 !border-slate-800" 
               title="Target Template Definition"
             />
             <span className={`text-xs font-mono ${isTemplateReady ? 'text-emerald-400' : 'text-slate-500 italic'}`}>
                {isTemplateReady ? `${templateMetadata?.canvas.width}x${templateMetadata?.canvas.height} px` : 'Connect Template...'}
             </span>
         </div>
      </div>

      {/* Dynamic Slots Area */}
      <div className="bg-slate-900 p-2 space-y-1 max-h-64 overflow-y-auto custom-scrollbar">
          {!isTemplateReady ? (
              <div className="text-[10px] text-slate-500 text-center py-4 border border-dashed border-slate-800 rounded mx-2 my-2">
                  Waiting for Target Template...
              </div>
          ) : (
              containers.map(container => {
                  const isFilled = slotConnections.has(container.name);
                  const payload = slotConnections.get(container.name);
                  const isGen = payload?.requiresGeneration || payload?.previewUrl; 
                  // Check if polished/reviewed
                  const isPolished = payload?.isPolished;

                  return (
                      <div 
                        key={container.id} 
                        className={`relative flex items-center justify-between p-2 pl-4 rounded border transition-colors ${
                            isFilled 
                            ? 'bg-indigo-900/20 border-indigo-500/30' 
                            : 'bg-slate-800/50 border-slate-700/50'
                        }`}
                      >
                          <Handle 
                            type="target" 
                            position={Position.Left} 
                            id={`input-${container.name}`}
                            className={`!w-3 !h-3 !-left-1.5 !border-2 transition-colors duration-200 ${
                                isFilled 
                                ? '!bg-indigo-500 !border-white' 
                                : '!bg-slate-700 !border-slate-500'
                            }`}
                            title={`Input for ${container.name}`} 
                          />
                          
                          <div className="flex flex-col flex-1 mr-2 overflow-hidden">
                              <span className={`text-xs font-medium truncate ${isFilled ? 'text-indigo-200' : 'text-slate-400'}`}>
                                  {container.name}
                              </span>
                              <div className="flex items-center space-x-1.5 mt-0.5">
                                  {isGen && (
                                      <span className="text-[8px] text-purple-400 font-mono leading-none">
                                          ✨ AI
                                      </span>
                                  )}
                                  {isPolished ? (
                                      <span className="text-[8px] text-emerald-400 font-mono leading-none">
                                          POLISHED
                                      </span>
                                  ) : isFilled ? (
                                      <span className="text-[8px] text-indigo-400 font-mono leading-none">
                                          PROCEDURAL
                                      </span>
                                  ) : null}
                              </div>
                          </div>
                          
                          {isFilled ? (
                              <svg className="w-3 h-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                          ) : (
                              <span className="text-[9px] text-slate-600">Empty</span>
                          )}
                      </div>
                  );
              })
          )}
      </div>

      {/* Footer / Actions */}
      <div className="p-3 bg-slate-800 border-t border-slate-700">
          <div className="flex justify-between text-[10px] text-slate-400 mb-2 font-mono border-b border-slate-700 pb-2">
              <span>ASSEMBLY STATUS</span>
              <span className={isExportReady ? 'text-emerald-400 font-bold' : 'text-orange-400'}>
                  {filledSlots} / {totalSlots} SLOTS
              </span>
          </div>

          {validationErrors.length > 0 && (
               <div className="mb-2 p-2 bg-orange-900/30 border border-orange-800/50 rounded space-y-1">
                   {validationErrors.map((err, i) => (
                       <div key={i} className="text-[9px] text-orange-200 flex items-start space-x-1">
                           <span className="font-bold text-orange-500 shrink-0">!</span>
                           <span className="leading-tight">{err}</span>
                       </div>
                   ))}
               </div>
          )}

          {exportError && (
              <div className="text-[10px] bg-red-900/40 text-red-200 p-2 rounded border border-red-800/50 mb-2">
                  ERROR: {exportError}
              </div>
          )}

          <button
            onClick={handleExport}
            disabled={!isExportReady || isExporting}
            className={`w-full py-2 px-4 rounded text-xs font-bold uppercase tracking-wider transition-all shadow-lg
                ${isExportReady && !isExporting
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white cursor-pointer transform hover:-translate-y-0.5' 
                    : 'bg-slate-700 text-slate-500 cursor-not-allowed border border-slate-600'}
            `}
          >
             {isExporting ? (
                 <span className="flex items-center justify-center space-x-2">
                     <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                     <span className="truncate">{exportStatus}</span>
                 </span>
             ) : (
                 filledSlots < totalSlots && filledSlots > 0
                    ? `Export Partial PSD (${filledSlots}/${totalSlots})`
                    : "Export Full PSD"
             )}
          </button>
      </div>
    </div>
  );
});