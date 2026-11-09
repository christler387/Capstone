import React, { useCallback, useEffect, useRef, useState } from 'react';
import slide1 from '../assets/login/slide-1.png';
import slide2 from '../assets/login/slide-2.png';
import slide3 from '../assets/login/slide-3.png';

// Photos for the login slideshow, shown in order. To add a photo: put the file in
// src/assets/login/, import it here and add it to this list.
const SLIDES: string[] = [slide1, slide2, slide3];

// How long each photo stays on screen before it moves on by itself.
const SLIDE_INTERVAL_MS = 10_000;

// How far (in px) a mouse or finger must move sideways to count as a swipe.
const SWIPE_THRESHOLD_PX = 40;

export const LoginShowcase: React.FC = () => {
  const [index, setIndex] = useState(0);
  const count = SLIDES.length;
  const startX = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => setIndex((current) => (current + delta + count) % count),
    [count],
  );

  // Move on every 10 seconds. The timer restarts after every change, including manual ones,
  // so a photo the viewer just chose stays up for a full 10 seconds.
  useEffect(() => {
    if (count < 2) return;
    const timer = window.setTimeout(() => go(1), SLIDE_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, count, go]);

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    startX.current = e.clientX;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) go(dx < 0 ? 1 : -1);
  };

  return (
    <section
      className="login-showcase"
      aria-label="SKYRUN"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => (startX.current = null)}
    >
      {SLIDES.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          aria-hidden={i !== index}
          className={`login-showcase-slide${i === index ? ' is-active' : ''}`}
        />
      ))}

      {count > 1 && (
        <>
          <button
            type="button"
            className="login-showcase-arrow is-prev"
            aria-label="Previous photo"
            onClick={() => go(-1)}
          >
            <i className="bx bx-chevron-left" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            className="login-showcase-arrow is-next"
            aria-label="Next photo"
            onClick={() => go(1)}
          >
            <i className="bx bx-chevron-right" aria-hidden="true"></i>
          </button>

          <div className="login-showcase-dots" role="group" aria-label="Choose a photo">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`login-showcase-dot${i === index ? ' is-active' : ''}`}
                aria-label={`Show photo ${i + 1}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
};
