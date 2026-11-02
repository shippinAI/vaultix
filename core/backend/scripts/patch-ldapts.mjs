import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// ldapts 9.2.0 omits LDAPResult.referral (RFC 4511, 4.1.9). Preserve the
// server's URLs and matched DN without automatically forwarding credentials.
export async function patchLdapts(root = new URL("../node_modules/ldapts/", import.meta.url)) {
  const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  if (manifest.name !== "ldapts" || manifest.version !== "9.2.0") throw new Error("Review the LDAP referral patch before upgrading ldapts.");
  const changes = [
    [
      '\t\tthis.errorMessage = reader.readString() ?? "";',
      `\t\tthis.errorMessage = reader.readString() ?? "";
\t\tthis.referrals = [];
\t\tif (reader.peek() === 0xa3) {
\t\t\tif (reader.readSequence(0xa3) === null) throw new Error("Incomplete LDAP referral");
\t\t\tconst end = reader.offset + reader.length;
\t\t\tif (end > reader.buffer.length) throw new Error("Truncated LDAP referral");
\t\t\twhile (reader.offset < end) {
\t\t\t\tconst uri = reader.readString();
\t\t\t\tif (uri === null || reader.offset > end) throw new Error("Invalid LDAP referral");
\t\t\t\tthis.referrals.push(uri);
\t\t\t}
\t\t}`
    ],
    [
      '\t\t\tcase 11: return new AdminLimitExceededError(result.errorMessage);',
      `\t\t\tcase 10: return Object.assign(new Error(result.errorMessage || "LDAP referral"), {
\t\t\t\tname: "ReferralError", code: 10, dn: result.matchedDN, referrals: result.referrals ?? []
\t\t\t});
\t\t\tcase 11: return new AdminLimitExceededError(result.errorMessage);`
    ]
  ];
  const receipts = [];
  const hashes = {
    "dist/index.mjs": ["765f01697902043b3a5d2209f46496c3691ccefa2afe32f48cbb1e1b8bbbbb53", "ae835837f795d8153b66b27a1e54cc06c1771a2908f3b95b05eb39b796dd359a"],
    "dist/index.cjs": ["addd5d000792577dff58be59a3314e8efe570689989df6c3f085c8d28efd3f1c", "0ef85f7695e40d916dea6f2791ea82c3b048d59657e76ad8c05f2839f28a613a"]
  };
  for (const file of ["dist/index.mjs", "dist/index.cjs"]) {
    const path = new URL(file, root);
    let source = await readFile(path, "utf8");
    if (!hashes[file].includes(createHash("sha256").update(source).digest("hex"))) {
      throw new Error(`LDAP package content differs from the reviewed release: ${file}`);
    }
    for (const [before, after] of changes) {
      if (source.includes(after)) continue;
      if (source.split(before).length !== 2) throw new Error(`LDAP referral patch context changed: ${file}`);
      source = source.replace(before, after);
    }
    await writeFile(path, source);
    receipts.push({ file, sha256: createHash("sha256").update(source).digest("hex") });
  }
  return receipts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({ ldapts: "9.2.0", referralPatch: await patchLdapts() }));
}
