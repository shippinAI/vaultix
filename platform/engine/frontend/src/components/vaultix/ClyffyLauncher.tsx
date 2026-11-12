import { lazy, Suspense, useState } from "react";
import { BotIcon } from "lucide-react";

import {
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@app/components/v3";
import { useOrganization } from "@app/context";

const ClyffyWorkspace = lazy(() => import("./ClyffyWorkspace"));

export const ClyffyLauncher = () => {
  const [open, setOpen] = useState(false);
  const { currentOrg } = useOrganization();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Tooltip disableHoverableContent={false}>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <Button
              variant="project"
              size="sm"
              className="mr-2 min-h-11 min-w-11"
              aria-label="Open Clyffy"
            >
              <BotIcon aria-hidden="true" />
              <span className="hidden sm:inline">Clyffy</span>
            </Button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent className="pointer-events-auto max-w-xs motion-reduce:animate-none!">
          Explore authorized secret references with guided MCP actions.
        </TooltipContent>
      </Tooltip>
      <SheetContent className="w-full motion-reduce:animate-none! motion-reduce:transition-none! sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Clyffy Workspace</SheetTitle>
          <SheetDescription className="text-muted">
            Browse the same references available to your AI client in {currentOrg.name}. Secret
            values stay in your vault.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {open && (
            <Suspense fallback={<p role="status">Loading Clyffy tools…</p>}>
              <ClyffyWorkspace key={currentOrg.id} organizationId={currentOrg.id} />
            </Suspense>
          )}
        </div>
        <SheetFooter className="border-t">
          <p className="mr-auto text-xs text-muted">Your permissions apply to every request.</p>
          <SheetClose asChild>
            <Button variant="outline">Close Clyffy</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};
