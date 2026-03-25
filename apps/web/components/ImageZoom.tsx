'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_STEP = 0.15;

export default function ImageZoom({ src, alt }: { src: string; alt: string }): React.ReactElement {
  const t = useTranslations('imageZoom');
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const isZoomed = scale > 1;

  const clampTranslate = useCallback((tx: number, ty: number, s: number) => {
    if (s <= 1) return { x: 0, y: 0 };
    const el = containerRef.current;
    if (!el) return { x: tx, y: ty };
    const maxX = ((s - 1) * el.clientWidth) / 2;
    const maxY = ((s - 1) * el.clientHeight) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, tx)),
      y: Math.max(-maxY, Math.min(maxY, ty)),
    };
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      setScale((prev) => {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta));
        if (next <= 1) setTranslate({ x: 0, y: 0 });
        else setTranslate((t) => clampTranslate(t.x, t.y, next));
        return next;
      });
    },
    [clampTranslate],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isZoomed) return;
      e.preventDefault();
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      translateStart.current = { ...translate };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [isZoomed, translate],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setTranslate(
        clampTranslate(translateStart.current.x + dx, translateStart.current.y + dy, scale),
      );
    },
    [dragging, scale, clampTranslate],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (isZoomed) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(3);
    }
  }, [isZoomed]);

  // Reset on src change
  useEffect(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, [src]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={containerRef}
        className={`relative flex-1 overflow-hidden ${isZoomed ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="h-full w-full select-none object-contain transition-transform duration-100"
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transitionProperty: dragging ? 'none' : 'transform',
          }}
        />
      </div>

      {/* Zoom controls */}
      <div className="flex items-center justify-between border-t border-[#d4c5a9] bg-[#ebe0c8] px-3 py-1.5">
        <span className="font-serif text-[10px] text-[#7a6652]">
          {isZoomed ? t('dragHint') : t('scrollHint')}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              const next = Math.max(MIN_SCALE, scale - ZOOM_STEP * 3);
              setScale(next);
              if (next <= 1) setTranslate({ x: 0, y: 0 });
              else setTranslate((t) => clampTranslate(t.x, t.y, next));
            }}
            className="rounded p-1 text-[#7a6652] transition-colors hover:bg-[#d4c5a9] hover:text-[#3d2b1f]"
            aria-label={t('zoomOut')}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM13.5 10.5h-6"
              />
            </svg>
          </button>
          <span className="min-w-[3rem] text-center font-serif text-xs text-[#3d2b1f]">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => {
              const next = Math.min(MAX_SCALE, scale + ZOOM_STEP * 3);
              setScale(next);
              setTranslate((t) => clampTranslate(t.x, t.y, next));
            }}
            className="rounded p-1 text-[#7a6652] transition-colors hover:bg-[#d4c5a9] hover:text-[#3d2b1f]"
            aria-label={t('zoomIn')}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
