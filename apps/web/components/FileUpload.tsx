'use client';

import { useState, useRef, useCallback } from 'react';

export interface UploadedPage {
  id: string;
  filename: string;
  imageUrl: string;
  status: string;
  collectionId: string | null;
  hash: string;
  order: number;
  createdAt: string;
}

interface FileUploadProps {
  onFilesUploaded: (pages: UploadedPage[]) => void;
  collectionId?: string | null;
  /** Legacy single-file callback, kept for backward compatibility */
  onFileUploaded?: (url: string, file: File) => void;
}

type UploadState = 'idle' | 'uploading' | 'success' | 'error';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE_MB = 20;

interface FileStatus {
  file: File;
  state: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  preview?: string;
}

export function FileUpload({
  onFilesUploaded,
  collectionId,
  onFileUploaded,
}: FileUploadProps): React.JSX.Element {
  const [state, setState] = useState<UploadState>('idle');
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
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

  const buildPreviews = (files: File[]): Promise<FileStatus[]> =>
    Promise.all(
      files.map(
        (file) =>
          new Promise<FileStatus>((resolve) => {
            const error = validateFile(file);
            if (error) {
              resolve({ file, state: 'error', error });
              return;
            }
            if (file.type.startsWith('image/')) {
              const reader = new FileReader();
              reader.onload = (e) => {
                resolve({ file, state: 'pending', preview: e.target?.result as string });
              };
              reader.readAsDataURL(file);
            } else {
              resolve({ file, state: 'pending' });
            }
          }),
      ),
    );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const statuses = await buildPreviews(files);
      setFileStatuses(statuses);
      setState('uploading');

      const validFiles = statuses.filter((s) => s.state !== 'error');
      if (validFiles.length === 0) {
        setState('error');
        return;
      }

      // Mark valid files as uploading
      setFileStatuses((prev) =>
        prev.map((s) => (s.state === 'pending' ? { ...s, state: 'uploading' as const } : s)),
      );

      try {
        const formData = new FormData();
        for (const s of validFiles) {
          formData.append('files', s.file);
        }
        if (collectionId) {
          formData.append('collectionId', collectionId);
        }

        const response = await fetch('/api/pages/upload', {
          method: 'POST',
          body: formData,
        });

        const data = (await response.json()) as {
          pages?: UploadedPage[];
          errors?: { filename: string; error: string }[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error ?? 'Nahrávání selhalo');
        }

        const uploadedPages = data.pages ?? [];
        const uploadErrors = data.errors ?? [];

        // Update per-file status
        setFileStatuses((prev) =>
          prev.map((s) => {
            const page = uploadedPages.find((p) => p.filename === s.file.name);
            if (page) return { ...s, state: 'done' as const };
            const err = uploadErrors.find((e) => e.filename === s.file.name);
            if (err) return { ...s, state: 'error' as const, error: err.error };
            return s;
          }),
        );

        setState('success');

        if (uploadedPages.length > 0) {
          onFilesUploaded(uploadedPages);
          // Legacy single-file callback support
          if (onFileUploaded && uploadedPages[0]) {
            onFileUploaded(uploadedPages[0].imageUrl, validFiles[0]?.file ?? new File([], ''));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Neznámá chyba';
        setFileStatuses((prev) =>
          prev.map((s) =>
            s.state === 'uploading' ? { ...s, state: 'error' as const, error: message } : s,
          ),
        );
        setState('error');
      }
    },
    [collectionId, onFilesUploaded, onFileUploaded],
  );

  const handleFilesSelected = (selected: FileList | null): void => {
    if (!selected || selected.length === 0) return;
    void uploadFiles(Array.from(selected));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    handleFilesSelected(e.target.files);
    // Reset input so same files can be selected again
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragOver(false);
    handleFilesSelected(e.dataTransfer.files);
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

  const handleReset = (): void => {
    setState('idle');
    setFileStatuses([]);
  };

  return (
    <div className="w-full space-y-4">
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
          'flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
          isDragOver
            ? 'border-stone-500 bg-stone-100'
            : 'border-stone-300 bg-white hover:border-stone-400 hover:bg-stone-50',
          state === 'uploading' ? 'pointer-events-none opacity-60' : '',
        ].join(' ')}
      >
        <div className="mb-3 text-stone-400">
          <svg
            className="mx-auto h-10 w-10"
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

        {state === 'uploading' ? (
          <p className="text-stone-600">Nahrávám soubory…</p>
        ) : state === 'success' ? (
          <div className="text-center">
            <p className="font-medium text-green-700">
              Soubory nahrány ({fileStatuses.filter((s) => s.state === 'done').length})
            </p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReset();
              }}
              className="mt-1 text-sm text-stone-500 underline"
            >
              Nahrát další
            </button>
          </div>
        ) : (
          <>
            <p className="text-center text-stone-600">
              Přetáhněte soubory sem nebo{' '}
              <span className="font-medium text-stone-800 underline">vyberte ze zařízení</span>
            </p>
            <p className="mt-2 text-sm text-stone-400">
              JPEG, PNG, TIFF, WebP · max {MAX_SIZE_MB} MB · více souborů najednou
            </p>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(',')}
        multiple
        onChange={handleFileChange}
        className="sr-only"
        aria-label="Vyberte soubory"
      />

      {/* Per-file status list */}
      {fileStatuses.length > 0 && (
        <div className="space-y-2">
          {fileStatuses.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-stone-100 bg-white px-3 py-2 text-sm shadow-sm"
            >
              {s.preview && (
                <img
                  src={s.preview}
                  alt=""
                  className="h-10 w-10 rounded object-cover"
                  aria-hidden="true"
                />
              )}
              <span className="flex-1 truncate text-stone-700">{s.file.name}</span>
              {s.state === 'uploading' && <span className="text-xs text-stone-400">Nahrávám…</span>}
              {s.state === 'done' && (
                <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
                  OK
                </span>
              )}
              {s.state === 'error' && (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                  {s.error ?? 'Chyba'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
