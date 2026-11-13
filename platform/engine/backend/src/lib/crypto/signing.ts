import { KeyObject } from "crypto";

import { crypto } from "./cryptography";

export const verifySignature = (data: string, signature: Buffer, publicKey: KeyObject) => {
  const verify = crypto.nativeCrypto.createVerify("SHA256");
  verify.update(data);
  verify.end();
  return verify.verify(publicKey, signature);
};

