// Only fixed OpenRouter endpoints are used. Credentials exist for one request only.
export const base = 'https://openrouter.ai/api/v1';

export class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export function method(req, res, allowed) {
  if (req.method === allowed) return true;
  res.setHeader('Allow', allowed);
  send(res, 405, { error: `Use ${allowed} for this endpoint.` });
  return false;
}

export function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > 100_000) throw new PublicError('Request is too large.');
    try { body = JSON.parse(body); } catch { throw new PublicError('Request must contain valid JSON.'); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError('Request must contain a JSON object.');
  if (JSON.stringify(body).length > 100_000) throw new PublicError('Request is too large.');
  return body;
}

export function credentials(body) {
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  if (!key || key.length > 500 || /[\r\n]/.test(key)) throw new PublicError('Enter a valid OpenRouter API key.');
  if (!model || model.length > 200 || !/^[a-zA-Z0-9_.:/-]+$/.test(model)) throw new PublicError('Select a valid model.');
  return { key, model };
}

export async function request(path, options = {}, timeoutMs = 110_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(base + path, { ...options, signal: controller.signal });
    if (!response.ok) {
      const messages = {
        400: 'OpenRouter rejected this request. Check the selected model and input.',
        401: 'OpenRouter rejected the API key. Check the key and try again.',
        402: 'OpenRouter reports insufficient credits or a spending limit.',
        403: 'OpenRouter denied access to this model or key.',
        404: 'The selected model is unavailable. Refresh the model list and choose another.',
        408: 'The provider timed out. Please retry.',
        429: 'OpenRouter rate limit reached. Wait a moment and retry.'
      };
      throw new PublicError(messages[response.status] || `OpenRouter request failed (HTTP ${response.status}). Please retry or select another model.`, response.status >= 400 && response.status < 500 ? response.status : 502);
    }
    try { return await response.json(); } catch { throw new PublicError('OpenRouter returned an invalid response. Please retry.', 502); }
  } catch (error) {
    if (error.name === 'AbortError') throw new PublicError('OpenRouter timed out. Please retry.', 504);
    throw error;
  } finally { clearTimeout(timer); }
}

export function fail(res, error) {
  // Never echo an upstream response, exception detail, key, or user prompt.
  const safe = error instanceof PublicError;
  return send(res, safe ? error.status : 502, { error: safe ? error.message : 'Could not reach OpenRouter. Check your connection and retry.' });
}
