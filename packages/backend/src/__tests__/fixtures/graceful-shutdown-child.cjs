/* global clearInterval, clearTimeout, process, setImmediate, setInterval, setTimeout */

const http = require('http');

const openSockets = new Set();
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 2000;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/__test__/sigterm') {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));
    setImmediate(() => {
      process.emit('SIGTERM');
    });
    return;
  }

  if (req.url === '/api/chat') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Last-Event-ID',
    });

    let index = 0;
    const chunks = ['alpha', 'beta', 'gamma'];

    res.write('event: start\\n');
    res.write('data: {"streamId":"test-stream"}\\n\\n');

    const timer = setInterval(() => {
      if (index >= chunks.length) {
        clearInterval(timer);
        res.write('event: done\\n');
        res.write('data: {"finishReason":"stop"}\\n\\n');
        res.end();
        return;
      }

      const content = chunks[index];
      res.write(`id: test-stream-${index}\\n`);
      res.write('event: chunk\\n');
      res.write(`data: {"content":"${content}","index":${index}}\\n\\n`);
      index += 1;
    }, 80);

    res.on('close', () => {
      clearInterval(timer);
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'NOT_FOUND' }));
});

server.on('connection', (socket) => {
  openSockets.add(socket);
  socket.on('close', () => {
    openSockets.delete(socket);
  });
});

async function shutdown() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  const closeServerPromise = new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([
      closeServerPromise.then(() => 'closed'),
      timeoutPromise,
    ]);

    if (result === 'timeout') {
      for (const socket of openSockets) {
        socket.destroy();
      }
      await closeServerPromise;
    }

    process.stdout.write('SHUTDOWN_COMPLETE\\n');
    process.exit(0);
  } catch (error) {
    process.stderr.write(`SHUTDOWN_ERROR:${error instanceof Error ? error.message : String(error)}\\n`);
    process.exit(1);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.stdout.write(`READY:${port}\\n`);
});
