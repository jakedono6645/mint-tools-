// api/lead.js  (Vercel serverless function, no dependencies)
//
// Saves a lead to Supabase. The public forms call this; they can never read leads back.
//
// Vercel environment variables required (Project Settings -> Environment Variables):
//   SUPABASE_URL          e.g. https://abcdxyz.supabase.co
//   SUPABASE_SERVICE_KEY  the service_role key (keep secret, never put it in a web page)
//
// Request (POST, JSON):
//   action:        "create" (default, a form submission) or "approve" (customer tapped Approve & Book)
//   type:          "residential" (default) or "commercial"
//   source:        "facebook", "website", ... (default "unknown")
//   name, email, phone, business_name, sqft, pets
//   frequency:     "deep" | "weekly" | "biweekly" | "monthly"  (used with approve)
//   price:         number                                       (used with approve)
//
// Repeat submissions: if the same email or phone already submitted the same type of form
// within MERGE_WINDOW_DAYS, that lead is updated instead of a new one being created.

const ALLOWED_ORIGINS = [
  'https://start.mintcleanpros.com',
  'https://quote.mintcleanpros.com',
  'https://mintcleanpros.com',
  'https://www.mintcleanpros.com',
];
const MERGE_WINDOW_DAYS = 30;
const FREQUENCIES = ['deep', 'weekly', 'biweekly', 'monthly'];

function clean(value, max = 200) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function emailKeyOf(email) {
  const e = clean(email, 254);
  if (!e) return null;
  const k = e.toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k) ? k : null;
}

function phoneKeyOf(phone) {
  const p = clean(phone, 40);
  if (!p) return null;
  let digits = p.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return null;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return null;
}

function toInt(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

function toPrice(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const action = body.action === 'approve' ? 'approve' : 'create';
  const type = body.type === 'commercial' ? 'commercial' : 'residential';
  const source = (clean(body.source, 50) || 'unknown').toLowerCase();
  const emailKey = emailKeyOf(body.email);
  const phoneKey = phoneKeyOf(body.phone);

  if (!emailKey && !phoneKey) {
    return res.status(400).json({ ok: false, error: 'A valid email or phone is required' });
  }

  const fields = {
    name: clean(body.name, 120),
    email: clean(body.email, 254),
    phone: clean(body.phone, 40),
    business_name: clean(body.business_name, 160),
    sqft: toInt(body.sqft, 0, 100000),
    pets: toBool(body.pets),
  };

  const frequency = FREQUENCIES.includes(body.frequency) ? body.frequency : null;
  const price = toPrice(body.price);

  // Older service_role keys are JWTs (start with "eyJ") and go in both headers.
  // Newer "secret" keys (start with "sb_secret_") go in the apikey header only.
  const headers = {
    apikey: SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json',
  };
  if (SUPABASE_SERVICE_KEY.startsWith('eyJ')) {
    headers.Authorization = 'Bearer ' + SUPABASE_SERVICE_KEY;
  }
  const base = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/leads';

  try {
    // 1. Look for an existing lead from the same person within the merge window.
    const ors = [];
    if (emailKey) ors.push('email_key.eq.' + encodeURIComponent(emailKey));
    if (phoneKey) ors.push('phone_key.eq.' + phoneKey);
    const since = new Date(Date.now() - MERGE_WINDOW_DAYS * 86400000).toISOString();
    const findUrl =
      base +
      '?select=id,status,submissions,source' +
      '&type=eq.' + type +
      '&created_at=gte.' + encodeURIComponent(since) +
      '&or=(' + ors.join(',') + ')' +
      '&order=updated_at.desc&limit=1';

    const findRes = await fetch(findUrl, { headers });
    if (!findRes.ok) throw new Error('lookup failed: ' + findRes.status);
    const found = await findRes.json();
    const existing = found[0];
    const now = new Date().toISOString();

    // 2a. Existing lead: update it instead of creating a duplicate.
    if (existing) {
      const patch = { updated_at: now };
      Object.keys(fields).forEach((k) => {
        if (fields[k] !== null) patch[k] = fields[k];
      });
      if (emailKey) patch.email_key = emailKey;
      if (phoneKey) patch.phone_key = phoneKey;
      if (existing.source === 'unknown' && source !== 'unknown') patch.source = source;

      if (action === 'create') {
        patch.submissions = (existing.submissions || 1) + 1;
      } else {
        if (existing.status !== 'booked') {
          patch.status = 'approved';
          patch.approved_at = now;
        }
        if (frequency) patch.frequency = frequency;
        if (price !== null) patch.price = price;
      }

      const upd = await fetch(base + '?id=eq.' + existing.id, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      });
      if (!upd.ok) throw new Error('update failed: ' + upd.status);
      const [row] = await upd.json();
      return res.status(200).json({
        ok: true,
        id: row.id,
        status: row.status,
        submissions: row.submissions,
        merged: true,
      });
    }

    // 2b. New lead.
    const row = {
      type,
      source,
      status: action === 'approve' ? 'approved' : 'new',
      email_key: emailKey,
      phone_key: phoneKey,
      submissions: 1,
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)),
    };
    if (action === 'approve') {
      row.approved_at = now;
      if (frequency) row.frequency = frequency;
      if (price !== null) row.price = price;
    }

    const ins = await fetch(base, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!ins.ok) throw new Error('insert failed: ' + ins.status);
    const [created] = await ins.json();
    return res.status(200).json({
      ok: true,
      id: created.id,
      status: created.status,
      submissions: created.submissions,
      merged: false,
    });
  } catch (err) {
    console.error('lead save error:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Could not save lead' });
  }
};
