/**
 * DraggableDroppableRow - wrapper that makes a row both draggable and a drop target.
 * Uses dnd-kit's useDraggable and useDroppable hooks.
 * Memoized to prevent unnecessary re-renders during list navigation.
 */
import React from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';

export interface DraggableDroppableRowProps extends React.HTMLAttributes<HTMLDivElement> {
  id: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  isOver?: boolean;
  isDragging?: boolean;
}

export const DraggableDroppableRow = React.memo(function DraggableDroppableRow({
  id,
  children,
  style,
  isOver,
  isDragging,
  ...props
}: DraggableDroppableRowProps) {
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
});

export default DraggableDroppableRow;
