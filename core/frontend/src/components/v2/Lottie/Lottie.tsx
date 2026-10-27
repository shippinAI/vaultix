import { forwardRef, lazy, ReactNode, Suspense, useRef } from "react";
import type { DotLottie, Mode } from "@lottiefiles/dotlottie-react";

const LottiePlayer = lazy(() => import("./LottiePlayer"));

export type LottieProps = {
  // Kudos to https://itnext.io/react-polymorphic-components-with-typescript-f7ce72ea7af2
  children?: ReactNode;
  icon?: string;
  iconMode?: Mode;
  className?: string;
  isAutoPlay?: boolean;
};

export const Lottie = forwardRef<HTMLDivElement, LottieProps>(
  ({ children, icon, iconMode, isAutoPlay, ...props }, ref): JSX.Element => {
    const iconRef = useRef<DotLottie | null>(null);
    if (
      icon === "vaultix_loading" ||
      icon === "vaultix_loading_bw" ||
      icon === "vaultix_loading_white"
    ) {
      return (
        <div {...props} ref={ref} role="status" aria-label="Loading">
          <img
            src="/images/vaultix-loading.svg"
            alt=""
            aria-hidden="true"
            className="h-full w-full"
          />
          {children}
        </div>
      );
    }
    return (
      <div
        onMouseEnter={() => iconRef.current?.play()}
        onMouseLeave={() => iconRef.current?.stop()}
        {...props}
        ref={ref}
      >
        <Suspense fallback={null}>
          <LottiePlayer
            dotLottieRefCallback={(el) => {
              iconRef.current = el;
            }}
            mode={iconMode}
            src={`/lotties/${icon}.json`}
            loop
            autoplay={isAutoPlay}
            className="h-full w-full"
          />
        </Suspense>
        {children}
      </div>
    );
  }
);
