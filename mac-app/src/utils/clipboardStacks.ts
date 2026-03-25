import type { ClipboardItem, ListRow, StackInfo } from '../types/clipboard';

type HydratedStackItemsById = Record<string, ClipboardItem[]>;

function groupItemsByStackId(items: ClipboardItem[]): Map<string, ClipboardItem[]> {
  const grouped = new Map<string, ClipboardItem[]>();

  for (const item of items) {
    if (!item.stackId) continue;

    const existing = grouped.get(item.stackId) ?? [];
    existing.push(item);
    grouped.set(item.stackId, existing);
  }

  return grouped;
}

function getStackInfoById(stacks: StackInfo[]): Map<string, StackInfo> {
  return new Map(stacks.map((stack) => [stack.stackId, stack]));
}

function getItemIdSignature(items: ClipboardItem[]): string {
  return items.map((item) => item.id).join(',');
}

export function getStackHydrationIds(
  items: ClipboardItem[],
  stacks: StackInfo[],
  hydratedStackItemsById: HydratedStackItemsById
): string[] {
  const visibleItemsByStackId = groupItemsByStackId(items);
  const stackInfoById = getStackInfoById(stacks);
  const stackIdsToHydrate: string[] = [];

  for (const [stackId, visibleItems] of visibleItemsByStackId) {
    const stackInfo = stackInfoById.get(stackId);
    if (!stackInfo) continue;

    const hydratedItems = hydratedStackItemsById[stackId];
    if (!hydratedItems) {
      if (stackInfo.itemCount > visibleItems.length) {
        stackIdsToHydrate.push(stackId);
      }
      continue;
    }

    if (hydratedItems.length !== stackInfo.itemCount) {
      stackIdsToHydrate.push(stackId);
      continue;
    }

    const hydratedItemIds = new Set(hydratedItems.map((item) => item.id));
    if (!visibleItems.every((item) => hydratedItemIds.has(item.id))) {
      stackIdsToHydrate.push(stackId);
    }
  }

  return stackIdsToHydrate;
}

export function buildClipboardListRows(
  items: ClipboardItem[],
  stacks: StackInfo[],
  expandedStacks: ReadonlySet<string>,
  hydratedStackItemsById: HydratedStackItemsById
): ListRow[] {
  const rows: ListRow[] = [];
  const seenStackIds = new Set<string>();
  const visibleItemsByStackId = groupItemsByStackId(items);
  const stackInfoById = getStackInfoById(stacks);

  for (const item of items) {
    if (!item.stackId) {
      rows.push({ type: 'item', item });
      continue;
    }

    if (seenStackIds.has(item.stackId)) {
      continue;
    }
    seenStackIds.add(item.stackId);

    const stackInfo = stackInfoById.get(item.stackId);
    if (!stackInfo) {
      rows.push({ type: 'item', item });
      continue;
    }

    const stackItems =
      hydratedStackItemsById[item.stackId] ??
      visibleItemsByStackId.get(item.stackId) ??
      [item];

    rows.push({
      type: 'stack',
      stack: stackInfo,
      items: stackItems,
      expanded: expandedStacks.has(item.stackId),
    });
  }

  return rows;
}

export function getStackItemsSignature(items: ClipboardItem[]): string {
  return `${items.length}:${getItemIdSignature(items)}`;
}
