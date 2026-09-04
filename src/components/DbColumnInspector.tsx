import React, { useState, useEffect } from 'react';
import { Database, Table, Key, ShieldCheck, Cpu, RefreshCw, Plus, X, Server, CheckCircle2, AlertCircle, Code } from 'lucide-react';

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
  dialect: string;
  schemaHash: string;
  fetchedAt: string;
  tableCount: number;
  tables: TableMeta[];
  tools: ToolMeta[];
  error?: string;
}

export const DbColumnInspector: React.FC<{ tenantId?: string }> = ({ tenantId = 'default_tenant' }) => {
  const [data, setData] = useState<DbColumnContextData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'columns' | 'tools' | 'raw'>('columns');

  // Connect New Database Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [dialect, setDialect] = useState<'sqlite' | 'postgres' | 'mysql'>('sqlite');
  const [sqlitePath, setSqlitePath] = useState('demo_database.db');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('5432');
  const [user, setUser] = useState('postgres');
  const [password, setPassword] = useState('postgres');
  const [database, setDatabase] = useState('acme_test');
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);

  const fetchContext = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/db-agent/column-context?tenantId=${tenantId}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (json.tables && json.tables.length > 0 && !selectedTable) {
          setSelectedTable(json.tables[0].name);
        }
      }
    } catch (err) {
      console.error('Failed to fetch DB column context:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContext();
    const interval = setInterval(fetchContext, 15000);
    return () => clearInterval(interval);
  }, [tenantId]);

  const handleConnectNewDb = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    setConnectMsg(null);

    const config: any = {
      tenantId,
      dialect,
      database: dialect === 'sqlite' ? sqlitePath : database,
      host,
      port: parseInt(port || '5432'),
      user,
      password
    };

    try {
      const res = await fetch('/api/db-agent/connect-database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, config })
      });

      const json = await res.json();
      if (res.ok && !json.error) {
        setConnectMsg(`Successfully connected & introspected database!`);
        setData(json);
        if (json.tables && json.tables.length > 0) {
          setSelectedTable(json.tables[0].name);
        }
        setTimeout(() => setIsModalOpen(false), 1200);
      } else {
        setConnectMsg(`Error: ${json.error || 'Failed to connect'}`);
      }
    } catch (err: any) {
      setConnectMsg(`Error: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const activeTableObj = data?.tables?.find(t => t.name === selectedTable);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl overflow-hidden text-slate-200 shadow-2xl flex flex-col h-full relative">
      {/* Top Header */}
      <div className="bg-slate-950 px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Database className="w-5 h-5 text-cyan-400" />
          <h3 className="font-semibold text-sm text-slate-100 tracking-wide">
            Database Column Context Inspector
          </h3>
          {data?.dialect && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
              {data.dialect.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white rounded font-medium transition shadow-lg"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect New DB</span>
          </button>
          <button
            onClick={fetchContext}
            disabled={loading}
            className="flex items-center space-x-1 text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Overview Stats Bar */}
      <div className="grid grid-cols-4 gap-2 p-3 bg-slate-900/50 border-b border-slate-800 text-xs font-mono">
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Tenant</span>
          <span className="text-cyan-300 font-medium truncate block">{data?.tenantId || 'default'}</span>
        </div>
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Tables</span>
          <span className="text-emerald-400 font-bold block">{data?.tableCount || 0}</span>
        </div>
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Compiled Tools</span>
          <span className="text-purple-400 font-bold block">{data?.tools?.length || 0}</span>
        </div>
        <div className="bg-slate-950/60 p-2 rounded border border-slate-800/80">
          <span className="text-slate-400 block text-[10px] uppercase">Schema Hash</span>
          <span className="text-slate-300 font-mono truncate block text-[10px]">{data?.schemaHash?.slice(0, 10) || 'None'}</span>
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
            {/* Table Sidebar Selector */}
            <div className="w-48 bg-slate-950/60 border-r border-slate-800 overflow-y-auto p-2">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider px-2 block mb-1">
                Tables
              </span>
              {data?.tables?.length === 0 && (
                <div className="text-xs text-slate-500 p-2 italic">No tables introspected</div>
              )}
              {data?.tables?.map(t => (
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
                  <span className="text-[10px] text-slate-500 bg-slate-900 px-1.5 rounded">{t.columnCount}</span>
                </button>
              ))}
            </div>

            {/* Columns Detail View */}
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
                        {activeTableObj.columns.map(c => (
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
            {data?.tools?.map(t => (
              <div key={t.name} className="bg-slate-950/80 border border-slate-800 rounded-lg p-3 font-mono">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-purple-300 font-semibold text-xs">{t.name}</span>
                  <span className="bg-purple-950 text-purple-400 text-[10px] px-2 py-0.5 rounded border border-purple-800">
                    MANIFEST TOOL
                  </span>
                </div>
                <p className="text-slate-400 text-xs mb-2 font-sans">{t.description}</p>
                <div className="bg-slate-900 p-2 rounded border border-slate-800 text-[11px]">
                  <span className="text-slate-500 block text-[10px] uppercase mb-1">Input Parameters Schema:</span>
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
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Connect New Database Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-5 shadow-2xl relative font-sans text-xs">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center space-x-2 mb-4">
              <Server className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-semibold text-slate-100">Connect & Ingest New Database</h3>
            </div>

            <form onSubmit={handleConnectNewDb} className="space-y-3">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Database Dialect</label>
                <select
                  value={dialect}
                  onChange={(e) => setDialect(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
                >
                  <option value="sqlite">SQLite (Local DB File)</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>

              {dialect === 'sqlite' ? (
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">SQLite Database Path / File</label>
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
              )}

              {connectMsg && (
                <div className={`p-2 rounded text-xs ${connectMsg.startsWith('Error') ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-emerald-950 text-emerald-300 border border-emerald-800'}`}>
                  {connectMsg}
                </div>
              )}

              <div className="pt-2 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connecting}
                  className="px-3 py-1.5 bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white rounded font-semibold transition"
                >
                  {connecting ? 'Connecting...' : 'Connect & Introspect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
