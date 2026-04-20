import { afterEach, describe, expect, it } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import http from 'http';

interface ChildHandle {
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
}

function onceWithTimeout<T>(
  register: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    register(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

async function waitForReadyPort(child: ChildHandle): Promise<number> {
  return onceWithTimeout<number>(
    (resolve) => {
      const onData = (chunk: Buffer) => {
        child.stdout += chunk.toString('utf8');
        const match = child.stdout.match(/READY:(\d+)/);
        if (match) {
          child.proc.stdout.off('data', onData);
          resolve(Number(match[1]));
        }
      };

      child.proc.stdout.on('data', onData);
    },
    5000,
    'Timed out waiting for child server READY signal'
  );
}

async function requestSse(port: number, onFirstChunk?: () => void): Promise<string> {
  return onceWithTimeout<string>(
    (resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/chat',
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
          },
        },
        (res) => {
          const chunks: string[] = [];
          let firstChunkSeen = false;
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            chunks.push(chunk);
            if (!firstChunkSeen) {
              firstChunkSeen = true;
              onFirstChunk?.();
            }
          });
          res.on('end', () => {
            resolve(chunks.join(''));
          });
          res.on('error', (error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        }
      );

      req.on('error', (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      req.end();
    },
    10000,
    'Timed out waiting for /api/chat SSE response to complete'
  );
}

async function triggerSigterm(port: number): Promise<void> {
  return onceWithTimeout<void>(
    (resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/__test__/sigterm',
          method: 'POST',
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve());
          res.on('error', (error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        }
      );

      req.on('error', (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      req.end();
    },
    5000,
    'Timed out triggering SIGTERM on child process'
  );
}

async function waitForExit(
  child: ChildHandle
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return onceWithTimeout<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.proc.once('exit', (code, signal) => {
        resolve({ code, signal });
      });
    },
    10000,
    'Timed out waiting for child process exit'
  );
}

describe('Graceful shutdown integration', () => {
  const children: ChildHandle[] = [];

  afterEach(async () => {
    for (const child of children) {
      if (!child.proc.killed) {
        child.proc.kill('SIGKILL');
      }
    }
  });

  it('completes /api/chat stream and exits cleanly after SIGTERM', async () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'graceful-shutdown-child.cjs');

    const proc = spawn(process.execPath, [fixturePath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const child: ChildHandle = {
      proc,
      stdout: '',
      stderr: '',
    };

    children.push(child);

    proc.stdout.on('data', (chunk: Buffer) => {
      child.stdout += chunk.toString('utf8');
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      child.stderr += chunk.toString('utf8');
    });

    const port = await waitForReadyPort(child);

    let signalTriggered = false;
    const ssePromise = requestSse(port, () => {
      if (!signalTriggered) {
        signalTriggered = true;
        void triggerSigterm(port);
      }
    });

    const sseBody = await ssePromise;
    const exit = await waitForExit(child);

    expect(sseBody).toContain('event: start');
    expect(sseBody).toContain('event: chunk');
    expect(sseBody).toContain('event: done');

    expect(exit.signal).toBeNull();
    expect(exit.code).toBe(0);
    expect(child.stdout).toContain('SHUTDOWN_COMPLETE');
    expect(child.stderr).toBe('');
  });
});
