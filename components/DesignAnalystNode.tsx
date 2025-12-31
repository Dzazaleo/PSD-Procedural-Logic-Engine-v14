import React, { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Handle, Position, NodeProps, useEdges, NodeResizer, useReactFlow, useUpdateNodeInternals, useNodes } from 'reactflow';
import { PSDNodeData, LayoutStrategy, SerializableLayer, ChatMessage, AnalystInstanceState, ContainerContext, TemplateMetadata, ContainerDefinition, MappingContext, KnowledgeContext } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { getSemanticThemeObject, findLayerByPath } from '../services/psdService';
import { GoogleGenAI, Type } from "@google/genai";
import { Brain, BrainCircuit, Ban, ClipboardList } from 'lucide-react';
import { Psd } from 'ag-psd';

// Define the exact union type for model keys to match PSDNodeData
type ModelKey = 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-3-pro-thinking';

// CONSTANT: Robust Default State for Type Safety
const DEFAULT_INSTANCE_STATE: AnalystInstanceState = {
    chatHistory: [],
    layoutStrategy: null,
    selectedModel: 'gemini-3-flash',
    isKnowledgeMuted: false
};

interface ModelConfig {
  apiModel: string;
  label: string;
  badgeClass: string;
  headerClass: string;
  thinkingBudget?: number;
}

const MODELS: Record<ModelKey, ModelConfig> = {
  'gemini-3-flash': {
    apiModel: 'gemini-3-flash-preview',
    label: 'FLASH',
    badgeClass: 'bg-yellow-500 text-yellow-950 border-yellow-400',
    headerClass: 'border-yellow-500/50 bg-yellow-900/20'
  },
  'gemini-3-pro': {
    apiModel: 'gemini-3-pro-preview',
    label: 'PRO',
    badgeClass: 'bg-blue-600 text-white border-blue-500',
    headerClass: 'border-blue-500/50 bg-blue-900/20'
  },
  'gemini-3-pro-thinking': {
    apiModel: 'gemini-3-pro-preview',
    label: 'DEEP THINKING',
    badgeClass: 'bg-purple-600 text-white border-purple-500',
    headerClass: 'border-purple-500/50 bg-purple-900/20',
    thinkingBudget: 16384
  }
};

// --- Subcomponent: Strategy Card Renderer ---
// UPDATED: Removed 'Reasoning' text display. It is now handled by the parent container as a "Design Audit".
const StrategyCard: React.FC<{ strategy: LayoutStrategy, modelConfig: ModelConfig }> = ({ strategy, modelConfig }) => {
    const overrideCount = strategy.overrides?.length || 0;

    // Determine method color badge
    let methodColor = 'text-slate-400 border-slate-600';
    if (strategy.method === 'GENERATIVE') methodColor = 'text-purple-300 border-purple-500 bg-purple-900/20';
    else if (strategy.method === 'HYBRID') methodColor = 'text-pink-300 border-pink-500 bg-pink-900/20';
    else if (strategy.method === 'GEOMETRIC') methodColor = 'text-emerald-300 border-emerald-500 bg-emerald-900/20';
    
    return (
        <div 
            className={`bg-slate-800/80 border-l-2 p-3 rounded text-xs space-y-3 w-full cursor-text ${modelConfig.badgeClass.replace('bg-', 'border-').split(' ')[2]}`}
            onMouseDown={(e) => e.stopPropagation()}
        >
             <div className="flex justify-between border-b border-slate-700 pb-2">
                <span className={`font-bold ${modelConfig.badgeClass.includes('yellow') ? 'text-yellow-400' : 'text-blue-300'}`}>SEMANTIC RECOMPOSITION</span>
                <span className="text-slate-400">{strategy.anchor}</span>
             </div>

             <div className="flex items-center space-x-2 mt-1">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono font-bold tracking-wider ${methodColor}`}>
                    {strategy.method || 'GEOMETRIC'}
                </span>
                {strategy.clearance && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-orange-500 text-orange-300 bg-orange-900/20 font-mono font-bold">
                        CLEARANCE
                    </span>
                )}
                {strategy.sourceReference && (
                     <span className="text-[9px] px-1.5 py-0.5 rounded border border-blue-500 text-blue-300 bg-blue-900/20 font-mono font-bold" title="Source Pixels Attached">
                        REF ATTACHED
                     </span>
                )}
             </div>

             {/* Knowledge Badge - Explicit Confirmation */}
             {strategy.knowledgeApplied && (
                 <div className="flex items-center space-x-1.5 p-1 bg-teal-900/30 border border-teal-500/30 rounded mt-1">
                     <Brain className="w-3 h-3 text-teal-400" />
                     <span className="text-[9px] text-teal-300 font-bold uppercase tracking-wider">
                         Knowledge Informed
                     </span>
                 </div>
             )}
             
             {/* Ignored/Muted Badge - Audit Trail */}
             {strategy.knowledgeMuted && (
                 <div className="flex items-center space-x-1.5 p-1 bg-slate-800/50 border border-slate-600 rounded mt-1 opacity-75">
                     <Ban className="w-3 h-3 text-slate-400" />
                     <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider line-through decoration-slate-500">
                         Rules Ignored
                     </span>
                 </div>
             )}
             
             <div className="grid grid-cols-2 gap-4 mt-1">
                <div>
                    <span className="block text-slate-500 text-[10px] uppercase tracking-wider">Global Scale</span>
                    <span className="text-slate-200 font-mono text-sm">{strategy.suggestedScale.toFixed(3)}x</span>
                </div>
                <div>
                    <span className="block text-slate-500 text-[10px] uppercase tracking-wider">Overrides</span>
                    <span className={`text-sm ${overrideCount > 0 ? 'text-pink-400 font-bold' : 'text-slate-400'}`}>
                        {overrideCount} Layers
                    </span>
                </div>
             </div>

             {strategy.safetyReport && strategy.safetyReport.violationCount > 0 && (
                 <div className="bg-orange-900/30 text-orange-200 p-2 rounded flex items-center space-x-2">
                     <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                     <span>{strategy.safetyReport.violationCount} Boundary Warnings</span>
                 </div>
             )}
        </div>
    );
};

// --- Subcomponent: Instance Row ---
interface InstanceRowProps {
    nodeId: string;
    index: number;
    state: AnalystInstanceState;
    sourceData: {
        container: ContainerContext;
        layers: any[];
    } | null;
    targetData: {
        bounds: { w: number, h: number };
        name: string;
    } | null;
    onAnalyze: (index: number) => void;
    onRefine: (index: number, text: string) => void;
    onModelChange: (index: number, model: ModelKey) => void;
    onToggleMute: (index: number) => void;
    isAnalyzing: boolean;
    compactMode: boolean;
    activeKnowledge?: KnowledgeContext | null; // Pass down for visual effect
}

const InstanceRow: React.FC<InstanceRowProps> = ({ 
    nodeId, index, state, sourceData, targetData, onAnalyze, onRefine, onModelChange, onToggleMute, isAnalyzing, compactMode, activeKnowledge 
}) => {
    const [inputText, setInputText] = useState('');
    const chatContainerRef = useRef<HTMLDivElement>(null);
    
    // Auto-scroll chat
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [state.chatHistory.length, isAnalyzing]);

    // Native Wheel Isolation
    useEffect(() => {
        const container = chatContainerRef.current;
        if (!container) return;
        const handleWheel = (e: WheelEvent) => { e.stopPropagation(); };
        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => { container.removeEventListener('wheel', handleWheel); };
    }, []);

    const activeModelConfig = MODELS[state.selectedModel];
    const isReady = !!sourceData && !!targetData;
    const targetName = targetData?.name || (sourceData?.container.containerName) || 'Unknown';
    const theme = getSemanticThemeObject(targetName, index);

    const handleRefineClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!inputText.trim()) return;
        onRefine(index, inputText);
        setInputText('');
    };

    const getPreviewStyle = (w: number, h: number, color: string) => {
        const maxDim = compactMode ? 24 : 32; 
        const ratio = w / h;
        let styleW = maxDim;
        let styleH = maxDim;
        if (ratio > 1) { styleH = maxDim / ratio; }
        else { styleW = maxDim * ratio; }
        return { width: `${styleW}px`, height: `${styleH}px`, borderColor: color };
    };

    return (
        <div className={`relative border-b border-slate-700/50 bg-slate-800/30 first:border-t-0 ${compactMode ? 'py-2' : ''}`}>
            {/* Instance Header */}
            <div className={`px-3 py-2 flex items-center justify-between ${theme.bg.replace('/20', '/10')}`}>
                <div className="flex items-center space-x-2">
                    <div className={`w-2 h-2 rounded-full ${theme.dot}`}></div>
                    <span className={`text-[11px] font-bold tracking-wide uppercase ${theme.text}`}>
                        {targetData?.name || `Instance ${index + 1}`}
                    </span>
                    {/* Knowledge Override Indicator */}
                    {activeKnowledge && state.isKnowledgeMuted && (
                         <span className="flex items-center space-x-1 text-[9px] text-slate-500 font-bold bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-700/50 ml-2">
                             <Ban className="w-2.5 h-2.5" />
                             <span className="line-through decoration-slate-500">RULES</span>
                         </span>
                    )}
                </div>
                
                <div className="flex items-center space-x-2">
                    {/* Semantic Override Toggle */}
                    {activeKnowledge && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onToggleMute(index); }}
                            className={`nodrag nopan p-1 rounded transition-colors border ${
                                state.isKnowledgeMuted 
                                    ? 'bg-slate-800 text-slate-500 border-slate-700 hover:text-slate-400' 
                                    : 'bg-teal-900/30 text-teal-400 border-teal-500/30 hover:bg-teal-900/50 animate-pulse-slow'
                            }`}
                            title={state.isKnowledgeMuted ? "Knowledge Muted (Geometric Mode)" : "Knowledge Active"}
                        >
                            {state.isKnowledgeMuted ? <BrainCircuit className="w-3 h-3 opacity-50" /> : <Brain className="w-3 h-3" />}
                        </button>
                    )}

                    {/* Model Selector */}
                    <div className="relative">
                        <select 
                            value={state.selectedModel}
                            onChange={(e) => onModelChange(index, e.target.value as ModelKey)}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            className={`nodrag nopan appearance-none text-[9px] px-2 py-1 pr-4 rounded font-mono font-bold cursor-pointer outline-none border transition-colors duration-300 ${activeModelConfig.badgeClass}`}
                        >
                            <option value="gemini-3-flash" className="text-black bg-white">FLASH</option>
                            <option value="gemini-3-pro" className="text-black bg-white">PRO</option>
                            <option value="gemini-3-pro-thinking" className="text-black bg-white">DEEP</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className={`p-3 space-y-3 ${compactMode ? 'text-[10px]' : ''}`}>
                
                {/* Visual Wiring & Preview Row */}
                <div className="flex items-center justify-between bg-slate-900/40 rounded p-2 border border-slate-700/30 relative min-h-[60px] overflow-visible">
                    
                    {/* Left Inputs (Source + Target) */}
                    <div className="flex flex-col gap-4 relative justify-center h-full">
                         <div className="relative flex items-center group h-4">
                            <Handle type="target" position={Position.Left} id={`source-in-${index}`} className="!absolute !-left-7 !w-3 !h-3 !rounded-full !bg-indigo-500 !border-2 !border-slate-800 z-50 transition-transform hover:scale-125" style={{ top: '50%', transform: 'translate(-50%, -50%)' }} title="Input: Source Context" />
                            <span className={`text-[9px] font-mono font-bold leading-none ${sourceData ? 'text-indigo-300' : 'text-slate-600'} ml-1`}>SRC</span>
                         </div>
                         <div className="relative flex items-center group h-4">
                            <Handle type="target" position={Position.Left} id={`target-in-${index}`} className="!absolute !-left-7 !w-3 !h-3 !rounded-full !bg-emerald-500 !border-2 !border-slate-800 z-50 transition-transform hover:scale-125" style={{ top: '50%', transform: 'translate(-50%, -50%)' }} title="Input: Target Definition" />
                            <span className={`text-[9px] font-mono font-bold leading-none ${targetData ? 'text-emerald-300' : 'text-slate-600'} ml-1`}>TGT</span>
                         </div>
                    </div>

                    {/* Center Preview */}
                    <div className="flex items-center justify-center space-x-3 mx-4 border-x border-slate-700/20 px-4 flex-1">
                        <div className="flex flex-col items-center gap-1">
                            <div className="border-2 border-dashed flex items-center justify-center bg-indigo-500/10 transition-all duration-300" style={sourceData ? getPreviewStyle(sourceData.container.bounds.w, sourceData.container.bounds.h, '#6366f1') : { width: 24, height: 24, borderColor: '#334155' }}></div>
                            {sourceData && (<span className="text-[8px] font-mono text-slate-500 leading-none">{Math.round(sourceData.container.bounds.w)}x{Math.round(sourceData.container.bounds.h)}</span>)}
                        </div>
                        <div className=""><svg className="w-3 h-3 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg></div>
                        <div className="flex flex-col items-center gap-1">
                            <div className="border-2 border-dashed flex items-center justify-center bg-emerald-500/10 transition-all duration-300" style={targetData ? getPreviewStyle(targetData.bounds.w, targetData.bounds.h, '#10b981') : { width: 24, height: 24, borderColor: '#334155' }}></div>
                             {targetData && (<span className="text-[8px] font-mono text-slate-500 leading-none">{Math.round(targetData.bounds.w)}x{Math.round(targetData.bounds.h)}</span>)}
                        </div>
                    </div>

                    {/* Right Outputs (Source Relay, Target Relay) */}
                    <div className="flex flex-col gap-4 items-end relative justify-center h-full">
                        <div className="relative flex items-center justify-end group h-4">
                            <span className="text-[9px] font-mono font-bold leading-none text-slate-500 mr-1">SOURCE</span>
                            <Handle type="source" position={Position.Right} id={`source-out-${index}`} className="!absolute !-right-7 !w-3 !h-3 !rounded-full !bg-indigo-500 !border-2 !border-white z-50 transition-transform hover:scale-125" style={{ top: '50%', transform: 'translate(50%, -50%)' }} title="Relay: Source Data + AI Strategy" />
                        </div>
                        <div className="relative flex items-center justify-end group h-4">
                            <span className="text-[9px] font-mono font-bold leading-none text-slate-500 mr-1">TARGET</span>
                            <Handle type="source" position={Position.Right} id={`target-out-${index}`} className="!absolute !-right-7 !w-3 !h-3 !rounded-full !bg-emerald-500 !border-2 !border-white z-50 transition-transform hover:scale-125" style={{ top: '50%', transform: 'translate(50%, -50%)' }} title="Relay: Target Definition" />
                        </div>
                    </div>
                </div>

                {/* Chat Console - EXPANDED & EVENT ISOLATED */}
                {/* UPDATED: Reasoning is now elevated as a primary "Audit" header inside the message bubble. */}
                <div ref={chatContainerRef} className={`nodrag nopan ${compactMode ? 'h-48' : 'h-64'} overflow-y-auto border border-slate-700 bg-slate-900 rounded p-3 space-y-3 custom-scrollbar transition-all shadow-inner cursor-auto`} onMouseDown={(e) => e.stopPropagation()}>
                    {state.chatHistory.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600 italic text-xs opacity-50"><span>Ready to analyze {targetData?.name || 'slot'}</span></div>
                    )}
                    {state.chatHistory.map((msg, idx) => (
                        <div key={msg.id || idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                            <div className={`max-w-[95%] rounded border p-3 text-xs leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-slate-800 border-slate-600 text-slate-200' : `bg-slate-800/50 ${activeModelConfig.badgeClass.replace('bg-', 'border-').split(' ')[0]} text-slate-300`}`}>
                                {msg.parts?.[0]?.text && msg.role === 'user' && (<div className="whitespace-pre-wrap break-words">{msg.parts[0].text}</div>)}
                                
                                {msg.role === 'model' && msg.strategySnapshot && (
                                    <div className="flex flex-col gap-3">
                                        {/* AUDIT HEADER */}
                                        <div className="space-y-1.5">
                                            <div className="flex items-center space-x-2 border-b border-slate-700/50 pb-1.5">
                                                <div className="p-1 bg-purple-500/20 rounded">
                                                    <Brain className="w-3 h-3 text-purple-300" />
                                                </div>
                                                <span className="text-[10px] font-bold text-purple-200 uppercase tracking-widest">
                                                    Expert Design Audit
                                                </span>
                                            </div>
                                            <div className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap pl-1">
                                                {msg.strategySnapshot.reasoning}
                                            </div>
                                        </div>

                                        {/* TECHNICAL CARD */}
                                        <StrategyCard strategy={msg.strategySnapshot} modelConfig={activeModelConfig} />
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isAnalyzing && (
                        <div className="flex items-center space-x-2 text-xs text-slate-400 animate-pulse pl-1">
                            <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></div>
                            <span>Analyst is thinking...</span>
                            {activeKnowledge && !state.isKnowledgeMuted && (
                                <span className="text-[9px] text-teal-400 font-bold ml-1 flex items-center gap-1">
                                    <Brain className="w-3 h-3" />
                                    + Rules & Anchors
                                </span>
                            )}
                            {activeKnowledge && state.isKnowledgeMuted && (
                                <span className="text-[9px] text-slate-500 font-bold ml-1 flex items-center gap-1 line-through decoration-slate-500">
                                    <Ban className="w-3 h-3" />
                                    Rules Muted
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Control Footer */}
                <div className="flex items-center space-x-2 pt-2 border-t border-slate-700/30">
                     <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onWheel={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} placeholder="Refinement instructions..." disabled={!isReady || isAnalyzing} className="nodrag nopan flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-10 transition-colors" />
                     <div className="flex space-x-2">
                        <button onClick={(e) => { e.stopPropagation(); onAnalyze(index); }} onMouseDown={(e) => e.stopPropagation()} disabled={!isReady || isAnalyzing} className={`nodrag nopan h-10 px-4 rounded text-[10px] font-bold uppercase transition-all shadow-sm flex items-center justify-center ${isReady && !isAnalyzing ? 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}`}>Analyze</button>
                        <button onClick={handleRefineClick} onMouseDown={(e) => e.stopPropagation()} disabled={!isReady || isAnalyzing || inputText.trim().length === 0} className={`nodrag nopan h-10 px-4 rounded text-[10px] font-bold uppercase transition-all shadow-sm flex items-center justify-center ${inputText.trim().length > 0 && !isAnalyzing ? 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-400' : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700'}`}>Refine</button>
                     </div>
                </div>
            </div>
        </div>
    );
};

export const DesignAnalystNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const [analyzingInstances, setAnalyzingInstances] = useState<Record<number, boolean>>({});
  const instanceCount = data.instanceCount || 1;
  const analystInstances = data.analystInstances || {};
  
  // Ref for debouncing draft generation
  const draftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const edges = useEdges();
  const nodes = useNodes(); // Use nodes to find Source PSD
  const { setNodes } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  
  const { resolvedRegistry, templateRegistry, knowledgeRegistry, registerResolved, registerTemplate, unregisterNode, psdRegistry } = useProceduralStore();

  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, instanceCount, updateNodeInternals]);

  // Derived Title
  const activeContainerNames = useMemo(() => {
    const names: string[] = [];
    for (let i = 0; i < instanceCount; i++) {
        const sourceEdge = edges.find(e => e.target === id && e.targetHandle === `source-in-${i}`);
        if (sourceEdge) {
            const registry = resolvedRegistry[sourceEdge.source];
            const context = registry ? registry[sourceEdge.sourceHandle || ''] : null;
            if (context?.container?.containerName) {
                names.push(context.container.containerName);
            }
        }
    }
    return names;
  }, [edges, id, instanceCount, resolvedRegistry]);
    
  const titleSuffix = activeContainerNames.length > 0 ? `(${activeContainerNames.join(', ')})` : '(Waiting...)';

  // --- Knowledge Discovery ---
  const activeKnowledge = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === 'knowledge-in');
    if (!edge) return null;
    return knowledgeRegistry[edge.source];
  }, [edges, id, knowledgeRegistry]);

  // --- Helpers ---
  const getSourceData = useCallback((index: number) => {
    const edge = edges.find(e => e.target === id && e.targetHandle === `source-in-${index}`);
    if (!edge || !edge.sourceHandle) return null;
    const registry = resolvedRegistry[edge.source];
    return registry ? registry[edge.sourceHandle] : null;
  }, [edges, id, resolvedRegistry]);

  const getTargetData = useCallback((index: number) => {
    const edge = edges.find(e => e.target === id && e.targetHandle === `target-in-${index}`);
    if (!edge) return null;
    const template = templateRegistry[edge.source];
    if (!template) return null;
    let containerName = edge.sourceHandle;
    if (containerName?.startsWith('slot-bounds-')) {
        containerName = containerName.replace('slot-bounds-', '');
    }
    const container = template.containers.find(c => c.name === containerName);
    return container ? { bounds: container.bounds, name: container.name } : null;
  }, [edges, id, templateRegistry]);

  // --- Pixel Extraction Service ---
  const extractSourcePixels = async (layers: SerializableLayer[], bounds: {x: number, y: number, w: number, h: number}): Promise<string | null> => {
      // Find the PSD Node to get the binary data
      const loadPsdNode = nodes.find(n => n.type === 'loadPsd');
      if (!loadPsdNode) return null;
      const psd = psdRegistry[loadPsdNode.id];
      if (!psd) return null;

      // Create a canvas to composite the layers
      const canvas = document.createElement('canvas');
      canvas.width = bounds.w;
      canvas.height = bounds.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const drawLayers = (layerNodes: SerializableLayer[]) => {
          // Iterate in reverse (painter's algorithm: bottom-up)
          for (let i = layerNodes.length - 1; i >= 0; i--) {
              const node = layerNodes[i];
              if (!node.isVisible) continue;

              if (node.children) {
                  drawLayers(node.children);
              } else {
                  const agLayer = findLayerByPath(psd, node.id);
                  if (agLayer && agLayer.canvas) {
                      const dx = (agLayer.left || 0) - bounds.x;
                      const dy = (agLayer.top || 0) - bounds.y;
                      ctx.drawImage(agLayer.canvas, dx, dy);
                  }
              }
          }
      };

      drawLayers(layers);
      return canvas.toDataURL('image/png');
  };

  // --- Store Synchronization Effect ---
  useEffect(() => {
    const syntheticContainers: ContainerDefinition[] = [];
    let canvasDims = { width: 0, height: 0 };

    for (let i = 0; i < instanceCount; i++) {
        const sourceData = getSourceData(i);
        const targetData = getTargetData(i);
        const instanceState = analystInstances[i] || DEFAULT_INSTANCE_STATE;

        if (sourceData) {
            const history = instanceState.chatHistory || [];
            const hasExplicitKeywords = history.some(msg => msg.role === 'user' && /\b(generate|recreate|nano banana)\b/i.test(msg.parts[0].text));
            
            const augmentedContext: MappingContext = {
                ...sourceData,
                aiStrategy: instanceState.layoutStrategy ? {
                    ...instanceState.layoutStrategy,
                    isExplicitIntent: hasExplicitKeywords
                } : undefined,
                previewUrl: undefined,
                targetDimensions: targetData ? { w: targetData.bounds.w, h: targetData.bounds.h } : undefined
            };
            
             registerResolved(id, `source-out-${i}`, augmentedContext);
        }

        if (targetData) {
            if (canvasDims.width === 0) {
                const edge = edges.find(e => e.target === id && e.targetHandle === `target-in-${i}`);
                if (edge) {
                    const t = templateRegistry[edge.source];
                    if (t) canvasDims = t.canvas;
                }
            }
            syntheticContainers.push({
                id: `proxy-target-${i}`,
                name: `target-out-${i}`, 
                originalName: targetData.name,
                bounds: targetData.bounds,
                normalized: {
                    x: canvasDims.width ? targetData.bounds.x / canvasDims.width : 0,
                    y: canvasDims.height ? targetData.bounds.y / canvasDims.height : 0,
                    w: canvasDims.width ? targetData.bounds.w / canvasDims.width : 0,
                    h: canvasDims.height ? targetData.bounds.h / canvasDims.height : 0,
                }
            });
        }
    }

    if (syntheticContainers.length > 0) {
        const syntheticTemplate: TemplateMetadata = {
            canvas: canvasDims.width > 0 ? canvasDims : { width: 1024, height: 1024 },
            containers: syntheticContainers
        };
        registerTemplate(id, syntheticTemplate);
    }

  }, [id, instanceCount, analystInstances, getSourceData, getTargetData, registerResolved, registerTemplate, edges, templateRegistry]);

  // --- Action Handlers ---
  const addInstance = useCallback(() => {
    setNodes((nds) => nds.map((n) => {
        if (n.id === id) {
            return { ...n, data: { ...n.data, instanceCount: (n.data.instanceCount || 0) + 1 } };
        }
        return n;
    }));
  }, [id, setNodes]);

  const updateInstanceState = useCallback((index: number, updates: Partial<AnalystInstanceState>) => {
    setNodes((nds) => nds.map((n) => {
        if (n.id === id) {
            const currentInstances = n.data.analystInstances || {};
            const oldState = currentInstances[index] || DEFAULT_INSTANCE_STATE;
            return {
                ...n,
                data: {
                    ...n.data,
                    analystInstances: {
                        ...currentInstances,
                        [index]: { ...oldState, ...updates }
                    }
                }
            };
        }
        return n;
    }));
  }, [id, setNodes]);

  const handleModelChange = (index: number, model: ModelKey) => {
      updateInstanceState(index, { selectedModel: model });
  };
  
  const handleToggleMute = (index: number) => {
      const currentState = analystInstances[index]?.isKnowledgeMuted || false;
      updateInstanceState(index, { isKnowledgeMuted: !currentState });
  };

  // --- AI Logic ---
  const generateDraft = async (prompt: string, sourceReference?: string): Promise<string | null> => {
     try {
         const apiKey = process.env.API_KEY;
         if (!apiKey) return null;
         const ai = new GoogleGenAI({ apiKey });
         
         const parts: any[] = [];
         
         // Inpaint/Outpaint: Attach source reference if available for style consistency
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
         
         parts.push({ text: `Generate a draft sketch (256x256) for: ${prompt}` });

         const response = await ai.models.generateContent({
             model: 'gemini-2.5-flash-image',
             contents: { parts },
             config: { imageConfig: { aspectRatio: "1:1" } }
         });
         
         for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) { return `data:image/png;base64,${part.inlineData.data}`; }
         }
         return null;
     } catch (e) {
         console.error("Draft Generation Failed", e);
         return null;
     }
  };

  const generateSystemInstruction = (sourceData: any, targetData: any, isRefining: boolean, knowledgeContext: KnowledgeContext | null) => {
    const sourceW = sourceData.container.bounds.w;
    const sourceH = sourceData.container.bounds.h;
    const targetW = targetData.bounds.w;
    const targetH = targetData.bounds.h;

    const flattenLayers = (layers: SerializableLayer[], depth = 0): any[] => {
        let flat: any[] = [];
        layers.forEach(l => {
            flat.push({
                id: l.id,
                name: l.name,
                type: l.type,
                depth: depth,
                relX: (l.coords.x - sourceData.container.bounds.x) / sourceW,
                relY: (l.coords.y - sourceData.container.bounds.y) / sourceH,
                width: l.coords.w,
                height: l.coords.h
            });
            if (l.children) { flat = flat.concat(flattenLayers(l.children, depth + 1)); }
        });
        return flat;
    };

    const layerAnalysisData = flattenLayers(sourceData.layers as SerializableLayer[]);

    let prompt = `
        ROLE: Senior Visual Systems Lead & Expert Graphic Designer.
        GOAL: Perform "Knowledge-Anchored Semantic Recomposition" with Intuition Fallback.
        
        CONTAINER CONTEXT:
        - Source: ${sourceData.container.containerName} (${sourceW}x${sourceH})
        - Target: ${targetData.name} (${targetW}x${targetH})
        
        LAYER HIERARCHY (JSON):
        ${JSON.stringify(layerAnalysisData.slice(0, 40))}

        KNOWLEDGE SCOPING PROTOCOL:
        You are analyzing the specific container: "${targetData.name}".
        Within the GLOBAL PROJECT KNOWLEDGE (if provided below), you must act as a 'Knowledge Scout.' 
        Search only for sections, headers, or bullet points that semantically relate to "${targetData.name}" or its direct visual function. 
        Ignore any rules belonging to other containers (e.g., if analyzing REEL, ignore BONUS or UI rules) to prevent cross-contamination.

        INTUITION FALLBACK PROTOCOL:
        If the provided Knowledge Scoping pass yields no specific results for the container "${targetData.name}", you must revert to your primary persona as a 'Senior Visual Systems Lead.' 
        Use your expert design intuition to solve for balance, hierarchy, and optical weight.

        GROUNDING PROTOCOL:
        1. Link every visual observation to a Metadata ID [layer-ID] using the deterministic path IDs provided in the JSON hierarchy.
        2. Use the Image for visual auditing and JSON for coordinate mapping.
        3. The top-left corner (0,0) of your visual workspace is the top-left of the Target Container (${targetData.name}).

        OPERATIONAL CONSTRAINTS:
        - NO NEW ELEMENTS: Strictly forbidden. Do not add assets or effects.
        - NO DELETION: Strictly forbidden. Every layer in the JSON must remain visible and accounted for.
        - NO CROPPING: Strictly forbidden. Use scale and position only.
        - METHOD 'GEOMETRIC': 'generativePrompt' MUST be "".

        JSON OUTPUT RULES:
        - Leading reasoning must justify 'overrides' by citing specific brand constraints (if found) or expert intuition.
        - 'knowledgeApplied' must be set to true if Knowledge rules were explicitly used.
        - Your 'overrides' must accurately map to the 'layerId' strings provided in the hierarchy.
    `;
    
    if (knowledgeContext && knowledgeContext.rules) {
        prompt = `
        [START KNOWLEDGE]
        ${knowledgeContext.rules}
        [END KNOWLEDGE]
        
        ` + prompt;
    }
    
    if (isRefining) {
        prompt += `\n\nUSER REFINEMENT: Adjust the 'overrides' based on user feedback while maintaining the Expert Designer persona and non-destructive rules.`;
    }
    return prompt;
  };

  const performAnalysis = async (index: number, history: ChatMessage[]) => {
      const sourceData = getSourceData(index);
      const targetData = getTargetData(index);
      
      if (!sourceData || !targetData) return;
      
      const instanceState = analystInstances[index] || DEFAULT_INSTANCE_STATE;
      const modelConfig = MODELS[instanceState.selectedModel as ModelKey];
      
      // Resolve Selective Injection (Per-Instance Toggle)
      const isMuted = instanceState.isKnowledgeMuted || false;
      const effectiveKnowledge = (!isMuted && activeKnowledge) ? activeKnowledge : null;

      setAnalyzingInstances(prev => ({ ...prev, [index]: true }));

      try {
        const apiKey = process.env.API_KEY;
        if (!apiKey) throw new Error("API_KEY missing");

        const ai = new GoogleGenAI({ apiKey });
        // Use effectiveKnowledge (null if muted)
        const systemInstruction = generateSystemInstruction(sourceData, targetData, history.length > 1, effectiveKnowledge);
        
        // --- Multimodal Fusion & Source Vision Injection ---
        // We construct the contents array, and augment the *last* user message to include visual context.
        // This gives the model "Vision" of both the Source Layers and the Reference Anchors.
        
        // 1. Extract Source Pixels for Vision
        const sourcePixelsBase64 = await extractSourcePixels(sourceData.layers as SerializableLayer[], sourceData.container.bounds);

        const apiContents = history.map(msg => ({ role: msg.role, parts: [...msg.parts] }));
        const lastMessage = apiContents[apiContents.length - 1];

        if (lastMessage.role === 'user') {
            const newParts: any[] = [];
            
            // A. Knowledge Anchors (Brand Context) - ONLY IF NOT MUTED
            if (effectiveKnowledge?.visualAnchors) {
                effectiveKnowledge.visualAnchors.forEach(anchor => {
                    newParts.push({
                        inlineData: { mimeType: anchor.mimeType, data: anchor.data }
                    });
                });
                if (effectiveKnowledge.visualAnchors.length > 0) {
                    newParts.push({ text: "REFERENCED VISUAL ANCHORS (Strict Style & Layout Adherence Required):" });
                }
            }

            // B. Source Pixels (Vision Context)
            if (sourcePixelsBase64) {
                const base64Clean = sourcePixelsBase64.split(',')[1];
                newParts.push({
                    inlineData: { mimeType: 'image/png', data: base64Clean }
                });
                newParts.push({ text: "INPUT SOURCE CONTEXT (Visual Representation of the Layers provided in JSON):" });
            }

            // C. Original Text Prompt
            newParts.push(...lastMessage.parts);
            
            // Apply mutated parts
            lastMessage.parts = newParts;
        }

        const requestConfig: any = {
            systemInstruction,
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    // NEW: Reasoning First with Description to enforce audit logic
                    reasoning: { 
                        type: Type.STRING,
                        description: `MANDATORY: A professional 'Design Audit' paragraph. Critique the visual hierarchy, balance, and optical weight before proposing changes. Your reasoning must explicitly state whether you found container-specific rules to follow for "${targetData.name}" or if you are applying 'Expert Intuition' because no relevant rules were found for this container.`
                    },
                    method: { type: Type.STRING, enum: ['GEOMETRIC', 'GENERATIVE', 'HYBRID'] },
                    suggestedScale: { type: Type.NUMBER },
                    anchor: { type: Type.STRING, enum: ['TOP', 'CENTER', 'BOTTOM', 'STRETCH'] },
                    generativePrompt: { type: Type.STRING },
                    clearance: { type: Type.BOOLEAN, description: "Set to true when resetting from Generative back to Geometric" },
                    knowledgeApplied: { 
                        type: Type.BOOLEAN, 
                        description: `Set to TRUE only if you identified and applied a rule specific to "${targetData.name}" from the knowledge base. Set to FALSE if you relied on general design intuition.` 
                    },
                    overrides: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                layerId: { type: Type.STRING },
                                xOffset: { type: Type.NUMBER },
                                yOffset: { type: Type.NUMBER },
                                individualScale: { type: Type.NUMBER }
                            },
                            required: ['layerId', 'xOffset', 'yOffset', 'individualScale']
                        }
                    },
                    safetyReport: {
                        type: Type.OBJECT,
                        properties: {
                            allowedBleed: { type: Type.BOOLEAN },
                            violationCount: { type: Type.INTEGER }
                        },
                        required: ['allowedBleed', 'violationCount']
                    }
                },
                required: ['reasoning', 'method', 'suggestedScale', 'anchor', 'generativePrompt', 'clearance', 'overrides', 'safetyReport', 'knowledgeApplied']
            }
        };
        
        if (modelConfig.thinkingBudget) {
            requestConfig.thinkingConfig = { thinkingBudget: modelConfig.thinkingBudget };
        }

        const response = await ai.models.generateContent({
            model: modelConfig.apiModel,
            contents: apiContents,
            config: requestConfig
        });

        const json = JSON.parse(response.text || '{}');
        
        // --- PAYLOAD ENRICHMENT ---
        // 1. Source Pixel Extraction
        if (json.method === 'GENERATIVE' || json.method === 'HYBRID') {
             if (sourcePixelsBase64) {
                 json.sourceReference = sourcePixelsBase64;
             }
        }
        
        // 2. Audit Trail: Muted State
        if (isMuted) {
            json.knowledgeMuted = true;
        }

        const newAiMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'model',
            parts: [{ text: response.text || '' }],
            strategySnapshot: json,
            timestamp: Date.now()
        };

        const finalHistory = [...history, newAiMessage];
        
        updateInstanceState(index, {
            chatHistory: finalHistory,
            layoutStrategy: json
        });

        const isExplicitIntent = history.some(msg => msg.role === 'user' && /\b(generate|recreate|nano banana)\b/i.test(msg.parts[0].text));

        const augmentedContext: MappingContext = {
            ...sourceData,
            aiStrategy: {
                ...json,
                isExplicitIntent
            },
            previewUrl: undefined, // Clear stale preview immediately
            targetDimensions: targetData ? { w: targetData.bounds.w, h: targetData.bounds.h } : undefined
        };
        
        // 1. Force update the registry without the preview first (Clear state)
        registerResolved(id, `source-out-${index}`, augmentedContext);

        // 2. Conditional Draft Generation (Debounced)
        if ((json.method === 'GENERATIVE' || json.method === 'HYBRID') && json.generativePrompt) {
             
             // Clear existing timeout to prevent rapid-fire API calls
             if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current);

             draftTimeoutRef.current = setTimeout(async () => {
                 // Pass source reference for better style matching
                 const url = await generateDraft(json.generativePrompt, json.sourceReference);
                 
                 if (url) {
                     console.log("PREVIEW_GENERATED");
                     const contextWithPreview: MappingContext = {
                         ...augmentedContext,
                         previewUrl: url,
                         message: "Free Preview: Draft"
                     };
                     // 3. Update registry with the new preview URL
                     registerResolved(id, `source-out-${index}`, contextWithPreview);
                 }
             }, 500); // 500ms debounce
        }

      } catch (e: any) {
          console.error("Analysis Failed:", e);
      } finally {
          setAnalyzingInstances(prev => ({ ...prev, [index]: false }));
      }
  };

  const handleAnalyze = (index: number) => {
      const initialMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          parts: [{ text: "Generate grid layout." }],
          timestamp: Date.now()
      };
      updateInstanceState(index, { chatHistory: [initialMsg] });
      performAnalysis(index, [initialMsg]);
  };

  const handleRefine = (index: number, text: string) => {
      const currentHistory = analystInstances[index]?.chatHistory || [];
      const userMsg: ChatMessage = {
          id: Date.now().toString(),
          role: 'user',
          parts: [{ text }],
          timestamp: Date.now()
      };
      const updatedHistory = [...currentHistory, userMsg];
      updateInstanceState(index, { chatHistory: updatedHistory });
      performAnalysis(index, updatedHistory);
  };

  return (
    <div className="w-[650px] bg-slate-800 rounded-lg shadow-2xl border border-slate-600 font-sans flex flex-col transition-colors duration-300">
      <NodeResizer minWidth={650} minHeight={500} isVisible={true} handleStyle={{ background: 'transparent', border: 'none' }} lineStyle={{ border: 'none' }} />
      
      {/* Knowledge Handle - Centered Top */}
      <Handle
        type="target"
        position={Position.Top}
        id="knowledge-in"
        className={`!w-4 !h-4 !-top-2 !bg-emerald-500 !border-2 !border-slate-900 z-50 transition-all duration-300 ${activeKnowledge ? 'shadow-[0_0_10px_#10b981]' : ''}`}
        style={{ left: '50%', transform: 'translateX(-50%)' }}
        title="Input: Global Design Rules"
      />

      <div className="bg-slate-900 p-2 border-b border-slate-700 flex items-center justify-between shrink-0 rounded-t-lg relative">
         <div className="flex items-center space-x-2">
           {/* Pulsing Dot if Linked */}
           {activeKnowledge && (
             <span className="absolute left-2 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
             </span>
           )}

           <svg className={`w-4 h-4 ${activeKnowledge ? 'text-emerald-400' : 'text-purple-400'} ml-4`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
           </svg>
           <div className="flex flex-col leading-none">
             <div className="flex items-center space-x-2">
                <span className="text-sm font-bold text-purple-100">Design Analyst</span>
                {activeKnowledge && (
                    <span className="text-[9px] bg-emerald-900/50 border border-emerald-500/30 text-emerald-300 px-1.5 py-0.5 rounded font-bold tracking-wider">
                        KNOWLEDGE LINKED
                    </span>
                )}
             </div>
             <span className="text-[9px] text-purple-400 max-w-[200px] truncate">{titleSuffix}</span>
           </div>
         </div>
      </div>
      <div className="flex flex-col">
          {Array.from({ length: instanceCount }).map((_, i) => {
              const state = analystInstances[i] || DEFAULT_INSTANCE_STATE;
              return (
                  <InstanceRow 
                      key={i} nodeId={id} index={i} state={state} sourceData={getSourceData(i)} targetData={getTargetData(i)}
                      onAnalyze={handleAnalyze} onRefine={handleRefine} onModelChange={handleModelChange} onToggleMute={handleToggleMute}
                      isAnalyzing={!!analyzingInstances[i]} compactMode={instanceCount > 1}
                      activeKnowledge={activeKnowledge}
                  />
              );
          })}
      </div>
      <button onClick={addInstance} className="w-full py-2 bg-slate-800 hover:bg-slate-700 border-t border-slate-700 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center space-x-1 rounded-b-lg">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
        <span className="text-[10px] font-medium uppercase tracking-wider">Add Analysis Instance</span>
      </button>
    </div>
  );
});