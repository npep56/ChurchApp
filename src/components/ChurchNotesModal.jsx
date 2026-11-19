import { useState } from 'react';
import { X, Save } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function ChurchNotesModal({ church, onClose, onSaved }) {
  const [notes, setNotes] = useState(church.notes || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const updated = await base44.entities.CowetaChurch.update(church.id, { notes });
    setSaving(false);
    onSaved?.(updated);
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[2000] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-4 py-3 border-b">
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900 truncate">{church.name}</h2>
            <p className="text-xs text-gray-500 truncate">{church.address}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-2"><X size={18} /></button>
        </div>
        <div className="p-4">
          <textarea
            autoFocus
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={8}
            placeholder="Contact name, pastor, visit outcome, follow-up..."
            className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
          />
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm rounded-lg text-white font-semibold flex items-center gap-2 disabled:opacity-50"
            style={{ backgroundColor: '#2d6a4f' }}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}
