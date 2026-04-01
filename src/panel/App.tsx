import React, { useEffect, useState } from 'react';
import { ApiSchema, NetworkRequest, ValidationResult } from '../core/types';
import { getSchemas, saveSchemas } from '../storage/store';
import { Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react';
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

  useEffect(() => {
    // Load schemas initial
    getSchemas().then(setSchemas);

    // Connect to background script
    const port = chrome.runtime.connect({ name: 'kontrak-panel' });
    
    port.onMessage.addListener((msg) => {
      if (msg.type === 'VALIDATION_RESULT') {
        setRequests(prev => [
          { id: crypto.randomUUID(), ...msg.payload },
          ...prev
        ].slice(0, 100)); // Keep last 100
      }
    });

    return () => port.disconnect();
  }, []);

  const handleAddSchema = async () => {
    try {
      const parsed = JSON.parse(newSchemaJson);
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
      setNewSchemaUrl('');
      setNewSchemaJson('{\n  "type": "object",\n  "properties": {}\n}');
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
              <h3>Add New Schema</h3>
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
              <textarea 
                value={newSchemaJson} 
                onChange={e => setNewSchemaJson(e.target.value)}
                placeholder="JSON Schema definition"
                rows={10}
              />
              <button 
                onClick={handleAddSchema} 
                disabled={!newSchemaUrl || !newSchemaJson}
                className="btn-primary"
              >
                <Plus size={16} /> Add Schema
              </button>
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
                  <button onClick={() => handleDeleteSchema(s.id)} className="btn-icon">
                    <Trash2 size={16} color="red" />
                  </button>
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
