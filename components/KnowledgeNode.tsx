import React, { memo, useCallback, useState, useEffect, useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow';
import { useProceduralStore } from '../store/ProceduralContext';
import { PSDNodeData, VisualAnchor, KnowledgeContext } from '../types';
import { BookOpen, Image as ImageIcon, FileText, Trash2, UploadCloud, BrainCircuit, Loader2, CheckCircle2, AlertCircle, X, Layers, RefreshCw } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { GoogleGenAI } from "@google/genai";

// Initialize PDF Worker from CDN to handle parsing off the main thread
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';

interface StagedFile {
  id: string;
  file?: File; // Optional now, as persisted items don't have File objects
  type: 'pdf' | 'image';
  preview?: string;
  // Parsing Lifecycle State
  status: 'idle' | 'parsing' | 'complete' | 'error';
  extractedText?: string;
  visualAnchor?: VisualAnchor;
  errorMsg?: string;
}

const extractTextFromPdf = async (file: File): Promise<string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        
        // Load the PDF document
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        let fullText = '';
        const CHAR_LIMIT = 10000; // Safety Cap for Context Window

        // Iterate through all pages
        for (let i = 1; i <= pdf.numPages; i++) {
            if (fullText.length >= CHAR_LIMIT) break;

            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            
            // Extract and join text items
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n\n';
        }

        // Sanitization: Remove excessive whitespace
        fullText = fullText.replace(/\s+/g, ' ').trim();

        // Enforce Limits
        if (fullText.length > CHAR_LIMIT) {
            fullText = fullText.substring(0, CHAR_LIMIT) + '... [TRUNCATED]';
        }

        return fullText;

    } catch (error) {
        console.error("PDF Extraction Failed:", error);
        throw new Error("Failed to parse PDF content.");
    }
};

const optimizeImage = (file: File): Promise<VisualAnchor> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const MAX_DIM = 512;
                let w = img.width;
                let h = img.height;

                // Scale down logic while preserving aspect ratio
                if (w > h) {
                    if (w > MAX_DIM) {
                        h *= MAX_DIM / w;
                        w = MAX_DIM;
                    }
                } else {
                    if (h > MAX_DIM) {
                        w *= MAX_DIM / h;
                        h = MAX_DIM;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error("Canvas context failed"));
                    return;
                }
                
                // Draw and optimize
                ctx.drawImage(img, 0, 0, w, h);
                
                // Export as JPEG with 0.8 quality to reduce token usage
                const mimeType = 'image/jpeg';
                const dataUrl = canvas.toDataURL(mimeType, 0.8);
                const base64 = dataUrl.split(',')[1];
                
                resolve({
                    mimeType,
                    data: base64
                });
            };
            img.onerror = () => reject(new Error("Failed to load image for optimization"));
            img.src = e.target?.result as string;
        };
        reader.onerror = () => reject(new Error("Failed to read image file"));
        reader.readAsDataURL(file);
    });
};

export const KnowledgeNode = memo(({ id, data }: NodeProps<PSDNodeData>) => {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isDistilling, setIsDistilling] = useState(false);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { registerKnowledge, unregisterNode } = useProceduralStore();
  const { setNodes } = useReactFlow();

  // Cleanup on unmount
  useEffect(() => {
    return () => unregisterNode(id);
  }, [id, unregisterNode]);

  // RE-HYDRATION LOGIC
  useEffect(() => {
    // If we have data from a loaded project (persisted context) but haven't synced yet...
    if (data.knowledgeContext && !lastSynced) {
        console.log(`[KnowledgeNode] Re-hydrating context for ${id}`);
        
        // 1. Broadcast to Store immediately so Analyst nodes see it
        registerKnowledge(id, data.knowledgeContext);
        setLastSynced(Date.now());
    }
  }, [data.knowledgeContext, id, registerKnowledge, lastSynced]);

  // Handle Drag Events
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const processFiles = useCallback((files: FileList | null) => {
    if (!files) return;

    const newStaged: StagedFile[] = [];
    const processingQueue: StagedFile[] = [];

    Array.from(files).forEach((file) => {
      // Validate types
      const isPdf = file.type === 'application/pdf';
      const isImage = file.type.startsWith('image/');

      if (isPdf || isImage) {
        const stagedId = `${file.name}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        
        const staged: StagedFile = {
          id: stagedId,
          file,
          type: isPdf ? 'pdf' : 'image',
          preview: isImage ? URL.createObjectURL(file) : undefined,
          status: 'parsing' // Start in parsing/optimizing state for both
        };
        
        newStaged.push(staged);
        processingQueue.push(staged);
      }
    });

    if (newStaged.length === 0) return;

    setStagedFiles(prev => [...prev, ...newStaged]);

    processingQueue.forEach(async (item) => {
        if (!item.file) return;
        try {
            if (item.type === 'pdf') {
                const text = await extractTextFromPdf(item.file);
                setStagedFiles(prev => prev.map(f => {
                    if (f.id === item.id) return { ...f, status: 'complete', extractedText: text };
                    return f;
                }));
            } else if (item.type === 'image') {
                const anchor = await optimizeImage(item.file);
                setStagedFiles(prev => prev.map(f => {
                    if (f.id === item.id) return { ...f, status: 'complete', visualAnchor: anchor };
                    return f;
                }));
            }
        } catch (err: any) {
            setStagedFiles(prev => prev.map(f => {
                if (f.id === item.id) return { ...f, status: 'error', errorMsg: "Processing Failed" };
                return f;
            }));
        }
    });
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    processFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (fileId: string) => {
    setStagedFiles(prev => {
        const target = prev.find(f => f.id === fileId);
        if (target?.preview) URL.revokeObjectURL(target.preview);
        return prev.filter(f => f.id !== fileId);
    });
    // Invalidate sync status implies modification
    setLastSynced(null);
  };

  const distillKnowledge = async () => {
    setIsDistilling(true);
    try {
        const rawText = stagedFiles
            .filter(f => f.type === 'pdf' && f.extractedText && f.file)
            .map(f => `--- SOURCE: ${f.file!.name} ---\n${f.extractedText}`)
            .join('\n\n');

        const visualAnchors = stagedFiles
            .filter(f => f.type === 'image' && f.visualAnchor)
            .map(f => f.visualAnchor!);

        let finalRules = "";

        if (rawText.trim().length > 0) {
            const apiKey = process.env.API_KEY;
            if (apiKey) {
                const ai = new GoogleGenAI({ apiKey });
                const response = await ai.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: `
                        SOURCE MATERIAL:
                        ${rawText.substring(0, 25000)} // Truncate to be safe
                        
                        TASK:
                        Summarize the above brand manual content into a concise, numbered list of 10-15 actionable 'Procedural Design Rules'. 
                        Focus on spatial layout, typography rules, color usage logic, and hierarchy.
                        e.g., 'Primary titles must have 24px top padding', 'Use a 12-column grid'.
                        
                        Format as plain text.
                    `,
                    config: {
                        systemInstruction: "You are a Design Systems Lead. Extract strict procedural logic from brand guidelines."
                    }
                });
                finalRules = response.text || "No rules generated.";
            } else {
                 finalRules = "API Key missing. Rules could not be distilled from text.";
            }
        } else if (visualAnchors.length > 0) {
            finalRules = "Adhere to the visual style, color palette, and spatial rhythm of the attached reference images.";
        } else {
             setIsDistilling(false);
             return; 
        }

        const context: KnowledgeContext = {
            sourceNodeId: id,
            rules: finalRules,
            visualAnchors: visualAnchors
        };

        // 1. Broadcast to Store
        registerKnowledge(id, context);
        setLastSynced(Date.now());

        // 2. Persist to Node Data (Critical for Save/Load)
        setNodes((nds) => nds.map((n) => {
            if (n.id === id) {
                return {
                    ...n,
                    data: { ...n.data, knowledgeContext: context }
                };
            }
            return n;
        }));

    } catch (e) {
        console.error("Distillation error", e);
    } finally {
        setIsDistilling(false);
    }
  };

  // derived state for the UI
  // If we have local staged files, show them.
  // If local is empty but we have persisted context (re-hydration), display persisted anchors.
  const hasLocalStaged = stagedFiles.length > 0;
  const persistedAnchors = data.knowledgeContext?.visualAnchors || [];
  
  // Create unified display anchors
  const displayAnchors = hasLocalStaged 
    ? stagedFiles.filter(f => f.type === 'image' && f.status === 'complete' && f.visualAnchor && f.preview).map(f => ({
        id: f.id,
        preview: f.preview!,
        isPersisted: false
    }))
    : persistedAnchors.map((anchor, i) => ({
        id: `persisted-${i}`,
        preview: `data:${anchor.mimeType};base64,${anchor.data}`, // Reconstruct blob URL
        isPersisted: true
    }));

  const hasContent = hasLocalStaged || persistedAnchors.length > 0 || (stagedFiles.some(f => f.type === 'pdf' && f.status === 'complete'));
  const isSyncActive = !!lastSynced;

  return (
    <div className={`w-[300px] bg-slate-900 rounded-lg shadow-2xl border transition-all duration-300 font-sans flex flex-col overflow-hidden ${isSyncActive ? 'border-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.2)]' : 'border-teal-500/50'}`}>
      
      {/* Header */}
      <div className="bg-teal-900/30 p-2 border-b border-teal-800 flex items-center justify-between shrink-0">
         <div className="flex items-center space-x-2">
           <div className={`p-1.5 rounded-full border transition-all duration-500 ${isDistilling ? 'bg-teal-400 border-teal-200 animate-pulse' : 'bg-teal-500/20 border-teal-500/50'}`}>
             <BrainCircuit className={`w-4 h-4 ${isDistilling ? 'text-teal-900' : 'text-teal-300'}`} />
           </div>
           <div className="flex flex-col leading-none">
             <span className="text-sm font-bold text-teal-100">Project Brain</span>
             <span className="text-[9px] text-teal-400">Context Engine</span>
           </div>
         </div>
         <div className="flex items-center space-x-2">
             {lastSynced && (
                 <span className="text-[8px] text-teal-300 font-mono animate-pulse">LIVE</span>
             )}
             <span className="text-[9px] text-teal-500/70 font-mono border border-teal-800 px-1 rounded bg-black/20">KNOWLEDGE</span>
         </div>
      </div>

      {/* Body */}
      <div className="p-3 bg-slate-800 space-y-3">
        
        {/* Drop Zone */}
        <div 
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
                group relative border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center transition-all cursor-pointer
                ${isDragging ? 'border-teal-400 bg-teal-900/20' : 'border-slate-600 hover:border-teal-500/50 hover:bg-slate-700/50'}
            `}
        >
            <input 
                type="file" 
                multiple 
                accept=".pdf,image/png,image/jpeg,image/jpg" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handleFileSelect}
            />
            
            <UploadCloud className={`w-8 h-8 mb-2 transition-colors ${isDragging ? 'text-teal-400' : 'text-slate-500 group-hover:text-teal-300'}`} />
            <span className="text-xs text-slate-400 font-medium group-hover:text-slate-300 text-center">
                Drop Brand Manuals (PDF)<br/> or Mood Boards (Images)
            </span>
        </div>

        {/* Staged Assets List */}
        <div className="space-y-1 max-h-32 overflow-y-auto custom-scrollbar border-b border-slate-700/50 pb-2">
            {!hasContent && !data.knowledgeContext ? (
                <div className="text-[10px] text-slate-600 text-center italic py-2">
                    No knowledge assets staged.
                </div>
            ) : (
                <>
                    {/* Persisted Rules Summary (Re-hydration view) */}
                    {data.knowledgeContext && !hasLocalStaged && (
                        <div className="p-2 bg-teal-900/20 border border-teal-800/50 rounded flex items-center space-x-2">
                            <CheckCircle2 className="w-3 h-3 text-teal-500" />
                            <span className="text-[10px] text-teal-200">
                                {data.knowledgeContext.rules.length > 50 
                                    ? "Knowledge Rules Loaded" 
                                    : "Knowledge Context Ready"}
                            </span>
                        </div>
                    )}

                    {/* Active Staging List */}
                    {stagedFiles.map(file => (
                        <div key={file.id} className="flex items-center justify-between p-2 bg-slate-900/50 border border-slate-700 rounded group hover:border-teal-500/30 transition-colors">
                            <div className="flex items-center space-x-2 overflow-hidden">
                                {file.type === 'pdf' ? (
                                    <FileText className="w-4 h-4 text-orange-400 shrink-0" />
                                ) : (
                                    <div className="w-4 h-4 rounded bg-slate-800 overflow-hidden shrink-0 border border-slate-600">
                                        {file.preview ? (
                                            <img src={file.preview} alt="preview" className="w-full h-full object-cover" />
                                        ) : (
                                            <ImageIcon className="w-3 h-3 text-purple-400 m-0.5" />
                                        )}
                                    </div>
                                )}
                                <div className="flex flex-col overflow-hidden min-w-[120px]">
                                    <span className="text-[10px] text-slate-300 truncate font-medium" title={file.file?.name}>
                                        {file.file?.name || 'File'}
                                    </span>
                                    <div className="flex items-center space-x-1">
                                        <span className="text-[8px] text-slate-500 uppercase tracking-wider">
                                            {file.type}
                                        </span>
                                        {file.type === 'pdf' && file.extractedText && (
                                            <span className="text-[8px] text-teal-500 font-mono">
                                                [{file.extractedText.length} chars]
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2">
                                {file.status === 'parsing' && <Loader2 className="w-3 h-3 text-teal-400 animate-spin" />}
                                {file.status === 'complete' && <CheckCircle2 className="w-3 h-3 text-teal-500" />}
                                <button 
                                    onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                                    className="text-slate-600 hover:text-red-400 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>

        {/* Visual Reference Anchors Gallery */}
        {displayAnchors.length > 0 && (
            <div className="flex flex-col space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-[9px] uppercase text-teal-400 font-bold tracking-wider flex items-center gap-1">
                        <Layers className="w-3 h-3" /> Visual Reference Anchors
                    </span>
                    <span className="text-[9px] text-slate-500 font-mono">{displayAnchors.length} Ready</span>
                </div>
                
                <div className="flex overflow-x-auto gap-2 pb-2 custom-scrollbar">
                    {displayAnchors.map(file => (
                        <div key={file.id} className="relative group shrink-0 w-16 h-16 rounded border border-slate-700 bg-black/20 overflow-hidden shadow-sm hover:border-teal-500/50 transition-colors">
                            <img 
                                src={file.preview} 
                                alt="Visual Anchor" 
                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" 
                            />
                            {/* Overlay Badge */}
                            <div className="absolute top-0 right-0 bg-teal-500 text-white text-[7px] font-bold px-1 rounded-bl leading-none shadow-sm">
                                REF
                            </div>
                            {/* Remove Overlay (Only for staged files, persisted ones are immutable in this view unless cleared) */}
                            {!file.isPersisted && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); removeFile(file.id); }}
                                    className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X className="w-5 h-5 text-white/80 hover:text-white drop-shadow-md" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        )}
        
        {/* Distillation & Broadcast Controls */}
        <div className="pt-2 border-t border-slate-700/50">
             <button 
                onClick={distillKnowledge}
                disabled={!hasContent || isDistilling}
                className={`w-full py-2 text-[10px] font-bold uppercase tracking-wider rounded shadow-lg flex items-center justify-center space-x-2 transition-all duration-300
                    ${isDistilling 
                        ? 'bg-slate-700 text-slate-400 cursor-wait' 
                        : hasContent
                            ? 'bg-teal-600 hover:bg-teal-500 text-white transform hover:-translate-y-0.5'
                            : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                    }
                `}
             >
                 {isDistilling ? (
                     <>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Distilling Knowledge...</span>
                     </>
                 ) : lastSynced ? (
                     <>
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Sync to Project Brain</span>
                     </>
                 ) : (
                     <>
                        <BookOpen className="w-3 h-3" />
                        <span>Distill & Broadcast</span>
                     </>
                 )}
             </button>
             
             {lastSynced && (
                 <div className="text-[8px] text-teal-500/70 text-center mt-1 font-mono">
                     Last Synced: {new Date(lastSynced).toLocaleTimeString()}
                 </div>
             )}
        </div>

      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="knowledge-out"
        className={`!w-3 !h-3 !-right-1.5 !border-2 transition-all duration-500
            ${isSyncActive ? '!bg-teal-500 !border-white shadow-[0_0_10px_#14b8a6]' : '!bg-slate-600 !border-slate-400'}
        `}
        style={{ top: '50%', transform: 'translateY(-50%)' }}
        title="Output: Global Knowledge Context"
      />
    </div>
  );
});