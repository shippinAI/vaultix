import { useMemo } from "react";
import type { Decorator } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from "@tanstack/react-router";

export const RouterDecorator: Decorator = (Story, params) => {
  const router = useMemo(() => {
    const routeTree = createRootRoute({
      component: Story
    });

    return createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] })
    });
  }, [Story, params]);

  return <RouterProvider<typeof router> router={router} />;
};
