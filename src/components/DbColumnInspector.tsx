import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Table,
  Key,
  Cpu,
  RefreshCw,
  Plus,
  X,
  Server,
  Code,
  Unplug,
  Link2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface ColumnMeta {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  referencesTable?: string;
  referencesColumn?: string;
}

interface TableMeta {
  name: string;
  columnCount: number;
  columns: ColumnMeta[];
}

interface ToolMeta {
  name: string;
  description: string;
  input_schema: any;
}

interface DbColumnContextData {
  tenantId: string;
  workspaceId?: string;
  dialect: string;
  schemaHash: string;
  fetchedAt: string;
  tableCount: number;
  tables: TableMeta[];
  tools: ToolMeta[];
  error?: string;
  connection?: Record<string, unknown>;
}

interface ConnectionStatus {
  connected: boolean;
  tenantId?: string;
  workspaceId?: string;
  status?: string;
  dialect?: string;
  database?: string;
  schemaHash?: string | null;
  tableCount?: number;
  toolCount?: number;
  connection?: Record<string, unknown> | null;
  error?: string;
  envDefaultAvailable?: boolean;
}

type Dialect = 'sqlite' | 'postgres' | 'mysql';

function buildConfigPayload(opts: {
  tenantId: string;
  dialect: Dialect;
  connectionUrl: string;
  sqlitePath: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}) {
  const {
    tenantId,
    dialect,
    connectionUrl,
    sqlitePath,
    host,
    port,
    user,
    password,
    database,
  } = opts;

  const config: Record<string, unknown> = {
    tenantId,
    workspaceId: tenantId,
    dialect,
  };

  if (connectionUrl.trim()) {
    config.connectionUrl = connectionUrl.trim();
    config.connectionString = connectionUrl.trim();
  } else if (dialect === 'sqlite') {
    config.database = sqlitePath;
  } else {
    config.host = host;
    config.port = parseInt(port || (dialect === 'mysql' ? '3306' : '5432'), 10);
    config.user = user;
    config.password = password;
    config.database = database;
  }

  return config;
}

export const DbColumnInspector: React.FC<{ tenantId?: string; workspaceId?: string }> = ({
  tenantId = 'default_tenant',
  workspaceId,
}) => {
  const resolvedTenant = workspaceId || tenantId;

  const [data, setData] = useState<DbColumnContextData | null>(null);
  const [connStatus, setConnStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'columns' | 'tools' | 'raw'>('columns');

  // Connect modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dialect, setDialect] = useState<Dialect>('sqlite');
  const [connectionUrl, setConnectionUrl] = useState('');
  const [sqlitePath, setSqlitePath] = useState('demo_database.db');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('5432');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('postgres');
  const [database, setDatabase] = useState('acme_test');
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [lastConnectSummary, setLastConnectSummary] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sql-mcp/connection-status?tenantId=${encodeURIComponent(resolvedTenant)}`
      );
      if (res.ok) {
        const json = await res.json();
        setConnStatus(json);
      }
    } catch (err) {
      console.error('Failed to fetch connection status:', err);
    }
  }, [resolvedTenant]);

  const fetchContext = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/sql-mcp/column-context?tenantId=${encodeURIComponent(resolvedTenant)}`
      );
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.tables && json.tables.length > 0) {
          setSelectedTable((prev) => prev || json.tables[0].name);
        }
      }
    } catch (err) {
      console.error('Failed to fetch DB column context:', err);
    } finally {
      setLoading(false);
    }
  }, [resolvedTenant]);

  useEffect(() => {
    fetchContext();
    fetchStatus();
    const interval = setInterval(() => {
      fetchContext();
      fetchStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchContext, fetchStatus]);

  useEffect(() => {
    if (dialect === 'postgres') setPort((p) => (p === '3306' ? '5432' : p));
    if (dialect === 'mysql') setPort((p) => (p === '5432' ? '3306' : p));
  }, [dialect]);

  const currentConfig = () =>
    buildConfigPayload({
      tenantId: resolvedTenant,
      dialect,
      connectionUrl,
      sqlitePath,
      host,
      port,
      user,
      password,
      database,
    });

  const handleTestConnection = async () => {
    setTesting(true);
    setConnectMsg(null);
    try {
      const res = await fetch('/api/sql-mcp/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: resolvedTenant, config: currentConfig() }),
      });
      const json = await res.json();
      if (json.ok || json.connected) {
        setConnectMsg(
          `Test OK · ${json.dialect || dialect} · ${json.tableCount ?? 0} tables` +
            (json.database ? ` · ${json.database}` : '')
        );
      } else {
        setConnectMsg(`Error: ${json.error || 'Connection test failed'}`);
      }
    } catch (err: any) {
      setConnectMsg(`Error: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleConnectNewDb = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setConnecting(true);
    setConnectMsg(null);
    setLastConnectSummary(null);

    try {
      const res = await fetch('/api/sql-mcp/connect-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: resolvedTenant, config: currentConfig() }),
      });

      const json = await res.json();
      if (res.ok && !json.error) {
        const toolCount = json.tools?.length ?? 0;
        const tableCount = json.tableCount ?? json.tables?.length ?? 0;
        const hash = json.schemaHash ? String(json.schemaHash).slice(0, 12) : 'n/a';
        const summary = `Connected · ${tableCount} tables · ${toolCount} tools · hash ${hash}`;
        setConnectMsg(summary);
        setLastConnectSummary(summary);
        setData(json);
        if (json.tables && json.tables.length > 0) {
          setSelectedTable(json.tables[0].name);
        }
        await fetchStatus();
        setTimeout(() => setIsModalOpen(false), 1000);
      } else {
        setConnectMsg(`Error: ${json.error || 'Failed to connect'}`);
      }
    } catch (err: any) {
      setConnectMsg(`Error: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleRefreshSchema = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/sql-mcp/refresh-schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: resolvedTenant }),
      });
      const json = await res.json();
      if (res.ok && !json.error) {
        setData(json);
        if (json.tables?.length) {
          setSelectedTable((prev) =>
            json.tables.some((t: TableMeta) => t.name === prev) ? prev : json.tables[0].name
          );
        }
        setLastConnectSummary(
          `Schema refreshed · ${json.tableCount ?? 0} tables · ${json.tools?.length ?? 0} tools · hash ${
            json.schemaHash ? String(json.schemaHash).slice(0, 12) : 'n/a'
          }`
        );
        await fetchStatus();
      } else {
        setLastConnectSummary(`Error: ${json.error || 'Refresh failed'}`);
      }
    } catch (err: any) {
      setLastConnectSummary(`Error: ${err.message}`);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/sql-mcp/disconnect-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: resolvedTenant }),
      });
      const json = await res.json();
      if (res.ok) {
        setLastConnectSummary('Disconnected');
        setData(null);
        setSelectedTable('');
        await fetchStatus();
        await fetchContext();
      } else {
        setLastConnectSummary(`Error: ${json.error || 'Disconnect failed'}`);
      }
    } catch (err: any) {
      setLastConnectSummary(`Error: ${err.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const activeTableObj = data?.tables?.find((t) => t.name === selectedTable);
  const isConnected = Boolean(connStatus?.connected);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden text-slate-200 shadow-2xl flex flex-col h-full relative">
      {/* Top Header */}
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center space-x-2 min-w-0">
          <Database className="w-5 h-5 text-cyan-400 flex-shrink-0" />
          <h3 className="font-semibold text-sm text-slate-100 tracking-wide truncate">
            Database Column Context Inspector
          </h3>
          {data?.dialect && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
              {data.dialect.toUpperCase()}
            </span>
          )}
          <span
            className={`px-2 py-0.5 text-[10px] rounded-full font-mono border flex items-center gap-1 ${
              isConnected
                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                : 'bg-rose-950/60 text-rose-300 border-rose-800/60'
            }`}
            title={connStatus?.error || connStatus?.status || ''}
          >
            {isConnected ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>
        <div className="flex items-center space-x-1.5 flex-wrap justify-end">
          <button
            onClick={() => {
              setConnectMsg(null);
              setIsModalOpen(true);
            }}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white rounded font-medium transition shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect</span>
          </button>
          <button
            onClick={handleRefreshSchema}
            disabled={refreshing}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
            title="POST /api/sql-mcp/refresh-schema"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Schema</span>
          </button>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting || !isConnected}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-300 rounded border border-slate-700 disabled:opacity-40 transition"
            title="POST /api/sql-mcp/disconnect-database"
          >
            <Unplug className="w-3.5 h-3.5" />
            <span>Disconnect</span>
          </button>
          <button
            onClick={() => {
              fetchContext();
              fetchStatus();
            }}
            disabled={loading}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Reload</span>
          </button>
        </div>
      </div>

      {/* Connection status (redacted) */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-950/40 text-[11px] font-mono flex flex-wrap gap-x-4 gap-y-1 text-slate-400">
        <span>
          tenant:{' '}
          <span className="text-cyan-300">{connStatus?.tenantId || data?.tenantId || resolvedTenant}</span>
        </span>
        {connStatus?.database && (
          <span>
            db: <span className="text-slate-200">{connStatus.database}</span>
          </span>
        )}
        {connStatus?.dialect && (
          <span>
            dialect: <span className="text-slate-200">{connStatus.dialect}</span>
          </span>
        )}
        {typeof connStatus?.toolCount === 'number' && (
          <span>
            tools: <span className="text-purple-300">{connStatus.toolCount}</span>
          </span>
        )}
        {lastConnectSummary && (
          <span className={lastConnectSummary.startsWith('Error') ? 'text-rose-300' : 'text-emerald-300'}>
            {lastConnectSummary}
          </span>
        )}
      </div>

      {/* Overview Stats Bar */}
      <div className="grid grid-cols-4 gap-2 p-3 bg-slate-900/50 border-b border-slate-800 text-xs font-mono">
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Tenant</span>
          <span className="text-cyan-300 font-medium truncate block">{data?.tenantId || resolvedTenant}</span>
        </div>
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Tables</span>
          <span className="text-emerald-400 font-bold block">
            {data?.tableCount ?? connStatus?.tableCount ?? 0}
          </span>
        </div>
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Compiled Tools</span>
          <span className="text-purple-400 font-bold block">
            {data?.tools?.length ?? connStatus?.toolCount ?? 0}
          </span>
        </div>
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Schema Hash</span>
          <span className="text-slate-300 font-mono truncate block text-[10px]">
            {(data?.schemaHash || connStatus?.schemaHash)?.toString().slice(0, 10) || 'None'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 px-3 bg-slate-950/40 text-xs">
        <button
          onClick={() => setActiveTab('columns')}
          className={`py-2 px-3 border-b-2 font-medium transition flex items-center space-x-1.5 ${
            activeTab === 'columns'
              ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Table className="w-3.5 h-3.5" />
          <span>Column Schemas</span>
        </button>
        <button
          onClick={() => setActiveTab('tools')}
          className={`py-2 px-3 border-b-2 font-medium transition flex items-center space-x-1.5 ${
            activeTab === 'tools'
              ? 'border-purple-400 text-purple-300 bg-purple-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>Compiled db-agent Tools ({data?.tools?.length || 0})</span>
        </button>
        <button
          onClick={() => setActiveTab('raw')}
          className={`py-2 px-3 border-b-2 font-medium transition flex items-center space-x-1.5 ${
            activeTab === 'raw'
              ? 'border-emerald-400 text-emerald-300 bg-emerald-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Code className="w-3.5 h-3.5" />
          <span>Raw Context JSON</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden flex">
        {activeTab === 'columns' && (
          <div className="flex-1 flex overflow-hidden">
            <div className="w-48 bg-slate-950/60 border-r border-slate-800 overflow-y-auto p-2">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider px-2 block mb-1">
                Tables
              </span>
              {(!data?.tables || data.tables.length === 0) && (
                <div className="text-xs text-slate-500 p-2 italic">No tables introspected</div>
              )}
              {data?.tables?.map((t) => (
                <button
                  key={t.name}
                  onClick={() => setSelectedTable(t.name)}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-mono transition flex items-center justify-between mb-0.5 ${
                    selectedTable === t.name
                      ? 'bg-cyan-950 text-cyan-300 font-semibold border border-cyan-800/60'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 rounded">
                    {t.columnCount}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {activeTableObj ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-mono text-sm font-semibold text-cyan-300 flex items-center space-x-1.5">
                      <Table className="w-4 h-4 text-cyan-400" />
                      <span>Table: {activeTableObj.name}</span>
                    </h4>
                    <span className="text-xs text-slate-400 font-mono">
                      {activeTableObj.columns.length} columns received by voice agent
                    </span>
                  </div>

                  <div className="border border-slate-800 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="bg-slate-950 text-slate-400 border-b border-slate-800">
                          <th className="py-2 px-3 font-medium">Column Name</th>
                          <th className="py-2 px-3 font-medium">Data Type</th>
                          <th className="py-2 px-3 font-medium">Attributes</th>
                          <th className="py-2 px-3 font-medium">References</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {activeTableObj.columns.map((c) => (
                          <tr key={c.name} className="hover:bg-slate-850/50 transition">
                            <td className="py-2 px-3 text-slate-200 font-medium">{c.name}</td>
                            <td className="py-2 px-3 text-cyan-400">{c.dataType}</td>
                            <td className="py-2 px-3">
                              <div className="flex items-center space-x-1">
                                {c.isPrimaryKey && (
                                  <span className="bg-amber-950/80 text-amber-300 text-[10px] px-1.5 py-0.5 rounded border border-amber-700/60 flex items-center space-x-0.5">
                                    <Key className="w-2.5 h-2.5" />
                                    <span>PK</span>
                                  </span>
                                )}
                                {c.isForeignKey && (
                                  <span className="bg-blue-950/80 text-blue-300 text-[10px] px-1.5 py-0.5 rounded border border-blue-700/60">
                                    FK
                                  </span>
                                )}
                                {!c.isNullable && (
                                  <span className="bg-slate-800 text-slate-400 text-[10px] px-1.5 py-0.5 rounded">
                                    NOT NULL
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-slate-400 text-[11px]">
                              {c.referencesTable ? (
                                <span className="text-purple-300">
                                  &rarr; {c.referencesTable}.{c.referencesColumn}
                                </span>
                              ) : (
                                <span className="text-slate-600">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 py-12 text-xs">
                  Select a table from the left sidebar to inspect its column context.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'tools' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {data?.tools?.map((t) => (
              <div key={t.name} className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 font-mono">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-purple-300 font-semibold text-xs">{t.name}</span>
                  <span className="bg-purple-950 text-purple-400 text-[10px] px-2 py-0.5 rounded border border-purple-800">
                    MANIFEST TOOL
                  </span>
                </div>
                <p className="text-slate-400 text-xs mb-2 font-sans">{t.description}</p>
                <div className="bg-slate-900 p-2 rounded border border-slate-800 text-[11px]">
                  <span className="text-slate-500 block text-[10px] uppercase mb-1">
                    Input Parameters Schema:
                  </span>
                  <pre className="text-emerald-400 whitespace-pre-wrap">
                    {JSON.stringify(t.input_schema, null, 2)}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'raw' && (
          <div className="flex-1 overflow-auto p-3 font-mono text-xs text-emerald-400 bg-slate-950">
            <pre>{JSON.stringify({ context: data, connectionStatus: connStatus }, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Connect Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl relative font-sans text-xs max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center space-x-2 mb-4">
              <Server className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-100">Connect Database</h3>
            </div>

            <form onSubmit={handleConnectNewDb} className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Database Dialect</label>
                <select
                  value={dialect}
                  onChange={(e) => setDialect(e.target.value as Dialect)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                >
                  <option value="sqlite">SQLite</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium flex items-center gap-1">
                  <Link2 className="w-3 h-3" />
                  Connection URL / String (optional)
                </label>
                <input
                  type="text"
                  value={connectionUrl}
                  onChange={(e) => setConnectionUrl(e.target.value)}
                  placeholder={
                    dialect === 'sqlite'
                      ? 'sqlite:///./demo_database.db'
                      : dialect === 'postgres'
                      ? 'postgresql://user:pass@host:5432/db'
                      : 'mysql://user:pass@host:3306/db'
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  If set, structured fields below are ignored (URL is parsed server-side).
                </p>
              </div>

              {!connectionUrl.trim() &&
                (dialect === 'sqlite' ? (
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">SQLite Database Path</label>
                    <input
                      type="text"
                      value={sqlitePath}
                      onChange={(e) => setSqlitePath(e.target.value)}
                      placeholder="e.g. demo_database.db"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                      required
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Host</label>
                        <input
                          type="text"
                          value={host}
                          onChange={(e) => setHost(e.target.value)}
                          placeholder="localhost"
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Port</label>
                        <input
                          type="text"
                          value={port}
                          onChange={(e) => setPort(e.target.value)}
                          placeholder={dialect === 'postgres' ? '5432' : '3306'}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">User</label>
                        <input
                          type="text"
                          value={user}
                          onChange={(e) => setUser(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-slate-400 mb-1 font-medium">Password</label>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                          autoComplete="off"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-slate-400 mb-1 font-medium">Database Name</label>
                      <input
                        type="text"
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                        placeholder="acme_test"
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                        required
                      />
                    </div>
                  </>
                ))}

              {connectMsg && (
                <div
                  className={`p-2 rounded text-xs ${
                    connectMsg.startsWith('Error')
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}
                >
                  {connectMsg}
                </div>
              )}

              <div className="pt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || connecting}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/50 rounded font-medium disabled:opacity-50"
                >
                  {testing ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  type="submit"
                  disabled={connecting || testing}
                  className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white rounded font-semibold transition disabled:opacity-50"
                >
                  {connecting ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
