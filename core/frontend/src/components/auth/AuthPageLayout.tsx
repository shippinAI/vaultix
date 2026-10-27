import { ReactNode } from "react";
import { BookOpen } from "lucide-react";

import { Button } from "@app/components/v3";
import { cn } from "@app/components/v3/utils";

import { AuthPageFooter } from "./AuthPageFooter";
import { AuthPageHeader } from "./AuthPageHeader";
import { AuthVaultIllustration } from "./AuthVaultIllustration";

type Props = {
  anchorBottomContent?: boolean;
  /** Per-step context; the Vaultix headline stays fixed. */
  aside?: {
    eyebrow?: ReactNode;
    description?: ReactNode;
  };
  bottomContent?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  headerAction?: ReactNode;
  showFooter?: boolean;
  variant?: "focused" | "split";
};

export const AuthPageLayout = ({
  anchorBottomContent = false,
  aside,
  bottomContent,
  children,
  contentClassName,
  headerAction,
  showFooter = true,
  variant = "split"
}: Props) => {
  const isSplit = variant === "split";

  return (
    <div
      className={cn(
        "min-h-screen bg-background",
        isSplit &&
          "lg:grid lg:grid-cols-[minmax(440px,44%)_minmax(0,1fr)] xl:grid-cols-[minmax(520px,40%)_minmax(0,1fr)]"
      )}
      data-variant={variant}
    >
      <section
        className={cn(
          "flex h-screen min-h-0 min-w-0 flex-col",
          anchorBottomContent ? "overflow-hidden" : "thin-scrollbar overflow-y-auto",
          isSplit && "lg:border-r lg:border-border"
        )}
      >
        <AuthPageHeader>{headerAction}</AuthPageHeader>
        <main
          className={cn(
            "flex flex-1 px-5 py-10 sm:px-8 lg:px-10 xl:px-14",
            anchorBottomContent
              ? "min-h-0 thin-scrollbar overflow-x-hidden overflow-y-auto"
              : "items-center justify-center"
          )}
        >
          <div className={cn("w-full max-w-md", anchorBottomContent && "m-auto", contentClassName)}>
            {children}
          </div>
        </main>
        {(bottomContent || showFooter) && (
          <div
            className={cn(
              "relative z-10 px-5 pb-6 text-center sm:px-8 lg:px-10 xl:px-14",
              anchorBottomContent && "shrink-0 border-t border-border pt-4"
            )}
          >
            {bottomContent}
            {showFooter && <AuthPageFooter />}
          </div>
        )}
      </section>

      {isSplit && (
        <aside className="relative hidden h-screen thin-scrollbar min-w-0 overflow-y-auto bg-card shadow-recessed lg:sticky lg:top-0 lg:flex lg:flex-col">
          <div className="relative z-10 flex h-16 items-center justify-end px-8 xl:px-12">
            <Button asChild variant="outline" size="sm">
              <a href="/api/docs" target="_blank" rel="noopener noreferrer">
                <BookOpen />
                API Reference
              </a>
            </Button>
          </div>

          <div className="relative z-10 flex flex-1 items-center justify-center px-10 pt-6 pb-16 xl:px-20">
            <div className="max-w-xl">
              <AuthVaultIllustration />
              <p className="mb-4 font-jetbrains-mono text-xs tracking-[0.02em] text-project uppercase">
                {aside?.eyebrow ?? "Vaultix · Secrets + AI"}
              </p>
              <h2 className="font-alliance text-3xl leading-tight font-normal text-foreground xl:text-4xl">
                <span className="block">Shippin secrets you own.</span>
                <span className="mt-2 block text-project">Build with confidence.</span>
              </h2>
              <p className="mt-4 max-w-lg font-alliance text-sm leading-relaxed text-label xl:text-base">
                {aside?.description ??
                  "Keep your app's secrets organized and its access scoped. Clyffy works with references while values stay in your vault."}
              </p>
              <div className="mt-8 grid gap-3 border-t border-border pt-6 text-sm text-muted">
                <p>Separate development and production environments.</p>
                <p>Use your own Codex or AI client setup.</p>
                <p>Software features included. Permissions and approvals still apply.</p>
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
};
