using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace ToeflScoreSplitter
{
    static class Program
    {
        private static Process serverProcess = null;
        private static NotifyIcon trayIcon = null;
        private static ApplicationContext appContext = null;
        private static string logFilePath = null;

        private static void Log(string message)
        {
            try
            {
                if (!string.IsNullOrEmpty(logFilePath))
                {
                    File.AppendAllText(logFilePath, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + message + Environment.NewLine);
                }
            }
            catch { }
        }

        [STAThread]
        static void Main()
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, "TOEFL_ITP_Score_Splitter_Mutex_v2", out createdNew))
            {
                if (!createdNew)
                {
                    // An instance is already running; simply bring up the web app in the browser
                    LaunchBrowser("http://localhost:3800");
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                AppDomain.CurrentDomain.ProcessExit += (s, e) => CleanupServer();

                try
                {
                    string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    string targetDir = Path.Combine(localAppData, "TOEFL_ITP_Score_Splitter_App");
                    logFilePath = Path.Combine(targetDir, "launcher.log");
                    string nodeExe = Path.Combine(targetDir, "node.exe");
                    string serverJs = Path.Combine(targetDir, "server.js");
                    string versionTag = Path.Combine(targetDir, "v1.0.3.tag");

                    Log("=== TOEFL ITP Score Splitter Portable Starting ===");

                    // Extract embedded bundle if not present or needs update
                    if (!File.Exists(versionTag) || !File.Exists(nodeExe) || !File.Exists(serverJs))
                    {
                        Log("Extracting embedded bundle to " + targetDir);
                        KillTargetDirNodeProcesses(targetDir);

                        if (Directory.Exists(targetDir))
                        {
                            try { Directory.Delete(targetDir, true); } catch { }
                        }
                        Directory.CreateDirectory(targetDir);

                        Assembly assembly = Assembly.GetExecutingAssembly();
                        Stream stream = assembly.GetManifestResourceStream("app_bundle.zip");
                        if (stream == null)
                        {
                            foreach (string res in assembly.GetManifestResourceNames())
                            {
                                if (res.EndsWith("app_bundle.zip", StringComparison.OrdinalIgnoreCase))
                                {
                                    stream = assembly.GetManifestResourceStream(res);
                                    break;
                                }
                            }
                        }

                        if (stream != null)
                        {
                            ExtractZipStream(stream, targetDir);
                            stream.Dispose();
                            try { File.WriteAllText(versionTag, "v1.0.3"); } catch { }
                            Log("Extraction complete.");
                        }
                        else
                        {
                            Log("ERROR: Embedded resource app_bundle.zip not found!");
                        }
                    }

                    Directory.SetCurrentDirectory(targetDir);

                    // Start node server if port 3800 is not already in use
                    if (!IsPortInUse(3800))
                    {
                        Log("Port 3800 is free. Starting internal node.exe...");
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = nodeExe;
                        psi.Arguments = "\"" + serverJs + "\"";
                        psi.WorkingDirectory = targetDir;
                        psi.CreateNoWindow = true;
                        psi.UseShellExecute = false;
                        psi.WindowStyle = ProcessWindowStyle.Hidden;

                        serverProcess = Process.Start(psi);
                        Log("Node process started with PID: " + (serverProcess != null ? serverProcess.Id.ToString() : "null"));
                    }
                    else
                    {
                        Log("Port 3800 is already in use; attaching to existing server instance.");
                    }

                    // Wait up to 25 seconds for the server to respond with 200 OK
                    Log("Waiting for HTTP 200 OK on http://localhost:3800...");
                    bool ready = WaitForServer("http://localhost:3800", 25);
                    Log("Server ready status: " + ready);

                    // Setup System Tray Icon with controls
                    SetupTrayIcon(targetDir);

                    // Launch desktop window in app mode
                    Log("Launching browser window...");
                    LaunchBrowser("http://localhost:3800");

                    // Keep app running via dedicated ApplicationContext until user explicitly exits
                    appContext = new ApplicationContext();
                    Log("Running message loop...");
                    Application.Run(appContext);
                    Log("Message loop terminated.");
                }
                catch (Exception ex)
                {
                    Log("CRITICAL ERROR: " + ex.ToString());
                    MessageBox.Show("Gagal menjalankan aplikasi: " + ex.Message, "TOEFL Score Splitter Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally
                {
                    CleanupServer();
                }
            }
        }

        private static void SetupTrayIcon(string targetDir)
        {
            try
            {
                trayIcon = new NotifyIcon();
                trayIcon.Text = "OSEE TOEFL ITP Score Splitter (Port 3800)";

                try
                {
                    trayIcon.Icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
                }
                catch
                {
                    trayIcon.Icon = SystemIcons.Application;
                }

                ContextMenu contextMenu = new ContextMenu();

                MenuItem openItem = new MenuItem("Buka Aplikasi TOEFL Splitter", (s, e) => LaunchBrowser("http://localhost:3800"));
                openItem.DefaultItem = true;
                contextMenu.MenuItems.Add(openItem);

                string outputDir = Path.Combine(targetDir, "storage", "output");
                contextMenu.MenuItems.Add(new MenuItem("Buka Folder Hasil Ekspor", (s, e) =>
                {
                    if (!Directory.Exists(outputDir)) Directory.CreateDirectory(outputDir);
                    Process.Start("explorer.exe", "\"" + outputDir + "\"");
                }));

                contextMenu.MenuItems.Add("-");

                contextMenu.MenuItems.Add(new MenuItem("Keluar / Matikan Aplikasi", (s, e) =>
                {
                    Log("User clicked 'Keluar / Matikan Aplikasi'");
                    if (trayIcon != null)
                    {
                        trayIcon.Visible = false;
                        trayIcon.Dispose();
                    }
                    CleanupServer();
                    if (appContext != null)
                    {
                        appContext.ExitThread();
                    }
                    else
                    {
                        Application.Exit();
                    }
                }));

                trayIcon.ContextMenu = contextMenu;
                trayIcon.DoubleClick += (s, e) => LaunchBrowser("http://localhost:3800");
                trayIcon.Visible = true;

                trayIcon.ShowBalloonTip(3000, "OSEE TOEFL ITP Score Splitter", "Aplikasi aktif di latar belakang (Port 3800). Klik kanan ikon ini untuk opsi lain.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                Log("SetupTrayIcon error: " + ex.Message);
            }
        }

        private static void LaunchBrowser(string appUrl)
        {
            try
            {
                string browserPath = FindBrowser();
                if (!string.IsNullOrEmpty(browserPath))
                {
                    ProcessStartInfo bPsi = new ProcessStartInfo();
                    bPsi.FileName = browserPath;
                    bPsi.Arguments = "--app=" + appUrl + " --window-size=1360,880";
                    bPsi.UseShellExecute = true;
                    Process.Start(bPsi);
                    return;
                }
            }
            catch (Exception ex)
            {
                Log("LaunchBrowser with --app error: " + ex.Message);
            }

            try
            {
                ProcessStartInfo fallbackPsi = new ProcessStartInfo();
                fallbackPsi.FileName = appUrl;
                fallbackPsi.UseShellExecute = true;
                Process.Start(fallbackPsi);
            }
            catch (Exception ex)
            {
                Log("LaunchBrowser fallback error: " + ex.Message);
            }
        }

        private static void ExtractZipStream(Stream stream, string destinationDir)
        {
            string tempZip = Path.Combine(Path.GetTempPath(), "toefl_extract_" + Guid.NewGuid().ToString("N") + ".zip");
            try
            {
                using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                {
                    stream.CopyTo(fs);
                }
                ZipFile.ExtractToDirectory(tempZip, destinationDir);
            }
            finally
            {
                if (File.Exists(tempZip))
                {
                    try { File.Delete(tempZip); } catch { }
                }
            }
        }

        private static bool IsPortInUse(int port)
        {
            try
            {
                using (TcpClient tcpClient = new TcpClient())
                {
                    IAsyncResult ar = tcpClient.BeginConnect("127.0.0.1", port, null, null);
                    bool success = ar.AsyncWaitHandle.WaitOne(200);
                    return success;
                }
            }
            catch { return false; }
        }

        private static bool WaitForServer(string url, int timeoutSeconds)
        {
            DateTime start = DateTime.Now;
            while ((DateTime.Now - start).TotalSeconds < timeoutSeconds)
            {
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                    request.Timeout = 1000;
                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if (response.StatusCode == HttpStatusCode.OK) return true;
                    }
                }
                catch { Thread.Sleep(250); }
            }
            return false;
        }

        private static string FindBrowser()
        {
            string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe");
            if (File.Exists(edge)) return edge;

            edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe");
            if (File.Exists(edge)) return edge;

            string chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe");
            if (File.Exists(chrome)) return chrome;

            chrome = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe");
            if (File.Exists(chrome)) return chrome;

            return null;
        }

        private static void KillTargetDirNodeProcesses(string targetDir)
        {
            try
            {
                foreach (var proc in Process.GetProcessesByName("node"))
                {
                    try
                    {
                        if (proc.MainModule != null && proc.MainModule.FileName.StartsWith(targetDir, StringComparison.OrdinalIgnoreCase))
                        {
                            proc.Kill();
                            proc.WaitForExit(1000);
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        private static void CleanupServer()
        {
            Log("Cleaning up server processes...");
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                    Log("serverProcess killed.");
                }
            }
            catch { }

            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string targetDir = Path.Combine(localAppData, "TOEFL_ITP_Score_Splitter_App");
                KillTargetDirNodeProcesses(targetDir);
            }
            catch { }
        }
    }
}
