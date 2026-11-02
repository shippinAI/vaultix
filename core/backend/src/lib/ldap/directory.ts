import { Client, EqualityFilter } from "ldapts";

export const resolveDirectoryPrincipal = async (
  client: Client,
  principal: string,
  searchBase: string
): Promise<string> => {
  try {
    const { searchEntries, searchReferences } = await client.search(searchBase, {
      filter: new EqualityFilter({ attribute: "userPrincipalName", value: principal }),
      scope: "sub",
      attributes: ["dn"]
    });
    if (searchEntries.length === 1) return searchEntries[0].dn;
    if (searchEntries.length > 1) throw new Error("Directory principal matched more than one account.");
    if (searchReferences.length) {
      throw Object.assign(new Error("Directory search requires a referral."), {
        name: "ReferralError",
        code: 10,
        dn: searchBase,
        referrals: searchReferences
      });
    }
    throw new Error("Unable to resolve the directory principal.");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 10) {
      const referral = error as Error & { dn?: string; referralSource?: string };
      referral.dn ||= searchBase;
      referral.referralSource = "search";
    }
    throw error;
  }
};

// Keep the persisted group mapping representation stable while accepting both
// RFC 4514 comma escape forms from directory servers.
export const directoryCommonName = (dn: string): string | undefined => {
  let part = "";
  const parts: string[] = [];
  for (let index = 0; index < dn.length; index += 1) {
    const character = dn[index];
    if (character === "\\" && index + 1 < dn.length) {
      index += 1;
      part += dn[index] === "," ? "\\2c" : `\\${dn[index]}`;
    } else if (character === "," || character === "+") {
      parts.push(part.trim());
      part = "";
    } else {
      part += character;
    }
  }
  parts.push(part.trim());
  return parts.find((rdn) => rdn.slice(0, 3).toLowerCase() === "cn=")?.slice(3);
};
