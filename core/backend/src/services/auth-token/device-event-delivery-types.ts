export type DeviceDeliveryJson =
  | null
  | boolean
  | number
  | string
  | DeviceDeliveryJson[]
  | {
      [key: string]: DeviceDeliveryJson;
    };

export type DeviceDeliverySnapshot = { version: 1; [key: string]: DeviceDeliveryJson };
export type DeviceDeliveryDestination = "audit" | "notification" | "email";
export type DeviceDeliveryDisposition = "delivered" | "disabled" | "not-applicable" | "expired";
export type DeviceDeliveryOutcome = Partial<
  Record<"storage" | "fanout" | "mail", "persisted" | "enqueued" | "accepted" | "disabled">
>;

export type DevicePreparationClaim = {
  id: string;
  orgId: string;
  userId: string;
  sessionId: string;
  action: "issued" | "rotated" | "reuse" | "revoked" | "policy-denied";
  createdAt: Date;
  provenance: Record<string, DeviceDeliveryJson>;
  sourceContext: DeviceDeliverySnapshot | null;
  preparationSnapshot: DeviceDeliverySnapshot | null;
  preparationCursor: string | null;
  preparationLease: string;
  preparationLeaseUntil: Date;
};

export type PreparedDeviceDelivery = {
  destination: DeviceDeliveryDestination;
  recipientId: string;
  payload: DeviceDeliverySnapshot;
  expiresAt: Date;
};

export type DeviceDeliveryClaim = PreparedDeviceDelivery & {
  id: string;
  eventId: string;
  orgId: string;
  createdAt: Date;
  leaseToken: string;
  leaseUntil: Date;
  attempts: number;
};
