import { useNodes, useEdges, Node } from 'reactflow';
import { PSDNodeData, ContainerContext } from '../types';
import { createContainerContext } from '../services/psdService';

/**
 * Custom hook for downstream nodes to retrieve the ContainerContext 
 * from a connected TemplateSplitterNode.
 * 
 * It automatically finds the edge connected to the target node, identifies 
 * the source handle (which corresponds to the container name), and resolves 
 * the specific container context.
 * 
 * @param nodeId The ID of the node requesting the context (usually the current node).
 * @returns The scoped ContainerContext or null if not connected or not found.
 */
export const useContainerContext = (nodeId: string): ContainerContext | null => {
  const nodes = useNodes();
  const edges = useEdges();

  // Find the edge connected to this node's input (target)
  // Assumes a single input connection for the context
  const edge = edges.find(e => e.target === nodeId);
  
  if (!edge || !edge.sourceHandle) {
    return null;
  }

  // Find the source node (expected to be TemplateSplitterNode or compatible)
  const sourceNode = nodes.find(n => n.id === edge.source) as Node<PSDNodeData>;

  if (!sourceNode || !sourceNode.data.template) {
    return null;
  }

  // The TemplateSplitterNode uses the container name as the sourceHandle ID.
  // We use this ID to look up the specific container context.
  return createContainerContext(sourceNode.data.template, edge.sourceHandle);
};