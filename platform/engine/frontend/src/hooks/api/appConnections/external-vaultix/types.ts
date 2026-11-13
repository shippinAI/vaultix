export type TRemoteVaultixProject = {
  id: string;
  name: string;
  slug: string;
  environments: Array<{ id: string; name: string; slug: string }>;
};

export type TRemoteVaultixFolder = {
  id: string;
  name: string;
  path: string;
};

export type TRemoteVaultixEnvironmentFolderTree = Record<
  string,
  { id: string; name: string; slug: string; folders: TRemoteVaultixFolder[] }
>;
