import React from 'react';
import type { PlaygroundTab, TabId } from './types';

interface TabRailProps {
  tabs: PlaygroundTab[];
  activeId: TabId;
  onSelect: (id: TabId) => void;
}

export function TabRail({ tabs, activeId, onSelect }: TabRailProps) {
  const buttonsRef = React.useRef<Map<TabId, HTMLButtonElement>>(new Map());

  const focusTab = (id: TabId) => {
    buttonsRef.current.get(id)?.focus();
    onSelect(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const ids = tabs.map(t => t.id);
    const idx = ids.indexOf(activeId);
    if (idx < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab(ids[(idx + 1) % ids.length]);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab(ids[(idx - 1 + ids.length) % ids.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(ids[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(ids[ids.length - 1]);
    }
  };

  return (
    <div
      className="pg-tab-rail"
      role="tablist"
      aria-orientation="vertical"
      aria-label="Demo feature tabs"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={el => {
              if (el) buttonsRef.current.set(tab.id, el);
              else buttonsRef.current.delete(tab.id);
            }}
            id={`pg-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`pg-tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={`pg-tab${selected ? ' pg-tab--active' : ''}`}
            onClick={() => onSelect(tab.id)}
          >
            <span className="pg-tab-index">{String(i + 1).padStart(2, '0')}</span>
            <span className="pg-tab-body">
              <span className="pg-tab-label">{tab.label}</span>
              <span className="pg-tab-subtitle">{tab.subtitle}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
