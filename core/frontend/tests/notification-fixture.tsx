// Browser-only shared-component fixture. No production route or API operations.
import { ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogTrigger,
  AlertDialogFooter,
  AlertDialogCancel
} from "../src/components/v3/generic/AlertDialog";
import { Modal, ModalContent, ModalTrigger, ModalClose } from "../src/components/v2/Modal";
import { Drawer, DrawerContent, DrawerTrigger, DrawerClose } from "../src/components/v2/Drawer";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from "../src/components/v3/generic/Sheet";

import { createNotification, NotificationContainer } from "../src/components/notifications";
import { Button } from "../src/components/v3/generic/Button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "../src/components/v3/generic/Dialog";
import { onRequestError } from "../src/hooks/api/reactQuery";
import "../src/index.css";

const fail = (kind: string, meta?: Record<string, unknown>) =>
  onRequestError(
    {
      isAxiosError: true,
      config: { data: JSON.stringify({ name: "fixture", privateValue: "DO-NOT-RETAIN-FIXTURE" }) },
      response: {
        data:
          kind === "validation"
            ? {
                error: "ValidationFailure",
                reqId: "fixture-request",
                message: [{ message: "Name is required", path: ["name"] }]
              }
            : {
                error: "PermissionDenied",
                reqId: "fixture-request",
                message: "Update requires permission",
                details: [
                  { action: "edit", subject: "secrets", conditions: { environment: "development" } }
                ]
              }
      }
    },
    undefined,
    undefined,
    { meta }
  );

let resolvePending: (() => void) | undefined;

function Form({ children }: { children: ReactNode }) {
  const variant = new URLSearchParams(location.search).get("variant") || "dialog";
  const trigger = <Button>Open Form</Button>;
  const save = (
    <Button
      onClick={() =>
        createNotification(
          {
            title: "Could Not Save Environment",
            type: "error",
            text: "The fixture service is unavailable. Your changes are still in the form. Try again.",
            copyActions: [{ name: "Request ID", value: "fixture-request" }]
          },
          { autoClose: false }
        )
      }
    >
      Save
    </Button>
  );
  const cancel = <Button variant="ghost">Cancel</Button>;
  if (variant === "alert")
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Edit Environment</AlertDialogTitle>
            <AlertDialogDescription>Fixture actions make no API changes.</AlertDialogDescription>
          </AlertDialogHeader>
          <div style={{ maxHeight: 80, overflow: "auto" }}>{children}</div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {save}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  if (variant === "modal")
    return (
      <Modal>
        <ModalTrigger asChild>{trigger}</ModalTrigger>
        <ModalContent
          title="Edit Environment"
          subTitle="Fixture actions make no API changes."
          footerContent={
            <>
              <ModalClose asChild>{cancel}</ModalClose>
              {save}
            </>
          }
        >
          {children}
        </ModalContent>
      </Modal>
    );
  if (variant === "drawer")
    return (
      <Drawer>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent
          title="Edit Environment"
          subTitle="Fixture actions make no API changes."
          footerContent={
            <>
              <DrawerClose asChild>{cancel}</DrawerClose>
              {save}
            </>
          }
        >
          {children}
        </DrawerContent>
      </Drawer>
    );
  if (variant === "sheet")
    return (
      <Sheet>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Edit Environment</SheetTitle>
            <SheetDescription>Fixture actions make no API changes.</SheetDescription>
          </SheetHeader>
          <div style={{ minHeight: 0, overflow: "auto", flex: 1, padding: 16 }}>{children}</div>
          <SheetFooter>
            <SheetClose asChild>{cancel}</SheetClose>
            {save}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Environment</DialogTitle>
          <DialogDescription>Fixture actions make no API changes.</DialogDescription>
        </DialogHeader>
        <DialogBody>{children}</DialogBody>
        <DialogFooter>
          <DialogClose asChild>{cancel}</DialogClose>
          {save}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Fixture() {
  return (
    <>
      <main className="p-6 text-foreground">
        <h1>Notification interaction fixture</h1>
        <Form>
          <p style={{ minHeight: 320 }}>Keep the form usable after a failed save.</p>
          <Button onClick={() => fail("validation")}>Validation Failure</Button>
          <Button
            onClick={() => {
              fail("validation");
              fail("validation");
            }}
          >
            Queued Validation
          </Button>
          <Button onClick={() => fail("permission")}>Permission Failure</Button>
          <Button onClick={() => fail("validation", { skipValidationToast: true })}>
            Handled Validation
          </Button>
          <Button onClick={() => fail("permission", { handledErrorCodes: ["PermissionDenied"] })}>
            Handled Permission
          </Button>
          <Button
            onClick={() =>
              onRequestError({
                isAxiosError: true,
                response: { data: { message: { unexpected: true } } }
              })
            }
          >
            Malformed Message
          </Button>
          <Button
            onClick={() => {
              for (let index = 1; index <= 5; index++)
                toast.info("Message " + index, { id: "message-" + index, duration: Infinity });
              toast.promise(
                new Promise<void>((resolve) => {
                  resolvePending = resolve;
                }),
                {
                  id: "pending",
                  loading: "Pending Operation",
                  success: "Operation Complete",
                  error: "Operation Failed",
                  duration: Infinity
                }
              );
            }}
          >
            Add Messages
          </Button>
          <Button onClick={() => resolvePending?.()}>Resolve Pending</Button>
          <Button onClick={() => createNotification({ text: "Timed Notice" }, { duration: 1500 })}>
            Timed Notice
          </Button>
          <Button onClick={() => toast.dismiss()}>Dismiss All</Button>
        </Form>
      </main>
      <NotificationContainer />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>
);
