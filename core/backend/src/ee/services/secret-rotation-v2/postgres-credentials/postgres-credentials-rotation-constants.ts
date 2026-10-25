import { SecretRotation } from "@app/ee/services/secret-rotation-v2/secret-rotation-v2-enums";
import { TSecretRotationV2ListItem } from "@app/ee/services/secret-rotation-v2/secret-rotation-v2-types";
import { AppConnection } from "@app/services/app-connection/app-connection-enums";

export const POSTGRES_CREDENTIALS_ROTATION_LIST_OPTION: TSecretRotationV2ListItem = {
  name: "PostgreSQL Credentials",
  type: SecretRotation.PostgresCredentials,
  connection: AppConnection.Postgres,
  template: {
    createUserStatement: `-- create user role
CREATE USER vaultix_user WITH ENCRYPTED PASSWORD 'temporary_password';
   
-- grant database connection permissions
GRANT CONNECT ON DATABASE my_database TO vaultix_user;
   
-- grant relevant table permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO vaultix_user;`,
    rotationStatement: `ALTER USER "{{username}}" WITH PASSWORD '{{password}}'`,
    secretsMapping: {
      username: "POSTGRES_DB_USERNAME",
      password: "POSTGRES_DB_PASSWORD"
    }
  }
};
