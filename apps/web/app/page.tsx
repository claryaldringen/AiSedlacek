'use client';
import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';

export default function HomePage(): React.JSX.Element {
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p className="text-stone-600">Nahrajte obrázek středověkého dokumentu pro OCR a překlad.</p>
      <FileUpload onFileUploaded={(url) => { setUploadedUrl(url); }} />
      {uploadedUrl && <p className="text-sm text-green-700">Soubor nahrán: {uploadedUrl}</p>}
    </div>
  );
}
