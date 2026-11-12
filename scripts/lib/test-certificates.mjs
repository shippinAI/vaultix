import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { webcrypto, KeyObject } from 'node:crypto';

const require = createRequire(resolve('platform/engine/backend/package.json'));
const x509 = require('@peculiar/x509');
x509.cryptoProvider.set(webcrypto);

export async function testCertificates() {
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const caKeys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    name: 'CN=Vaultix disposable protocol test CA', serialNumber: '01', keys: caKeys, signingAlgorithm: algorithm,
    notBefore: new Date(Date.now() - 60_000), notAfter: new Date(Date.now() + 3_600_000),
    extensions: [new x509.BasicConstraintsExtension(true, 1, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign, true)]
  });
  let serial = 1;
  async function issue({subject = 'CN=localhost', client = false, expired = false} = {}) {
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const cert = await x509.X509CertificateGenerator.create({
      subject, issuer: ca.subject, serialNumber: (++serial).toString(16).padStart(2,'0'), publicKey: keys.publicKey,
      signingKey: caKeys.privateKey, signingAlgorithm: algorithm,
      notBefore: new Date(Date.now() - 120_000), notAfter: new Date(Date.now() + (expired ? -60_000 : 3_600_000)),
      extensions: [new x509.BasicConstraintsExtension(false), new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
        new x509.ExtendedKeyUsageExtension([client ? '1.3.6.1.5.5.7.3.2' : '1.3.6.1.5.5.7.3.1'], true),
        new x509.SubjectAlternativeNameExtension([{type:'dns',value:'localhost'},{type:'ip',value:'127.0.0.1'}])]
    });
    return {cert: cert.toString('pem'), key: KeyObject.from(keys.privateKey).export({type:'pkcs8',format:'pem'})};
  }
  return {ca: ca.toString('pem'), issue};
}
