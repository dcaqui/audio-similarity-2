const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function isAllowedIMSLPUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host.endsWith('imslp.org') || host.endsWith('petruccimusiclibrary.org');
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requestedPath).replace(/^\.\.(\/|\\|$)+/, '');
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

async function handleImslpProxy(req, res, parsedUrl) {
  const target = parsedUrl.searchParams.get('url');
  if (!target || !isAllowedIMSLPUrl(target)) {
    sendJson(res, 400, {
      error: 'Please provide a valid IMSLP audio URL hosted on imslp.org or petruccimusiclibrary.org.'
    });
    return;
  }

  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      headers: { 'User-Agent': 'audio-similarity-2/1.0' }
    });

    if (!upstream.ok) {
      sendJson(res, 502, {
        error: `Failed to fetch the IMSLP recording (status ${upstream.status}).`
      });
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buffer);
  } catch (error) {
    sendJson(res, 500, { error: `Unable to retrieve IMSLP audio: ${error.message}` });
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && parsedUrl.pathname === '/api/imslp-audio') {
    await handleImslpProxy(req, res, parsedUrl);
    return;
  }

  if (req.method === 'GET') {
    await serveStatic(req, res, parsedUrl.pathname);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
