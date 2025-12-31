
import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { Psd } from 'ag-psd';
import { TemplateMetadata, MappingContext, TransformedPayload, LayoutStrategy, KnowledgeContext, KnowledgeRegistry } from '../types';

interface ProceduralState {
  // Maps NodeID -> Raw PSD Object (Binary/Structure)
  psdRegistry: Record<string, Psd>;
  
  // Maps NodeID -> Lightweight Template Metadata
  templateRegistry: Record<string, TemplateMetadata>;
  
  // Maps NodeID -> HandleID -> Resolved Context (Layers + Bounds)
  resolvedRegistry: Record<string, Record<string, MappingContext>>;

  // Maps NodeID -> HandleID -> Transformed Payload (Ready for Assembly)
  payloadRegistry: Record<string, Record<string, TransformedPayload>>;

  // Maps NodeID -> HandleID -> Polished Payload (CARO Output)
  // Stores the final refined transforms from Reviewer nodes
  reviewerRegistry: Record<string, Record<string, TransformedPayload>>;

  // Maps NodeID -> HandleID -> LayoutStrategy (AI Analysis)
  analysisRegistry: Record<string, Record<string, LayoutStrategy>>;

  // Maps NodeID -> KnowledgeContext (Global Design Rules)
  knowledgeRegistry: KnowledgeRegistry;

  // Global counter to force re-evaluation of downstream nodes upon binary re-hydration
  globalVersion: number;
}

interface ProceduralContextType extends ProceduralState {
  registerPsd: (nodeId: string, psd: Psd) => void;
  registerTemplate: (nodeId: string, template: TemplateMetadata) => void;
  registerResolved: (nodeId: string, handleId: string, context: MappingContext) => void;
  registerPayload: (nodeId: string, handleId: string, payload: TransformedPayload, masterOverride?: boolean) => void;
  registerReviewerPayload: (nodeId: string, handleId: string, payload: TransformedPayload) => void;
  updatePayload: (nodeId: string, handleId: string, partial: Partial<TransformedPayload>) => void; 
  registerAnalysis: (nodeId: string, handleId: string, strategy: LayoutStrategy) => void;
  registerKnowledge: (nodeId: string, context: KnowledgeContext) => void;
  updatePreview: (nodeId: string, handleId: string, url: string) => void;
  unregisterNode: (nodeId: string) => void;
  triggerGlobalRefresh: () => void;
}

const ProceduralContext = createContext<ProceduralContextType | null>(null);

// --- HELPER: Reconcile Terminal State ---
// Implements "Double-Buffer" Update Strategy + Stale Guard + Geometric Preservation + Logic Gate
const reconcileTerminalState = (
    incomingPayload: TransformedPayload, 
    currentPayload: TransformedPayload | undefined
): TransformedPayload => {

    // 0. GENERATIVE LOGIC GATE: HARD STOP
    // If generation is explicitly disallowed (per-instance toggle), we must strip all generative assets immediately.
    // This acts as a "Kill Switch" for the pipeline's specific instance.
    if (incomingPayload.generationAllowed === false) {
        return {
            ...incomingPayload,
            // Destructive Strip:
            previewUrl: undefined,
            isConfirmed: false,
            isTransient: false,
            isSynthesizing: false,
            requiresGeneration: false, // Ensure downstream nodes know generation is off
            // Preserve geometric data
            metrics: incomingPayload.metrics,
            // Visually remove any layers marked as generative
            layers: incomingPayload.layers.filter(l => l.type !== 'generative') 
        };
    }

    // 1. STALE GUARD:
    // If store has a newer generation ID than incoming, reject the update.
    if (currentPayload?.generationId && incomingPayload.generationId && incomingPayload.generationId < currentPayload.generationId) {
        return currentPayload;
    }

    // 2. SANITATION (Geometric Reset)
    // Explicitly flush preview and history if status is 'idle' (e.g. disconnected or reset)
    if (incomingPayload.status === 'idle') {
        return {
             ...incomingPayload,
             previewUrl: undefined,
             isConfirmed: false,
             isTransient: false,
             isSynthesizing: false
        };
    }

    // 3. FLUSH PHASE (Start Synthesis)
    if (incomingPayload.isSynthesizing) {
        return {
            ...(currentPayload || incomingPayload),
            isSynthesizing: true,
            // Preserve visual context during load
            previewUrl: currentPayload?.previewUrl,
            sourceReference: incomingPayload.sourceReference || currentPayload?.sourceReference,
            targetContainer: incomingPayload.targetContainer || currentPayload?.targetContainer || '',
            metrics: incomingPayload.metrics || currentPayload?.metrics,
            generationId: currentPayload?.generationId,
            generationAllowed: true
        };
    }

    // 4. REFINEMENT PERSISTENCE (State Guard)
    // Prevent accidental reset of confirmation if prompt hasn't changed structurally
    let isConfirmed = incomingPayload.isConfirmed ?? currentPayload?.isConfirmed ?? false;
    
    // If explicitly marked transient (draft), it cannot be confirmed yet
    if (incomingPayload.isTransient) {
        isConfirmed = false;
    }

    // 5. GEOMETRIC PRESERVATION
    // If this is a layout update (no generationId) but we have AI assets, keep them.
    if (!incomingPayload.generationId && currentPayload?.generationId) {
         return {
            ...incomingPayload,
            previewUrl: currentPayload.previewUrl,
            generationId: currentPayload.generationId,
            isSynthesizing: currentPayload.isSynthesizing,
            isConfirmed: currentPayload.isConfirmed, 
            isTransient: currentPayload.isTransient,
            sourceReference: currentPayload.sourceReference || incomingPayload.sourceReference,
            generationAllowed: true
         };
    }

    // 6. FINAL CONSTRUCTION
    return {
        ...incomingPayload,
        isConfirmed,
        sourceReference: incomingPayload.sourceReference || currentPayload?.sourceReference,
        generationId: incomingPayload.generationId || currentPayload?.generationId,
        generationAllowed: true
    };
};

export const ProceduralStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [psdRegistry, setPsdRegistry] = useState<Record<string, Psd>>({});
  const [templateRegistry, setTemplateRegistry] = useState<Record<string, TemplateMetadata>>({});
  const [resolvedRegistry, setResolvedRegistry] = useState<Record<string, Record<string, MappingContext>>>({});
  const [payloadRegistry, setPayloadRegistry] = useState<Record<string, Record<string, TransformedPayload>>>({});
  const [reviewerRegistry, setReviewerRegistry] = useState<Record<string, Record<string, TransformedPayload>>>({});
  const [analysisRegistry, setAnalysisRegistry] = useState<Record<string, Record<string, LayoutStrategy>>>({});
  const [knowledgeRegistry, setKnowledgeRegistry] = useState<KnowledgeRegistry>({});
  const [globalVersion, setGlobalVersion] = useState<number>(0);

  const registerPsd = useCallback((nodeId: string, psd: Psd) => {
    setPsdRegistry(prev => ({ ...prev, [nodeId]: psd }));
  }, []);

  const registerTemplate = useCallback((nodeId: string, template: TemplateMetadata) => {
    setTemplateRegistry(prev => {
      if (prev[nodeId] === template) return prev;
      if (JSON.stringify(prev[nodeId]) === JSON.stringify(template)) return prev;
      return { ...prev, [nodeId]: template };
    });
  }, []);

  const registerResolved = useCallback((nodeId: string, handleId: string, context: MappingContext) => {
    // SANITATION LOGIC (Ghost Flushing)
    let sanitizedContext = context;

    // Check Logic Gate: Is generation permitted?
    // We check specifically if allowed is FALSE. Undefined implies allowed (default).
    // Or we can be strict. Let's assume explicit disablement is required to trigger stripping.
    const isGenerationDisallowed = context.generationAllowed === false || context.aiStrategy?.generationAllowed === false;

    if (isGenerationDisallowed) {
        sanitizedContext = {
            ...context,
            // Flush Ghost Preview
            previewUrl: undefined,
            // Flush Generative Intent
            aiStrategy: context.aiStrategy ? {
                ...context.aiStrategy,
                generativePrompt: '',
                generationAllowed: false
            } : undefined,
            generationAllowed: false
        };
    } else if (context.aiStrategy?.method === 'GEOMETRIC') {
        sanitizedContext = {
            ...context,
            // Flush Ghost Preview
            previewUrl: undefined,
            // Flush Generative Intent
            aiStrategy: {
                ...context.aiStrategy,
                generativePrompt: ''
            }
        };
    }

    setResolvedRegistry(prev => {
      const nodeRecord = prev[nodeId] || {};
      const currentContext = nodeRecord[handleId];
      if (currentContext === sanitizedContext) return prev;
      if (currentContext && JSON.stringify(currentContext) === JSON.stringify(sanitizedContext)) return prev;
      
      return {
        ...prev,
        [nodeId]: {
          ...nodeRecord,
          [handleId]: sanitizedContext
        }
      };
    });
  }, []);

  const registerPayload = useCallback((nodeId: string, handleId: string, payload: TransformedPayload, masterOverride?: boolean) => {
    setPayloadRegistry(prev => {
      const nodeRecord = prev[nodeId] || {};
      const currentPayload = nodeRecord[handleId];
      
      let effectivePayload = { ...payload };

      // Phase 4A: Cascaded Generation Blocking (Master Override)
      // If the master gate is explicitly CLOSED (false), we enforce it immediately on the registry logic.
      if (masterOverride === false) {
          effectivePayload.generationAllowed = false;
          // Note: setting generationAllowed=false triggers the cleanup logic inside reconcileTerminalState
      }

      // APPLY RECONCILIATION MIDDLEWARE
      // This enforces logic gates and state transitions
      const reconciledPayload = reconcileTerminalState(effectivePayload, currentPayload);

      // Deep equality check optimization
      if (currentPayload && JSON.stringify(currentPayload) === JSON.stringify(reconciledPayload)) {
          return prev;
      }

      return { 
        ...prev, 
        [nodeId]: {
            ...nodeRecord,
            [handleId]: reconciledPayload
        } 
      };
    });
  }, []);

  const registerReviewerPayload = useCallback((nodeId: string, handleId: string, payload: TransformedPayload) => {
    setReviewerRegistry(prev => {
        const nodeRecord = prev[nodeId] || {};
        const currentPayload = nodeRecord[handleId];
        
        // Enforce Polished Flag for CARO output
        const effectivePayload = { ...payload, isPolished: true };

        // Use same reconciliation logic as standard payloads to handle generation IDs and stale updates
        // This ensures downstream stability even for micro-adjustments
        const reconciledPayload = reconcileTerminalState(effectivePayload, currentPayload);

        if (currentPayload && JSON.stringify(currentPayload) === JSON.stringify(reconciledPayload)) {
            return prev;
        }

        return {
            ...prev,
            [nodeId]: {
                ...nodeRecord,
                [handleId]: reconciledPayload
            }
        };
    });
  }, []);

  // NEW: Atomic Partial Update to prevent Stale Closures
  const updatePayload = useCallback((nodeId: string, handleId: string, partial: Partial<TransformedPayload>) => {
    setPayloadRegistry(prev => {
      const nodeRecord = prev[nodeId] || {};
      const currentPayload = nodeRecord[handleId];
      
      // Safety: Cannot update non-existent payload unless sufficient data provided (assumed handled upstream)
      if (!currentPayload && !partial.sourceContainer && !partial.previewUrl) return prev; 

      // Merge: State = Current + Partial
      const mergedPayload: TransformedPayload = currentPayload 
        ? { ...currentPayload, ...partial }
        : (partial as TransformedPayload); 

      // Reconcile
      const reconciledPayload = reconcileTerminalState(mergedPayload, currentPayload);
      
      if (currentPayload && JSON.stringify(currentPayload) === JSON.stringify(reconciledPayload)) return prev;

      return { 
        ...prev, 
        [nodeId]: {
            ...nodeRecord,
            [handleId]: reconciledPayload
        } 
      };
    });
  }, []);

  const registerAnalysis = useCallback((nodeId: string, handleId: string, strategy: LayoutStrategy) => {
    setAnalysisRegistry(prev => {
        const nodeRecord = prev[nodeId] || {};
        const currentStrategy = nodeRecord[handleId];
        
        if (currentStrategy === strategy) return prev;
        if (currentStrategy && JSON.stringify(currentStrategy) === JSON.stringify(strategy)) return prev;
        
        return { 
            ...prev, 
            [nodeId]: {
                ...nodeRecord,
                [handleId]: strategy
            } 
        };
    });
  }, []);

  const registerKnowledge = useCallback((nodeId: string, context: KnowledgeContext) => {
    setKnowledgeRegistry(prev => {
        if (prev[nodeId] === context) return prev;
        if (JSON.stringify(prev[nodeId]) === JSON.stringify(context)) return prev;
        return { ...prev, [nodeId]: context };
    });
  }, []);

  const updatePreview = useCallback((nodeId: string, handleId: string, url: string) => {
    setPayloadRegistry(prev => {
      const nodeRecord = prev[nodeId];
      if (!nodeRecord) return prev; 
      
      const currentPayload = nodeRecord[handleId];
      if (!currentPayload) return prev;

      if (currentPayload.previewUrl === url) return prev;

      return {
        ...prev,
        [nodeId]: {
          ...nodeRecord,
          [handleId]: {
            ...currentPayload,
            previewUrl: url
          }
        }
      };
    });
  }, []);

  const unregisterNode = useCallback((nodeId: string) => {
    setPsdRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setTemplateRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setResolvedRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setPayloadRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setReviewerRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    setAnalysisRegistry(prev => { const { [nodeId]: _, ...rest } = prev; return rest; });
    
    // Explicitly clean up Knowledge Registry to ensure stale rules don't persist
    setKnowledgeRegistry(prev => { 
        if (!prev[nodeId]) return prev;
        const { [nodeId]: _, ...rest } = prev; 
        return rest; 
    });
    
    // Lifecycle Force Refresh: 
    // Increment global version to notify downstream subscribers (like Analyst Node) 
    // that a dependency (e.g., Knowledge Node) might have been removed.
    setGlobalVersion(v => v + 1);
  }, []);

  const triggerGlobalRefresh = useCallback(() => {
    setGlobalVersion(v => v + 1);
  }, []);

  const value = useMemo(() => ({
    psdRegistry,
    templateRegistry,
    resolvedRegistry,
    payloadRegistry,
    reviewerRegistry,
    analysisRegistry,
    knowledgeRegistry,
    globalVersion,
    registerPsd,
    registerTemplate,
    registerResolved,
    registerPayload,
    registerReviewerPayload,
    updatePayload, 
    registerAnalysis,
    registerKnowledge,
    updatePreview,
    unregisterNode,
    triggerGlobalRefresh
  }), [
    psdRegistry, templateRegistry, resolvedRegistry, payloadRegistry, reviewerRegistry, analysisRegistry, knowledgeRegistry, globalVersion,
    registerPsd, registerTemplate, registerResolved, registerPayload, registerReviewerPayload, updatePayload, registerAnalysis, registerKnowledge, updatePreview,
    unregisterNode, triggerGlobalRefresh
  ]);

  return (
    <ProceduralContext.Provider value={value}>
      {children}
    </ProceduralContext.Provider>
  );
};

export const useProceduralStore = () => {
  const context = useContext(ProceduralContext);
  if (!context) {
    throw new Error('useProceduralStore must be used within a ProceduralStoreProvider');
  }
  return context;
};