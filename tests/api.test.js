import { test } from 'node:test';
import assert from 'node:assert/strict';
import generate from '../api/generate.js';
import image from '../api/image.js';
import models from '../api/models.js';

const secret = 'sk-or-test-private';
function response() {
  return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code = n; return this; }, json(body) { this.body = body; return this; } };
}
function mock(status, data) { return { ok: status >= 200 && status < 300, status, json: async () => data }; }
const creds = { key: secret, model: 'example/model' };

test('blueprint call uses the user key and keeps answers and safety requirements', async () => {
  let outgoing;
  globalThis.fetch = async (url, options) => { outgoing = { url, ...options }; return mock(200, { choices: [{ message: { content: '# Blueprint' } }] }); };
  const res = response();
  await generate({ method:'POST', body: { ...creds, answers: { role:'assistant', sendEmail:'approval required', calls:'future' } } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.markdown, '# Blueprint');
  assert.equal(outgoing.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(outgoing.headers.Authorization, `Bearer ${secret}`);
  assert.match(outgoing.body, /approval required/); assert.match(outgoing.body, /future/); assert.match(outgoing.body, /Unresolved/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('portrait returns raster data and refuses remote URLs or SVG', async () => {
  globalThis.fetch = async (url) => { assert.equal(url, 'https://openrouter.ai/api/v1/images'); return mock(200, { data: [{ b64_json:'aGVsbG8=', media_type:'image/jpeg' }] }); };
  let res = response(); await image({ method:'POST', body: { ...creds, prompt:'A portrait' } }, res);
  assert.equal(res.body.image, 'data:image/jpeg;base64,aGVsbG8=');
  globalThis.fetch = async () => mock(200, { data: [{ url:'http://localhost/admin' }] });
  res = response(); await image({ method:'POST', body: { ...creds, prompt:'A portrait' } }, res); assert.equal(res.code, 502); assert.match(res.body.error, /No image/);
  globalThis.fetch = async () => mock(200, { data: [{ b64_json:'aGVsbG8=', media_type:'image/svg+xml' }] });
  res = response(); await image({ method:'POST', body: { ...creds, prompt:'A portrait' } }, res); assert.equal(res.code, 502); assert.match(res.body.error, /not supported/);
});

test('catalog excludes reference-only image models', async () => {
  globalThis.fetch = async (url) => url.includes('/images/') ? mock(200, {data:[{id:'a/edit', supported_parameters:{input_references:{min:1}}},{id:'a/vector',supported_parameters:{output_format:{values:['svg']}}},{id:'a/create',name:'Create',supported_parameters:{input_references:{min:0}}}]}) : mock(200, {data:[{id:'a/chat',name:'Chat',architecture:{input_modalities:['text']}}]});
  const res = response(); await models({ method:'GET' }, res);
  assert.deepEqual(res.body.image, [{ id:'a/create', name:'Create' }]); assert.equal(res.body.text[0].id,'a/chat');
});

test('invalid keys and upstream failures are actionable without leaking secret or upstream content', async () => {
  let res = response(); await generate({ method:'POST', body: { model:'a/b', answers:{} } }, res); assert.equal(res.code, 400);
  globalThis.fetch = async () => mock(401, {error:{message:secret}});
  res = response(); await generate({ method:'POST', body: { ...creds, answers:{} } }, res);
  assert.equal(res.code, 401); assert.match(res.body.error,/API key/); assert.ok(!JSON.stringify(res.body).includes(secret));
  globalThis.fetch = async () => mock(402, {error:{message:secret}});
  res = response(); await image({ method:'POST', body: { ...creds, prompt:'A portrait' } }, res);
  assert.equal(res.code, 402); assert.match(res.body.error,/credits/);
  globalThis.fetch = async () => mock(200, {});
  res = response(); await generate({ method:'POST', body: { ...creds, answers:{} } }, res); assert.match(res.body.error,/No Markdown/);
});
