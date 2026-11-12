// Crée le paiement Stripe avec le panier EXACT (maison + terrain + options + statue), calculé ici côté serveur.
// Vercel : variable d'environnement STRIPE_KEY (clé restreinte : Products, Prices, Payment Links, Checkout Sessions).
const SITE = 'https://lepaysdetous.github.io';
const MAISONS = { cabane: 199, petite: 299, grande: 499, villa: 799 };
const OPTIONS = { statue: 999, piscine: 299, voiture: 199, fontaine: 199, feu: 199, jardin: 99, drapeau: 99 };
const MOTS = /^[a-z0-9_]{1,20}$/;

async function stripe(chemin, params, methode = 'POST') {
  const corps = new URLSearchParams(params).toString();
  const r = await fetch('https://api.stripe.com/v1' + chemin + (methode === 'GET' ? '?' + corps : ''), {
    method: methode, headers: { Authorization: 'Bearer ' + process.env.STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, body: methode === 'GET' ? undefined : corps });
  const j = await r.json(); if (!r.ok) throw new Error(j.error && j.error.message || 'Stripe ' + r.status); return j;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', SITE); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erreur: 'POST uniquement' });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const lot = parseInt(b.lot, 10), maison = String(b.maison || '');
    if (!MAISONS[maison] || !(lot >= 1 && lot <= 48)) return res.status(400).json({ erreur: 'Choisis une maison et une parcelle.' });
    const opts = [...new Set((b.options || []).map(String))].filter(o => OPTIONS[o]);
    if (b.statue) opts.push('statue');
    const cles = [`vulk_${maison}_${MAISONS[maison]}`, ...opts.map(o => `vulk_${o}_${OPTIONS[o]}`)];
    if (lot >= 33) cles.push('vulk_terrain_mer_299'); else if (lot >= 17) cles.push('vulk_terrain_centre_99');
    const p = { limit: '20' }; cles.forEach((k, i) => p[`lookup_keys[${i}]`] = k);
    const prix = (await stripe('/prices', p, 'GET')).data;
    if (prix.length !== cles.length) throw new Error('prix manquant dans Stripe');
    const ref = String(b.ref || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
    const s = { mode: 'payment', client_reference_id: ref || `P${lot}-${maison}`, success_url: SITE + '/#merci', cancel_url: SITE + '/',
      // panier abandonné : Stripe renvoie un e-mail de rappel (seulement si la personne a accepté les e-mails) — à activer aussi dans le Dashboard
      'after_expiration[recovery][enabled]': 'true', 'consent_collection[promotions]': 'auto', expires_at: String(Math.floor(Date.now() / 1000) + 2 * 3600),
      'metadata[parcelle]': String(lot), 'metadata[maison]': maison, 'metadata[options]': opts.join(','), 'metadata[choix]': ref.slice(0, 500),
      'custom_fields[0][key]': 'pseudo', 'custom_fields[0][label][type]': 'custom', 'custom_fields[0][label][custom]': 'Ton pseudo (TikTok, Insta ou YouTube)', 'custom_fields[0][type]': 'text',
      'custom_fields[1][key]': 'boite', 'custom_fields[1][label][type]': 'custom', 'custom_fields[1][label][custom]': 'Nom sur la boîte aux lettres', 'custom_fields[1][type]': 'text', 'custom_fields[1][optional]': 'true' };
    if (opts.includes('statue')) Object.assign(s, { 'custom_fields[2][key]': 'plaque', 'custom_fields[2][label][type]': 'custom', 'custom_fields[2][label][custom]': 'Texte de la plaque de ta statue', 'custom_fields[2][type]': 'text' });
    prix.forEach((x, i) => { s[`line_items[${i}][price]`] = x.id; s[`line_items[${i}][quantity]`] = '1'; });
    const sess = await stripe('/checkout/sessions', s);
    return res.status(200).json({ url: sess.url });
  } catch (e) { return res.status(500).json({ erreur: 'Paiement indisponible pour le moment.', detail: String(e.message || e).slice(0, 200) }); }
}
