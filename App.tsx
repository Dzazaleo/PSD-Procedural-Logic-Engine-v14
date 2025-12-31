import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
  ReactFlowProvider,
} from 'reactflow';

import { LoadPSDNode } from './components/LoadPSDNode';
import { TargetTemplateNode } from './components/TargetTemplateNode';
import { TargetSplitterNode } from './components/TargetSplitterNode';
import { DesignInfoNode } from './components/DesignInfoNode';
import { TemplateSplitterNode } from './components/TemplateSplitterNode';
import { ContainerResolverNode } from './components/ContainerResolverNode';
import { RemapperNode } from './components/RemapperNode';
import { DesignAnalystNode } from './components/DesignAnalystNode'; 
import { ExportPSDNode } from './components/ExportPSDNode';
import { KnowledgeNode } from './components/KnowledgeNode'; 
import { DesignReviewerNode } from './components/DesignReviewerNode'; 
import { AssetPreviewNode } from './components/AssetPreviewNode';
import { ProjectControls } from './components/ProjectControls';
import { PSDNodeData } from './types';
import { ProceduralStoreProvider } from './store/ProceduralContext';

const initialNodes: Node<PSDNodeData>[] = [
  {
    id: 'node-1',
    type: 'loadPsd',
    position: { x: 50, y: 50 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-knowledge-1',
    type: 'knowledge',
    position: { x: 50, y: 350 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-target-1',
    type: 'targetTemplate',
    position: { x: 650, y: 50 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-2',
    type: 'designInfo',
    position: { x: 350, y: 50 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-3',
    type: 'templateSplitter',
    position: { x: 350, y: 450 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-4',
    type: 'containerResolver',
    position: { x: 950, y: 450 },
    data: { 
      fileName: null, 
      template: null, 
      validation: null, 
      designLayers: null,
      channelCount: 10 // Initial state for persistence
    },
  },
  {
    id: 'node-analyst-1', 
    type: 'designAnalyst',
    position: { x: 1300, y: 300 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
    style: { width: 650 },
  },
  {
    id: 'node-remapper-1',
    type: 'remapper',
    position: { x: 1650, y: 400 },
    data: { 
      fileName: null, 
      template: null, 
      validation: null, 
      designLayers: null, 
      remapperConfig: { targetContainerName: null },
      instanceCount: 1 // Initial state for persistence
    },
    style: { width: 500 }
  },
  {
    id: 'node-reviewer-1',
    type: 'designReviewer',
    position: { x: 2200, y: 400 },
    data: { 
        fileName: null, template: null, validation: null, designLayers: null,
        instanceCount: 1 
    },
    style: { width: 480 }
  },
  {
    id: 'node-preview-1',
    type: 'assetPreview',
    position: { x: 2750, y: 400 },
    data: {
        fileName: null, template: null, validation: null, designLayers: null,
        instanceCount: 1
    },
    style: { width: 420 }
  },
  {
    id: 'node-5',
    type: 'targetSplitter',
    position: { x: 1300, y: 50 },
    data: { fileName: null, template: null, validation: null, designLayers: null },
  },
  {
    id: 'node-export-1',
    type: 'exportPsd',
    position: { x: 3300, y: 400 }, 
    data: { fileName: null, template: null, validation: null, designLayers: null },
  }
];

const initialEdges: Edge[] = [
    { id: 'e1-2', source: 'node-1', target: 'node-2' },
    { id: 'e1-3', source: 'node-1', target: 'node-3' },
    { 
      id: 'e-target-1-5', 
      source: 'node-target-1', 
      target: 'node-5', 
      sourceHandle: 'target-metadata-out',
      targetHandle: 'template-input'
    },
    // Connect Target Template to Export (to initialize Export slots)
    {
      id: 'e-target-export',
      source: 'node-target-1',
      target: 'node-export-1',
      sourceHandle: 'target-metadata-out',
      targetHandle: 'template-input'
    }
];

const App: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const onConnect = useCallback(
    (params: Connection) => {
      // 1. Validation Logic
      // Resolve source and target nodes to check their types
      const sourceNode = nodes.find((n) => n.id === params.source);
      const targetNode = nodes.find((n) => n.id === params.target);

      if (sourceNode && targetNode) {
        // Target Splitter Validation Rules
        if (targetNode.type === 'targetSplitter') {
          // Check if connecting to the Template Input handle
          if (params.targetHandle === 'template-input') {
             // Constraint: Template Input expects a TargetTemplateNode
             if (sourceNode.type !== 'targetTemplate') {
               console.warn("Invalid Connection: Target Splitter 'Template Input' requires a Target Template source.");
               return;
             }
          }
          // Note: Target Splitter Slots can connect to DesignAnalyst OR Remapper
        }
        
        // Remapper Validation Rules (Dynamic Multi-Instance)
        if (targetNode.type === 'remapper') {
            const handle = params.targetHandle || '';
            
            // Allow dynamic Target Template Slots
            if (handle.startsWith('target-in-')) {
                 // Remapper accepts Target Splitter OR Design Analyst (Proxy)
                 if (sourceNode.type !== 'targetSplitter' && sourceNode.type !== 'designAnalyst') {
                     console.warn("Remapper 'Target' input requires a Target Splitter or Design Analyst.");
                     return;
                 }
            } 
            // Allow dynamic Content Sources
            else if (handle.startsWith('source-in-')) {
                 // Remapper accepts Container Resolver OR Design Analyst (Proxy)
                 if (sourceNode.type !== 'containerResolver' && sourceNode.type !== 'designAnalyst') {
                     console.warn("Remapper 'Source' input requires a Container Resolver or Design Analyst.");
                     return;
                 }
            }
        }

        // Design Analyst Validation Rules
        if (targetNode.type === 'designAnalyst') {
            const handle = params.targetHandle || '';

            if (handle === 'knowledge-in') {
                if (sourceNode.type !== 'knowledge') {
                    console.warn("Design Analyst 'Knowledge' input requires a Knowledge Node source.");
                    return;
                }
            } else if (handle.startsWith('source-in')) {
                if (sourceNode.type !== 'containerResolver') {
                    console.warn("Design Analyst 'Source' requires a Container Resolver.");
                    return;
                }
            } else if (handle.startsWith('target-in')) {
                if (sourceNode.type !== 'targetSplitter') {
                    console.warn("Design Analyst 'Target' requires a Target Splitter.");
                    return;
                }
            }
        }

        // Design Reviewer Validation Rules
        if (targetNode.type === 'designReviewer') {
            const handle = params.targetHandle || '';

            if (handle.startsWith('payload-in')) {
                // Accepts output from Remapper OR Container Resolver (Direct Bridge Exception)
                if (sourceNode.type !== 'remapper' && sourceNode.type !== 'containerResolver') {
                    console.warn("Reviewer 'Payload Input' requires a Remapper or Container Resolver source.");
                    return;
                }
            } else if (handle.startsWith('target-in')) {
                // Accepts Target Splitter (context definition)
                if (sourceNode.type !== 'targetSplitter') {
                    console.warn("Reviewer 'Target Input' requires a Target Splitter.");
                    return;
                }
            }
        }

        // Asset Preview Validation Rules (Visual Gatekeeper)
        if (targetNode.type === 'assetPreview') {
            const handle = params.targetHandle || '';
            
            if (handle.startsWith('payload-in')) {
                // Accepts Polished (Reviewer) or Raw (Remapper/Resolver)
                const validSources = ['designReviewer', 'remapper', 'containerResolver'];
                if (!validSources.includes(sourceNode.type || '')) {
                    console.warn("Asset Preview 'Payload Input' requires a Reviewer, Remapper, or Resolver source.");
                    return;
                }
            }
        }

        // Export Node Validation
        if (targetNode.type === 'exportPsd' && params.targetHandle?.startsWith('input-')) {
            // Updated to accept Asset Preview as a valid source
            const validSources = ['assetPreview', 'designReviewer', 'remapper', 'containerResolver'];
            if (!validSources.includes(sourceNode.type || '')) {
                console.warn(`Export Node input requires a payload source (Preview, Reviewer, Remapper, Resolver). Got: ${sourceNode.type}`);
                return;
            }
        }
      }

      // 2. Apply Connection
      setEdges((eds) => {
        // Logic: Ensure only one edge connects to any given target handle.
        // Intercept connection and remove any existing edge on the specific target handle.
        const targetHandle = params.targetHandle || null;
        
        // Exception: Export Node Assembly Input allows multiple connections
        const isMultiInput = targetNode?.type === 'exportPsd' && targetHandle === 'assembly-input';

        const cleanEdges = isMultiInput ? eds : eds.filter((edge) => {
          const edgeTargetHandle = edge.targetHandle || null;
          // Keep the edge if it targets a different node OR a different handle on the same node
          return edge.target !== params.target || edgeTargetHandle !== targetHandle;
        });
        
        return addEdge(params, cleanEdges);
      });
    },
    [nodes, setNodes, setEdges] // Added setNodes dependency for completeness
  );

  // Register custom node types
  const nodeTypes = useMemo(() => ({
    loadPsd: LoadPSDNode,
    targetTemplate: TargetTemplateNode,
    targetSplitter: TargetSplitterNode,
    designInfo: DesignInfoNode,
    templateSplitter: TemplateSplitterNode,
    containerResolver: ContainerResolverNode,
    remapper: RemapperNode,
    designAnalyst: DesignAnalystNode, 
    designReviewer: DesignReviewerNode,
    assetPreview: AssetPreviewNode,
    exportPsd: ExportPSDNode,
    knowledge: KnowledgeNode,
  }), []);

  return (
    <ProceduralStoreProvider>
      <div className="w-screen h-screen bg-slate-900">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            className="bg-slate-900"
          >
            <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="#334155" />
            <Controls className="bg-slate-800 border-slate-700 fill-slate-200" />
            <MiniMap 
              className="bg-slate-800 border-slate-700" 
              nodeColor="#475569" 
              maskColor="rgba(15, 23, 42, 0.6)"
            />
            
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
              <h1 className="text-2xl font-bold text-slate-100 tracking-tight">
                PSD Procedural Logic Engine
              </h1>
              <p className="text-slate-400 text-sm">
                Procedural generation graph for Adobe Photoshop files
              </p>
            </div>
          </ReactFlow>
          <ProjectControls />
        </ReactFlowProvider>
      </div>
    </ProceduralStoreProvider>
  );
};

export default App;