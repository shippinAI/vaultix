import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";

type Props = { children?: ReactNode };

export const AuthPageHeader = ({ children }: Props) => (
  <header className="relative z-10 flex h-16 w-full shrink-0 items-center justify-between px-5 sm:px-8 lg:px-10 xl:px-14">
    <Link
      to="/"
      aria-label="Vaultix home"
      className="flex items-center gap-3 text-xl font-semibold text-foreground"
    >
      <span className="flex size-9 items-center justify-center rounded-md border border-project/40 bg-project/10">
        <KeyRoundIcon className="size-5 text-project" aria-hidden="true" />
      </span>
      Vaultix
    </Link>
    {children && <div className="flex items-center gap-2">{children}</div>}
  </header>
);
