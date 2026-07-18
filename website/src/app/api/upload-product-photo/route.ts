import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { requireAdmin } from '@/lib/apiAuth';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ('response' in auth) return auth.response;

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const productId = formData.get('productId') as string;

    if (!file || !productId) {
      return NextResponse.json({ error: 'Missing file or productId' }, { status: 400 });
    }

    // Sanitize to prevent path traversal: productId must be a plain id and the
    // extension must be a known image type.
    if (!/^[a-zA-Z0-9-]+$/.test(productId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 });
    }
    const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const ext = ['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg';

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const filename = `${productId}-1.${ext}`;
    const dir = path.join(process.cwd(), 'public', 'products');
    
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);

    const url = `/products/${filename}`;
    return NextResponse.json({ url });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
