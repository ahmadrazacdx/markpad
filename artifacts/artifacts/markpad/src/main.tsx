import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initializeApiBaseUrl } from "@/lib/runtime-api";

async function bootstrap() {
  await initializeApiBaseUrl();
  createRoot(document.getElementById("root")!).render(<App />);
}

void bootstrap();
