/**
 * ConceptGraphView - Visualizes the story/lesson knowledge graph.
 * Shows connections between artifacts based on shared stories and lessons.
 *
 * Node types:
 * - Stories (historical/scientific examples): Violet circles
 * - Lessons (takeaways): Amber circles
 *
 * Edges connect stories/lessons to their artifacts.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { fonts } from '../design/tokens';

interface ConceptGraphViewProps {
  index: ConceptsIndex | null;
  selectedArtifact?: string;
  onSelectArtifact?: (filename: string) => void;
}

interface GraphNode {
  id: string;
  type: 'story' | 'lesson' | 'artifact';
  label: string;
  count: number; // Number of connections
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphEdge {
  source: string;
  target: string;
}

const NODE_RADIUS = {
  story: 8,
  lesson: 6,
  artifact: 10,
};

const NODE_COLORS = {
  story: '#8b5cf6', // violet
  lesson: '#f59e0b', // amber
  artifact: '#3b82f6', // blue
};

/**
 * Simple force-directed layout simulation
 */
function useForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number
): GraphNode[] {
  const [positions, setPositions] = useState<GraphNode[]>([]);
  const frameRef = useRef<number>();
  const iterationRef = useRef(0);

  useEffect(() => {
    if (nodes.length === 0 || width === 0 || height === 0) {
      setPositions([]);
      return;
    }

    // Initialize positions in a circle
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    const initialNodes = nodes.map((node, i) => ({
      ...node,
      x: centerX + radius * Math.cos((2 * Math.PI * i) / nodes.length),
      y: centerY + radius * Math.sin((2 * Math.PI * i) / nodes.length),
      vx: 0,
      vy: 0,
    }));

    // Build edge lookup for quick access
    const edgeMap = new Map<string, Set<string>>();
    edges.forEach((e) => {
      if (!edgeMap.has(e.source)) edgeMap.set(e.source, new Set());
      if (!edgeMap.has(e.target)) edgeMap.set(e.target, new Set());
      edgeMap.get(e.source)!.add(e.target);
      edgeMap.get(e.target)!.add(e.source);
    });

    iterationRef.current = 0;
    const maxIterations = 100;
    const cooling = 0.95;
    let temperature = 0.1;

    const simulate = () => {
      if (iterationRef.current >= maxIterations) return;

      const nodeMap = new Map(initialNodes.map((n) => [n.id, n]));

      // Calculate forces
      for (const node of initialNodes) {
        let fx = 0;
        let fy = 0;

        // Repulsion from all nodes
        for (const other of initialNodes) {
          if (node.id === other.id) continue;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 1000 / (dist * dist);
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        // Attraction to connected nodes
        const connected = edgeMap.get(node.id);
        if (connected) {
          for (const otherId of connected) {
            const other = nodeMap.get(otherId);
            if (!other) continue;
            const dx = other.x - node.x;
            const dy = other.y - node.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = dist * 0.01;
            fx += (dx / dist) * force;
            fy += (dy / dist) * force;
          }
        }

        // Center gravity
        fx += (centerX - node.x) * 0.001;
        fy += (centerY - node.y) * 0.001;

        // Apply velocity
        node.vx = (node.vx + fx) * temperature;
        node.vy = (node.vy + fy) * temperature;
        node.x += node.vx;
        node.y += node.vy;

        // Bounds
        const r = NODE_RADIUS[node.type];
        node.x = Math.max(r, Math.min(width - r, node.x));
        node.y = Math.max(r, Math.min(height - r, node.y));
      }

      temperature *= cooling;
      iterationRef.current++;
      setPositions([...initialNodes]);

      if (iterationRef.current < maxIterations) {
        frameRef.current = requestAnimationFrame(simulate);
      }
    };

    simulate();

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [nodes, edges, width, height]);

  return positions;
}

export default function ConceptGraphView({
  index,
  selectedArtifact,
  onSelectArtifact,
}: ConceptGraphViewProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Build graph data from index
  const { nodes, edges } = useMemo(() => {
    if (!index) return { nodes: [], edges: [] };

    const nodeMap = new Map<string, GraphNode>();
    const edgeList: GraphEdge[] = [];

    // Count story and lesson usage
    const storyCounts = new Map<string, number>();
    const lessonCounts = new Map<string, number>();

    Object.values(index.artifacts).forEach((artifact) => {
      artifact.stories.forEach((story) => {
        storyCounts.set(story, (storyCounts.get(story) || 0) + 1);
      });
      artifact.lessons.forEach((lesson) => {
        lessonCounts.set(lesson, (lessonCounts.get(lesson) || 0) + 1);
      });
    });

    // Add story nodes (only show those with > 0 connections)
    index.stories_used.forEach((story) => {
      const count = storyCounts.get(story) || 0;
      if (count > 0) {
        nodeMap.set(`story:${story}`, {
          id: `story:${story}`,
          type: 'story',
          label: story.replace(/-/g, ' '),
          count,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
        });
      }
    });

    // Add lesson nodes
    index.lessons_used.forEach((lesson) => {
      const count = lessonCounts.get(lesson) || 0;
      if (count > 0) {
        nodeMap.set(`lesson:${lesson}`, {
          id: `lesson:${lesson}`,
          type: 'lesson',
          label: lesson.replace(/-/g, ' '),
          count,
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
        });
      }
    });

    // Add artifact nodes and edges
    Object.entries(index.artifacts).forEach(([filename, artifact]) => {
      // Only add artifacts that have stories or lessons
      if (artifact.stories.length === 0 && artifact.lessons.length === 0) return;

      const artifactId = `artifact:${filename}`;
      nodeMap.set(artifactId, {
        id: artifactId,
        type: 'artifact',
        label: artifact.title,
        count: artifact.stories.length + artifact.lessons.length,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
      });

      // Connect to stories
      artifact.stories.forEach((story) => {
        const storyId = `story:${story}`;
        if (nodeMap.has(storyId)) {
          edgeList.push({ source: artifactId, target: storyId });
        }
      });

      // Connect to lessons
      artifact.lessons.forEach((lesson) => {
        const lessonId = `lesson:${lesson}`;
        if (nodeMap.has(lessonId)) {
          edgeList.push({ source: artifactId, target: lessonId });
        }
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      edges: edgeList,
    };
  }, [index]);

  // Run force layout
  const positions = useForceLayout(nodes, edges, dimensions.width, dimensions.height);

  // Build position lookup
  const positionMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    positions.forEach((node) => map.set(node.id, node));
    return map;
  }, [positions]);

  // Get highlighted edges (connected to hovered/selected node)
  const highlightedEdges = useMemo(() => {
    const activeNode = selectedNode || hoveredNode;
    if (!activeNode) return new Set<string>();

    const highlighted = new Set<string>();
    edges.forEach((e) => {
      if (e.source === activeNode || e.target === activeNode) {
        highlighted.add(`${e.source}-${e.target}`);
      }
    });
    return highlighted;
  }, [edges, selectedNode, hoveredNode]);

  // Get highlighted nodes (connected to hovered/selected node)
  const highlightedNodes = useMemo(() => {
    const activeNode = selectedNode || hoveredNode;
    if (!activeNode) return new Set<string>();

    const highlighted = new Set<string>([activeNode]);
    edges.forEach((e) => {
      if (e.source === activeNode) highlighted.add(e.target);
      if (e.target === activeNode) highlighted.add(e.source);
    });
    return highlighted;
  }, [edges, selectedNode, hoveredNode]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (selectedNode === nodeId) {
        setSelectedNode(null);
      } else {
        setSelectedNode(nodeId);
      }
    },
    [selectedNode]
  );

  // Stats
  const stats = useMemo(() => {
    if (!index) return { stories: 0, lessons: 0, artifacts: 0 };
    return {
      stories: index.stories_used.length,
      lessons: index.lessons_used.length,
      artifacts: Object.keys(index.artifacts).length,
    };
  }, [index]);

  if (!index) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: theme.textSecondary,
          fontFamily: fonts.sans,
          padding: '32px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '14px', marginBottom: '8px' }}>No concept index found</div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          Stories and lessons will appear here as you create artifacts
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: theme.textSecondary,
          fontFamily: fonts.sans,
          padding: '32px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '14px', marginBottom: '8px' }}>No stories or lessons indexed yet</div>
        <div style={{ fontSize: '12px', opacity: 0.7 }}>
          Create artifacts with STORY: and LESSON: metadata to populate the graph
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Stats header */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          display: 'flex',
          gap: '16px',
          fontSize: '11px',
          fontFamily: fonts.sans,
          color: theme.textSecondary,
          zIndex: 10,
        }}
      >
        <span>
          <span style={{ color: NODE_COLORS.story }}>●</span> {stats.stories} stories
        </span>
        <span>
          <span style={{ color: NODE_COLORS.lesson }}>●</span> {stats.lessons} lessons
        </span>
        <span>
          <span style={{ color: NODE_COLORS.artifact }}>●</span> {stats.artifacts} artifacts
        </span>
      </div>

      {/* SVG Graph */}
      <svg
        width={dimensions.width}
        height={dimensions.height}
        style={{ display: 'block' }}
      >
        {/* Edges */}
        <g>
          {edges.map((edge) => {
            const source = positionMap.get(edge.source);
            const target = positionMap.get(edge.target);
            if (!source || !target) return null;

            const edgeKey = `${edge.source}-${edge.target}`;
            const isHighlighted = highlightedEdges.has(edgeKey);
            const hasActiveNode = selectedNode || hoveredNode;

            return (
              <line
                key={edgeKey}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isHighlighted ? theme.accent : theme.border}
                strokeWidth={isHighlighted ? 2 : 1}
                opacity={hasActiveNode && !isHighlighted ? 0.2 : 0.6}
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {positions.map((node) => {
            const isHighlighted = highlightedNodes.has(node.id);
            const hasActiveNode = selectedNode || hoveredNode;
            const radius = NODE_RADIUS[node.type] + (node.count - 1) * 1.5;
            const isHovered = hoveredNode === node.id;
            const isSelected = selectedNode === node.id;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => handleNodeClick(node.id)}
              >
                {/* Node circle */}
                <circle
                  r={radius}
                  fill={NODE_COLORS[node.type]}
                  opacity={hasActiveNode && !isHighlighted ? 0.3 : 1}
                  stroke={isSelected ? '#fff' : isHovered ? 'rgba(255,255,255,0.5)' : 'none'}
                  strokeWidth={isSelected ? 3 : isHovered ? 2 : 0}
                />

                {/* Label on hover */}
                {(isHovered || isSelected) && (
                  <>
                    <rect
                      x={radius + 6}
                      y={-10}
                      width={Math.min(node.label.length * 6 + 12, 200)}
                      height={20}
                      rx={4}
                      fill={theme.isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)'}
                    />
                    <text
                      x={radius + 12}
                      y={4}
                      fontSize="11px"
                      fontFamily={fonts.sans}
                      fill={theme.text}
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.label.length > 30 ? node.label.slice(0, 30) + '...' : node.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Selected node details panel */}
      {selectedNode && (
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            right: '12px',
            padding: '12px',
            backgroundColor: theme.isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)',
            borderRadius: '8px',
            fontFamily: fonts.sans,
            fontSize: '12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '4px', color: theme.text }}>
            {positionMap.get(selectedNode)?.label}
          </div>
          <div style={{ color: theme.textSecondary, fontSize: '11px' }}>
            {selectedNode.startsWith('story:') && 'Historical/scientific example'}
            {selectedNode.startsWith('lesson:') && 'Takeaway lesson'}
            {selectedNode.startsWith('artifact:') && 'Artifact'}
            {' • '}
            {highlightedNodes.size - 1} connections
          </div>
          {selectedNode.startsWith('artifact:') && onSelectArtifact && (
            <button
              onClick={() => {
                const filename = selectedNode.replace('artifact:', '');
                onSelectArtifact(filename);
              }}
              style={{
                marginTop: '8px',
                padding: '4px 12px',
                fontSize: '11px',
                backgroundColor: theme.accent,
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              View Artifact
            </button>
          )}
        </div>
      )}
    </div>
  );
}
