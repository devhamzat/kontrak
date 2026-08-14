import type { ContractValidationResult, LocalExchange } from '@kontrak/core';
import { createJsonSchemaPlugin } from '@kontrak/plugin-json-schema';
import { createOpenApiPlugin } from '@kontrak/plugin-openapi';
import {
  isValidationCompletedMessage,
  panelPortName,
  type ContractSummary,
} from '@kontrak/protocol';
import { CheckCircle2, Edit2, Plus, Trash2, XCircle } from 'lucide-react';
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import type { StoredContract } from '../core/types';
import { getContracts, saveContracts } from '../storage/store';
import './App.css';

interface ValidatedRequest {
  id: string;
  exchange: LocalExchange;
  result: ContractValidationResult;
  contract?: ContractSummary;
}

type ContractFormat = StoredContract['format'];
type ResultFilter = 'all' | 'valid' | 'invalid' | 'unmatched';

const jsonSchemaPlugin = createJsonSchemaPlugin();
const openApiPlugin = createOpenApiPlugin();
const ContractSourceEditor = lazy(() => import('./ContractSourceEditor'));
const JSON_SCHEMA_STARTER = '{\n  "type": "object",\n  "properties": {}\n}';
const OPENAPI_STARTER = `openapi: 3.1.0
info:
  title: My API
  version: 1.0.0
paths: {}
`;

const App: React.FC = () => {
  const [contracts, setContracts] = useState<StoredContract[]>([]);
  const [requests, setRequests] = useState<ValidatedRequest[]>([]);
  const [activeTab, setActiveTab] = useState<'requests' | 'contracts'>(
    'requests',
  );
  const [format, setFormat] = useState<ContractFormat>('json-schema');
  const [name, setName] = useState('');
  const [urlPattern, setUrlPattern] = useState('');
  const [urlPatternKind, setUrlPatternKind] = useState<'literal' | 'regex'>(
    'literal',
  );
  const [method, setMethod] = useState('GET');
  const [source, setSource] = useState(JSON_SCHEMA_STARTER);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all');
  const [deletedContract, setDeletedContract] = useState<{
    contract: StoredContract;
    index: number;
  } | null>(null);

  useEffect(() => {
    getContracts()
      .then(setContracts)
      .catch((error: unknown) => {
        setFormError(error instanceof Error ? error.message : String(error));
      });

    const inspectedTabId = chrome.devtools.inspectedWindow.tabId;
    const port = chrome.runtime.connect({
      name: panelPortName(inspectedTabId),
    });
    port.onMessage.addListener((message: unknown) => {
      if (
        isValidationCompletedMessage(message) &&
        message.inspectedTabId === inspectedTabId
      ) {
        setRequests((previous) =>
          [
            {
              id: crypto.randomUUID(),
              exchange: message.payload.exchange,
              result: message.payload.result,
              contract: message.payload.contract,
            },
            ...previous,
          ].slice(0, 100),
        );
      }
    });
    return () => port.disconnect();
  }, []);

  const summary = useMemo(
    () => ({
      valid: requests.filter((item) => item.result.status === 'valid').length,
      invalid: requests.filter((item) =>
        ['invalid', 'error'].includes(item.result.status),
      ).length,
      unmatched: requests.filter((item) => item.result.status === 'skipped')
        .length,
    }),
    [requests],
  );

  const visibleRequests = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((item) => {
      const matchesFilter =
        resultFilter === 'all' ||
        (resultFilter === 'valid' && item.result.status === 'valid') ||
        (resultFilter === 'invalid' &&
          ['invalid', 'error'].includes(item.result.status)) ||
        (resultFilter === 'unmatched' && item.result.status === 'skipped');
      const matchesSearch =
        !query ||
        item.exchange.request.url.toLowerCase().includes(query) ||
        item.exchange.request.method.toLowerCase().includes(query) ||
        item.result.operationId?.toLowerCase().includes(query) ||
        item.contract?.name.toLowerCase().includes(query);
      return matchesFilter && Boolean(matchesSearch);
    });
  }, [requests, resultFilter, search]);

  const resetForm = (nextFormat: ContractFormat = 'json-schema') => {
    setEditingId(null);
    setFormat(nextFormat);
    setName('');
    setUrlPattern('');
    setUrlPatternKind('literal');
    setMethod('GET');
    setSource(nextFormat === 'openapi' ? OPENAPI_STARTER : JSON_SCHEMA_STARTER);
    setFormError(null);
  };

  const changeFormat = (nextFormat: ContractFormat) => resetForm(nextFormat);

  const editContract = (contract: StoredContract) => {
    setEditingId(contract.id);
    setFormat(contract.format);
    setName(contract.name);
    setFormError(null);
    if (contract.format === 'json-schema') {
      setUrlPattern(contract.urlPattern);
      setUrlPatternKind(contract.urlPatternKind);
      setMethod(contract.method);
      setSource(JSON.stringify(contract.schema, null, 2));
    } else {
      setUrlPattern('');
      setMethod('GET');
      setSource(
        typeof contract.document === 'string'
          ? contract.document
          : JSON.stringify(contract.document, null, 2),
      );
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveContract = async () => {
    setFormError(null);
    try {
      if (!name.trim()) throw new Error('Contract name is required.');
      const id = editingId ?? crypto.randomUUID();
      let stored: StoredContract;
      if (format === 'openapi') {
        const imported = await openApiPlugin.import({
          id,
          name,
          content: source,
        });
        if (imported.contracts.length === 0)
          throwImportDiagnostics(imported.diagnostics);
        stored = { id, name: name.trim(), format, document: source };
      } else {
        if (!urlPattern.trim()) throw new Error('URL pattern is required.');
        const schema = JSON.parse(source) as unknown;
        const imported = await jsonSchemaPlugin.import({
          id,
          name,
          content: schema,
          metadata: {
            method,
            target: 'response',
            urlPattern,
            urlPatternKind,
          },
        });
        if (imported.contracts.length === 0)
          throwImportDiagnostics(imported.diagnostics);
        stored = {
          id,
          name: name.trim(),
          format,
          method,
          urlPattern: urlPattern.trim(),
          urlPatternKind,
          schema,
        };
      }

      const updated = editingId
        ? contracts.map((contract) =>
            contract.id === editingId ? stored : contract,
          )
        : [...contracts, stored];
      await saveContracts(updated);
      setContracts(updated);
      resetForm(format);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteContract = async (id: string) => {
    const index = contracts.findIndex((contract) => contract.id === id);
    const deleted = contracts[index];
    if (!deleted) return;
    const updated = contracts.filter((contract) => contract.id !== id);
    try {
      await saveContracts(updated);
      setContracts(updated);
      setDeletedContract({ contract: deleted, index });
      if (editingId === id) resetForm(format);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  const undoDelete = async () => {
    if (!deletedContract) return;
    const updated = [...contracts];
    updated.splice(deletedContract.index, 0, deletedContract.contract);
    try {
      await saveContracts(updated);
      setContracts(updated);
      setDeletedContract(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Kontrak</h1>
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'requests' ? 'active' : ''}`}
            onClick={() => setActiveTab('requests')}
          >
            Requests ({requests.length})
          </button>
          <button
            className={`tab ${activeTab === 'contracts' ? 'active' : ''}`}
            onClick={() => setActiveTab('contracts')}
          >
            Contracts ({contracts.length})
          </button>
        </div>
      </header>

      <main className="content">
        {activeTab === 'requests' ? (
          <div className="requests-list">
            <div className="validation-summary" aria-label="Validation summary">
              <span>{summary.valid} valid</span>
              <span>{summary.invalid} invalid</span>
              <span>{summary.unmatched} unmatched</span>
            </div>
            <div className="request-tools">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search URL, method, operation, or contract"
                aria-label="Search captured requests"
              />
              <select
                value={resultFilter}
                onChange={(event) =>
                  setResultFilter(event.target.value as ResultFilter)
                }
                aria-label="Filter validation results"
              >
                <option value="all">All results</option>
                <option value="valid">Valid</option>
                <option value="invalid">Invalid</option>
                <option value="unmatched">Unmatched</option>
              </select>
              {requests.length > 0 && (
                <button className="btn-icon" onClick={() => setRequests([])}>
                  Clear session
                </button>
              )}
            </div>
            {requests.length === 0 && (
              <p className="empty">
                {contracts.length === 0
                  ? 'Start by adding an OpenAPI or JSON Schema contract.'
                  : 'No requests captured yet. Reload the inspected page or make an API request.'}
              </p>
            )}
            {requests.length > 0 && visibleRequests.length === 0 && (
              <p className="empty">
                No requests match the current search and filter.
              </p>
            )}
            {visibleRequests.map((request) => (
              <ValidationCard key={request.id} value={request} />
            ))}
          </div>
        ) : (
          <div className="schemas-panel">
            <div className="add-schema">
              <h3>{editingId ? 'Edit contract' : 'Add contract'}</h3>
              <div className="form-group row">
                <select
                  value={format}
                  onChange={(event) =>
                    changeFormat(event.target.value as ContractFormat)
                  }
                  aria-label="Contract format"
                  disabled={editingId !== null}
                >
                  <option value="json-schema">JSON Schema</option>
                  <option value="openapi">OpenAPI</option>
                </select>
                <input
                  className="flex-1"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Contract name"
                  aria-label="Contract name"
                />
              </div>

              {format === 'json-schema' && (
                <div className="form-group row">
                  <select
                    value={method}
                    onChange={(event) => setMethod(event.target.value)}
                  >
                    {['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(
                      (value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ),
                    )}
                  </select>
                  <select
                    value={urlPatternKind}
                    onChange={(event) =>
                      setUrlPatternKind(
                        event.target.value as 'literal' | 'regex',
                      )
                    }
                    aria-label="URL matching mode"
                  >
                    <option value="literal">Contains</option>
                    <option value="regex">Regular expression</option>
                  </select>
                  <input
                    className="flex-1"
                    value={urlPattern}
                    onChange={(event) => setUrlPattern(event.target.value)}
                    placeholder="URL pattern, e.g. /api/users"
                    aria-label="URL pattern"
                  />
                </div>
              )}

              <Suspense
                fallback={<p className="empty">Loading contract editor…</p>}
              >
                <ContractSourceEditor
                  format={format}
                  source={source}
                  onChange={setSource}
                />
              </Suspense>
              {formError && (
                <div className="errors" role="alert">
                  {formError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => void saveContract()}
                  className="btn-primary"
                >
                  <Plus size={16} />{' '}
                  {editingId ? 'Update contract' : 'Add contract'}
                </button>
                {editingId && (
                  <button
                    onClick={() => resetForm(format)}
                    className="btn-icon"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="schema-list">
              <h3>Configured contracts</h3>
              {contracts.length === 0 && (
                <p className="empty">No contracts configured.</p>
              )}
              {contracts.map((contract) => (
                <div key={contract.id} className="schema-item">
                  <div className="schema-info">
                    <span className="method">
                      {contract.format === 'openapi'
                        ? 'OPENAPI'
                        : contract.method}
                    </span>
                    <span className="url">
                      {contract.name}
                      {contract.format === 'json-schema'
                        ? ` — ${contract.urlPattern}`
                        : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={() => editContract(contract)}
                      className="btn-icon"
                      aria-label={`Edit ${contract.name}`}
                    >
                      <Edit2 size={16} color="var(--primary-color)" />
                    </button>
                    <button
                      onClick={() => void deleteContract(contract.id)}
                      className="btn-icon"
                      aria-label={`Delete ${contract.name}`}
                    >
                      <Trash2 size={16} color="red" />
                    </button>
                  </div>
                </div>
              ))}
              {deletedContract && (
                <div className="undo-notice" role="status">
                  Removed {deletedContract.contract.name}.
                  <button onClick={() => void undoDelete()}>Undo</button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

function ValidationCard({ value }: { value: ValidatedRequest }) {
  const valid = value.result.status === 'valid';
  const unmatched = value.result.status === 'skipped';
  return (
    <div
      className={`request-item ${valid ? 'valid' : unmatched ? 'unmatched' : 'invalid'}`}
    >
      <div className="request-header">
        <span
          className={`method ${value.exchange.request.method.toLowerCase()}`}
        >
          {value.exchange.request.method}
        </span>
        <span className="url" title={value.exchange.request.url}>
          {value.exchange.request.url}
        </span>
        <span className="status">{value.exchange.response.status}</span>
        <span className="contract-label">
          {value.contract?.name ??
            (unmatched ? 'No matching contract' : value.result.format)}
          {value.result.operationId ? ` · ${value.result.operationId}` : ''}
        </span>
        <span className="icon">
          {valid ? (
            <CheckCircle2 color="green" size={20} />
          ) : unmatched ? (
            <span aria-label="Unmatched">—</span>
          ) : (
            <XCircle color="red" size={20} />
          )}
        </span>
      </div>
      {value.result.diagnostics.length > 0 && (
        <div className="errors">
          {value.result.diagnostics.map((item, index) => (
            <div key={`${item.code}-${index}`} className="error-item">
              <strong>{item.code}</strong> · {item.path || '/'}: {item.message}
              {item.source?.pointer ? (
                <div className="diagnostic-source">
                  Contract: {item.source.pointer}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <details className="exchange-details">
        <summary>Inspect request and response</summary>
        <div className="exchange-grid">
          <BodyInspector
            title="Request"
            headers={value.exchange.request.headers}
            body={value.exchange.request.body}
          />
          <BodyInspector
            title="Response"
            headers={value.exchange.response.headers}
            body={value.exchange.response.body}
          />
        </div>
      </details>
    </div>
  );
}

function BodyInspector({
  title,
  headers,
  body,
}: {
  title: string;
  headers: Readonly<Record<string, string>>;
  body: LocalExchange['request']['body'];
}) {
  return (
    <section>
      <h4>{title}</h4>
      <div className="inspector-label">Sanitized headers</div>
      <pre>{JSON.stringify(headers, null, 2)}</pre>
      <div className="inspector-label">Body</div>
      <pre>{displayBody(body)}</pre>
    </section>
  );
}

function displayBody(body: LocalExchange['request']['body']): string {
  if (body.kind === 'empty') return '(empty)';
  if (body.kind === 'unavailable') return `(unavailable: ${body.reason})`;
  if (body.kind === 'binary') {
    return `(binary: ${body.byteLength} bytes${body.encoding ? `, ${body.encoding}` : ''})`;
  }
  return typeof body.value === 'string'
    ? body.value
    : JSON.stringify(body.value, null, 2);
}

function throwImportDiagnostics(
  diagnostics: readonly { message: string }[],
): never {
  throw new Error(
    diagnostics.map((item) => item.message).join('\n') ||
      'Contract import failed.',
  );
}

export default App;
