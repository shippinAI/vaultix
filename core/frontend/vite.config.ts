import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, loadEnv, PluginOption } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import tsconfigPaths from "vite-tsconfig-paths";

const virtualRouteFileChangeReloadPlugin: PluginOption = {
  name: "watch-config-restart",
  configureServer(server) {
    server.watcher.add("./src/routes.ts");
    server.watcher.on("change", (path) => {
      if (path.endsWith("src/routes.ts")) {
        console.log("Virtual route changed");
        server.restart();
      }
    });
  }
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const allowedHosts = env.VITE_ALLOWED_HOSTS?.split(",") ?? [];
  const version = (
    env.VAULTIX_PLATFORM_VERSION ||
    env.VITE_VAULTIX_PLATFORM_VERSION ||
    "0.0.1"
  ).replaceAll(".", "-");

  return {
    server: {
      allowedHosts,
      host: true,
      port: 3000,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8200",
          changeOrigin: true,
          secure: false,
          ws: true
        },
        "/runtime-ui-env.js": {
          target: "http://127.0.0.1:8200",
          changeOrigin: true,
          secure: false
        }
      }
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: `assets/[name]-${version}-[hash].js`,
          chunkFileNames: `assets/[name]-${version}-[hash].js`,
          assetFileNames: `assets/[name]-${version}-[hash].[ext]`,
          // Shared runtime dependencies must not be owned by the chart chunk:
          // otherwise importing React at login downloads the chart renderer too.
          // Keep each dependency family together; do not split their CJS cycles.
          manualChunks(id) {
            const path = id.replaceAll("\\", "/");
            if (
              path.includes("commonjsHelpers.js") ||
              /\/node_modules\/(react|react-dom|react-is|scheduler|use-sync-external-store|tiny-invariant|clsx)\//.test(
                path
              ) ||
              path.includes("/vite-plugin-node-polyfills/shims/")
            ) {
              return "ui-runtime";
            }
            // D3 interaction primitives are shared by permission graphs. Their
            // imports must not drag the Recharts renderer into unrelated routes.
            if (path.includes("/node_modules/d3-")) return "d3";
            if (
              path.includes("/node_modules/recharts/") ||
              path.includes("/node_modules/victory-vendor/")
            ) {
              return "recharts";
            }

            return undefined;
          }
        }
      }
    },
    experimental: {
      renderBuiltUrl(filename, { hostType }) {
        if (hostType === "js") {
          const fallback = 'function(f){ return "/" + f; }';
          const fn = `(typeof window.__toCdnUrl === "function" ? window.__toCdnUrl : ${fallback})`;
          return { runtime: `${fn}(${JSON.stringify(filename)})` };
        }
        return { relative: true };
      }
    },
    plugins: [
      tsconfigPaths(),
      nodePolyfills({
        globals: {
          Buffer: true
        }
      }),
      wasm(),
      topLevelAwait(),
      TanStackRouterVite({
        virtualRouteConfig: "./src/routes.ts"
      }),
      react(),
      virtualRouteFileChangeReloadPlugin
    ]
  };
});
