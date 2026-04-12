import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeApiBaseUrl } from "@/lib/runtime-api";
import { initializeDesktopDiagnostics, writeFrontendDiagnostic } from "@/lib/diagnostics";

async function bootstrap() {
  await initializeDesktopDiagnostics();

  try {
    await initializeApiBaseUrl();
  } catch (error) {
    await writeFrontendDiagnostic("error", `Failed to initialize API base URL: ${String(error)}`);
  }

  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
