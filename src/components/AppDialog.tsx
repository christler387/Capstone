import React, { useEffect, useRef, useState } from 'react';

// In-app dialogs that replace the browser's own prompt, confirm and alert boxes.
// Call askText / askConfirm / askNotice with await; AppDialog (mounted once in App) shows them.

type Kind = 'text' | 'confirm' | 'notice';

export interface DialogOptions {
  title?: string;
  label?: string;
  multiline?: boolean;
  minLength?: number;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Pending {
  kind: Kind;
  message: string;
  initial: string;
  options: DialogOptions;
  resolve: (value: unknown) => void;
}

let pending: Pending | null = null;
const listeners = new Set<(value: Pending | null) => void>();
const publish = () => listeners.forEach((listener) => listener(pending));

const cancelValue = (kind: Kind) => (kind === 'text' ? null : kind === 'confirm' ? false : undefined);

const open = (kind: Kind, message: string, initial: string, options: DialogOptions) =>
  new Promise<unknown>((resolve) => {
    // A new dialog replaces one that is still open; the old one counts as cancelled.
    if (pending) pending.resolve(cancelValue(pending.kind));
    pending = { kind, message, initial, options, resolve };
    publish();
  });

const close = (value: unknown) => {
  const current = pending;
  pending = null;
  publish();
  current?.resolve(value);
};

export const askText = (message: string, initial = '', options: DialogOptions = {}) =>
  open('text', message, initial, options) as Promise<string | null>;

export const askConfirm = (message: string, options: DialogOptions = {}) =>
  open('confirm', message, '', options) as Promise<boolean>;

export const askNotice = (message: string, options: DialogOptions = {}) =>
  open('notice', message, '', options) as Promise<void>;

export const AppDialog: React.FC = () => {
  const [current, setCurrent] = useState<Pending | null>(pending);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    setValue(current.initial);
    setError(null);
    const focus = window.setTimeout(() => (inputRef.current ?? textareaRef.current)?.focus(), 0);
    return () => window.clearTimeout(focus);
  }, [current]);

  if (!current) return null;

  const { kind, message, options } = current;
  const title = options.title ?? (kind === 'text' ? 'Add a note' : kind === 'confirm' ? 'Please confirm' : 'Notice');
  const confirmLabel = options.confirmLabel ?? (kind === 'notice' ? 'OK' : 'Confirm');

  const cancel = () => close(cancelValue(kind));

  const submit = () => {
    if (kind === 'text') {
      const trimmed = value.trim();
      if (options.minLength && trimmed.length < options.minLength) {
        setError(`Please enter at least ${options.minLength} characters.`);
        return;
      }
      close(trimmed);
      return;
    }
    close(kind === 'confirm' ? true : undefined);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Enter') return;
    // In a note box, Enter adds a new line; Ctrl+Enter sends.
    if (kind === 'text' && options.multiline && !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    submit();
  };

  return (
    <div className="ask-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }}>
      <div className="ask-card" role="dialog" aria-modal="true" aria-labelledby="ask-title" onKeyDown={onKeyDown}>
        <h2 id="ask-title" className="ask-title">{title}</h2>
        <p className="ask-message">{message}</p>
        {kind === 'text' && (
          <label className="ask-field">
            {options.label && <span className="ask-label">{options.label}</span>}
            {options.multiline ? (
              <textarea
                ref={textareaRef}
                rows={3}
                value={value}
                placeholder={options.placeholder}
                onChange={(event) => setValue(event.target.value)}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={value}
                placeholder={options.placeholder}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            {error && <span className="ask-error" role="alert">{error}</span>}
          </label>
        )}
        <div className="ask-actions">
          {kind !== 'notice' && (
            <button type="button" className="ask-btn is-ghost" onClick={cancel}>
              {options.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            type="button"
            className={`ask-btn is-primary${options.danger ? ' is-danger' : ''}`}
            onClick={submit}
            autoFocus={kind !== 'text'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
