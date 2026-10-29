import { PublicError, credentials, fail, method, parseBody, request } from '../lib/openrouter.js';

// Stream the validated JSON response rather than buffering it through Vercel's
// 4.5 MB response limit. Bound the decoded image to limit memory use.
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const CHUNK_SIZE = 64 * 1024;

function waitForDrain(res) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { res.off('drain', onDrain); res.off('close', onClose); res.off('error', onError); };
    const onDrain = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(new Error('Response closed')); };
    const onError = error => { cleanup(); reject(error); };
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
    if (res.destroyed) onClose();
  });
}

async function writeChunk(res, chunk) {
  if (res.destroyed) throw new Error('Response closed');
  if (!res.write(chunk)) await waitForDrain(res);
}

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
    const rawImage = item?.b64_json;
    if (typeof rawImage !== 'string' || !rawImage) throw new PublicError('No image was returned by the selected model. Please retry or choose another model.', 502);
    if (rawImage.length > MAX_BASE64_LENGTH * 1.1) throw new PublicError('The generated image exceeds the 30 MB limit. Please choose a smaller image output.', 502);
    const image = rawImage.replace(/[\r\n]/g, '');
    if (!image || image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new PublicError('The selected model returned invalid image data. Please retry.', 502);
    if (image.length > MAX_BASE64_LENGTH || Buffer.byteLength(image, 'base64') > MAX_IMAGE_BYTES) throw new PublicError('The generated image exceeds the 30 MB limit. Please choose a smaller image output.', 502);
    // Do not return active SVG content or fetch arbitrary provider URLs.
    const mime = item.media_type || 'image/png';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new PublicError('Generated image format is not supported. Choose a raster image model.', 502);
    res.statusCode = 200;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    await writeChunk(res, `{"image":"data:${mime};base64,`);
    for (let offset = 0; offset < image.length; offset += CHUNK_SIZE) await writeChunk(res, image.slice(offset, offset + CHUNK_SIZE));
    res.end('"}');
  } catch (error) {
    // Once streaming starts, an HTTP error cannot be sent safely; close instead.
    if (res.headersSent || res.destroyed) { if (!res.destroyed) res.destroy(); return; }
    return fail(res, error);
  }
}
