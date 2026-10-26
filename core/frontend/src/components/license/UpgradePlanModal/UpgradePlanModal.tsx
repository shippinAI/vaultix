import { ShieldCheckIcon } from "lucide-react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Separator
} from "@app/components/v3";

type Props = {
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  // Retained for existing callers; paid-tier copy must not be rendered.
  // eslint-disable-next-line react/no-unused-prop-types
  text: string;
  // akhilmhdh: We will come back to this late. Otherwise would need to change in a lot of places.
  // eslint-disable-next-line
  isEnterpriseFeature?: boolean;
};

// Existing callers still pass legacy plan copy. Availability is no longer a paid tier.
export const UpgradePlanModal = ({ isOpen, onOpenChange }: Props): JSX.Element => {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {/* z-[70] keeps this above legacy v2 modals (z-[60]) that open it, e.g. RoleModal */}
      <DialogContent className="z-[70] sm:max-w-xl" overlayClassName="z-[70]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <ShieldCheckIcon className="size-5 text-project" />
            Check Feature Availability
          </DialogTitle>
          <DialogDescription>
            Vaultix software capabilities are included with your deployment.
          </DialogDescription>
        </DialogHeader>

        <Separator />
        <p className="text-sm leading-relaxed text-foreground">
          This action is currently unavailable. Check your project permissions and the
          feature&apos;s configuration with your administrator. Approvals and access policies still
          apply.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange?.(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
