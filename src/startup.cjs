const { createHash } = require('node:crypto');

function createStartup(app, { testMode = false, execPath = process.execPath, env = process.env } = {}) {
  // A portable app runs from a temporary extraction directory. Register its outer EXE.
  const executable = app.isPackaged && env.PORTABLE_EXECUTABLE_FILE || execPath;
  const args = app.isPackaged ? [] : [app.getAppPath()];
  if (testMode) args.push('--smoke-test', `--data-dir=${app.getPath('userData')}`);
  args.push('--autostart');
  const name = testMode ? `GlassIsland.Test.${createHash('sha256').update(app.getPath('userData')).digest('hex').slice(0, 12)}` : 'GlassIsland.Desktop';
  const options = { name, path: executable, args };
  return {
    options,
    status() {
      try {
        const settings = app.getLoginItemSettings({ path: executable, args });
        // Windows reports switch arguments inconsistently through openAtLogin. Match our named entry.
        const entry = settings.launchItems?.find(item => item.name === name && item.path.toLowerCase() === executable.toLowerCase());
        const registered = Array.isArray(settings.launchItems) ? Boolean(entry) : settings.openAtLogin === true;
        return { enabled: registered && (entry ? entry.enabled !== false : settings.executableWillLaunchAtLogin !== false), registered, path: executable, error: '' };
      } catch (error) { return { enabled: false, registered: false, path: executable, error: error.message }; }
    },
    set(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('开机自启设置无效');
      app.setLoginItemSettings({ ...options, openAtLogin: enabled, ...(enabled ? { enabled: true } : {}) });
      const status = this.status();
      if (status.error || status.registered !== enabled) throw new Error(status.error || '无法保存开机自启设置，请检查系统启动项设置');
      return status;
    }
  };
}
module.exports = { createStartup };
