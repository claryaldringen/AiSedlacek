'use client';

import { useState, useRef, useCallback } from 'react';

interface FileUploadProps {
  onFileUploaded: (url: string, file: File) => void;
}

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE_MB = 20;

export function FileUpload({ onFileUploaded }: FileUploadProps): React.JSX.Element {
  const [state, setState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Nepodporovaný formát. Povolené: JPEG, PNG, TIFF, WebP';
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `Soubor je příliš velký (max ${MAX_SIZE_MB} MB)`;
    }
    return null;
  };

  const uploadFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        setState('error');
        return;
      }

      // Show preview for image types
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => setPreview(e.target?.result as string);
        reader.readAsDataURL(file);
      }

      setState('uploading');
      setError(null);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const data = (await response.json()) as { url?: string; error?: string };

        if (!response.ok) {
          throw new Error(data.error ?? 'Nahrávání selhalo');
        }

        setState('success');
        onFileUploaded(data.url!, file);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Neznámá chyba';
        setError(message);
        setState('error');
        setPreview(null);
      }
    },
    [onFileUploaded],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      void uploadFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (): void => {
    setIsDragOver(false);
  };

  const handleClick = (): void => {
    inputRef.current?.click();
  };

  return (
    <div className="w-full">
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClick();
        }}
        className={[
          'flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
          isDragOver
            ? 'border-stone-500 bg-stone-100'
            : 'border-stone-300 bg-white hover:border-stone-400 hover:bg-stone-50',
          state === 'uploading' ? 'pointer-events-none opacity-60' : '',
        ].join(' ')}
      >
        {preview ? (
          <img
            src={preview}
            alt="Náhled dokumentu"
            className="mb-4 max-h-64 max-w-full rounded object-contain shadow"
          />
        ) : (
          <div className="mb-4 text-stone-400">
            <svg
              className="mx-auto h-12 w-12"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
          </div>
        )}

        {state === 'uploading' ? (
          <p className="text-stone-600">Nahrávání…</p>
        ) : state === 'success' ? (
          <p className="font-medium text-green-700">Soubor úspěšně nahrán</p>
        ) : (
          <>
            <p className="text-center text-stone-600">
              Přetáhněte soubor sem nebo{' '}
              <span className="font-medium text-stone-800 underline">vyberte ze zařízení</span>
            </p>
            <p className="mt-2 text-sm text-stone-400">JPEG, PNG, TIFF, WebP · max {MAX_SIZE_MB} MB</p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Vyberte soubor"
      />

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
