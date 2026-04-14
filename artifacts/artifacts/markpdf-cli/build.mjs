import { build } from "esbuild";

await Promise.all([
  build({
    entryPoints: ["src/cli.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    outfile: "dist/markpdf.cjs",
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
