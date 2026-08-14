import { json } from '@codemirror/lang-json';
import CodeMirror from '@uiw/react-codemirror';

export default function ContractSourceEditor({
  format,
  source,
  onChange,
}: {
  format: 'json-schema' | 'openapi';
  source: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-color)',
        borderRadius: '0.375rem',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-color)',
      }}
    >
      <CodeMirror
        value={source}
        height="320px"
        extensions={format === 'json-schema' ? [json()] : []}
        onChange={onChange}
        theme="dark"
        aria-label="Contract source"
        style={{ fontSize: '14px', fontFamily: 'monospace' }}
      />
    </div>
  );
}
