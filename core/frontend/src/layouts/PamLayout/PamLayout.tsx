import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";

import { useProjectPermission, useSubscription } from "@app/context";

import { AssumePrivilegeModeBanner } from "../ProjectLayout/components/AssumePrivilegeModeBanner";

export const PamLayout = () => {
  const { assumedPrivilegeDetails } = useProjectPermission();
  const { subscription } = useSubscription();

  const isPamGated = subscription?.pam === false;
  const [, setIsUpgradeModalOpen] = useState(isPamGated);

  useEffect(() => {
    if (isPamGated) setIsUpgradeModalOpen(true);
  }, [isPamGated]);

  return (
    <>
      {assumedPrivilegeDetails && <AssumePrivilegeModeBanner />}
      <Outlet />
    </>
  );
};
