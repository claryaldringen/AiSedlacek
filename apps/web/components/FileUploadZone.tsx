'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

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

interface FileUploadZoneProps {
  onFilesUploaded: (pages: UploadedPage[]) => void;
  collectionId?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

interface FileStatus {
  file: File;
  state: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  preview?: string;
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE_MB = 20;

function validateFile(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Nepodporovaný formát. Povolené: JPEG, PNG, TIFF, WebP';
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return `Příliš velký (max ${MAX_SIZE_MB} MB)`;
  }
  return null;
}

export function FileUploadZone({
  onFilesUploaded,
  collectionId,
  isOpen,
  onClose,
}: FileUploadZoneProps): React.JSX.Element | null {
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setFileStatuses([]);
      setIsUploading(false);
      setIsDragOver(false);
    }
  }, [isOpen]);

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
      setIsUploading(true);

      const validFiles = statuses.filter((s) => s.state !== 'error');
      if (validFiles.length === 0) {
        setIsUploading(false);
        return;
      }

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

        const response = await fetch('/api/pages/upload', { method: 'POST', body: formData });
        const data = (await response.json()) as {
          pages?: UploadedPage[];
          errors?: { filename: string; error: string }[];
          error?: string;
        };

        if (!response.ok) throw new Error(data.error ?? 'Nahrávání selhalo');

        const uploadedPages = data.pages ?? [];
        const uploadErrors = data.errors ?? [];

        setFileStatuses((prev) =>
          prev.map((s) => {
            const page = uploadedPages.find((p) => p.filename === s.file.name);
            if (page) return { ...s, state: 'done' as const };
            const err = uploadErrors.find((e) => e.filename === s.file.name);
            if (err) return { ...s, state: 'error' as const, error: err.error };
            return s;
          }),
        );

        if (uploadedPages.length > 0) {
          onFilesUploaded(uploadedPages);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Neznámá chyba';
        setFileStatuses((prev) =>
          prev.map((s) =>
            s.state === 'uploading' ? { ...s, state: 'error' as const, error: message } : s,
          ),
        );
      } finally {
        setIsUploading(false);
      }
    },
    [collectionId, onFilesUploaded],
  );

  const handleFilesSelected = (selected: FileList | null): void => {
    if (!selected || selected.length === 0) return;
    void uploadFiles(Array.from(selected));
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragOver(false);
    handleFilesSelected(e.dataTransfer.files);
  };

  const allDone =
    fileStatuses.length > 0 && fileStatuses.every((s) => s.state === 'done' || s.state === 'error');
  const doneCount = fileStatuses.filter((s) => s.state === 'done').length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-800">Nahrát soubory</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onClick={() => !isUploading && inputRef.current?.click()}
            className={[
              'flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors',
              isDragOver
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50',
              isUploading ? 'pointer-events-none opacity-60' : '',
            ].join(' ')}
          >
            <svg
              className="mb-3 h-10 w-10 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            {isUploading ? (
              <p className="text-slate-600">Nahrávám soubory…</p>
            ) : allDone ? (
              <div>
                <p className="font-medium text-green-700">
                  Hotovo – {doneCount} {doneCount === 1 ? 'soubor' : 'souborů'} nahráno
                </p>
                <p className="mt-1 text-sm text-slate-400">Klikněte pro nahrání dalších</p>
              </div>
            ) : (
              <>
                <p className="text-slate-600">
                  Přetáhněte soubory sem nebo{' '}
                  <span className="font-medium text-blue-600">vyberte ze zařízení</span>
                </p>
                <p className="mt-2 text-xs text-slate-400">
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
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="sr-only"
          />

          {/* File list */}
          {fileStatuses.length > 0 && (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {fileStatuses.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                >
                  {s.preview && (
                    <img src={s.preview} alt="" className="h-8 w-8 rounded object-cover" />
                  )}
                  <span className="flex-1 truncate text-slate-700">{s.file.name}</span>
                  {s.state === 'uploading' && (
                    <svg
                      className="h-4 w-4 animate-spin text-blue-500"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {s.state === 'done' && (
                    <svg
                      className="h-4 w-4 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m4.5 12.75 6 6 9-13.5"
                      />
                    </svg>
                  )}
                  {s.state === 'error' && (
                    <span className="text-xs text-red-500">{s.error ?? 'Chyba'}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
          >
            {allDone ? 'Zavřít' : 'Zrušit'}
          </button>
        </div>
      </div>
    </div>
  );
}
