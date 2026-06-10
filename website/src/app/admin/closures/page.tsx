'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Closure {
  id: string;
  start_date: string;
  end_date: string;
  reason: string;
  banner_text_de: string;
  created_at: string;
}

export default function AdminClosuresPage() {
  const [closures, setClosures] = useState<Closure[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [subCount, setSubCount] = useState<number>(0);
  const [addForm, setAddForm] = useState({
    start_date: '',
    end_date: '',
    reason: '',
    banner_text_de: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [closuresRes, subRes] = await Promise.all([
      supabase.from('closures').select('*').order('start_date', { ascending: false }),
      supabase
        .from('subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active'),
    ]);
    if (closuresRes.data) setClosures(closuresRes.data);
    setSubCount(subRes.count || 0);
    setLoading(false);
  }

  async function addClosure() {
    if (!addForm.start_date || !addForm.end_date) return;
    const { error } = await supabase.from('closures').insert({
      start_date: addForm.start_date,
      end_date: addForm.end_date,
      reason: addForm.reason,
      banner_text_de:
        addForm.banner_text_de ||
        'Während unseres Urlaubs findet keine Produktion statt.',
    });
    if (!error) {
      setShowAdd(false);
      setAddForm({ start_date: '', end_date: '', reason: '', banner_text_de: '' });
      loadData();
    }
  }

  async function deleteClosure(closure: Closure) {
    const msg = `Diese Schließzeit betrifft ${subCount} aktive Abonnements, die pausiert werden. Wirklich löschen?`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from('closures').delete().eq('id', closure.id);
    if (!error) loadData();
  }

  function isActive(closure: Closure): boolean {
    const now = new Date();
    const start = new Date(closure.start_date);
    const end = new Date(closure.end_date);
    end.setHours(23, 59, 59, 999);
    return now >= start && now <= end;
  }

  function isPast(closure: Closure): boolean {
    return new Date(closure.end_date) < new Date();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Schließzeiten...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Schließzeiten</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors"
        >
          Neue Schließzeit
        </button>
      </div>

      {showAdd && (
        <div className="mt-6 bg-white rounded-xl p-5 border border-smitten-cream space-y-4">
          <h2 className="font-display font-bold text-smitten-text">Schließzeit anlegen</h2>
          <p className="text-sm text-smitten-text/60">
            {subCount} aktive Abonnements sind betroffen und werden automatisch pausiert.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Startdatum</label>
              <input
                type="date"
                value={addForm.start_date}
                onChange={(e) => setAddForm({ ...addForm, start_date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Enddatum</label>
              <input
                type="date"
                value={addForm.end_date}
                onChange={(e) => setAddForm({ ...addForm, end_date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">Grund</label>
            <input
              type="text"
              value={addForm.reason}
              onChange={(e) => setAddForm({ ...addForm, reason: e.target.value })}
              placeholder="z.B. Betriebsurlaub"
              className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">Banner-Text (Deutsch)</label>
            <textarea
              value={addForm.banner_text_de}
              onChange={(e) => setAddForm({ ...addForm, banner_text_de: e.target.value })}
              rows={2}
              placeholder="Während unseres Urlaubs findet keine Produktion statt."
              className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={addClosure}
              className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors"
            >
              Speichern
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-smitten-cream text-sm rounded-lg text-smitten-text/60 hover:bg-smitten-bg transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {closures.length === 0 ? (
          <div className="bg-white rounded-xl p-8 border border-smitten-cream text-center text-smitten-text/60 text-sm">
            Keine Schließzeiten vorhanden.
          </div>
        ) : (
          closures.map((closure) => {
            const active = isActive(closure);
            const past = isPast(closure);
            return (
              <div
                key={closure.id}
                className={`bg-white rounded-xl border overflow-hidden ${
                  active
                    ? 'border-red-300 ring-1 ring-red-200'
                    : past
                    ? 'border-smitten-cream opacity-60'
                    : 'border-smitten-cream'
                }`}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-smitten-text">
                          {new Date(closure.start_date).toLocaleDateString('de-DE')} –{' '}
                          {new Date(closure.end_date).toLocaleDateString('de-DE')}
                        </p>
                        {active && (
                          <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                            Aktiv
                          </span>
                        )}
                        {past && (
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                            Vergangen
                          </span>
                        )}
                        {!active && !past && (
                          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                            Geplant
                          </span>
                        )}
                      </div>
                      {closure.reason && (
                        <p className="text-xs text-smitten-text/60 mt-0.5">{closure.reason}</p>
                      )}
                      <p className="text-xs text-smitten-text/40 mt-0.5">
                        Banner: {closure.banner_text_de}
                      </p>
                    </div>
                    <button
                      onClick={() => deleteClosure(closure)}
                      className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors flex-shrink-0"
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
