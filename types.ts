
import { Psd } from 'ag-psd';
import { Node, Edge } from 'reactflow';

export const MAX_BOUNDARY_VIOLATION_PERCENT = 0.03;

export interface ContainerDefinition {
  id: string;
  name: string;
  originalName: string;
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  normalized: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export interface TemplateMetadata {
  canvas: {
    width: number;
    height: number;
  };
  containers: ContainerDefinition[];
}

// --- KNOWLEDGE INTEGRATION ---
export interface VisualAnchor {
  mimeType: string;
  data: string; // Base64 pixel data for multimodal injection
}

export interface KnowledgeContext {
  sourceNodeId: string;
  rules: string; // Distilled textual guidelines (PDF/Rules)
  visualAnchors: VisualAnchor[]; // Visual style references (Mood boards)
}

export type KnowledgeRegistry = Record<string, KnowledgeContext>;
// -----------------------------

export interface ContainerContext {
  containerName: string;
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  canvasDimensions: {
    w: number;
    h: number;
  };
}

export interface SerializableLayer {
  id: string;
  name: string;
  type: 'layer' | 'group' | 'generative';
  children?: SerializableLayer[];
  isVisible: boolean;
  opacity: number;
  coords: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
}

export type RemapStrategy = 'STRETCH' | 'UNIFORM_FIT' | 'UNIFORM_FILL' | 'NONE';

export interface LayerOverride {
  layerId: string;
  xOffset: number;
  yOffset: number;
  individualScale: number;
  rotation?: number; // Added for Reviewer Node support
}

export interface LayoutStrategy {
  method?: 'GEOMETRIC' | 'GENERATIVE' | 'HYBRID';
  suggestedScale: number;
  anchor: 'TOP' | 'CENTER' | 'BOTTOM' | 'STRETCH';
  generativePrompt: string;
  reasoning: string;
  overrides?: LayerOverride[];
  safetyReport?: {
    allowedBleed: boolean;
    violationCount: number;
  };
  // Logic Gate Flags
  isExplicitIntent?: boolean;
  clearance?: boolean;
  generationAllowed?: boolean; // Master switch for generation strategy
  // Visual Grounding
  sourceReference?: string; // Base64 pixel data of the source container
  knowledgeApplied?: boolean; // Flag indicating if Knowledge/Rules influenced the decision
  knowledgeMuted?: boolean; // Audit flag: Was knowledge explicitly ignored during this generation?
}

export interface ReviewerStrategy {
    CARO_Audit: string; // Technical log for the Reviewer Node
    overrides: LayerOverride[]; // Restricted geometric overrides
}

export interface TransformedLayer extends SerializableLayer {
  transform: {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    rotation?: number; // Added for Reviewer Node support
  };
  children?: TransformedLayer[];
  generativePrompt?: string;
}

export interface MappingContext {
  container: ContainerContext;
  layers: SerializableLayer[] | TransformedLayer[];
  status: 'resolved' | 'empty' | 'transformed';
  message?: string;
  // Metadata Injection: AI Strategy travels with the data
  aiStrategy?: LayoutStrategy;
  // Visual Sandboxing: Upstream nodes can pass a draft preview
  previewUrl?: string; 
  // Explicit Target Dimensions for deterministic rendering
  targetDimensions?: { w: number, h: number };
  generationAllowed?: boolean; // Propagated gate state
}

export interface ValidationIssue {
  layerName: string;
  containerName: string;
  type: 'PROCEDURAL_VIOLATION';
  message: string;
}

export interface DesignValidationReport {
  isValid: boolean;
  issues: ValidationIssue[];
}

export interface TargetAssembly {
  targetDimensions: {
    width: number;
    height: number;
  };
  slots: {
    containerName: string;
    isFilled: boolean;
    assignedLayerCount: number;
  }[];
}

export interface TransformedPayload {
  status: 'success' | 'error' | 'idle' | 'awaiting_confirmation';
  sourceNodeId: string;
  sourceContainer: string;
  targetContainer: string;
  layers: TransformedLayer[];
  scaleFactor: number;
  metrics: {
    source: { w: number, h: number };
    target: { w: number, h: number };
  };
  requiresGeneration?: boolean;
  previewUrl?: string;
  isConfirmed?: boolean;
  isTransient?: boolean; // Marks in-progress/unconfirmed generative states
  isSynthesizing?: boolean; // Indicates active generation (Double-Buffer Flush state)
  sourceReference?: string; // Carried over from Strategy for Export/Gen use
  generationId?: number; // Timestamp of the specific generation to force React updates
  generationAllowed?: boolean; // New Flag: Per-instance enforcement state
  isPolished?: boolean; // Flag indicating if this payload has been refined by CARO
}

export interface RemapperConfig {
  targetContainerName: string | null;
  strategy?: RemapStrategy;
  generationAllowed?: boolean; // Global Toggle
}

export interface InstanceSettings {
  generationAllowed?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  parts: { text: string }[];
  strategySnapshot?: LayoutStrategy;
  timestamp: number;
}

export interface AnalystInstanceState {
  chatHistory: ChatMessage[];
  layoutStrategy: LayoutStrategy | null;
  selectedModel: 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-3-pro-thinking';
  isKnowledgeMuted: boolean; // REQUIRED: Per-instance toggle to ignore global knowledge
}

export interface ReviewerInstanceState {
  chatHistory: ChatMessage[];
  reviewerStrategy: ReviewerStrategy | null;
}

export interface PSDNodeData {
  fileName: string | null;
  template: TemplateMetadata | null;
  validation: DesignValidationReport | null;
  designLayers: SerializableLayer[] | null;
  containerContext?: ContainerContext | null;
  mappingContext?: MappingContext | null; // For downstream nodes consuming resolver output
  targetAssembly?: TargetAssembly | null; // For TargetSplitterNode output
  remapperConfig?: RemapperConfig | null; // For RemapperNode state
  transformedPayload?: TransformedPayload | null; // For RemapperNode output
  knowledgeContext?: KnowledgeContext | null; // For KnowledgeNode state
  
  // Dynamic State Persistence
  channelCount?: number;
  instanceCount?: number;
  instanceSettings?: Record<number, InstanceSettings>; // Per-Instance Persistence
  
  // Multi-Instance Analysis State
  analystInstances?: Record<number, AnalystInstanceState>;
  reviewerInstances?: Record<number, ReviewerInstanceState>; // Reviewer Node State
  
  // Legacy Single-Instance Fields (Kept for backward compatibility if needed, but deprecated)
  layoutStrategy?: LayoutStrategy | null; 
  selectedModel?: 'gemini-3-flash' | 'gemini-3-pro' | 'gemini-3-pro-thinking';
  chatHistory?: ChatMessage[];

  error?: string | null;
}

export interface TargetTemplateData {
  fileName: string | null;
  template: TemplateMetadata | null;
  // Targets act as skeletons, so they don't have design layers or self-validation reports
  validation: null;
  designLayers: null;
  containerContext: null;
  mappingContext: null;
  error?: string | null;
}

// Persistence Schema
export interface ProjectExport {
  version: string;
  timestamp: number;
  nodes: Node<PSDNodeData>[];
  edges: Edge[];
  viewport: { x: number, y: number, zoom: number };
}

// Re-export Psd type for convenience in other files
export type { Psd };