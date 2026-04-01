import React, { useEffect, useState } from 'react';
import { ApiSchema, NetworkRequest, ValidationResult } from '../core/types';
import { getSchemas, saveSchemas } from '../storage/store';
import { Plus, Trash2, CheckCircle2, XCircle, Edit2 } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import './App.css';

interface ValidatedRequest {
  id: string;
  request: NetworkRequest;
  schema: ApiSchema;
  validationResult: ValidationResult;
}

const App: React.FC = () => {
  const [schemas, setSchemas] = useState<ApiSchema[]>([]);
  const [requests, setRequests] = useState<ValidatedRequest[]>([]);
  const [activeTab, setActiveTab] = useState<'requests' | 'schemas'>('requests');
  const [newSchemaUrl, setNewSchemaUrl] = useState('');
  const [newSchemaMethod, setNewSchemaMethod] = useState('GET');
  const [newSchemaJson, setNewSchemaJson] = useState('{\n  "type": "object",\n  "properties": {}\n}');
  const [editingSchemaId, setEditingSchemaId] = useState<string | null>(null);

  useEffect(() => {
    getSchemas().then(setSchemas);

    const port = chrome.runtime.connect({ name: 'kontrak-panel' });
    
    port.onMessage.addListener((msg) => {
      if (msg.type === 'VALIDATION_RESULT') {
        setRequests(prev => [
          { id: crypto.randomUUID(), ...msg.payload },
          ...prev
        ].slice(0, 100));
      }
    });

    return () => port.disconnect();
  }, []);

  const handleEditSchema = (schema: ApiSchema) => {
    setEditingSchemaId(schema.id);
    setNewSchemaUrl(schema.urlPattern);
    setNewSchemaMethod(schema.method);
    setNewSchemaJson(JSON.stringify(schema.schema, null, 2));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingSchemaId(null);
    setNewSchemaUrl('');
    setNewSchemaMethod('GET');
    setNewSchemaJson('{\n  "type": "object",\n  "properties": {}\n}');
  };

  const handleSaveSchema = async () => {
    try {
      const parsed = JSON.parse(newSchemaJson);
      if (editingSchemaId) {
        const updated = schemas.map(s => 
          s.id === editingSchemaId 
            ? { ...s, name: newSchemaUrl, urlPattern: newSchemaUrl, method: newSchemaMethod, schema: parsed }
            : s
        );
        setSchemas(updated);
        await saveSchemas(updated);
      } else {
        const newSchema: ApiSchema = {
          id: crypto.randomUUID(),
          name: newSchemaUrl,
          urlPattern: newSchemaUrl,
          method: newSchemaMethod,
          schema: parsed
        };
        const updated = [...schemas, newSchema];
        setSchemas(updated);
        await saveSchemas(updated);
      }
      handleCancelEdit();
    } catch (e) {
      alert('Invalid JSON Schema');
    }
  };

  const handleDeleteSchema = async (id: string) => {
    const updated = schemas.filter(s => s.id !== id);
    setSchemas(updated);
    await saveSchemas(updated);
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
            className={`tab ${activeTab === 'schemas' ? 'active' : ''}`}
            onClick={() => setActiveTab('schemas')}
          >
            Schemas ({schemas.length})
          </button>
        </div>
      </header>

      <main className="content">
        {activeTab === 'requests' && (
          <div className="requests-list">
            {requests.length === 0 && <p className="empty">No validated requests yet. Make sure your schemas are configured and make an API request.</p>}
            {requests.map(req => (
              <div key={req.id} className={`request-item ${req.validationResult.isValid ? 'valid' : 'invalid'}`}>
                <div className="request-header">
                  <span className={`method ${req.request.method.toLowerCase()}`}>{req.request.method}</span>
                  <span className="url" title={req.request.url}>{req.request.url}</span>
                  <span className="status">{req.request.statusCode}</span>
                  <span className="icon">
                    {req.validationResult.isValid ? <CheckCircle2 color="green" size={20} /> : <XCircle color="red" size={20} />}
                  </span>
                </div>
                {!req.validationResult.isValid && (
                  <div className="errors">
                    {req.validationResult.errors.map((e, i) => (
                      <div key={i} className="error-item">
                        <strong>{e.path}:</strong> {e.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'schemas' && (
          <div className="schemas-panel">
            <div className="add-schema">
              <h3>{editingSchemaId ? 'Edit Schema' : 'Add New Schema'}</h3>
              <div className="form-group row">
                <select value={newSchemaMethod} onChange={e => setNewSchemaMethod(e.target.value)}>
                  <option value="ALL">ALL</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
                <input 
                  type="text" 
                  placeholder="URL Pattern (e.g. /api/users)" 
                  value={newSchemaUrl} 
                  onChange={e => setNewSchemaUrl(e.target.value)} 
                  className="flex-1"
                />
              </div>
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '0.375rem', overflow: 'hidden', backgroundColor: 'var(--bg-color)' }}>
                <CodeMirror
                  value={newSchemaJson}
                  height="300px"
                  extensions={[json()]}
                  onChange={(value) => setNewSchemaJson(value)}
                  theme="dark"
                  style={{ fontSize: '14px', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button 
                  onClick={handleSaveSchema} 
                  disabled={!newSchemaUrl || !newSchemaJson}
                  className="btn-primary"
                >
                  <Plus size={16} /> {editingSchemaId ? 'Update Schema' : 'Add Schema'}
                </button>
                {editingSchemaId && (
                  <button onClick={handleCancelEdit} className="btn-icon" style={{ padding: '0.75rem 1rem', background: 'var(--border-color)', fontWeight: 500 }}>
                    Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="schema-list">
              <h3>Configured Schemas</h3>
              {schemas.length === 0 && <p className="empty">No schemas configured.</p>}
              {schemas.map(s => (
                <div key={s.id} className="schema-item">
                  <div className="schema-info">
                    <span className="method">{s.method}</span>
                    <span className="url">{s.urlPattern}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => handleEditSchema(s)} className="btn-icon">
                      <Edit2 size={16} color="var(--primary-color)" />
                    </button>
                    <button onClick={() => handleDeleteSchema(s.id)} className="btn-icon">
                      <Trash2 size={16} color="red" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
