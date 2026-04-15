import { build } from "esbuild";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const markpdfVersion = String(packageJson.version ?? "0.0.0");

await Promise.all([
  build({
    entryPoints: ["src/cli.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    outfile: "dist/markpdf.cjs",
    define: {
      __MARKPDF_VERSION__: JSON.stringify(markpdfVersion),
    },
    minify: true,
    sourcemap: false,
    legalComments: "none"
  }),
  build({
    entryPoints: ["src/web/main.tsx"],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: ["es2020"],
    outfile: "public/app.js",
    minify: true,
    sourcemap: false,
    legalComments: "none"
  })
]);
