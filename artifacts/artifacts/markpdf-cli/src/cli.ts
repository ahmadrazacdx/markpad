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

  await new Promise<void>((resolve, reject) => {
    const child = spawn(uninstallPath, [], { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Uninstaller exited with code ${code ?? "unknown"}`));
    });
  });
}

function openBrowser(url: string): void {
  const detached = { detached: true, stdio: "ignore" as const };

  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], detached);
    child.unref();
    return;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [url], detached);
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
