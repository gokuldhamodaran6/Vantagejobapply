"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/** Side sheet (full screen on phones): Esc closes, focus moves in and returns to where it was. */
export function Sheet({ title, onClose, children, accent }: { title: string; onClose: () => void; children: React.ReactNode; accent?: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-ink/30" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[480px] flex-col overflow-y-auto bg-white shadow-2xl">
        {accent && <span className="h-1.5 w-full shrink-0" style={{ background: accent }} />}
        <div className="p-5">
          <div className="mb-4 flex items-start gap-3">
            <h2 className="min-w-0 flex-1 text-xl font-bold">{title}</h2>
            <button ref={closeRef} onClick={onClose} className="rounded-lg p-2 hover:bg-canvas" aria-label="Close"><X size={20} /></button>
          </div>
          {children}
        </div>
      </aside>
    </div>
  );
}
