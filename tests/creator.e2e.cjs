// Dependency-free browser smoke test. Run: node tests/creator.e2e.cjs
// Uses Microsoft Edge on Windows and a local, deterministic OpenRouter mock.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-creator-test-'));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZkAAAAASUVORK5CYII=';
let failNext = false;
const requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/models') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({text:[{id:'test/text',name:'Test text'}],image:[{id:'test/image',name:'Test image'}]}));
  }
  if (url.pathname === '/api/generate' || url.pathname === '/api/image') {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({path:url.pathname, body:JSON.parse(body)});
    res.setHeader('Content-Type','application/json');
    if (failNext) { failNext = false; res.statusCode = 429; return res.end(JSON.stringify({error:'Test quota exceeded'})); }
    return res.end(JSON.stringify(url.pathname.endsWith('image') ? {image:png} : {markdown:'# Lucid agent\n\nDraft emails; ask before sending. Calls are a future capability.'}));
  }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode=404; return res.end(); }
  const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'};
  res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  assert.ok(fs.existsSync(edge), 'Set EDGE_PATH to a Microsoft Edge executable');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = spawn(edge, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], {stdio:'ignore'});
  let ws;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i=0; i<100 && !fs.existsSync(portFile); i++) await sleep(100);
    assert.ok(fs.existsSync(portFile), 'Edge did not start');
    const debugPort = fs.readFileSync(portFile,'utf8').split(/\r?\n/)[0];
    const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(origin)}`, {method:'PUT'})).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ({data}) => { const msg=JSON.parse(data); if (msg.id && pending.has(msg.id)) { const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); } else if (msg.method === 'Page.javascriptDialogOpening') { ws.send(JSON.stringify({id:++id,method:'Page.handleJavaScriptDialog',params:{accept:true}})); } };
    const send = (method, params={}) => new Promise((resolve,reject) => {const n=++id; pending.set(n,{resolve,reject}); ws.send(JSON.stringify({id:n,method,params}));});
    const evaluate = async expression => { const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
    const waitFor = async (expression, message) => { for(let i=0;i<100;i++){if(await evaluate(expression)) return; await sleep(100);} throw new Error(message); };
    await send('Runtime.enable');
    await send('Page.enable');
    await waitFor("document.readyState === 'complete' && !!document.querySelector('[data-field]')", 'Creator did not load its guided fields');
    // The workflow assertions are intentionally below, so API and DOM changes are easy to audit.
    await runWorkflow({evaluate,waitFor,send,requests,origin,failOnce:()=>{failNext=true}});
    console.log('Creator browser workflow passed');
  } finally {
    if (ws) ws.close();
    browser.kill();
    await new Promise(resolve => server.close(resolve));
    for (let i=0; i<10; i++) {
      try { fs.rmSync(profile, {recursive:true, force:true}); break; } catch { await sleep(200); }
    }
  }
}

async function runWorkflow({evaluate,waitFor,send,requests,origin,failOnce}) {
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const set = (selector,value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const stage = number => click(`[data-stage="${number}"]`);
  const field = (name,value) => set(`[data-field="${name}"]`,value);
  await waitFor("document.querySelector('#modelStatus').textContent.includes('available')",'Model catalog did not load');
  await field('organization','Lucid Labs Ltd');
  await field('role','First AI employee');
  await field('goal','Keep the founder on top of communication');
  await stage(1);
  await field('name','Atlas');
  await field('presentation','Masculine Gen Z tech professional');
  await field('voice','Calm, intelligent and forward-thinking');
  await click('[data-chip="traits"][data-value="Mysterious"]');
  await stage(2);
  await click('[data-chip="tasks"][data-value="Read email"]');
  await click('[data-chip="tasks"][data-value="Draft email replies"]');
  await field('future','Make calls in the future');
  await stage(3);
  await field('draftAuthority','Can act independently');
  await field('sendAuthority','Ask for approval first');
  await field('callAuthority','Future capability');
  await stage(4);
  await click('[data-style="Cyberpunk Neon"]');
  await field('appearance','Mysterious male tech professional');
  await stage(5);
  await set('#apiKey','test-secret-key');
  await set('#textModel','test/text');
  await set('#imageModel','test/image');
  const saved = await evaluate("localStorage.getItem('lucid_agent_creator_v1')");
  assert.ok(!saved.includes('test-secret-key'), 'API key must never be saved in browser storage');
  await click('#generateBlueprint');
  await waitFor("document.querySelector('#markdown').value.includes('Draft emails')", 'Blueprint generation failed');
  assert.equal(requests[0].body.key,'test-secret-key');
  assert.equal(requests[0].body.answers.sendAuthority,'Ask for approval first');
  assert.equal(requests[0].body.answers.callAuthority,'Future capability');
  assert.equal(requests[0].body.answers.future,'Make calls in the future');
  await set('#markdown','# Reviewed blueprint\nDraft emails; ask before sending. Calls are future work.');
  failOnce();
  await click('#generateBlueprint');
  await waitFor("document.querySelector('#status').textContent.includes('Test quota exceeded')", 'Generation failure was not shown');
  assert.ok((await evaluate("document.querySelector('#markdown').value")).includes('Reviewed blueprint'), 'Failed regeneration must preserve edited Markdown');
  await click('#generatePortrait');
  await waitFor("!!document.querySelector('#portraitWrap img')",'Portrait generation failed');
  const imageRequest = requests.find(r=>r.path==='/api/image');
  assert.match(imageRequest.body.prompt,/Cyberpunk Neon/);
  assert.match(imageRequest.body.prompt,/Mysterious male tech professional/);
  failOnce();
  await click('#generatePortrait');
  await waitFor("document.querySelector('#status').textContent.includes('Test quota exceeded')",'Portrait failure was not shown');
  assert.ok(await evaluate("!!document.querySelector('#portraitWrap img')"),'Failed regeneration must preserve the portrait');
  const downloads = path.join(profile,'downloads');
  fs.mkdirSync(downloads);
  await send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await click('#downloadMarkdown');
  await click('#downloadPortrait');
  for(let i=0;i<100 && (!fs.existsSync(path.join(downloads,'atlas-blueprint.md')) || !fs.existsSync(path.join(downloads,'atlas-portrait.png')));i++) await sleep(100);
  assert.match(fs.readFileSync(path.join(downloads,'atlas-blueprint.md'),'utf8'),/Reviewed blueprint/);
  assert.ok(fs.statSync(path.join(downloads,'atlas-portrait.png')).size>0);
  await send('Page.reload');
  await waitFor("!!document.querySelector('#markdown') && document.querySelector('#markdown').value.includes('Reviewed blueprint')",'Draft did not survive reload');
  assert.equal(await evaluate("document.querySelector('#apiKey').value"),'', 'API key must not survive reload');
  await stage(3);
  assert.equal(await evaluate("document.querySelector('[data-field=sendAuthority]').value"),'Ask for approval first');
  await stage(0);
  assert.equal(await evaluate("document.querySelector('[data-field=organization]').value"),'Lucid Labs Ltd');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await sleep(200);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'Mobile page should not overflow horizontally');
  await stage(5);
  assert.ok(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'Mobile review should not overflow horizontally');
  if (process.env.CREATOR_SCREENSHOT) {
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(process.env.CREATOR_SCREENSHOT,Buffer.from(screenshot.data,'base64'));
  }
  await click('#resetDraft');
  await waitFor("document.querySelector('[data-field=organization]')?.value === ''",'Reset did not clear the draft');
  assert.equal(await evaluate("document.querySelector('#apiKey').value"),'');
}

main().catch(error => { console.error(error); process.exitCode=1; });
