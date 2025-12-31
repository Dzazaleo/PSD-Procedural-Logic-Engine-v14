import { useCallback } from 'react';
import { SerializableLayer } from '../types';

export type ResolverStatus = 
  | 'RESOLVED' 
  | 'CASE_MISMATCH' 
  | 'MISSING_DESIGN_GROUP' 
  | 'EMPTY_GROUP' 
  | 'DATA_LOCKED' 
  | 'NO_NAME'
  | 'UNKNOWN_ERROR';

export interface ResolverResult {
  layer: SerializableLayer | null;
  status: ResolverStatus;
  message: string;
  totalCount?: number; // Recursive count of visible/leaf layers
}

// Helper: Deep recursive search for a layer by name
// Returns the first match found in the tree (pre-order traversal)
const findLayerDeep = (tree: SerializableLayer[], targetName: string, caseSensitive: boolean): SerializableLayer | null => {
  for (const layer of tree) {
    const layerName = layer.name || '';
    const isMatch = caseSensitive 
      ? layerName === targetName 
      : layerName.toLowerCase() === targetName.toLowerCase();

    if (isMatch) {
      return layer;
    }

    // Recursive Step
    if (layer.children && layer.children.length > 0) {
      const foundInChildren = findLayerDeep(layer.children, targetName, caseSensitive);
      if (foundInChildren) {
        return foundInChildren;
      }
    }
  }
  return null;
};

// Helper: Recursively count leaf layers (pixels/generative)
// Groups sum their children; Layers return 1.
const getRecursiveLeafCount = (layer: SerializableLayer): number => {
  // Base case: If it's not a group, it's a content layer (1)
  if (layer.type !== 'group') {
    return 1;
  }
  
  // If it is a group but has no children, it's empty (0)
  if (!layer.children || layer.children.length === 0) {
    return 0;
  }

  // Recursive case: Sum of children's leaf counts
  return layer.children.reduce((sum, child) => sum + getRecursiveLeafCount(child), 0);
};

/**
 * Hook to resolve a template container name to a matching design layer group.
 * 
 * Encapsulates the logic for:
 * 1. Stripping procedural prefixes (e.g., '!!SYMBOLS' -> 'SYMBOLS')
 * 2. Strict & Case-insensitive matching using DEEP RECURSION
 * 3. Hierarchy/Content validation using RECURSIVE LEAF COUNTING
 */
export const usePsdResolver = () => {
  /**
   * Resolves a template name to a matching group in the design layer tree with diagnostic feedback.
   * 
   * @param templateName The name of the container/template (e.g. "!!SYMBOLS" or "SYMBOLS").
   * @param designTree The array of SerializableLayers from the PSD.
   * @returns ResolverResult object containing the layer (if found), status code, message, and deep count.
   */
  const resolveLayer = useCallback((templateName: string, designTree: SerializableLayer[] | null): ResolverResult => {
    // Check if design data is available (Rule 2: Data Locked)
    if (!designTree) {
      return { 
        status: 'DATA_LOCKED', 
        layer: null, 
        message: 'Waiting for layer data...',
        totalCount: 0
      };
    }

    if (!templateName) {
      return { 
        status: 'NO_NAME', 
        layer: null, 
        message: 'No container connected',
        totalCount: 0
      };
    }

    // 1. Strip procedural prefixes (Rule 1: Stripping)
    const cleanTargetName = templateName.replace(/^!+/, '').trim();
    
    if (!cleanTargetName) {
      return { 
        status: 'NO_NAME', 
        layer: null, 
        message: 'Invalid name',
        totalCount: 0
      };
    }

    // 2. Strict Deep Search (Priority 1)
    const strictMatch = findLayerDeep(designTree, cleanTargetName, true);
    
    if (strictMatch) {
       const totalCount = getRecursiveLeafCount(strictMatch);

       // Content Validation (Rule: Recursive Empty Check)
       if (totalCount === 0) {
           return { 
             status: 'EMPTY_GROUP', 
             layer: strictMatch, 
             message: 'Group is empty',
             totalCount: 0
           };
       }
       return { 
         status: 'RESOLVED', 
         layer: strictMatch, 
         message: `${totalCount} Layers Found`,
         totalCount: totalCount
       };
    }

    // 3. Loose Deep Search (Priority 2 - Fallback)
    const looseMatch = findLayerDeep(designTree, cleanTargetName, false);
    
    if (looseMatch) {
       const totalCount = getRecursiveLeafCount(looseMatch);

       if (totalCount === 0) {
           return { 
             status: 'EMPTY_GROUP', 
             layer: looseMatch, 
             message: 'Empty (Case Mismatch)',
             totalCount: 0
           };
       }
       return { 
         status: 'CASE_MISMATCH', 
         layer: looseMatch, 
         message: `Warning: Case Mismatch (${totalCount} Layers)`,
         totalCount: totalCount
       };
    }

    // 4. No match found
    return { 
      status: 'MISSING_DESIGN_GROUP', 
      layer: null, 
      message: `No group named "${cleanTargetName}"`,
      totalCount: 0
    };
  }, []);

  return { resolveLayer };
};