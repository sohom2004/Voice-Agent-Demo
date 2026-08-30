import { ConnectionConfig, DatabaseConnector, DiscoveredSchema } from '../connectors/base';
import { PostgresConnector } from '../connectors/postgres';
import { MysqlConnector } from '../connectors/mysql';
import { decryptCredentials } from '../security/credentials';

export function getConnector(provider: string, encryptedConfig: string): DatabaseConnector {
  const configText = decryptCredentials(encryptedConfig);
  const config = JSON.parse(configText) as ConnectionConfig;

  switch (provider.toLowerCase()) {
    case 'postgres':
    case 'postgresql':
      return new PostgresConnector(config);
    case 'mysql':
      return new MysqlConnector(config);
    default:
      throw new Error(`Unsupported database provider: ${provider}`);
  }
}

export class SchemaInspector {
  async inspect(provider: string, encryptedConfig: string): Promise<DiscoveredSchema> {
    const connector = getConnector(provider, encryptedConfig);
    try {
      await connector.connect();
      const schema = await connector.inspectSchema();
      return schema;
    } finally {
      await connector.disconnect();
    }
  }
}
