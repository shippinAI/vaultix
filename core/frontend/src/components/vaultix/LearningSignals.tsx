import { LightbulbIcon } from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@app/components/v3";
import type {
  VaultixCapabilityFamily,
  VaultixTeachingSignal
} from "@app/hooks/api/vaultix/learning";
import { selectVaultixLearning } from "@app/hooks/api/vaultix/learning";

export const LearningSignals = ({
  area,
  didYouKnow,
  knowledgeDrops,
  enterpriseCapabilities = []
}: {
  area: "references" | "connections";
  didYouKnow: VaultixTeachingSignal[];
  knowledgeDrops: VaultixTeachingSignal[];
  enterpriseCapabilities?: VaultixCapabilityFamily[];
}) => {
  const signals = selectVaultixLearning([...didYouKnow, ...knowledgeDrops], area);
  if (!signals.length && !enterpriseCapabilities.length) return null;

  return (
    <Accordion
      type="single"
      collapsible
      variant="ghost"
      className="motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none"
    >
      <AccordionItem value="learning">
        <AccordionTrigger>
          <LightbulbIcon aria-hidden="true" className="mx-2 inline size-4" />
          Learn While You Work
        </AccordionTrigger>
        <AccordionContent className="flex flex-col gap-4">
          <p className="text-xs text-muted">
            Workflow tips from the Vaultix guide. No activity profile is recorded.
          </p>
          {signals.map((signal) => (
            <div key={signal.id} className="flex flex-col gap-2">
              <p className="text-xs text-muted">
                {signal.kind === "did-you-know" ? "Did You Know?" : "Workflow Detail"}
              </p>
              <h3 className="text-sm font-medium">{signal.title}</h3>
              <p className="text-sm text-muted">{signal.description}</p>
            </div>
          ))}
          {enterpriseCapabilities.length > 0 && (
            <Accordion type="single" collapsible variant="ghost">
              <AccordionItem value="roadmap">
                <AccordionTrigger>Capability Roadmap</AccordionTrigger>
                <AccordionContent>
                  <p className="text-sm text-muted">
                    Software features are included. These families are undergoing migration and
                    verification; this roadmap does not establish feature readiness. Permissions and
                    approvals still apply.
                  </p>
                  <ul className="mt-4 flex flex-col gap-4">
                    {enterpriseCapabilities.map((capability) => (
                      <li key={capability.id} className="flex flex-col gap-1">
                        <h3 className="text-sm font-medium">{capability.title}</h3>
                        <p className="text-xs text-muted">
                          {capability.category}: Verification in progress
                        </p>
                        <p className="text-sm text-muted">{capability.summary}</p>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
