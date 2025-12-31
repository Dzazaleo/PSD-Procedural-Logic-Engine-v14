import React, { memo, useState, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, useEdges, useReactFlow } from 'reactflow';
import { PSDNodeData, TransformedPayload, TransformedLayer, TemplateMetadata } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';
import { findLayerByPath } from '../services/psdService';
import { Layer } from 'ag-psd';
import { Eye, CheckCircle2, Zap, Scan, Layers, Crosshair } from 'lucide-react';

interface PreviewInstanceRowProps {
  nodeId: string;
  index: number;
  edges: any[];
}

// --- Helper: Deep Leaf Counter ---
const countDeepLeaves = (layers: TransformedLayer[]): number => {
    let count = 0;
    layers.forEach(l => {
        if (l.children) {
            count += countDeepLeaves(l.children);
        } else {
            count++;
        }
    });
    return count;
};

// --- Helper: Binary Name Search Fallback ---
const findLayerByName = (children: Layer[] | undefined, name: string): Layer | null => {
    if (!children) return null;
    for (const child of children) {
        if (child.name === name) return child;
        if (child.children) {
            const found = findLayerByName(child.children, name);
            if (found) return found;
        }
    }
    return null;
};

const PreviewInstanceRow: React.FC<PreviewInstanceRowProps> = ({ nodeId, index, edges }) => {
  const [viewMode, setViewMode] = useState<'PROCEDURAL' | 'POLISHED'>('PROCEDURAL');
  const [autoFrame, setAutoFrame] = useState(true); // Default to TRUE to ensure visibility
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  
  // Store Access
  const { payloadRegistry, reviewerRegistry, psdRegistry, registerReviewerPayload, templateRegistry } = useProceduralStore();

  // 1. Resolve Inputs
  const inputEdge = edges.find(e => e.target === nodeId && e.targetHandle === `payload-in-${index}`);
  
  const polishedPayload = inputEdge && reviewerRegistry[inputEdge.source] 
    ? reviewerRegistry[inputEdge.source][inputEdge.sourceHandle || ''] 
    : undefined;

  const proceduralPayload = useMemo(() => {
    if (!polishedPayload && inputEdge && payloadRegistry[inputEdge.source]) {
        return payloadRegistry[inputEdge.source][inputEdge.sourceHandle || ''];
    }
    if (!polishedPayload) return undefined;
    
    // Fallback: Find matching procedural payload by container name
    const sourceId = polishedPayload.sourceNodeId;
    const registry = payloadRegistry[sourceId] || {};
    const allPayloads = Object.values(registry) as TransformedPayload[];
    return allPayloads.find(p => p.targetContainer === polishedPayload.targetContainer);
  }, [polishedPayload, payloadRegistry, inputEdge]);

  const isPolishedAvailable = !!polishedPayload && !!polishedPayload.isPolished;
  const effectiveMode = (viewMode === 'POLISHED' && isPolishedAvailable) ? 'POLISHED' : 'PROCEDURAL';
  const displayPayload = effectiveMode === 'POLISHED' ? polishedPayload : (polishedPayload || proceduralPayload);

  // 2. Broadcast Selection to Downstream (Export)
  useEffect(() => {
    if (displayPayload) {
      registerReviewerPayload(nodeId, `preview-out-${index}`, displayPayload);
    }
  }, [displayPayload, nodeId, index, registerReviewerPayload]);

  // 3. "ABSOLUTE-LOCAL" COMPOSITING ENGINE
  useEffect(() => {
    if (!displayPayload) return;

    // A. Binary Source Recovery
    let sourcePsd = psdRegistry[displayPayload.sourceNodeId];
    if (!sourcePsd) {
        // Fallback strategy: Try to find a PSD that matches the source path ID structure
        // This handles cases where connection IDs might shift but the binary is loaded
        const firstAvailableKey = Object.keys(psdRegistry)[0];
        if (firstAvailableKey) {
            sourcePsd = psdRegistry[firstAvailableKey];
        }
    }

    const { w, h } = displayPayload.metrics.target;
    if (w === 0 || h === 0) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // B. Draw Checkerboard Background
    const squareSize = 20;
    const cols = Math.ceil(w / squareSize);
    const rows = Math.ceil(h / squareSize);
    
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#1e293b' : '#334155'; // Slate 800/700
            ctx.fillRect(c * squareSize, r * squareSize, squareSize, squareSize);
        }
    }

    // C. Calculate Camera Origin (Normalization Vector)
    let originX = 0;
    let originY = 0;
    
    // Scan content bounds to allow auto-centering if requested
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    if (displayPayload.layers.length > 0) {
        const scanBounds = (layers: TransformedLayer[]) => {
            layers.forEach(l => {
                if (l.isVisible) {
                    if (l.coords.x < minX) minX = l.coords.x;
                    if (l.coords.y < minY) minY = l.coords.y;
                    if (l.coords.x + l.coords.w > maxX) maxX = l.coords.x + l.coords.w;
                    if (l.coords.y + l.coords.h > maxY) maxY = l.coords.y + l.coords.h;
                    if (l.children) scanBounds(l.children);
                }
            });
        };
        scanBounds(displayPayload.layers);
    }

    if (autoFrame && minX !== Infinity) {
        // Mode 1: Auto-Center Content
        const contentW = maxX - minX;
        const contentH = maxY - minY;
        originX = minX + (contentW - w) / 2;
        originY = minY + (contentH - h) / 2;
    } else {
        // Mode 2: Strict Template Coordinates
        // Search all templates to find the matching container definition
        const allTemplates = Object.values(templateRegistry) as TemplateMetadata[];
        for (const tmpl of allTemplates) {
            const container = tmpl.containers.find(c => 
                c.name === displayPayload.targetContainer || // Match cleaned name
                c.originalName === displayPayload.targetContainer // Match raw name
            );
            if (container) {
                originX = container.bounds.x;
                originY = container.bounds.y;
                break;
            }
        }
    }

    // D. Recursive Render Loop (Painter's Algorithm)
    const drawLayers = (layers: TransformedLayer[]) => {
        // Iterate BACKWARDS to draw bottom layers first (Background -> Foreground)
        for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            
            if (layer.isVisible) {
                // 1. Group Recursion (Groups don't render pixels, only their children do)
                if (layer.children && layer.children.length > 0) {
                    drawLayers(layer.children);
                    continue; 
                }

                // 2. Coordinate Mapping
                const localX = layer.coords.x - originX;
                const localY = layer.coords.y - originY;

                ctx.save();
                ctx.globalAlpha = Number.isFinite(layer.opacity) ? layer.opacity : 1.0;

                // 3. Render Generative Placeholder
                if (layer.type === 'generative') {
                    ctx.fillStyle = 'rgba(192, 132, 252, 0.2)';
                    ctx.strokeStyle = '#c084fc';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.fillRect(localX, localY, layer.coords.w, layer.coords.h);
                    ctx.strokeRect(localX, localY, layer.coords.w, layer.coords.h);
                    
                    ctx.fillStyle = '#fff';
                    ctx.font = '8px monospace';
                    ctx.fillText("AI GEN", localX + 2, localY + 10);
                } 
                // 4. Render Raster Pixel Data
                else if (sourcePsd) {
                    // Try exact path match first
                    let originalLayer = findLayerByPath(sourcePsd, layer.id);
                    
                    // Fallback to name search if path is stale/mismatched
                    if (!originalLayer) {
                         originalLayer = findLayerByName(sourcePsd.children, layer.name);
                    }

                    if (originalLayer && originalLayer.canvas) {
                         const srcCanvas = originalLayer.canvas as HTMLCanvasElement;
                         
                         // Transform Baking: Rotation & Scaling
                         // Move origin to the CENTER of the layer's bounding box to rotate
                         const cx = localX + layer.coords.w / 2;
                         const cy = localY + layer.coords.h / 2;
                         
                         ctx.translate(cx, cy);
                         
                         if (layer.transform.rotation) {
                             ctx.rotate((layer.transform.rotation * Math.PI) / 180);
                         }

                         try {
                            if (srcCanvas.width > 0 && srcCanvas.height > 0) {
                                // Draw centered at the translated origin
                                ctx.drawImage(
                                    srcCanvas, 
                                    -layer.coords.w / 2, // Left relative to center
                                    -layer.coords.h / 2, // Top relative to center
                                    layer.coords.w, 
                                    layer.coords.h
                                );
                            } else {
                                // Draw debug placeholder for empty canvas
                                ctx.fillStyle = 'rgba(255, 0, 255, 0.1)';
                                ctx.fillRect(-layer.coords.w / 2, -layer.coords.h / 2, layer.coords.w, layer.coords.h);
                            }
                         } catch (e) { 
                             console.error("Layer draw error", e);
                             ctx.strokeStyle = 'red';
                             ctx.strokeRect(-layer.coords.w / 2, -layer.coords.h / 2, layer.coords.w, layer.coords.h);
                         }

                         // Debug Overlay: Layer Border
                         /*
                         ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)'; // Cyan low opacity
                         ctx.lineWidth = 1;
                         ctx.setLineDash([]);
                         ctx.strokeRect(-layer.coords.w / 2, -layer.coords.h / 2, layer.coords.w, layer.coords.h);
                         */
                    } else {
                        // Missing Pixels Warning
                        ctx.strokeStyle = '#ef4444';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(localX, localY, layer.coords.w, layer.coords.h);
                        
                        ctx.beginPath();
                        ctx.moveTo(localX, localY);
                        ctx.lineTo(localX + layer.coords.w, localY + layer.coords.h);
                        ctx.stroke();
                    }
                } else {
                    // Missing Binary Source
                    ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
                    ctx.fillRect(localX, localY, layer.coords.w, layer.coords.h);
                }

                ctx.restore();
            }
        }
    };

    if (displayPayload.layers) {
        drawLayers(displayPayload.layers);
    }
    
    // Auto-Frame Indicator Overlay
    if (autoFrame) {
        ctx.save();
        ctx.fillStyle = '#06b6d4';
        ctx.font = '9px monospace';
        ctx.fillText("AUTO-CENTER ACTIVE", 4, h - 4);
        ctx.restore();
    }

    setLocalPreview(canvas.toDataURL('image/jpeg', 0.9));

  }, [displayPayload, psdRegistry, templateRegistry, autoFrame]);

  // Deep Count for UI
  const leafCount = useMemo(() => {
      if (!displayPayload?.layers) return 0;
      return countDeepLeaves(displayPayload.layers);
  }, [displayPayload]);

  return (
    <div className="relative border-b border-emerald-900/30 bg-slate-950/50 p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${isPolishedAvailable ? 'bg-emerald-500' : 'bg-blue-500'}`}></div>
                <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wider truncate max-w-[150px]">
                    {displayPayload?.targetContainer || `SLOT ${index}`}
                </span>
            </div>
            
            {/* View Controls */}
            <div className="flex space-x-2">
                <button
                    onClick={() => setAutoFrame(!autoFrame)}
                    className={`p-1 rounded border transition-colors ${
                        autoFrame 
                        ? 'bg-cyan-900/50 border-cyan-500/50 text-cyan-300' 
                        : 'bg-slate-900 border-slate-700 text-slate-500'
                    }`}
                    title={autoFrame ? "Auto-Center Enabled" : "Strict Template Coordinates"}
                >
                    <Crosshair className="w-3 h-3" />
                </button>

                <div className="flex bg-slate-900 rounded p-0.5 border border-slate-700">
                    <button
                        onClick={() => setViewMode('PROCEDURAL')}
                        className={`px-3 py-1 rounded text-[9px] font-bold uppercase transition-all ${
                            effectiveMode === 'PROCEDURAL' 
                            ? 'bg-indigo-600 text-white shadow-sm' 
                            : 'text-slate-500 hover:text-slate-300'
                        }`}
                    >
                        <Zap className="w-3 h-3 inline mr-1" />
                        Raw
                    </button>
                    <button
                        onClick={() => setViewMode('POLISHED')}
                        disabled={!isPolishedAvailable}
                        className={`px-3 py-1 rounded text-[9px] font-bold uppercase transition-all ${
                            effectiveMode === 'POLISHED' 
                            ? 'bg-emerald-600 text-white shadow-sm' 
                            : 'text-slate-600 cursor-not-allowed opacity-50'
                        }`}
                    >
                        <CheckCircle2 className="w-3 h-3 inline mr-1" />
                        Final
                    </button>
                </div>
            </div>
        </div>

        {/* Canvas Stage */}
        <div className="relative w-full aspect-video bg-[#0f172a] rounded border border-slate-700/50 overflow-hidden flex items-center justify-center group">
            {localPreview ? (
                <img 
                    src={localPreview} 
                    alt="Preview" 
                    className="max-w-full max-h-full object-contain shadow-2xl"
                />
            ) : (
                <div className="flex flex-col items-center text-slate-600 space-y-2">
                    <Eye className="w-6 h-6 opacity-50" />
                    <span className="text-[9px] uppercase tracking-widest opacity-50">Rendering...</span>
                </div>
            )}

            {/* Stats Overlay */}
            <div className="absolute bottom-2 right-2 flex gap-1">
                <div className="bg-black/60 backdrop-blur text-slate-300 text-[8px] px-1.5 py-0.5 rounded border border-white/10 font-mono">
                   {displayPayload ? `${Math.round(displayPayload.metrics.target.w)}x${Math.round(displayPayload.metrics.target.h)}` : 'N/A'}
                </div>
            </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-1">
            <div className="flex items-center space-x-2 text-[9px] text-slate-500 font-mono">
                <Layers className="w-3 h-3" />
                <span>{leafCount} Objects</span>
            </div>
            
            <div className="relative">
                <span className="text-[7px] text-emerald-600 font-bold tracking-widest uppercase mr-4">TO EXPORT</span>
                <Handle 
                    type="source" 
                    position={Position.Right} 
                    id={`preview-out-${index}`} 
                    className="!absolute !right-[-8px] !top-1/2 !-translate-y-1/2 !w-3 !h-3 !bg-emerald-400 !border-2 !border-slate-900 z-50" 
                />
            </div>
        </div>
        
        {/* Input Handle */}
        <Handle 
            type="target" 
            position={Position.Left} 
            id={`payload-in-${index}`} 
            className="!absolute !left-[-8px] !top-12 !w-3 !h-3 !bg-indigo-500 !border-2 !border-slate-900 z-50" 
        />
    </div>
  );
};

export const AssetPreviewNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const [instanceCount, setInstanceCount] = useState(data.instanceCount || 1);
  const { setNodes } = useReactFlow();
  const edges = useEdges();

  const addSlot = () => {
    const newCount = instanceCount + 1;
    setInstanceCount(newCount);
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, instanceCount: newCount } } : n));
  };

  return (
    <div className="w-[420px] bg-slate-900 rounded-lg shadow-2xl border border-emerald-500/30 font-sans flex flex-col transition-all duration-300 hover:border-emerald-400/50">
      <div className="bg-emerald-950/50 p-2 border-b border-emerald-500/20 flex items-center justify-between">
         <div className="flex items-center space-x-2">
           <Scan className="w-4 h-4 text-emerald-400" />
           <div className="flex flex-col leading-none">
             <span className="text-sm font-bold text-emerald-100">Asset Preview</span>
             <span className="text-[9px] text-emerald-500/60 font-mono uppercase">Visual Gatekeeper</span>
           </div>
         </div>
      </div>

      <div className="flex flex-col bg-slate-950">
         {Array.from({ length: instanceCount }).map((_, i) => (
             <PreviewInstanceRow key={i} nodeId={id} index={i} edges={edges} />
         ))}
      </div>

      <button 
        onClick={addSlot}
        className="w-full py-2 bg-slate-900 hover:bg-slate-800 border-t border-slate-800 text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center space-x-1"
      >
        <span className="text-[10px] font-bold uppercase tracking-widest">Add Preview Slot</span>
      </button>
    </div>
  );
});