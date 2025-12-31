import React, { useRef } from 'react';
import { useReactFlow } from 'reactflow';
import { ProjectExport } from '../types';
import { useProceduralStore } from '../store/ProceduralContext';

export const ProjectControls = () => {
    const { toObject, setNodes, setEdges, setViewport } = useReactFlow();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const onSave = () => {
        const flow = toObject();
        
        // PERSISTENCE LOGIC:
        // 1. Strip transient "AI Ghost" images (large base64 previews) from Remapper nodes to keep JSON lightweight.
        // 2. PRESERVE "KnowledgeContext" in Knowledge nodes (contains distilled rules + optimized visual anchors).
        //    This ensures the "Project Brain" is portable.
        
        const sanitizedNodes = flow.nodes.map(node => {
            // Rule 1: Sanitize Remapper Payloads (Transient AI drafts)
            if (node.data && node.data.transformedPayload) {
                return {
                    ...node,
                    data: {
                        ...node.data,
                        transformedPayload: {
                            ...node.data.transformedPayload,
                            previewUrl: undefined, // Remove generated preview blob/base64
                        }
                    }
                };
            }
            
            // Rule 2: Explicitly preserve Knowledge Context (Implicit behavior, documented for clarity)
            // node.data.knowledgeContext is NOT stripped, preserving visualAnchors (512px optimized) and rules.

            return node;
        });
        
        const projectData: ProjectExport = {
            version: '1.0.0',
            timestamp: Date.now(),
            nodes: sanitizedNodes,
            edges: flow.edges,
            viewport: flow.viewport
        };
        
        const jsonString = JSON.stringify(projectData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `PSD_PROJECT_${Date.now()}.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const onLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const result = event.target?.result;
                if (typeof result === 'string') {
                    const rawData = JSON.parse(result);
                    
                    // VALIDATION LOGIC
                    const isValidSchema = 
                        rawData && 
                        Array.isArray(rawData.nodes) && 
                        Array.isArray(rawData.edges) && 
                        rawData.viewport && 
                        typeof rawData.viewport.x === 'number';

                    if (!isValidSchema) {
                        console.error("Schema Mismatch: Missing core React Flow properties.");
                        alert("Invalid Project File: The file structure does not match the expected schema.");
                        return;
                    }

                    // Strict Type Cast after validation
                    const project = rawData as ProjectExport;

                    // Apply React Flow State
                    // This triggers the re-hydration effects in individual nodes (e.g., KnowledgeNode)
                    setNodes(project.nodes);
                    setEdges(project.edges);
                    setViewport(project.viewport);

                    if (project.version !== '1.0.0') {
                        console.warn(`Version mismatch: Loading project version ${project.version} into runtime 1.0.0`);
                    }
                }
            } catch (err) {
                console.error("Failed to parse project file", err);
                alert("Corrupt File: Could not parse JSON data.");
            }
        };
        reader.readAsText(file);
        // Reset input so same file can be loaded again if needed
        e.target.value = '';
    };

    return (
        <div className="fixed top-4 right-4 z-50 flex space-x-2">
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".json" 
                onChange={onLoad} 
            />
            <button 
                onClick={onSave}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider shadow-lg flex items-center space-x-2 transition-colors"
                title="Save Layout & Metadata"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                <span>Save Project</span>
            </button>
            <button 
                onClick={() => fileInputRef.current?.click()}
                className="bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider shadow-lg flex items-center space-x-2 transition-colors"
                title="Load Project JSON"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Load Project</span>
            </button>
        </div>
    );
};