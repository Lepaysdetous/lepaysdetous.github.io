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
    const propre = (t, n) => String(t || '').replace(/[<>]/g, '').trim().slice(0, n);
    const s = { mode: 'payment', client_reference_id: ref || `P${lot}-${maison}`, success_url: SITE + '/#merci', cancel_url: SITE + '/',
      'metadata[parcelle]': String(lot), 'metadata[maison]': maison, 'metadata[options]': opts.join(','), 'metadata[choix]': ref.slice(0, 500), 'metadata[panneau]': propre(b.boite, 22), 'metadata[plaque]': propre(b.plaque, 24),
      'custom_fields[0][key]': 'pseudo', 'custom_fields[0][label][type]': 'custom', 'custom_fields[0][label][custom]': 'Ton pseudo (TikTok, Insta ou YouTube)', 'custom_fields[0][type]': 'text',
      'custom_fields[1][key]': 'nouvelles', 'custom_fields[1][label][type]': 'custom', 'custom_fields[1][label][custom]': 'Être prévenu(e) par e-mail de la sortie du jeu ?', 'custom_fields[1][type]': 'dropdown', 'custom_fields[1][optional]': 'true',
      'custom_fields[1][dropdown][options][0][label]': 'Oui, tenez-moi au courant', 'custom_fields[1][dropdown][options][0][value]': 'oui',
      'custom_fields[1][dropdown][options][1][label]': 'Non merci', 'custom_fields[1][dropdown][options][1][value]': 'non' };
    prix.forEach((x, i) => { s[`line_items[${i}][price]`] = x.id; s[`line_items[${i}][quantity]`] = '1'; });
    const sess = await stripe('/checkout/sessions', s);
    return res.status(200).json({ url: sess.url });
  } catch (e) { return res.status(500).json({ erreur: 'Paiement indisponible pour le moment.', detail: String(e.message || e).slice(0, 200) }); }
}
