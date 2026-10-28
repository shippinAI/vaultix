// Component-only permission fixtures; no real API, import or secret operations.
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { SecretDropzone } from "../src/pages/secret-manager/OverviewPage/components/SecretDropzone/SecretDropzone";
import "../src/index.css";

function Fixture() {
  const [actions, setActions] = useState(0);
  return (
    <main className="p-4 text-foreground">
      <h1 className="mb-4 text-xl">Secret import component fixture</h1>
      <section aria-label="Secret upload">
        <SecretDropzone
          onParsedSecrets={() => setActions((count) => count + 1)}
          onAddSecret={() => setActions((count) => count + 1)}
        />
      </section>
      <output aria-label="Fixture action count">{actions}</output>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <TooltipProvider>
    <Fixture />
  </TooltipProvider>
);
