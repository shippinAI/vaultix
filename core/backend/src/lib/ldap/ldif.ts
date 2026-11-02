import { Attribute, Change, Client } from "ldapts";

type Field = { name: string; value: Buffer };
type DirectoryChange =
  | { dn: string; operation: "add"; attributes: Attribute[] }
  | { dn: string; operation: "modify"; changes: Change[] }
  | { dn: string; operation: "delete" };

const field = (line: string): Field => {
  const match = /^((?:[A-Za-z][A-Za-z0-9-]*|[0-9]+(?:\.[0-9]+)+)(?:;[A-Za-z0-9-]+)*)(::|:<|:)[ ]*(.*)$/.exec(line);
  if (!match || match[2] === ":<") throw new Error("LDAP changes require inline attribute values.");
  const [, name, separator, raw] = match;
  if (separator === "::" && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
    throw new Error("Invalid base64 LDAP attribute.");
  }
  return { name, value: Buffer.from(raw, separator === "::" ? "base64" : "utf8") };
};

export const parseDirectoryChanges = (input: string): DirectoryChange[] => {
  if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw new Error("LDAP change document exceeds 4 MiB.");
  const lines: string[] = [];
  for (const line of input.replaceAll("\r\n", "\n").split("\n")) {
    if (line.startsWith(" ")) {
      if (!lines.length || !lines[lines.length - 1]) throw new Error("Invalid folded LDAP line.");
      lines[lines.length - 1] += line.slice(1);
    } else lines.push(line);
  }
  const records = lines
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .trim()
    .split(/\n\s*\n/);
  if (records[0] === "version: 1") records.shift();
  else if (records[0]?.startsWith("version: 1\n")) records[0] = records[0].slice(11);
  if (!records.length || records.length > 10_000) throw new Error("LDAP changes require between 1 and 10000 records.");
  return records.map((record): DirectoryChange => {
    const parts = record.split("\n");
    const dnField = field(parts.shift() ?? "");
    if (dnField.name.toLowerCase() !== "dn" || !dnField.value.length) throw new Error("LDAP record requires a DN.");
    const dn = dnField.value.toString("utf8");
    const action = field(parts.shift() ?? "");
    if (action.name.toLowerCase() !== "changetype") throw new Error("LDAP record requires a change type.");
    const operation = action.value.toString("utf8");
    if (operation === "delete") {
      if (parts.length) throw new Error("LDAP delete records cannot contain attributes.");
      return { dn, operation };
    }
    if (operation === "add") {
      const attributes = new Map<string, { type: string; values: Buffer[] }>();
      for (const line of parts) {
        const { name, value } = field(line);
        const key = name.toLowerCase();
        const attribute = attributes.get(key) ?? { type: name, values: [] };
        attribute.values.push(value);
        attributes.set(key, attribute);
      }
      if (!attributes.size) throw new Error("LDAP add requires attributes.");
      return { dn, operation, attributes: [...attributes.values()].map((attribute) => new Attribute(attribute)) };
    }
    if (operation !== "modify") throw new Error("Unsupported LDAP change type.");
    const changes: Change[] = [];
    while (parts.length) {
      const change = field(parts.shift() ?? "");
      if (!["add", "delete", "replace"].includes(change.name)) throw new Error("Unsupported LDAP modification.");
      const type = change.value.toString("utf8");
      if (!/^(?:[A-Za-z][A-Za-z0-9-]*|[0-9]+(?:\.[0-9]+)+)(?:;[A-Za-z0-9-]+)*$/.test(type))
        throw new Error("Invalid LDAP attribute name.");
      const values: Buffer[] = [];
      while (parts.length && parts[0] !== "-") {
        const value = field(parts.shift() ?? "");
        if (value.name.toLowerCase() !== type.toLowerCase()) throw new Error("LDAP modification attribute mismatch.");
        values.push(value.value);
      }
      if (parts[0] === "-") parts.shift();
      changes.push(
        new Change({
          operation: change.name as "add" | "delete" | "replace",
          modification: new Attribute({ type, values })
        })
      );
    }
    if (!changes.length) throw new Error("LDAP modify requires changes.");
    return { dn, operation, changes };
  });
};

export const executeDirectoryChanges = async (client: Client, input: string): Promise<string[]> => {
  const records = parseDirectoryChanges(input);
  for (const record of records) {
    // Directory changes are ordered; later records may depend on earlier additions.
    // eslint-disable-next-line no-await-in-loop
    if (record.operation === "add") await client.add(record.dn, record.attributes);
    // eslint-disable-next-line no-await-in-loop
    else if (record.operation === "modify") await client.modify(record.dn, record.changes);
    // eslint-disable-next-line no-await-in-loop
    else await client.del(record.dn);
  }
  return records.map(({ dn }) => dn);
};
