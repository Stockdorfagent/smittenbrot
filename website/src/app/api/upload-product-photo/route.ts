import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/apiAuth';

// Product images live in the public Supabase Storage bucket `product-images`.
// (The old version wrote to the Next.js public/ folder, which is read-only on
// Vercel, so uploads never persisted.)
const BUCKET = 'product-images';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

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

    // Sanitize: productId must be a plain id; extension must be a known image type.
    if (!/^[a-zA-Z0-9-]+$/.test(productId)) {
      return NextResponse.json({ error: 'Invalid productId' }, { status: 400 });
    }
    const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const ext = ['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'jpg';
    const contentType = file.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`;

    const bytes = await file.arrayBuffer();
    // Unique filename → the returned URL changes on each upload, so browsers/CDN
    // never serve a stale cached image.
    const filename = `${productId}-${Date.now()}.${ext}`;

    const supabase = getSupabaseAdmin();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filename, bytes, { contentType, upsert: true });

    if (uploadError) {
      console.error('[upload-product-photo] Storage upload failed:', uploadError);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(filename);
    return NextResponse.json({ url: pub.publicUrl });
  } catch (err) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
