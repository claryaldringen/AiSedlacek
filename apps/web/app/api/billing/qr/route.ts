import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const data = request.nextUrl.searchParams.get('data');
  if (!data) {
    return NextResponse.json({ error: 'Missing data parameter' }, { status: 400 });
  }

  try {
    const url = await QRCode.toDataURL(data, { width: 200, margin: 2 });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: 'QR generation failed' }, { status: 500 });
  }
}
