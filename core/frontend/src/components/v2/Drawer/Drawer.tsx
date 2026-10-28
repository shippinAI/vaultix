import { forwardRef, ReactNode } from "react";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, VariantProps } from "cva";
import { twMerge } from "tailwind-merge";

import { NotificationDock } from "@app/components/notifications/NotificationDock";

import { Card, CardBody, CardFooter, CardTitle } from "../Card";
import { IconButton } from "../IconButton";

export type DrawerContentProps = DialogPrimitive.DialogContentProps & {
  title?: ReactNode;
  subTitle?: ReactNode;
  footerContent?: ReactNode;
  onClose?: () => void;
  cardBodyClassName?: string;
} & VariantProps<typeof drawerContentVariation>;

const drawerContentVariation = cva(
  "fixed ease-in-out duration-300 z-90 border border-mineshaft-600 drop-shadow-2xl",
  {
    variants: {
      direction: {
        right: [
          "right-0 top-0",
          "h-full w-96 max-w-full",
          "data-[state=open]:animate-drawer-right-in data-[state=closed]:animate-drawer-right-out"
        ]
      }
    }
  }
);

export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(
  (
    {
      children,
      title,
      subTitle,
      className,
      footerContent,
      direction = "right",
      onClose,
      cardBodyClassName,
      ...props
    },
    forwardedRef
  ) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="fixed inset-0 z-20 h-full w-full"
        style={{ backgroundColor: "rgba(0, 0, 0, 0.7)" }}
      />
      <DialogPrimitive.Content
        {...props}
        ref={forwardedRef}
        className={twMerge(drawerContentVariation({ direction, className }))}
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          const toastElement = target.closest("[data-sonner-toast]");
          if (toastElement) {
            e.preventDefault();
            return;
          }

          if (onClose) {
            onClose();
          }
          props.onPointerDownOutside?.(e);
        }}
      >
        <Card isRounded={false} className="dark h-full w-full">
          {title && (
            <DialogPrimitive.Title asChild>
              <div className="shrink-0 pr-10">
                <CardTitle subTitle={subTitle} className="mb-0 px-4">
                  {title}
                </CardTitle>
              </div>
            </DialogPrimitive.Title>
          )}
          <CardBody
            className={twMerge(
              "grow overflow-x-hidden overflow-y-auto px-4 pt-4 dark:scheme-dark",
              cardBodyClassName
            )}
          >
            {children}
          </CardBody>
          <NotificationDock />
          {footerContent && <CardFooter className="order-2">{footerContent}</CardFooter>}{" "}
          <DialogPrimitive.Close aria-label="Close" asChild onClick={onClose}>
            <IconButton
              variant="plain"
              ariaLabel="close"
              className="absolute top-4 right-6 rounded-sm text-bunker-400 hover:text-bunker-50"
            >
              <FontAwesomeIcon icon={faTimes} size="lg" className="cursor-pointer" />
            </IconButton>
          </DialogPrimitive.Close>
        </Card>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
);

DrawerContent.displayName = "DrawerContent";

export type DrawerProps = Omit<DialogPrimitive.DialogProps, "open"> & { isOpen?: boolean };
export const Drawer = ({ isOpen, ...props }: DrawerProps) => (
  <DialogPrimitive.Root open={isOpen} {...props} />
);

export const DrawerTrigger = DialogPrimitive.Trigger;
export type DrawerTriggerProps = DialogPrimitive.DialogTriggerProps;

export const DrawerClose = DialogPrimitive.Close;
export type DrawerCloseProps = DialogPrimitive.DialogCloseProps;
