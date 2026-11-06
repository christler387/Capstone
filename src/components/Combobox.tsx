import React, { useEffect, useMemo, useRef, useState } from "react";

interface ComboboxProps {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  // Values already in use. Typing a value that is not listed is allowed; it becomes a suggestion once saved.
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}

interface ComboboxItem {
  kind: "option" | "add";
  value: string;
  label: string;
}

// Stored values share one style (upper case, single spaces), so the same thing is never saved twice.
export const normalizeDescriptor = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * A text field with suggestions, following the WAI-ARIA combobox pattern:
 * type freely, or move through the suggestions with the arrow keys.
 */
export const Combobox: React.FC<ComboboxProps> = ({
  id,
  label,
  value,
  onValueChange,
  options,
  placeholder,
  disabled = false,
  invalid = false,
  required = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;

  const query = normalizeDescriptor(value);

  const items = useMemo<ComboboxItem[]>(() => {
    const matches: ComboboxItem[] = options
      .filter((option) => !query || option.toUpperCase().includes(query))
      .map((option) => ({ kind: "option", value: option, label: option }));
    const alreadySaved = options.some((option) => option.toUpperCase() === query);
    if (query && !alreadySaved) {
      matches.push({ kind: "add", value: query, label: `Add "${query}"` });
    }
    return matches;
  }, [options, query]);

  // Keep the highlighted suggestion visible while moving through a long list.
  useEffect(() => {
    if (activeIndex >= 0) {
      document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, id]);

  const close = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const commit = (next: string) => {
    onValueChange(normalizeDescriptor(next));
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setActiveIndex(event.key === "ArrowDown" ? 0 : items.length - 1);
        return;
      }
      if (items.length === 0) return;
      setActiveIndex((current) => {
        if (current < 0) return event.key === "ArrowDown" ? 0 : items.length - 1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + items.length) % items.length;
      });
      return;
    }

    if (event.key === "Enter") {
      // With the list closed, Enter behaves as usual (for example, it submits the form).
      if (!isOpen) return;
      event.preventDefault();
      const highlighted = activeIndex >= 0 ? items[activeIndex] : undefined;
      commit(highlighted ? highlighted.value : value);
      return;
    }

    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      close();
    }
  };

  const handleBlur = () => {
    close();
    onValueChange(normalizeDescriptor(value));
  };

  const activeDescendant = isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return (
    <div className={`combobox${isOpen ? " is-open" : ""}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        className={`form-input combobox-input${invalid ? " is-missing" : ""}`}
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (!disabled) setIsOpen(true);
        }}
        onBlur={handleBlur}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid}
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        autoComplete="off"
        spellCheck={false}
      />
      {isOpen && items.length > 0 && (
        <ul id={listboxId} role="listbox" className="combobox-list" aria-label={`${label} suggestions`}>
          {items.map((item, index) => (
              <li
                key={`${item.kind}-${item.value}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                className={`combobox-option${item.kind === "add" ? " is-add" : ""}${index === activeIndex ? " is-active" : ""}`}
                // Keep focus in the text field while a suggestion is clicked.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(item.value)}
              >
                {item.kind === "add" ? <i className="bx bx-plus" aria-hidden="true"></i> : null}
                <span>{item.label}</span>
              </li>
          ))}
        </ul>
      )}
    </div>
  );
};
