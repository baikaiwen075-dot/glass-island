const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
function startBridge() {
  if (process.platform !== 'win32') return null;
  const binary = path.join(__dirname, '../assets/windows-bridge.exe').replace('app.asar', 'app.asar.unpacked');
  if (!fs.existsSync(binary)) return null;
  const child = spawn(binary, [String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let sequence = 0, ended = false;
  function finish(error) { ended = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); }
  child.on('error', finish); child.on('exit', () => finish(new Error('桌面桥接程序已退出')));
  child.stdin.on('error', () => {}); child.stderr.resume();
  readline.createInterface({ input: child.stdout }).on('line', line => {
    try { const reply = JSON.parse(line), p = pending.get(reply.id); if (!p) return; clearTimeout(p.timer); pending.delete(reply.id); reply.ok ? p.resolve(reply.value) : p.reject(new Error(reply.error)); } catch { /* Ignore unrelated runtime output. */ }
  });
  return {
    request(op, values = {}) {
      if (ended) return Promise.reject(new Error('桌面桥接程序不可用'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('桌面桥接程序响应超时')); }, 5000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ ...values, op, id }) + '\n');
      });
    },
    bind(win, floating = false) { return this.request('bind', { hwnd: win.getNativeWindowHandle().readBigUInt64LE().toString(), floating }); },
    stop() { child.stdin.end(); }
  };
}
module.exports = { startBridge };
