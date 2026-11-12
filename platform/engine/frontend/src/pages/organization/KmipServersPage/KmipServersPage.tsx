import { Helmet } from "react-helmet";

import { KmipServerTab } from "./components";

export const KmipServersPage = () => {
  return (
    <>
      <Helmet>
        <title>Vaultix | KMIP Servers</title>
        <meta property="og:image" content="/images/vaultix-social.png" />
      </Helmet>
      <div className="flex w-full justify-center bg-bunker-800 text-white">
        <div className="w-full max-w-8xl">
          <KmipServerTab />
        </div>
      </div>
    </>
  );
};
