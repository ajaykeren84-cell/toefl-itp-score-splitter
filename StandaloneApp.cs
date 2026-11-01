using System;
using System.Diagnostics;
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

        [STAThread]
        static void Main()
        {
            try
            {
                // Dedicated App directory in LocalAppData
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string targetDir = Path.Combine(localAppData, "TOEFL_ITP_Score_Splitter_App");
                string nodeExe = Path.Combine(targetDir, "node.exe");
                string serverJs = Path.Combine(targetDir, "server.js");
                string versionTag = Path.Combine(targetDir, "v1.0.1.tag");

                // Extract embedded bundle if not present or needs update
                if (!File.Exists(versionTag) || !File.Exists(nodeExe) || !File.Exists(serverJs))
                {
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
                        try { File.WriteAllText(versionTag, "v1.0.1"); } catch { }
                    }
                }

                Directory.SetCurrentDirectory(targetDir);

                // Start node server if port 3800 is not already in use
                if (!IsPortInUse(3800))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = nodeExe;
                    psi.Arguments = "\"" + serverJs + "\"";
                    psi.WorkingDirectory = targetDir;
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;

                    serverProcess = Process.Start(psi);
                }

                // Wait up to 25 seconds for the server to respond with 200 OK
                WaitForServer("http://localhost:3800", 25);

                // Launch dedicated Desktop Window in App Mode (Edge or Chrome)
                string browserPath = FindBrowser();
                string appUrl = "http://localhost:3800";
                string profileDir = Path.Combine(targetDir, "Profile");
                string arguments = "--app=" + appUrl + " --window-size=1360,880 --user-data-dir=\"" + profileDir + "\"";

                Process browserProcess = null;
                if (!string.IsNullOrEmpty(browserPath))
                {
                    ProcessStartInfo bPsi = new ProcessStartInfo();
                    bPsi.FileName = browserPath;
                    bPsi.Arguments = arguments;
                    bPsi.UseShellExecute = false;
                    browserProcess = Process.Start(bPsi);
                }
                else
                {
                    Process.Start(appUrl);
                }

                if (browserProcess != null)
                {
                    browserProcess.WaitForExit();
                }
                else
                {
                    // Fallback delay if opened via default system handler
                    Thread.Sleep(5000);
                }

                CleanupServer();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Gagal menjalankan aplikasi: " + ex.Message, "TOEFL Score Splitter Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                CleanupServer();
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

        private static void WaitForServer(string url, int timeoutSeconds)
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
                        if (response.StatusCode == HttpStatusCode.OK) return;
                    }
                }
                catch { Thread.Sleep(250); }
            }
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

        private static void CleanupServer()
        {
            try
            {
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    serverProcess.Kill();
                }
            }
            catch { }
        }
    }
}
