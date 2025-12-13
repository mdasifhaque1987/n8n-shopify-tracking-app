import { createServer } from 'http';
import { createRequestHandler } from '@react-router/node';
import { broadcastDevReady } from '@react-router/node';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUILD_DIR = join(__dirname, 'build');
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Listen on all interfaces for Docker/Fly.io

const build = await import('./build/server/index.js');

const server = createServer(
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV,
  })
);

server.listen(PORT, HOST, async () => {
  console.log(`✅ Server listening on http://${HOST}:${PORT}`);
  
  if (process.env.NODE_ENV === 'development') {
    broadcastDevReady(build);
  }
});
