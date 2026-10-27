using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading;

// Reads local assets, binds this application's widgets and activates the fixed This PC shell object.
internal static class WindowsBridge
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)] static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out int value, int size);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SystemParametersInfo(uint action, uint param, StringBuilder value, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHDefExtractIcon(string file, int index, uint flags, out IntPtr large, IntPtr small, uint size);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr icon);
    [DllImport("ole32.dll")] static extern int CoInitializeEx(IntPtr reserved, uint flags);
    [DllImport("ole32.dll")] static extern void CoUninitialize();
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ShellFileInfo
    {
        public IntPtr icon; public int iconIndex; public uint attributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string displayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)] public string typeName;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SHGetFileInfo(string file, uint attributes, out ShellFileInfo info, uint size, uint flags);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern IntPtr ShellExecute(IntPtr hwnd, string verb, string file, string parameters, string directory, int show);
    static bool IsLocalFile(string value) { return value != null && value.Length > 3 && Char.IsLetter(value[0]) && value[1] == ':' && (value[2] == '\\' || value[2] == '/') && File.Exists(value); }
    static string Png(Bitmap bitmap)
    {
        using (MemoryStream stream = new MemoryStream()) { bitmap.Save(stream, ImageFormat.Png); return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray()); }
    }
    static string IconPng(IntPtr handle)
    {
        using (Icon icon = (Icon)Icon.FromHandle(handle).Clone()) using (Bitmap bitmap = icon.ToBitmap()) return Png(bitmap);
    }
    static string ResourceIcon(string file, int index)
    {
        if (!IsLocalFile(file)) return "";
        IntPtr handle = IntPtr.Zero;
        try
        {
            string ext = Path.GetExtension(file).ToLowerInvariant();
            if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp")
            {
                if (new FileInfo(file).Length > 8 * 1024 * 1024) return "";
                using (Image image = Image.FromFile(file))
                {
                    if (image.Width > 4096 || image.Height > 4096) return "";
                    using (Bitmap output = new Bitmap(64, 64, PixelFormat.Format32bppArgb))
                    using (Graphics graphics = Graphics.FromImage(output))
                    {
                        graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        float scale = Math.Min(64f / image.Width, 64f / image.Height);
                        float width = image.Width * scale, height = image.Height * scale;
                        graphics.DrawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
                        return Png(output);
                    }
                }
            }
            if (SHDefExtractIcon(file, index, 0, out handle, IntPtr.Zero, 64) == 0 && handle != IntPtr.Zero) return IconPng(handle);
        }
        catch { }
        finally { if (handle != IntPtr.Zero) DestroyIcon(handle); }
        return "";
    }
    static string ShellIcon(string file)
    {
        if (!IsLocalFile(file) && !Directory.Exists(file)) return "";
        ShellFileInfo info;
        if (SHGetFileInfo(file, 0, out info, (uint)Marshal.SizeOf(typeof(ShellFileInfo)), 0x100) == IntPtr.Zero || info.icon == IntPtr.Zero) return "";
        try { return IconPng(info.icon); } finally { DestroyIcon(info.icon); }
    }
    static void OpenComputer()
    {
        const string computer = "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}";
        object automation = Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
        try
        {
            // Explorer may reuse a previously hidden window and ignore ShellExecute's show flag.
            for (int attempt = -1; attempt < 30; attempt++)
            {
                if (attempt == 0)
                {
                    long code = ShellExecute(IntPtr.Zero, "open", computer, null, null, 1).ToInt64();
                    if (code <= 32) throw new Exception("Unable to open This PC (" + code + ")");
                }
                object windows = ((dynamic)automation).Windows();
                try
                {
                    foreach (object entry in (System.Collections.IEnumerable)windows)
                    {
                        try
                        {
                            dynamic window = entry;
                            if (!String.Equals((string)window.Document.Folder.Self.Path, computer, StringComparison.OrdinalIgnoreCase)) continue;
                            IntPtr hwnd = new IntPtr((long)window.HWND);
                            window.Visible = true; ShowWindow(hwnd, 9); SetForegroundWindow(hwnd);
                            if (IsWindowVisible(hwnd) && !IsIconic(hwnd)) return;
                        }
                        catch { }
                        finally { Marshal.ReleaseComObject(entry); }
                    }
                }
                finally { Marshal.ReleaseComObject(windows); }
                if (attempt >= 0) Thread.Sleep(50);
            }
        }
        finally { Marshal.ReleaseComObject(automation); }
        throw new Exception("此电脑窗口未能显示，请重试");
    }
    [STAThread]
    static void Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        uint parent = UInt32.Parse(args[0]);
        JavaScriptSerializer json = new JavaScriptSerializer();
        int com = CoInitializeEx(IntPtr.Zero, 2);
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            object id = null;
            try
            {
                Dictionary<string, object> request = json.Deserialize<Dictionary<string, object>>(line);
                id = request["id"];
                string op = (string)request["op"];
                object result;
                if (op == "computer")
                {
                    OpenComputer();
                    result = true;
                }
                else if (op == "icon")
                {
                    string source = (string)request["path"], location = (string)request["iconPath"], target = (string)request["targetPath"];
                    if (!IsLocalFile(source) && !Directory.Exists(source)) throw new Exception("Icon source must be a local file or folder");
                    int index = Convert.ToInt32(request["iconIndex"]);
                    string icon = ResourceIcon(location, index), origin = "location";
                    if (icon.Length == 0) { icon = ResourceIcon(target, 0); origin = "target"; }
                    if (icon.Length == 0) { icon = ResourceIcon(source, 0); origin = "resource"; }
                    if (icon.Length == 0) { icon = ShellIcon(source); origin = "shell"; }
                    result = new { icon = icon, source = origin };
                }
                else if (op == "wallpaper")
                {
                    StringBuilder path = new StringBuilder(32768);
                    SystemParametersInfo(0x0073, 32768, path, 0);
                    result = path.ToString();
                }
                else if (op == "bind" || op == "inspect")
                {
                    IntPtr hwnd = new IntPtr(Int64.Parse((string)request["hwnd"]));
                    uint process;
                    GetWindowThreadProcessId(hwnd, out process);
                    if (!IsWindow(hwnd) || process != parent) throw new Exception("Window is not owned by this application");
                    IntPtr desktop = FindWindow("Progman", null);
                    if (op == "bind")
                    {
                        bool floating = (bool)request["floating"];
                        IntPtr owner = floating ? IntPtr.Zero : desktop;
                        if (!floating && desktop == IntPtr.Zero) throw new Exception("Windows desktop is unavailable");
                        if (GetWindow(hwnd, 4) != owner)
                        {
                            SetWindowLongPtr(hwnd, -8, owner);
                            if (GetWindow(hwnd, 4) != owner) throw new Exception("Unable to bind window to desktop");
                            if (!floating) SetWindowPos(hwnd, new IntPtr(1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
                        }
                    }
                    int cloaked; DwmGetWindowAttribute(hwnd, 14, out cloaked, 4);
                    result = new { desktopOwned = desktop != IntPtr.Zero && GetWindow(hwnd, 4) == desktop, visible = IsWindowVisible(hwnd), minimized = IsIconic(hwnd), cloaked = cloaked };
                }
                else throw new Exception("Unsupported operation");
                Console.WriteLine(json.Serialize(new { id = id, ok = true, value = result }));
            }
            catch (Exception error) { Console.WriteLine(json.Serialize(new { id = id, ok = false, error = error.Message })); }
        }
        if (com >= 0) CoUninitialize();
    }
}
