export type MarkdownFormattingKind = 'bold' | 'italic' | 'underline';

export type MarkdownFormattingEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

type MarkdownFormattingMarkers = {
  open: string;
  close: string;
};

function getFormattingMarkers(kind: MarkdownFormattingKind): MarkdownFormattingMarkers {
  switch (kind) {
    case 'bold':
      return { open: '**', close: '**' };
    case 'italic':
      return { open: '*', close: '*' };
    case 'underline':
      return { open: '<u>', close: '</u>' };
  }
}

function hasStandaloneAsteriskAt(value: string, offset: number): boolean {
  return value[offset] === '*'
    && value[offset - 1] !== '*'
    && value[offset + 1] !== '*';
}

function hasMarkerAt(value: string, offset: number, marker: string): boolean {
  if (marker === '*') return hasStandaloneAsteriskAt(value, offset);
  return value.slice(offset, offset + marker.length) === marker;
}

function selectionHasWrappingMarkers(selected: string, markers: MarkdownFormattingMarkers): boolean {
  const closeStart = selected.length - markers.close.length;
  if (closeStart < markers.open.length) return false;
  return hasMarkerAt(selected, 0, markers.open) && hasMarkerAt(selected, closeStart, markers.close);
}

export function getMarkdownFormattingEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  kind: MarkdownFormattingKind,
): MarkdownFormattingEdit {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, value.length));
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), value.length));
  const markers = getFormattingMarkers(kind);
  const selected = value.slice(start, end);

  if (selected && selectionHasWrappingMarkers(selected, markers)) {
    const innerStart = start + markers.open.length;
    const innerEnd = end - markers.close.length;
    return {
      nextValue: `${value.slice(0, start)}${value.slice(innerStart, innerEnd)}${value.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + Math.max(0, innerEnd - innerStart),
    };
  }

  const openStart = start - markers.open.length;
  const hasSurroundingMarkers = openStart >= 0
    && hasMarkerAt(value, openStart, markers.open)
    && hasMarkerAt(value, end, markers.close);
  if (selected && hasSurroundingMarkers) {
    return {
      nextValue: `${value.slice(0, openStart)}${selected}${value.slice(end + markers.close.length)}`,
      selectionStart: openStart,
      selectionEnd: openStart + selected.length,
    };
  }

  return {
    nextValue: `${value.slice(0, start)}${markers.open}${selected}${markers.close}${value.slice(end)}`,
    selectionStart: start + markers.open.length,
    selectionEnd: start + markers.open.length + selected.length,
  };
}
