import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { startHttpUi } from "./server.js";

const VERSION = "0.1.0";

function printHelp(): void {
  process.stdout.write(
    [
      "markpdf",
      "",
      "Usage:",
      "  markpdf          Open local UI in browser",
      "  markpdf --help   Show usage",
      "  markpdf --version Show version",
      "  markpdf uninstall Run uninstaller",
      "",
      "Supported options: --help, --version, uninstall"
    ].join("\n") + "\n"
  );
}

async function runUninstall(): Promise<void> {
  if (process.platform !== "win32") {
    process.stdout.write("Automatic uninstall is available on Windows installer builds only.\n");
    process.stdout.write("Remove the markpdf binary and its install directory manually on this platform.\n");
    return;
  }

  const executableDir = dirname(process.execPath);
  const candidates = [
    join(executableDir, "Uninstall.exe"),
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "MarkPDF CLI", "Uninstall.exe") : "",
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "MarkPDF CLI", "Uninstall.exe") : ""
  ].filter((entry) => entry.length > 0);

  const uninstallPath = candidates.find((candidate) => existsSync(candidate));
  if (!uninstallPath) {
    throw new Error("Uninstaller was not found. If installed manually, remove the binary and install directory manually.");
  }

  process.stdout.write("Launching MarkPDF uninstaller...\n");

  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const comSpecCandidates = [
    process.env.ComSpec,
    join(systemRoot, "System32", "cmd.exe"),
    join(systemRoot, "Sysnative", "cmd.exe")
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

  let launched = false;
  let lastError: unknown = null;

  for (const command of [...new Set(comSpecCandidates)]) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, ["/d", "/s", "/c", "start", "", uninstallPath], {
          stdio: "ignore"
        });

        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`launcher exited with code ${code ?? "unknown"}`));
        });
      });

      launched = true;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!launched) {
    throw new Error(`Unable to launch uninstaller${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
  }
}

function openBrowser(url: string): void {
  const detached = { detached: true, stdio: "ignore" as const };

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const comSpecCandidates = [
      process.env.ComSpec,
      join(systemRoot, "System32", "cmd.exe"),
      join(systemRoot, "Sysnative", "cmd.exe")
    ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

    const windowsLaunchers: Array<readonly [string, readonly string[]]> = [
      ...new Set(comSpecCandidates)
    ].map((command) => [command, ["/d", "/s", "/c", "start", "", url]] as const);

    windowsLaunchers.push(["rundll32", ["url.dll,FileProtocolHandler", url]] as const);

    const launchWithFallback = (index: number): void => {
      if (index >= windowsLaunchers.length) {
        process.stderr.write("Unable to launch a browser automatically. Open this URL manually:\n");
        process.stderr.write(`${url}\n`);
        return;
      }

      const [command, args] = windowsLaunchers[index];

      try {
        const child = spawn(command, args, detached);
        child.once("error", () => launchWithFallback(index + 1));
        child.unref();
      } catch {
        launchWithFallback(index + 1);
      }
    };

    launchWithFallback(0);
    return;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [url], detached);
    child.on("error", () => {
      process.stderr.write("Unable to launch a browser automatically. Open this URL manually:\n");
      process.stderr.write(`${url}\n`);
    });
    child.unref();
    return;
  }

  const launchers = [
    ["google-chrome", [url]],
    ["chromium", [url]],
    ["xdg-open", [url]]
  ] as const;

  for (const [command, args] of launchers) {
    const exists = spawnSync("which", [command], { stdio: "ignore" }).status === 0;
    if (!exists) {
      continue;
    }

    const child = spawn(command, args, detached);
    child.on("error", () => {
      process.stderr.write("Unable to launch a browser automatically. Open this URL manually:\n");
      process.stderr.write(`${url}\n`);
    });
    child.unref();
    return;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length > 1) {
    process.stderr.write("Only --help, --version, and uninstall are supported.\n");
    process.exitCode = 1;
    return;
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  if (args[0] === "--version" || args[0] === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (args[0] === "uninstall") {
    await runUninstall();
    return;
  }

  if (args.length === 1) {
    process.stderr.write("Unknown option. Supported options: --help, --version, uninstall.\n");
    process.exitCode = 1;
    return;
  }

  const server = await startHttpUi();
  const url = `http://127.0.0.1:${server.port}`;
  process.stdout.write(`MarkPDF running at ${url}\n`);
  process.stdout.write("Press Ctrl+C to stop.\n");

  openBrowser(url);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
