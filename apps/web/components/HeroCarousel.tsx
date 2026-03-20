'use client';

import { useState, useEffect } from 'react';

const images = ['/hero/hero-1.jpg', '/hero/hero-2.jpg', '/hero/hero-3.jpg'];

const INTERVAL = 6000;
const FADE_MS = 1200;

export default function HeroCarousel(): React.ReactElement {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActive((i) => (i + 1) % images.length);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="absolute inset-0">
      {images.map((src, i) => (
        <div
          key={src}
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${src})`,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
            opacity: i === active ? 1 : 0,
          }}
        />
      ))}
      <div className="absolute inset-0 bg-black/55" />
    </div>
  );
}
