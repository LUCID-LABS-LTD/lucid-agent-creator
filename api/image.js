import { PublicError, credentials, fail, method, parseBody, request, send } from '../lib/openrouter.js';

export default async function handler(req, res) {
  if (!method(req, res, 'POST')) return;
  try {
    const body = parseBody(req);
    const { key, model } = credentials(body);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt || prompt.length > 12_000) throw new PublicError('Enter a portrait description of up to 12,000 characters.');
    const data = await request('/images', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt })
    });
    const item = data?.data?.[0];
    const image = item?.b64_json;
    if (typeof image !== 'string' || !image || !/^[A-Za-z0-9+/=\r\n]+$/.test(image)) throw new PublicError('No image was returned by the selected model. Please retry or choose another model.', 502);
    // Do not return active SVG content. Vercel limits response sizes, so fail explicitly.
    const mime = item.media_type || 'image/png';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new PublicError('Generated image format is not supported. Choose a raster image model.', 502);
    if (image.length > 4_000_000) throw new PublicError('Generated image is too large to return. Choose a model with a smaller output.', 502);
    return send(res, 200, { image: `data:${mime};base64,${image.replace(/[\r\n]/g, '')}` });
  } catch (error) { return fail(res, error); }
}
