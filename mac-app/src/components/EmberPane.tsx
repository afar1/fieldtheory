import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { isDocumentSaveConflict, isDocumentSaveOk } from '../utils/documentSaveConflicts';
import {
  EMBER_FOLDER_NAME,
  EMBER_TIMING_PRESETS,
  EMBER_VISIBLE_PERSON_LIMIT,
  type EmberPerson,
  type EmberTimingPreset,
  buildEmberFrontmatterUpdate,
  createEmberPersonContent,
  emberPersonFromPage,
  isEmberTimingPreset,
  sortEmberPeople,
} from '../utils/ember';

interface EmberPaneProps {
  active?: boolean;
  onOpenPerson: (relPath: string) => void;
  onPersonCreated?: (page: WikiPage) => void;
}

function collectEmberRelPathsFromNode(node: WikiNode): string[] {
  if (node.kind === 'file') {
    return node.relPath.startsWith(`${EMBER_FOLDER_NAME}/`) ? [node.relPath] : [];
  }
  return node.children.flatMap(collectEmberRelPathsFromNode);
}

export function collectEmberRelPathsFromRoots(roots: LibraryRoot[]): string[] {
  const builtinRoot = roots.find((root) => root.builtin);
  if (!builtinRoot) return [];
  return builtinRoot.tree.flatMap(collectEmberRelPathsFromNode);
}

function formatCountdown(person: EmberPerson): string {
  if (person.daysUntil <= 0) return 'now';
  if (person.daysUntil === 1) return 'tomorrow';
  return `${person.daysUntil} days`;
}

function sameEmberPeople(left: EmberPerson[], right: EmberPerson[]): boolean {
  return left.length === right.length && left.every((person, index) => {
    const other = right[index];
    return other
      && person.relPath === other.relPath
      && person.title === other.title
      && person.nextAt === other.nextAt
      && person.daysUntil === other.daysUntil
      && person.urgencyProgress === other.urgencyProgress
      && person.opacity === other.opacity
      && person.documentVersion.sha256 === other.documentVersion.sha256;
  });
}

function shouldReduceMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function EmberPane({ active = true, onOpenPerson, onPersonCreated }: EmberPaneProps) {
  const { theme } = useTheme();
  const [people, setPeople] = useState<EmberPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPersonName, setNewPersonName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savingRelPath, setSavingRelPath] = useState<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const hasLoadedPeopleRef = useRef(false);
  const previousCardRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const demoTimeoutRef = useRef<number | null>(null);
  const [demoOrder, setDemoOrder] = useState<string[] | null>(null);
  const visiblePeople = useMemo(() => {
    const ordered = people.slice(0, EMBER_VISIBLE_PERSON_LIMIT);
    if (!demoOrder) return ordered;
    const peopleByRelPath = new Map(ordered.map((person) => [person.relPath, person]));
    return demoOrder
      .map((relPath) => peopleByRelPath.get(relPath))
      .filter((person): person is EmberPerson => !!person);
  }, [demoOrder, people]);
  const visiblePeopleKey = useMemo(() => visiblePeople.map((person) => person.relPath).join('\n'), [visiblePeople]);

  const captureCardPositions = useCallback(() => {
    if (shouldReduceMotion()) return;
    const rects = new Map<string, DOMRect>();
    cardRefs.current.forEach((element, relPath) => {
      rects.set(relPath, element.getBoundingClientRect());
    });
    previousCardRectsRef.current = rects;
  }, []);

  useLayoutEffect(() => {
    const previousRects = previousCardRectsRef.current;
    if (!previousRects || shouldReduceMotion()) return;
    previousCardRectsRef.current = null;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const movingElements: HTMLElement[] = [];
    cardRefs.current.forEach((element, relPath) => {
      const previousRect = previousRects.get(relPath);
      if (!previousRect) return;
      const nextRect = element.getBoundingClientRect();
      const dx = previousRect.left - nextRect.left;
      const dy = previousRect.top - nextRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      element.style.transition = 'none';
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      movingElements.push(element);
    });

    if (movingElements.length === 0) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      for (const element of movingElements) {
        element.style.transition = 'transform 180ms ease, opacity 180ms ease';
        element.style.transform = 'translate(0, 0)';
      }
      animationFrameRef.current = null;
    });
  }, [visiblePeopleKey]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (demoTimeoutRef.current !== null) {
      window.clearTimeout(demoTimeoutRef.current);
    }
  }, []);

  const loadPeople = useCallback(async () => {
    if (!hasLoadedPeopleRef.current) setLoading(true);
    const roots = await window.libraryAPI?.getRoots?.() ?? [];
    const relPaths = collectEmberRelPathsFromRoots(roots);
    const pages = (await Promise.all(relPaths.map((relPath) => window.wikiAPI?.getPage(relPath))))
      .filter((page): page is WikiPage => !!page);
    const nextPeople = sortEmberPeople(pages.map((page) => emberPersonFromPage(page)));
    captureCardPositions();
    setPeople((prev) => sameEmberPeople(prev, nextPeople) ? prev : nextPeople);
    hasLoadedPeopleRef.current = true;
    setLoading(false);
  }, [captureCardPositions]);

  useEffect(() => {
    if (!active) return;
    void loadPeople();
    const unsubscribeLibrary = window.libraryAPI?.onRootsChanged?.(() => {
      void loadPeople();
    });
    const unsubscribeWiki = window.wikiAPI?.onPageChanged?.(() => {
      void loadPeople();
    });
    return () => {
      unsubscribeLibrary?.();
      unsubscribeWiki?.();
    };
  }, [active, loadPeople]);

  const demoAnimation = useCallback(() => {
    const relPaths = people.slice(0, EMBER_VISIBLE_PERSON_LIMIT).map((person) => person.relPath);
    if (relPaths.length < 2) return;
    if (demoTimeoutRef.current !== null) {
      window.clearTimeout(demoTimeoutRef.current);
      demoTimeoutRef.current = null;
    }
    const midpoint = Math.ceil(relPaths.length / 2);
    const demoRelPaths = [...relPaths.slice(midpoint), ...relPaths.slice(0, midpoint)];
    captureCardPositions();
    setDemoOrder(demoRelPaths);
    demoTimeoutRef.current = window.setTimeout(() => {
      captureCardPositions();
      setDemoOrder(null);
      demoTimeoutRef.current = null;
    }, 800);
  }, [captureCardPositions, people]);

  const saveTiming = useCallback(async (person: EmberPerson, preset: EmberTimingPreset) => {
    setSavingRelPath(person.relPath);
    setError(null);
    const latestPage = await window.wikiAPI?.getPage(person.relPath);
    if (!latestPage) {
      setSavingRelPath(null);
      setError('Could not find that Ember person file.');
      await loadPeople();
      return;
    }
    let updatedContent = buildEmberFrontmatterUpdate(latestPage.content, preset);
    const result = await window.wikiAPI?.save(latestPage.relPath, updatedContent, latestPage.documentVersion);
    let updatedVersion = isDocumentSaveOk(result) ? result.version : null;
    if (isDocumentSaveConflict(result) && result.currentContent && result.currentVersion) {
      updatedContent = buildEmberFrontmatterUpdate(result.currentContent, preset);
      const retry = await window.wikiAPI?.save(latestPage.relPath, updatedContent, result.currentVersion);
      if (isDocumentSaveOk(retry)) {
        updatedVersion = retry.version;
      } else {
        setError('Could not update timing because the file changed again.');
      }
    } else if (!isDocumentSaveOk(result)) {
      setError('Could not update timing.');
    }
    if (updatedVersion) {
      const updatedPage = { ...latestPage, content: updatedContent, documentVersion: updatedVersion };
      captureCardPositions();
      setPeople((prev) => sortEmberPeople(prev.map((person) => (
        person.relPath === updatedPage.relPath ? emberPersonFromPage(updatedPage) : person
      ))));
    } else {
      await loadPeople();
    }
    setSavingRelPath(null);
  }, [captureCardPositions, loadPeople]);

  const resetAfterConversation = useCallback(async (person: EmberPerson) => {
    if (!isEmberTimingPreset(person.frequency)) return;
    await saveTiming(person, person.frequency);
  }, [saveTiming]);

  const createPerson = useCallback(async () => {
    const name = newPersonName.trim();
    if (!name) return;
    setError(null);
    const page = await window.wikiAPI?.createFile(EMBER_FOLDER_NAME, name);
    if (!page) {
      setError('Could not create person. Check for a duplicate or invalid name.');
      return;
    }
    const content = createEmberPersonContent(page.title);
    const result = await window.wikiAPI?.save(page.relPath, content, page.documentVersion);
    if (!isDocumentSaveOk(result)) {
      setError('Created person, but could not seed Ember timing.');
      onPersonCreated?.(page);
      setNewPersonName('');
      await loadPeople();
      return;
    }
    const savedPage = { ...page, content, documentVersion: isDocumentSaveOk(result) ? result.version : page.documentVersion };
    onPersonCreated?.(savedPage);
    captureCardPositions();
    setPeople((prev) => sortEmberPeople([
      emberPersonFromPage(savedPage),
      ...prev.filter((person) => person.relPath !== savedPage.relPath),
    ]));
    setNewPersonName('');
  }, [captureCardPositions, loadPeople, newPersonName, onPersonCreated]);

  const cardBorder = theme.isDark ? 'rgba(255,255,255,0.5)' : 'rgba(17,24,39,0.36)';
  const cardBg = theme.isDark ? 'rgba(255,255,255,0.018)' : 'rgba(255,255,255,0.66)';
  const duePeople = visiblePeople.filter((person) => person.due);
  const upcomingPeople = visiblePeople.filter((person) => !person.due);

  const renderPerson = (person: EmberPerson) => (
    <div
      key={person.relPath}
      role="button"
      tabIndex={0}
      onClick={() => onOpenPerson(person.relPath)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpenPerson(person.relPath);
      }}
      ref={(element) => {
        if (element) cardRefs.current.set(person.relPath, element);
        else cardRefs.current.delete(person.relPath);
      }}
      style={{
        opacity: person.opacity,
        minHeight: '58px',
        border: `1.5px solid ${cardBorder}`,
        borderRadius: '8px',
        background: cardBg,
        padding: '10px 12px',
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        cursor: 'pointer',
        transition: 'transform 180ms ease, opacity 180ms ease',
        willChange: 'transform, opacity',
      }}
    >
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 520, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {person.title}
        </div>
        <div style={{ marginTop: '3px', fontSize: '11px', color: theme.textSecondary }}>
          {formatCountdown(person)}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '5px', maxWidth: '240px' }}>
        {EMBER_TIMING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            disabled={savingRelPath === person.relPath}
            title={`Reset ${person.title} for ${preset.label}`}
            onClick={(event) => {
              event.stopPropagation();
              void saveTiming(person, preset.id);
            }}
            style={{
              height: '24px',
              padding: '0 7px',
              border: `1px solid ${theme.border}`,
              borderRadius: '5px',
              background: 'transparent',
              color: theme.textSecondary,
              fontSize: '10px',
              cursor: savingRelPath === person.relPath ? 'default' : 'pointer',
            }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          disabled={savingRelPath === person.relPath || !isEmberTimingPreset(person.frequency)}
          title={isEmberTimingPreset(person.frequency) ? `Reset ${person.title} because you talked` : 'Choose a timing first'}
          onClick={(event) => {
            event.stopPropagation();
            void resetAfterConversation(person);
          }}
          style={{
            height: '24px',
            padding: '0 8px',
            border: `1px solid ${theme.accent}`,
            borderRadius: '5px',
            background: isEmberTimingPreset(person.frequency)
              ? (theme.isDark ? 'rgba(20,184,166,0.12)' : 'rgba(15,118,110,0.08)')
              : 'transparent',
            color: isEmberTimingPreset(person.frequency) ? theme.text : theme.textSecondary,
            fontSize: '10px',
            cursor: savingRelPath === person.relPath || !isEmberTimingPreset(person.frequency) ? 'default' : 'pointer',
          }}
        >
          Talked
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: theme.bg, color: theme.text }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '34px 28px 56px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
          <input
            value={newPersonName}
            onChange={(event) => setNewPersonName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createPerson();
            }}
            placeholder="Person name"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              height: '32px',
              padding: '0 10px',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              background: theme.inputBg,
              color: theme.text,
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={() => void createPerson()}
            disabled={!newPersonName.trim()}
            style={{
              height: '32px',
              padding: '0 10px',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              background: newPersonName.trim() ? theme.hoverBg : 'transparent',
              color: theme.text,
              fontSize: '12px',
              cursor: newPersonName.trim() ? 'pointer' : 'default',
            }}
          >
            New person
          </button>
          <button
            type="button"
            onClick={demoAnimation}
            disabled={visiblePeople.length < 2}
            title="Demo Ember card animation"
            style={{
              height: '32px',
              padding: '0 10px',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              background: 'transparent',
              color: theme.textSecondary,
              fontSize: '12px',
              cursor: visiblePeople.length >= 2 ? 'pointer' : 'default',
            }}
          >
            Demo animation
          </button>
        </div>
        {error && (
          <div role="status" style={{ marginBottom: '12px', fontSize: '12px', color: theme.textSecondary }}>
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ fontSize: '12px', color: theme.textSecondary }}>Loading Ember...</div>
        ) : visiblePeople.length === 0 ? (
          <div style={{ fontSize: '12px', color: theme.textSecondary }}>No Ember people yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {duePeople.length > 0 && (
              <div style={{ fontSize: '11px', color: theme.textSecondary, marginBottom: '-2px' }}>Need to reach out</div>
            )}
            {duePeople.map(renderPerson)}
            {upcomingPeople.length > 0 && (
              <div style={{ fontSize: '11px', color: theme.textSecondary, margin: duePeople.length > 0 ? '8px 0 -2px' : '0 0 -2px' }}>
                Upcoming
              </div>
            )}
            {upcomingPeople.map(renderPerson)}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(EmberPane);
