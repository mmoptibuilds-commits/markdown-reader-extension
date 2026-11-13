import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';

/**
 * Opens a native modal dialog while `open` is true and returns focus to the element that
 * had it before. The dialog provides the focus trap, Escape, and the inert background.
 */
export function useModalDialog(open: boolean): RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      // React's autoFocus runs before the dialog opens, so focus the marked control now.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    if (!open && returnFocus.current?.isConnected) {
      returnFocus.current.focus();
      returnFocus.current = null;
    }
  }, [open]);
  return ref;
}

export function ReaderDialog({ open, onClose, title, className, children, description }: { open: boolean; onClose: () => void; title: string; className: string; children: ReactNode; description?: string }): ReactElement {
  const ref = useModalDialog(open);
  const titleId = useId();
  const descriptionId = useId();
  return <dialog ref={ref} className={`reader-dialog ${className}`} aria-labelledby={titleId} {...(description ? { 'aria-describedby': descriptionId } : {})} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
    <div className="dialog-heading">
      <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button className="icon-button" type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </div>
    {open && children}
  </dialog>;
}

export interface ReaderCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

/** Ranks label-start matches first, then word starts, then anywhere, then keyword matches. */
export function filterCommands(commands: readonly ReaderCommand[], query: string): ReaderCommand[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...commands];
  const scored: Array<[number, number, ReaderCommand]> = [];
  commands.forEach((command, order) => {
    const label = command.label.toLocaleLowerCase();
    const score = label.startsWith(needle) ? 0
      : label.split(/\s+/u).some((word) => word.startsWith(needle)) ? 1
        : label.includes(needle) ? 2
          : command.keywords?.toLocaleLowerCase().includes(needle) ? 3 : -1;
    if (score >= 0) scored.push([score, order, command]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , command]) => command);
}

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: readonly ReaderCommand[] }): ReactElement {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => filterCommands(commands, query), [commands, query]);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => { if (open) { setQuery(''); setActive(0); } }, [open]);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (command: ReaderCommand | undefined): void => {
    if (!command) return;
    onClose();
    // Let the dialog close and restore focus before the command moves it elsewhere.
    window.setTimeout(command.run, 0);
  };
  const optionId = (index: number): string => `${listId}-option-${index}`;
  const selected = results[active];

  return <ReaderDialog open={open} onClose={onClose} title="Commands" className="command-dialog">
    <div className="command-search">
      <Search size={17} aria-hidden="true" />
      <input
        data-autofocus
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={selected ? optionId(active) : undefined}
        aria-label="Search commands"
        placeholder="Type a command"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          const last = results.length - 1;
          if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => (index >= last ? 0 : index + 1)); }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index <= 0 ? last : index - 1)); }
          else if (event.key === 'Home' && results.length) { event.preventDefault(); setActive(0); }
          else if (event.key === 'End' && results.length) { event.preventDefault(); setActive(last); }
          else if (event.key === 'Enter') { event.preventDefault(); run(selected); }
        }}
      />
    </div>
    <ul ref={listRef} id={listId} className="command-list" role="listbox" aria-label="Commands">
      {results.map((command, index) => <li
        key={command.id}
        id={optionId(index)}
        role="option"
        aria-selected={index === active}
        className="command-row"
        onPointerMove={() => setActive(index)}
        onClick={() => run(command)}
      ><span>{command.label}</span>{command.hint && <kbd>{command.hint}</kbd>}</li>)}
    </ul>
    <p className="command-status" role="status">{results.length === 0 ? `No commands match “${query.trim()}”.` : `${results.length} ${results.length === 1 ? 'command' : 'commands'}`}</p>
  </ReaderDialog>;
}

export function ImageViewer({ images, index, onIndex, onClose }: { images: HTMLImageElement[]; index: number | null; onIndex: (index: number) => void; onClose: () => void }): ReactElement {
  const [scale, setScale] = useState(1);
  const image = index === null ? undefined : images[index];
  useEffect(() => { setScale(1); }, [index]);
  const step = (direction: 1 | -1): void => {
    if (index === null || images.length < 2) return;
    onIndex((index + direction + images.length) % images.length);
  };
  const title = image?.alt || 'Image';
  return <ReaderDialog open={index !== null} onClose={onClose} title={images.length > 1 && index !== null ? `${title} (${index + 1} of ${images.length})` : title} className="lightbox-dialog">
    <div className="lightbox-tools" role="toolbar" aria-label="Image controls" onKeyDown={(event) => { if (event.key === 'ArrowRight') step(1); if (event.key === 'ArrowLeft') step(-1); }}>
      <button className="icon-button" type="button" aria-label="Zoom out" disabled={scale <= 0.5} onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}><Minus size={17} aria-hidden="true" /></button>
      <output aria-live="polite">{Math.round(scale * 100)}%</output>
      <button className="icon-button" type="button" aria-label="Zoom in" disabled={scale >= 3} onClick={() => setScale((value) => Math.min(3, value + 0.25))}><Plus size={17} aria-hidden="true" /></button>
      <button className="icon-button" type="button" aria-label="Reset zoom" disabled={scale === 1} onClick={() => setScale(1)}><RotateCcw size={16} aria-hidden="true" /></button>
      {images.length > 1 && <>
        <button className="icon-button" type="button" aria-label="Previous image" onClick={() => step(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
        <button className="icon-button" type="button" aria-label="Next image" onClick={() => step(1)}><ChevronRight size={18} aria-hidden="true" /></button>
      </>}
    </div>
    <div className="lightbox-stage" tabIndex={0} aria-label="Image, scroll to pan when zoomed">
      {image && <figure><img src={image.currentSrc || image.src} alt={image.alt} style={{ width: `${scale * 100}%` }} />{image.title && <figcaption>{image.title}</figcaption>}</figure>}
    </div>
  </ReaderDialog>;
}
