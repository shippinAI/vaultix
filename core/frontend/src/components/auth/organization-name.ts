// A suggested display name is editable, not an identifier or a security boundary.
export const suggestOrganizationName = () => {
  const adjectives = ["Amber", "Cedar", "Coral", "Maple", "Silver", "Willow", "Indigo", "Juniper"];
  const nouns = ["Studio", "Workshop", "Collective", "Team", "Works", "Labs", "Group", "House"];
  const words = crypto.getRandomValues(new Uint32Array(2));
  return `${adjectives[words[0] % adjectives.length]} ${nouns[words[1] % nouns.length]}`;
};

export const validateOrganizationName = (value: string): true | string => {
  const name = value.trim();
  if (!name) return "Enter a name for your business, team, brand, or organization.";
  if (name.length > 64) return "Use 64 characters or fewer.";
  if (!/^[a-zA-Z0-9\-_\s]+$/.test(name))
    return "Use letters, numbers, spaces, hyphens, or underscores.";
  return true;
};
