type VaultixActionTriggerOptions = {
  scope?: string;
  target?: string;
};

type DataAttributes = Record<`data-${string}`, string>;

export const vaultixActionTrigger = (
  actionId: string,
  options: VaultixActionTriggerOptions = {}
): DataAttributes => {
  const attrs: DataAttributes = {
    "data-vaultix-action": actionId
  };
  if (options.scope) attrs["data-vaultix-action-scope"] = options.scope;
  if (options.target) attrs["data-vaultix-action-target"] = options.target;
  return attrs;
};
