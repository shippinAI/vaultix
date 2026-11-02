import { Link } from "@tanstack/react-router";

import { Button } from "@app/components/v3";
import { GuidanceHint, GuidedHelp } from "@app/components/vaultix/GuidedHelp";
import { LearningSignals } from "@app/components/vaultix/LearningSignals";
import { ReferenceTeaching } from "@app/components/vaultix/ReferenceTeaching";
import { referenceActions } from "@app/hooks/api/vaultix/actions";
import { useVaultixGuide, type VaultixSourceAction } from "@app/hooks/api/vaultix/queries";

export const VaultixReferences = ({
  action,
  scopeKey = "guide"
}: {
  action: VaultixSourceAction;
  scopeKey?: string;
}) => {
  const guide = useVaultixGuide();
  return (
    <ReferenceTeaching
      action={action}
      scopeKey={scopeKey}
      client={referenceActions}
      help={{
        overview: <GuidedHelp guideId="references" />,
        project: <GuidanceHint guideId="references" target="reference-app" />,
        environment: <GuidanceHint guideId="references" target="reference-environment" />,
        folder: <GuidanceHint guideId="references" target="reference-path" />
      }}
      learning={
        guide.data && (
          <LearningSignals
            area="references"
            didYouKnow={guide.data.didYouKnow}
            knowledgeDrops={guide.data.knowledgeDrops}
          />
        )
      }
      signIn={
        <Button asChild variant="outline">
          <Link to="/login">Sign In</Link>
        </Button>
      }
    />
  );
};
