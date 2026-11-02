import { TSmtpSendMail, TSmtpService } from "@app/services/smtp/smtp-service";

export type TTestSmtpService = TSmtpService & {
  getEmails: () => TSmtpSendMail[];
  getLastEmail: () => TSmtpSendMail | undefined;
  clear: () => void;
};

export const mockSmtpServer = (): TTestSmtpService => {
  const storage: TSmtpSendMail[] = [];
  const unsupportedRecordedMail = async (): Promise<never> => {
    throw new Error(
      "Recorded mail requires the dedicated SMTP acceptance fixture; this mock captures legacy mail only."
    );
  };
  return {
    sendRecordedMail: unsupportedRecordedMail,
    prepareRecordedMail: unsupportedRecordedMail,
    sendPreparedRecordedMail: unsupportedRecordedMail,
    sendMail: async (data) => {
      storage.push(data);
    },
    verify: async () => {
      return true;
    },
    getEmails: () => storage,
    getLastEmail: () => storage[storage.length - 1],
    clear: () => {
      storage.length = 0;
    }
  };
};
