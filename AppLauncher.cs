using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
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
                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                Directory.SetCurrentDirectory(appDir);

                // 1. Check if server already running on port 3800
                bool isRunning = IsPortInUse(3800);
                if (!isRunning)
                {
                    string nodeExe = Path.Combine(appDir, "node.exe");
                    if (!File.Exists(nodeExe))
                    {
                        nodeExe = "node";
                    }

                    string serverJs = Path.Combine(appDir, "server.js");
                    if (File.Exists(serverJs))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = nodeExe;
                        psi.Arguments = "\"" + serverJs + "\"";
                        psi.WorkingDirectory = appDir;
                        psi.CreateNoWindow = true;
                        psi.UseShellExecute = false;
                        psi.WindowStyle = ProcessWindowStyle.Hidden;

                        serverProcess = Process.Start(psi);
                    }
                }

                // 2. Wait until server responds with HTTP 200
                WaitForServer("http://localhost:3800", 15);

                // 3. Launch dedicated Desktop Window in App Mode (Edge or Chrome)
                string browserPath = FindBrowser();
                string appUrl = "http://localhost:3800";
                string arguments = "--app=" + appUrl + " --window-size=1280,840";

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

                // 4. Wait for the window to close and cleanup server
                if (browserProcess != null && serverProcess != null)
                {
                    browserProcess.WaitForExit();
                    CleanupServer();
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("Gagal menjalankan aplikasi: " + ex.Message, "TOEFL Score Splitter Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                CleanupServer();
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
            catch
            {
                return false;
            }
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
                        if (response.StatusCode == HttpStatusCode.OK)
                            return;
                    }
                }
                catch
                {
                    Thread.Sleep(250);
                }
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
