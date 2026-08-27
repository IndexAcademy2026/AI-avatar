// Server-side image proxy.
//
// Why this exists: some image hosts we depend on (e.g. AceData's Nano Banana
// CDN, platform2.cdn.acedata.cloud) send no Access-Control-Allow-Origin
// header at all. Browsers happily <img>/background-image them, but a
// same-origin-policy `fetch()` from the app's own JS is blocked outright
// ("TypeError: Failed to fetch") — there's no client-side workaround for
// that. This function does the fetch server-side, where CORS doesn't apply,
// then re-hosts the bytes in our own Supabase Storage bucket so the browser
// can fetch that instead.
//
// Deploy: supabase functions deploy fetch-remote-image
// Invoke from the client: supabase.functions.invoke('fetch-remote-image', { body: { url, bucket } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_BUCKETS = new Set(['avatars', 'backgrounds', 'renders']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { url, bucket } = await req.json();

    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return json({ error: 'Missing or invalid "url"' }, 400);
    }
    const targetBucket = ALLOWED_BUCKETS.has(bucket) ? bucket : 'renders';

    const upstream = await fetch(url);
    if (!upstream.ok) {
      return json({ error: `Upstream fetch failed: HTTP ${upstream.status}` }, 502);
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const bytes = new Uint8Array(await upstream.arrayBuffer());

    const ext = (contentType.split('/')[1] || 'bin').split(';')[0];
    const path = `proxied/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    // Service role key is injected automatically for Edge Functions — this
    // bypasses Storage RLS, which the anon key (used everywhere else in the
    // app) generally can't for uploads.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error: uploadError } = await supabase.storage
      .from(targetBucket)
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadError) {
      return json({ error: 'Storage upload failed: ' + uploadError.message }, 500);
    }

    const { data } = supabase.storage.from(targetBucket).getPublicUrl(path);
    return json({ url: data.publicUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}
