import React, { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Handle, Position, NodeProps, NodeResizer, useEdges, useReactFlow, useUpdateNodeInternals, useNodes } from 'reactflow';
import { PSDNodeData, TransformedPayload, ReviewerInstanceState, ReviewerStrategy, TransformedLayer, LayerOverride, ChatMessage } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { findLayerByPath } from '../services/psdService';
import { GoogleGenAI, Type } from "@google/genai";
import { Psd } from 'ag-psd';
import { BrainCircuit, Activity, ShieldCheck, Move, Maximize, RotateCw, CheckCircle2, ArrowRight, ScanEye } from 'lucide-react';

const DEFAULT_REVIEWER_STATE: ReviewerInstanceState = {
    chatHistory: [],
    reviewerStrategy: null
};

// --- HELPER: Visual Compositor ---
// Renders the current mathematical layout onto a canvas for AI Vision
const renderCurrentState = async (payload: TransformedPayload, psd: Psd): Promise<string | null> => {
    if (!payload || !psd) return null;

    const { w, h } = payload.metrics.target;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fill background (Dark slate to help AI see boundaries)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const drawLayers = (layers: TransformedLayer[]) => {
        // Reverse painter's algorithm (bottom-up)
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            
            if (layer.isVisible) {
                // 1. Draw Image Content (if standard layer)
                if (layer.type !== 'generative' && layer.type !== 'group') {
                    const originalLayer = findLayerByPath(psd, layer.id);
                    if (originalLayer && originalLayer.canvas) {
                        try {
                            // Draw at transformed coordinates
                            ctx.globalAlpha = layer.opacity;
                            ctx.drawImage(
                                originalLayer.canvas, 
                                layer.coords.x, 
                                layer.coords.y, 
                                layer.coords.w, 
                                layer.coords.h
                            );
                        } catch (e) {
                            console.warn("Failed to draw layer:", layer.name);
                        }
                    }
                }
                
                // 2. Draw Generative Placeholder (if gen layer)
                if (layer.type === 'generative') {
                    ctx.fillStyle = 'rgba(192, 132, 252, 0.3)'; // Purple tint
                    ctx.strokeStyle = 'rgba(192, 132, 252, 0.8)';
                    ctx.lineWidth = 2;
                    ctx.fillRect(layer.coords.x, layer.coords.y, layer.coords.w, layer.coords.h);
                    ctx.strokeRect(layer.coords.x, layer.coords.y, layer.coords.w, layer.coords.h);
                }

                ctx.globalAlpha = 1.0;

                // Recursion
                if (layer.children) {
                    drawLayers(layer.children);
                }
            }
        }
    };

    drawLayers(payload.layers);

    // Export high-quality JPEG for Vision
    return canvas.toDataURL('image/jpeg', 0.9);
};

// --- HELPER: Apply Nudges ---
// Creates a new payload by applying CARO's overrides to the geometry
const applyOverridesToPayload = (payload: TransformedPayload, overrides: LayerOverride[]): TransformedPayload => {
  const deepUpdate = (layers: TransformedLayer[]): TransformedLayer[] => {
    return layers.map(layer => {
      const override = overrides.find(o => o.layerId === layer.id);
      let newLayer = { ...layer };
      
      if (override) {
        // Apply geometric nudges (Offsets are additive to current state)
        const newX = layer.coords.x + override.xOffset;
        const newY = layer.coords.y + override.yOffset;
        
        // Scale is multiplicative
        const scaleMult = override.individualScale || 1;
        
        newLayer.coords = {
            ...layer.coords,
            x: newX,
            y: newY,
            w: layer.coords.w * scaleMult,
            h: layer.coords.h * scaleMult
        };
        
        newLayer.transform = {
            ...layer.transform,
            scaleX: layer.transform.scaleX * scaleMult,
            scaleY: layer.transform.scaleY * scaleMult,
            offsetX: newX,
            offsetY: newY,
            rotation: (layer.transform.rotation || 0) + (override.rotation || 0)
        };
      }
      
      if (layer.children) {
        newLayer.children = deepUpdate(layer.children);
      }
      
      return newLayer;
    });
  };

  return {
    ...payload,
    layers: deepUpdate(payload.layers),
    isPolished: true
  };
};

// --- Subcomponent: Nudge Matrix ---
const NudgeMatrix: React.FC<{ strategy: ReviewerStrategy | null }> = ({ strategy }) => {
    if (!strategy) return null;
    
    const overrides = strategy.overrides || [];
    return (
        <div className="bg-slate-950/80 border border-emerald-500/20 rounded p-2 mt-2 space-y-1">
            <div className="flex justify-between items-center border-b border-emerald-900/50 pb-1 mb-1">
                <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-widest">Aesthetic Deltas</span>
                <span className="text-[8px] text-emerald-600 font-mono">{overrides.length} Layers Polished</span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
                <div className="flex flex-col bg-emerald-950/20 p-1 rounded">
                    <span className="text-[7px] text-emerald-600 uppercase">Pos</span>
                    <ShieldCheck className="w-2.5 h-2.5 mx-auto my-0.5 text-emerald-400" />
                </div>
                <div className="flex flex-col bg-emerald-950/20 p-1 rounded">
                    <span className="text-[7px] text-emerald-600 uppercase">Scale</span>
                    <Maximize className="w-2.5 h-2.5 mx-auto my-0.5 text-emerald-400" />
                </div>
                <div className="flex flex-col bg-emerald-950/20 p-1 rounded">
                    <span className="text-[7px] text-emerald-600 uppercase">Rot</span>
                    <RotateCw className="w-2.5 h-2.5 mx-auto my-0.5 text-emerald-400" />
                </div>
                <div className="flex flex-col bg-emerald-950/20 p-1 rounded">
                    <span className="text-[7px] text-emerald-600 uppercase">Sync</span>
                    <Activity className="w-2.5 h-2.5 mx-auto my-0.5 text-emerald-500 animate-pulse" />
                </div>
            </div>
        </div>
    );
};

// --- Subcomponent: Instance Row ---
const ReviewerInstanceRow: React.FC<{
    index: number;
    nodeId: string;
    state: ReviewerInstanceState;
    incomingPayload: TransformedPayload | null;
    onReview: (index: number) => void;
    isProcessing: boolean;
}> = ({ index, nodeId, state, incomingPayload, onReview, isProcessing }) => {
    const isReady = !!incomingPayload;
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const { registerReviewerPayload } = useProceduralStore();

    // Isolated Scroll
    useEffect(() => {
        const container = chatContainerRef.current;
        if (!container) return;
        const handleWheel = (e: WheelEvent) => e.stopPropagation();
        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    // Auto-scroll chat
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [state.chatHistory]);

    // Apply Overrides Effect (State -> Store)
    useEffect(() => {
        if (!incomingPayload) return;

        // If we have a strategy, calculate the NEW geometry
        if (state.reviewerStrategy) {
            const finalPayload = applyOverridesToPayload(incomingPayload, state.reviewerStrategy.overrides);
            registerReviewerPayload(nodeId, `polished-out-${index}`, finalPayload);
        } else {
            // Pass-through if no audit performed yet
            const cleanPayload = { ...incomingPayload, isPolished: false };
            registerReviewerPayload(nodeId, `polished-out-${index}`, cleanPayload);
        }

    }, [incomingPayload, state.reviewerStrategy, nodeId, index, registerReviewerPayload]);


    return (
        <div className="relative border-b border-emerald-900/30 bg-slate-900/20 p-3 space-y-3">
            {/* Headers & Wiring */}
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_#10b981]"></div>
                    <span className="text-[10px] font-bold text-emerald-100 uppercase tracking-wider">
                        {incomingPayload?.targetContainer || `Auditor ${index + 1}`}
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    <Handle type="target" position={Position.Left} id={`payload-in-${index}`} className="!static !w-2.5 !h-2.5 !bg-indigo-500 !border-slate-900" title="Input: Transformed Payload" />
                    <Handle type="target" position={Position.Left} id={`target-in-${index}`} className="!static !w-2.5 !h-2.5 !bg-emerald-500 !border-slate-900" title="Input: Target Definition" />
                </div>
            </div>

            {/* Audit Console */}
            <div 
                ref={chatContainerRef}
                className="h-32 bg-black/40 border border-emerald-900/50 rounded p-2 overflow-y-auto custom-scrollbar font-mono text-[9px] leading-tight space-y-2 cursor-auto"
                onMouseDown={e => e.stopPropagation()}
            >
                {state.chatHistory.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-emerald-900/50 italic">
                        [WAITING_FOR_PAYLOAD_READY]
                    </div>
                ) : (
                    state.chatHistory.map((msg, i) => (
                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`${msg.role === 'model' ? 'text-emerald-400' : 'text-slate-500'} bg-slate-900/80 p-1.5 rounded border border-emerald-900/30`}>
                                <span className="font-bold opacity-50 mr-1">[{msg.role.toUpperCase()}]</span>
                                {msg.parts[0].text}
                            </div>
                            {msg.strategySnapshot && (
                                <div className="mt-1 pl-2 text-emerald-600 italic">
                                    &gt; Applied {msg.strategySnapshot.overrides.length} surgical nudges.
                                </div>
                            )}
                        </div>
                    ))
                )}
                {isProcessing && (
                     <div className="flex items-center space-x-2 text-emerald-500 animate-pulse mt-2">
                        <ScanEye className="w-3 h-3" />
                        <span>CARO is reconciling optics...</span>
                     </div>
                )}
            </div>

            {/* Metrics & Output */}
            <div className="flex items-end justify-between space-x-4">
                <div className="flex-1">
                    <NudgeMatrix strategy={state.reviewerStrategy} />
                </div>
                <div className="flex flex-col items-end space-y-2">
                    <button 
                        onClick={() => onReview(index)}
                        disabled={!isReady || isProcessing}
                        className={`px-3 py-1.5 rounded text-[9px] font-bold uppercase transition-all flex items-center gap-1 ${isReady && !isProcessing ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                    >
                        {isProcessing ? <Activity className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                        <span>Reconcile</span>
                    </button>
                    <div className="relative">
                        <span className="text-[7px] text-emerald-700 font-mono mr-5">POLISHED_OUT</span>
                        <Handle type="source" position={Position.Right} id={`polished-out-${index}`} className="!absolute !right-[-8px] !top-1/2 !-translate-y-1/2 !w-3 !h-3 !bg-white !border-emerald-500" title="Output: Aesthetic Sign-off" />
                    </div>
                </div>
            </div>
        </div>
    );
};

export const DesignReviewerNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const instanceCount = data.instanceCount || 1;
  const reviewerInstances = data.reviewerInstances || {};
  const [processingState, setProcessingState] = useState<Record<number, boolean>>({});
  
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const { payloadRegistry, psdRegistry, unregisterNode } = useProceduralStore();
  
  const edges = useEdges();

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, instanceCount, updateNodeInternals]);

  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  const getIncomingPayload = useCallback((index: number) => {
    const edge = edges.find(e => e.target === id && e.targetHandle === `payload-in-${index}`);
    if (!edge) return null;
    const nodePayloads = payloadRegistry[edge.source];
    return nodePayloads ? nodePayloads[edge.sourceHandle || ''] : null;
  }, [id, payloadRegistry, edges]);

  const handleReview = async (index: number) => {
      const payload = getIncomingPayload(index);
      if (!payload) return;

      const psd = psdRegistry[payload.sourceNodeId];
      if (!psd) {
          console.error("Binary PSD source not found for visual compositing.");
          return;
      }

      setProcessingState(prev => ({ ...prev, [index]: true }));

      try {
          // 1. Render Visual Context (Vision)
          const visualBase64 = await renderCurrentState(payload, psd);
          if (!visualBase64) throw new Error("Failed to composite visual state.");

          // 2. Prepare AI Request
          const apiKey = process.env.API_KEY;
          if (!apiKey) throw new Error("API Key missing");
          const ai = new GoogleGenAI({ apiKey });

          // 3. Simplify Layer Hierarchy for Tokens
          const simplifiedLayers = payload.layers.map(l => ({
              id: l.id,
              name: l.name,
              x: Math.round(l.coords.x),
              y: Math.round(l.coords.y),
              w: Math.round(l.coords.w),
              h: Math.round(l.coords.h),
              type: l.type
          }));

          const prompt = `
            ROLE: CARO (Chief Aesthetic Reconciliation Officer).
            TASK: Optical Audit & Surgical Correction.
            
            CONTEXT:
            - Target Container: ${payload.targetContainer}
            - Current Scale Factor: ${payload.scaleFactor}
            
            INPUT:
            1. An image of the current procedural layout (Rendered).
            2. A JSON list of layers corresponding to that image.
            
            YOUR JOB:
            Identify aesthetic collisions (e.g., text overlapping objects, awkward tangents, visual imbalance) that purely mathematical resizing missed.
            Provide precise 'nudges' (offsets, scale adjustments) to achieve Optical Equilibrium.
            
            RULES:
            - DO NOT change content. 
            - DO NOT delete layers.
            - ONLY apply offsets (xOffset, yOffset) and micro-scaling (individualScale).
            - 'individualScale' is a multiplier (e.g. 0.95 = shrink 5%).
            
            OUTPUT JSON:
            {
                "CARO_Audit": "Brief, clinical report of friction points found (e.g., 'Corrected overlap between Prize Text and Bottle neck').",
                "overrides": [
                    { "layerId": "string (must match input)", "xOffset": number, "yOffset": number, "individualScale": number, "rotation": number }
                ]
            }
          `;

          const parts: any[] = [
              { text: prompt },
              { text: `LAYER HIERARCHY:\n${JSON.stringify(simplifiedLayers.slice(0, 50))}` }, // Limit context
              { inlineData: { mimeType: 'image/jpeg', data: visualBase64.split(',')[1] } }
          ];

          // 4. Call Gemini
          const response = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: { parts },
              config: {
                  responseMimeType: "application/json",
                  responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                          CARO_Audit: { type: Type.STRING },
                          overrides: {
                              type: Type.ARRAY,
                              items: {
                                  type: Type.OBJECT,
                                  properties: {
                                      layerId: { type: Type.STRING },
                                      xOffset: { type: Type.NUMBER },
                                      yOffset: { type: Type.NUMBER },
                                      individualScale: { type: Type.NUMBER },
                                      rotation: { type: Type.NUMBER }
                                  },
                                  required: ['layerId', 'xOffset', 'yOffset', 'individualScale']
                              }
                          }
                      },
                      required: ['CARO_Audit', 'overrides']
                  }
              }
          });

          // 5. Process Response
          const result = JSON.parse(response.text || '{}');
          
          const newStrategy: ReviewerStrategy = {
              CARO_Audit: result.CARO_Audit,
              overrides: result.overrides
          };

          const newLog: ChatMessage = {
              id: Date.now().toString(),
              role: 'model',
              parts: [{ text: result.CARO_Audit }],
              strategySnapshot: { ...payload.metrics, overrides: result.overrides } as any, // Mock strategy for UI compatibility
              timestamp: Date.now()
          };

          // 6. Update Node Data
          setNodes(nds => nds.map(n => {
              if (n.id === id) {
                  const currentInstances = n.data.reviewerInstances || {};
                  const oldState = currentInstances[index] || DEFAULT_REVIEWER_STATE;
                  return {
                      ...n,
                      data: {
                          ...n.data,
                          reviewerInstances: {
                              ...currentInstances,
                              [index]: {
                                  ...oldState,
                                  chatHistory: [...oldState.chatHistory, newLog],
                                  reviewerStrategy: newStrategy
                              }
                          }
                      }
                  };
              }
              return n;
          }));

      } catch (e) {
          console.error("CARO Audit Failed:", e);
      } finally {
          setProcessingState(prev => ({ ...prev, [index]: false }));
      }
  };

  const addInstance = () => {
      setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, instanceCount: instanceCount + 1 } } : n));
  };

  return (
    <div className="w-[400px] bg-slate-900 rounded-lg shadow-2xl border border-emerald-500/50 font-sans flex flex-col overflow-hidden transition-colors hover:border-emerald-400">
      <NodeResizer minWidth={400} minHeight={300} isVisible={true} lineStyle={{ border: 'none' }} handleStyle={{ background: 'transparent' }} />
      
      {/* Header */}
      <div className="bg-emerald-950/80 p-2 border-b border-emerald-500/30 flex items-center justify-between relative overflow-hidden">
         <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10"></div>
         <div className="flex items-center space-x-2 z-10">
           <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
           <div className="flex flex-col leading-none">
             <span className="text-sm font-bold text-emerald-100 tracking-tight">Design Reviewer</span>
             <span className="text-[9px] text-emerald-500/70 font-mono">PERSONA: CARO</span>
           </div>
         </div>
         <div className="z-10 px-1.5 py-0.5 rounded border border-emerald-500/50 bg-emerald-500/10 text-[8px] text-emerald-400 font-bold uppercase tracking-widest">
            Audit Gate
         </div>
      </div>

      <div className="flex flex-col bg-slate-950">
          {Array.from({ length: instanceCount }).map((_, i) => (
              <ReviewerInstanceRow 
                key={i} 
                index={i} 
                nodeId={id}
                state={reviewerInstances[i] || { chatHistory: [], reviewerStrategy: null }}
                incomingPayload={getIncomingPayload(i)}
                onReview={handleReview}
                isProcessing={!!processingState[i]}
              />
          ))}
      </div>

      <button onClick={addInstance} className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-emerald-600 hover:text-emerald-400 text-[9px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center space-x-2 border-t border-emerald-900/50">
          <ArrowRight className="w-3 h-3" />
          <span>Add Audit Instance</span>
      </button>
    </div>
  );
});