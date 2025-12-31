import { readPsd, writePsd, Psd, ReadOptions, WriteOptions, Layer } from 'ag-psd';
import { TemplateMetadata, ContainerDefinition, DesignValidationReport, ValidationIssue, SerializableLayer, ContainerContext } from '../types';

// --- Procedural Palette & Theme Logic ---

interface PaletteTheme {
  name: string;
  border: string;
  bg: string;
  text: string;
  dot: string; // Added for UI elements requiring a solid accent
}

export const CONTAINER_PALETTE: PaletteTheme[] = [
  // 1. Purple (Legacy: BG)
  { name: 'Purple', border: 'border-purple-500', bg: 'bg-purple-500/20', text: 'text-purple-200', dot: 'bg-purple-400' },
  // 2. Orange (Legacy: SYMBOLS)
  { name: 'Orange', border: 'border-orange-500', bg: 'bg-orange-500/20', text: 'text-orange-200', dot: 'bg-orange-400' },
  // 3. Blue (Legacy: COUNTERS)
  { name: 'Blue', border: 'border-blue-500', bg: 'bg-blue-500/20', text: 'text-blue-200', dot: 'bg-blue-400' },
  // 4. Pink
  { name: 'Pink', border: 'border-pink-500', bg: 'bg-pink-500/20', text: 'text-pink-200', dot: 'bg-pink-400' },
  // 5. Teal
  { name: 'Teal', border: 'border-teal-500', bg: 'bg-teal-500/20', text: 'text-teal-200', dot: 'bg-teal-400' },
  // 6. Amber
  { name: 'Amber', border: 'border-amber-500', bg: 'bg-amber-500/20', text: 'text-amber-200', dot: 'bg-amber-400' },
  // 7. Rose
  { name: 'Rose', border: 'border-rose-500', bg: 'bg-rose-500/20', text: 'text-rose-200', dot: 'bg-rose-400' },
  // 8. Indigo
  { name: 'Indigo', border: 'border-indigo-500', bg: 'bg-indigo-500/20', text: 'text-indigo-200', dot: 'bg-indigo-400' },
];

/**
 * Returns a consistent Tailwind theme string based on container name or index.
 * Prioritizes semantic naming conventions (BG, SYMBOLS) before falling back to index-based rotation.
 * 
 * @param name The container name (e.g., "BG Layer")
 * @param index The deterministic index of the container
 * @returns A string of tailwind classes (border, bg, text)
 */
export const getSemanticTheme = (name: string, index: number): string => {
  const upperName = name.toUpperCase();
  let theme: PaletteTheme | undefined;

  // 1. Semantic Matching (Legacy/Priority)
  if (upperName.includes('BG')) {
    theme = CONTAINER_PALETTE.find(t => t.name === 'Purple');
  } else if (upperName.includes('SYMBOL')) {
    theme = CONTAINER_PALETTE.find(t => t.name === 'Orange');
  } else if (upperName.includes('COUNTER')) {
    theme = CONTAINER_PALETTE.find(t => t.name === 'Blue');
  }

  // 2. Index Fallback (Procedural)
  if (!theme) {
    const paletteIndex = index % CONTAINER_PALETTE.length;
    theme = CONTAINER_PALETTE[paletteIndex];
  }

  // 3. Return constructed class string
  // Default fallback if something goes wrong (shouldn't happen with math)
  const safeTheme = theme || CONTAINER_PALETTE[0];
  
  return `${safeTheme.border} ${safeTheme.bg} ${safeTheme.text}`;
};

/**
 * Retrieves the full theme object if structured access (like dot color) is needed.
 */
export const getSemanticThemeObject = (name: string, index: number): PaletteTheme => {
    const upperName = name.toUpperCase();
    let theme: PaletteTheme | undefined;
  
    if (upperName.includes('BG')) {
      theme = CONTAINER_PALETTE.find(t => t.name === 'Purple');
    } else if (upperName.includes('SYMBOL')) {
      theme = CONTAINER_PALETTE.find(t => t.name === 'Orange');
    } else if (upperName.includes('COUNTER')) {
      theme = CONTAINER_PALETTE.find(t => t.name === 'Blue');
    }
  
    if (!theme) {
      const paletteIndex = index % CONTAINER_PALETTE.length;
      theme = CONTAINER_PALETTE[paletteIndex];
    }
  
    return theme || CONTAINER_PALETTE[0];
};

export interface PSDParseOptions {
  /**
   * Whether to skip parsing layer image data.
   * Defaults to false (we need image data for procedural generation).
   */
  skipLayerImageData?: boolean;
  /**
   * Whether to skip parsing the thumbnail.
   * Defaults to true to save resources.
   */
  skipThumbnail?: boolean;
}

/**
 * Parses a PSD file using ag-psd with enhanced error handling and configuration.
 * @param file The File object to parse.
 * @param options Configuration options for parsing.
 * @returns A Promise resolving to the parsed Psd object.
 */
export const parsePsdFile = async (file: File, options: PSDParseOptions = {}): Promise<Psd> => {
  return new Promise((resolve, reject) => {
    // Input validation
    if (!file) {
      reject(new Error('No file provided for parsing.'));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const arrayBuffer = reader.result;

      // Ensure we have a valid ArrayBuffer
      if (!arrayBuffer || !(arrayBuffer instanceof ArrayBuffer)) {
        reject(new Error('FileReader failed to produce a valid ArrayBuffer.'));
        return;
      }

      if (arrayBuffer.byteLength === 0) {
        reject(new Error('The provided file is empty.'));
        return;
      }

      try {
        // Configure parsing options
        // CRITICAL FIX: Explicitly enable useCanvas to ensure browser compatibility for pixel data
        const readOptions: ReadOptions = {
          skipLayerImageData: options.skipLayerImageData ?? false,
          skipThumbnail: options.skipThumbnail ?? true,
          useCanvas: true 
        };

        // Attempt to parse the PSD
        const psd = readPsd(arrayBuffer, readOptions);
        resolve(psd);

      } catch (error: any) {
        console.error("PSD Parsing Logic Error:", error);

        // Distinguish between different types of errors
        let errorMessage = 'Failed to parse PSD structure.';
        
        if (error instanceof Error) {
          // Check for common ag-psd or format errors
          if (error.message.includes('Invalid signature') || error.message.includes('Signature not found')) {
            errorMessage = 'Invalid file format. The file does not appear to be a valid Adobe Photoshop file.';
          } else if (error.message.includes('RangeError') || error.message.includes('Out of bounds')) {
             errorMessage = 'The PSD file appears to be corrupted or truncated (Buffer out of bounds).';
          } else {
             errorMessage = `PSD Parsing Error: ${error.message}`;
          }
        }

        reject(new Error(errorMessage));
      }
    };

    reader.onerror = () => {
      const msg = reader.error ? reader.error.message : 'Unknown IO error';
      console.error("FileReader Error:", reader.error);
      reject(new Error(`Failed to read file from disk: ${msg}`));
    };

    // Start reading
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Extracts metadata for the procedural logic engine from the parsed PSD.
 * Looks for a top-level group named '!!TEMPLATE' and extracts its children as containers.
 */
export const extractTemplateMetadata = (psd: Psd): TemplateMetadata => {
  // Default to 1 to avoid division by zero if undefined, though PSDs usually have dims.
  const canvasWidth = psd.width || 1;
  const canvasHeight = psd.height || 1;

  const containers: ContainerDefinition[] = [];

  // Find the !!TEMPLATE group
  const templateGroup = psd.children?.find(child => child.name === '!!TEMPLATE');

  if (templateGroup && templateGroup.children) {
    templateGroup.children.forEach((child, index) => {
      // Skip invisible layers if needed, but for now we include all structure
      
      const top = child.top ?? 0;
      const left = child.left ?? 0;
      const bottom = child.bottom ?? 0;
      const right = child.right ?? 0;
      
      const width = right - left;
      const height = bottom - top;
      
      const rawName = child.name || 'Untitled';
      const cleanName = rawName.replace(/^!!/, '');

      containers.push({
        id: `container-${index}-${cleanName.replace(/\s+/g, '_')}`,
        name: cleanName,
        originalName: rawName,
        bounds: {
          x: left,
          y: top,
          w: width,
          h: height
        },
        normalized: {
          x: left / canvasWidth,
          y: top / canvasHeight,
          w: width / canvasWidth,
          h: height / canvasHeight,
        }
      });
    });
  }

  return {
    canvas: {
      width: canvasWidth,
      height: canvasHeight
    },
    containers
  };
};

/**
 * Creates a scoped ContainerContext object for a specific container.
 * Used by downstream nodes to get context from the TemplateSplitterNode.
 */
export const createContainerContext = (template: TemplateMetadata, containerName: string): ContainerContext | null => {
  const container = template.containers.find(c => c.name === containerName);
  
  if (!container) {
    return null;
  }

  return {
    containerName: container.name,
    bounds: container.bounds,
    canvasDimensions: {
      w: template.canvas.width,
      h: template.canvas.height
    }
  };
};

/**
 * Validates 'Design' layers against the 'Template' containers.
 * Design groups (e.g. SYMBOLS) are checked against containers of the same name (e.g. !!SYMBOLS).
 * Any layer within a design group must be fully contained within the container bounds.
 */
export const mapLayersToContainers = (psd: Psd, template: TemplateMetadata): DesignValidationReport => {
  const issues: ValidationIssue[] = [];
  const containerMap = new Map<string, ContainerDefinition>();
  
  // Index containers by name (e.g. "SYMBOLS" derived from "!!SYMBOLS")
  template.containers.forEach(c => {
    containerMap.set(c.name, c);
  });

  psd.children?.forEach(group => {
    // Skip the template group itself
    if (group.name === '!!TEMPLATE') return;
    
    // Check if this group name matches a known container
    if (group.name && containerMap.has(group.name)) {
        const container = containerMap.get(group.name)!;
        
        // Validate children of this design group
        group.children?.forEach(layer => {
            // Check if layer has valid coordinates
            if (typeof layer.top === 'number' && typeof layer.left === 'number' && 
                typeof layer.bottom === 'number' && typeof layer.right === 'number') {
                
                // Calculate container boundaries
                const containerRight = container.bounds.x + container.bounds.w;
                const containerBottom = container.bounds.y + container.bounds.h;
                
                // Check if layer exceeds container bounds
                const isViolation = 
                    layer.left < container.bounds.x ||
                    layer.top < container.bounds.y ||
                    layer.right > containerRight ||
                    layer.bottom > containerBottom;
                    
                if (isViolation) {
                    issues.push({
                        layerName: layer.name || 'Untitled Layer',
                        containerName: container.name,
                        type: 'PROCEDURAL_VIOLATION',
                        message: `Layer '${layer.name}' extends outside '${container.name}' container.`
                    });
                }
            }
        });
    }
  });

  return {
    isValid: issues.length === 0,
    issues
  };
};

/**
 * Recursively maps ag-psd Layers to a simplified SerializableLayer structure.
 * USES DETERMINISTIC PATH IDs for reconstruction.
 * @param layers The array of layers to process.
 * @param path The current hierarchy path (e.g., "0.1").
 * @returns An array of lightweight SerializableLayer objects.
 */
export const getCleanLayerTree = (layers: Layer[], path: string = ''): SerializableLayer[] => {
  const nodes: SerializableLayer[] = [];
  
  layers.forEach((child, index) => {
    // Explicitly filter out the !!TEMPLATE group
    if (child.name === '!!TEMPLATE') {
      return;
    }

    // Construct deterministic path: "parentIndex.childIndex"
    // Use the index within the full layers array from ag-psd
    const currentPath = path ? `${path}.${index}` : `${index}`;

    const top = child.top ?? 0;
    const left = child.left ?? 0;
    const bottom = child.bottom ?? 0;
    const right = child.right ?? 0;
    
    const width = right - left;
    const height = bottom - top;
    
    const node: SerializableLayer = {
      id: currentPath,
      name: child.name || `Layer ${index}`,
      type: child.children ? 'group' : 'layer',
      isVisible: !child.hidden,
      opacity: (child.opacity ?? 255) / 255, // ag-psd 0-255 -> 0-1
      coords: {
        x: left,
        y: top,
        w: width,
        h: height
      },
      // Recursion
      children: child.children ? getCleanLayerTree(child.children, currentPath) : undefined
    };
    
    nodes.push(node);
  });
  
  return nodes;
};

/**
 * Finds a heavy `ag-psd` Layer object in the raw PSD structure using a deterministic path ID.
 * The path ID (e.g., "0.3.1") corresponds to the indices in the `children` arrays.
 * 
 * @param psd The raw parsed PSD object.
 * @param pathId The dot-separated index path (e.g., "0.3.1").
 * @returns The matching Layer object or null if not found.
 */
export const findLayerByPath = (psd: Psd, pathId: string): Layer | null => {
  if (!pathId) return null;
  const indices = pathId.split('.').map(Number);
  
  let currentLayers = psd.children;
  let targetLayer: Layer | undefined;

  for (const index of indices) {
    if (!currentLayers || !currentLayers[index]) {
      return null;
    }
    targetLayer = currentLayers[index];
    currentLayers = targetLayer.children;
  }

  return targetLayer || null;
};

/**
 * Writes a PSD object to a file and triggers a browser download.
 * 
 * @param psd The PSD object to write.
 * @param filename The name of the file to download.
 */
export const writePsdFile = async (psd: Psd, filename: string) => {
  try {
    // writePsd returns an ArrayBuffer or Buffer depending on environment. In browser, ArrayBuffer.
    const buffer = writePsd(psd, { generateThumbnail: false });
    
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Error writing PSD file:", err);
    throw new Error("Failed to construct PSD binary.");
  }
};