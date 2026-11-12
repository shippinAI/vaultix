import { useEffect, useId, useState } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@app/components/v3";

type Instance = {
  id: string;
  name: string;
  slug: string;
};

type Props = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  instances: Instance[];
  orgDefaultProjectId: string | null;
  onSelect: (projectId: string) => void;
};

export const CertManagerSelectInstanceModal = ({
  isOpen,
  onOpenChange,
  instances,
  orgDefaultProjectId,
  onSelect
}: Props) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectId = useId();
  const isValidSelection = instances.some((instance) => instance.id === selectedId);

  useEffect(() => {
    if (isOpen) setSelectedId(orgDefaultProjectId);
  }, [isOpen, orgDefaultProjectId]);

  const handleOpenProject = () => {
    if (selectedId && isValidSelection) onSelect(selectedId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="gap-4">
          <DialogTitle>Select a Certificate Manager project</DialogTitle>
          <DialogDescription>
            Choose an existing certificate project. Vaultix remembers your selection for this
            organization and checks your access before opening it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-1.5">
          <FieldLabel htmlFor={selectId}>Certificate Manager project</FieldLabel>
          <Select value={selectedId ?? undefined} onValueChange={setSelectedId}>
            <SelectTrigger id={selectId} className="w-full min-w-0">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72 w-(--radix-select-trigger-width)">
              {instances.map((instance) => (
                <SelectItem
                  key={instance.id}
                  value={instance.id}
                  description={
                    instance.id === orgDefaultProjectId ? "Organization default" : undefined
                  }
                >
                  <span className="truncate">{instance.slug}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="project" isDisabled={!isValidSelection} onClick={handleOpenProject}>
            Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
