const path = require('node:path');
function iconLocation(value, index = 0, shortcut = '', env = process.env) {
  let file = typeof value === 'string' ? value.trim() : '';
  const variables = new Map(Object.entries(env).map(([key, value]) => [key.toLowerCase(), value]));
  file = file.replace(/%([^%]+)%/g, (match, key) => variables.get(key.toLowerCase()) ?? match);
  const suffix = file.match(/,\s*(-?\d+)\s*$/);
  if (suffix) { index = Number(suffix[1]); file = file.slice(0, suffix.index).trim(); }
  file = file.replace(/^"(.*)"$/, '$1');
  if (file && !path.win32.isAbsolute(file) && shortcut) file = path.win32.resolve(path.win32.dirname(shortcut), file);
  if (!/^[a-z]:[\\/]/i.test(file) || /[\0\r\n]/.test(file)) file = '';
  return { path: file ? path.win32.normalize(file) : '', index: Number.isInteger(index) && Math.abs(index) <= 100000 ? index : 0 };
}
module.exports = { iconLocation };
