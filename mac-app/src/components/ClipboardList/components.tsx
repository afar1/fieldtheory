/**
 * ClipboardList Shared Components
 * 
 * Small reusable components used in the list rendering.
 */

import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';

/**
 * DraggableDroppableRow - wrapper that makes a row both draggable and a drop target.
 * Uses dnd-kit's useDraggable and useDroppable hooks.
 */
export function DraggableDroppableRow({
  id,
  children,
  style,
  isOver,
  isDragging,
  ...props
}: {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  isOver?: boolean;
  isDragging?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id });
  const { setNodeRef: setDropRef } = useDroppable({ id });

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      {...props}
      style={{
        ...style,
        opacity: isDragging ? 0.5 : 1,
        outline: isOver ? '2px solid #2dd4bf' : 'none',
        outlineOffset: '-2px',
      }}
    >
      {children}
    </div>
  );
}

/**
 * KeyCap component - renders a keyboard key with clean styling.
 * Used for displaying keyboard shortcuts with a visual key appearance.
 */
export function KeyCap({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: small ? '1px 4px' : '2px 5px',
        fontSize: small ? '9px' : '10px',
        fontWeight: 500,
        color: '#555',
        backgroundColor: '#e8e8e8',
        borderRadius: '3px',
        marginRight: '2px',
      }}
    >
      {children}
    </span>
  );
}
