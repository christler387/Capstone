import React, { useEffect, useState } from 'react';
import slide1 from '../assets/login/slide-1.png';

// Photos for the login slideshow, shown in order. To add a photo: put the file in
// src/assets/login/, import it here and add it to this list.
const SLIDES: string[] = [slide1];

// How long each photo stays on screen.
const SLIDE_INTERVAL_MS = 10_000;

export const LoginShowcase: React.FC = () => {
  const [index, setIndex] = useState(0);
  const count = SLIDES.length;

  // Move to the next photo every 10 seconds (only when there is more than one).
  useEffect(() => {
    if (count < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, SLIDE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [count]);

  return (
    <section className="login-showcase" aria-label="SKYRUN">
      {SLIDES.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden={i !== index}
          className={`login-showcase-slide${i === index ? ' is-active' : ''}`}
        />
      ))}

      {count > 1 && (
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
      )}
    </section>
  );
};
