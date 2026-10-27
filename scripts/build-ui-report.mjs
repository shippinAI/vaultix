// Build the real UI and inspect emitted dependencies, never application data.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "../core/frontend/node_modules/vite/dist/node/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = resolve(root, "core/frontend");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/bundle-proof-"));
const normalize = id => id.replaceAll("\\", "/").replaceAll(`${root.replaceAll("\\", "/")}/`, "");
const previousCwd = process.cwd();
try {
  // The existing Vite config resolves its environment and router config from cwd.
  process.chdir(frontend);
  await build({
    plugins: [{
      name: "vaultix-bundle-evidence",
      generateBundle(_, bundle) {
        const chunks = Object.values(bundle).filter(item => item.type === "chunk").map(chunk => ({
          file: chunk.fileName, entry: chunk.isEntry,
          bytes: Buffer.byteLength(chunk.code), gzipBytes: gzipSync(chunk.code).byteLength,
          imports: chunk.imports, dynamicImports: chunk.dynamicImports,
          modules: Object.entries(chunk.modules).map(([id, module]) => ({
            id: normalize(id), renderedBytesBeforeMinification: module.renderedLength
          }))
        }));
        const byFile = new Map(chunks.map(chunk => [chunk.file, chunk]));
        const entryFiles = chunks.filter(chunk => chunk.entry).map(chunk => chunk.file);
        assert.ok(entryFiles.length, "Build has no entry chunks");
        const eager = new Set();
        const visit = file => {
          if (eager.has(file)) return;
          const chunk = byFile.get(file);
          assert.ok(chunk, `Missing emitted chunk: ${file}`);
          eager.add(file);
          chunk.imports.filter(dependency => byFile.has(dependency)).forEach(visit);
        };
        entryFiles.forEach(visit);
        const eagerChunks = [...eager].map(file => byFile.get(file));
        const forbidden = eagerChunks.flatMap(chunk => chunk.modules)
          .filter(module => /\/node_modules\/(recharts|@lottiefiles)\//.test(module.id)
            || module.id.endsWith("/PamAccessControlPage/PamAccessControlPage.tsx"));
        const summary = {
          scope: "Production emitted chunks; static entry closure only. Browser route loads are measured separately. Gzip is a build estimate, not hosted transfer.",
          entries: entryFiles, eagerFiles: [...eager],
          eagerJavaScriptBytes: eagerChunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
          eagerGzipBytes: eagerChunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
          forbiddenEagerModules: forbidden.map(module => module.id),
          chunks: chunks.map(({ modules, ...chunk }) => ({ ...chunk, moduleCount: modules.length }))
        };
        writeFileSync(resolve(evidence, "summary.json"), JSON.stringify(summary, null, 2));
        writeFileSync(resolve(evidence, "graph.json"), JSON.stringify({
          note: "Source import edges include tree-shaken modules. Use emitted chunk membership and browser requests to establish loading, not an import path alone.",
          chunks,
          sourceModules: [...this.getModuleIds()].map(id => {
            const info = this.getModuleInfo(id);
            return { id: normalize(id), included: info.isIncluded,
              imports: info.importedIds.map(normalize), dynamicImports: info.dynamicallyImportedIds.map(normalize) };
          })
        }, null, 2));
        assert.deepEqual(summary.forbiddenEagerModules, [], "Feature-only modules entered the application startup closure; inspect bundle evidence");
      }
    }]
  });
  console.log(`Vaultix bundle boundary checks passed. Evidence: ${evidence}`);
} finally {
  process.chdir(previousCwd);
}
