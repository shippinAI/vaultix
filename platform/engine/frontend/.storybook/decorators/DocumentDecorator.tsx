import { useEffect } from "react";
import type { Decorator } from "@storybook/react-vite";

export const DocumentDecorator: Decorator = (Story) => {
  useEffect(() => {
    const root = document.documentElement;

    root.classList.add("overflow-visible");
    return () => root.classList.remove("overflow-visible");
  }, []);

  return <Story />;
};
