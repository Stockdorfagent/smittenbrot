'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PickupLocation } from '@/lib/types';

export default function AdminPickupLocationsPage() {
  const [locations, setLocations] = useState<PickupLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PickupLocation>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    address: '',
    cabinet_code: '',
    notification_template: '',
    pickup_instructions: '',
    available_wed: true,
    available_sat: false,
    active: true,
    sort_order: 0,
  });

  useEffect(() => {
    loadLocations();
  }, []);

  async function loadLocations() {
    setLoading(true);
    const { data } = await supabase
      .from('pickup_locations')
      .select('*')
      .order('sort_order', { ascending: true });
    if (data) setLocations(data);
    setLoading(false);
  }

  function startEdit(loc: PickupLocation) {
    setEditingId(loc.id);
    setEditForm({ ...loc });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  async function saveEdit() {
    if (!editingId) return;
    const { error } = await supabase
      .from('pickup_locations')
      .update({
        name: editForm.name,
        address: editForm.address,
        cabinet_code: editForm.cabinet_code,
        notification_template: editForm.notification_template,
        pickup_instructions: editForm.pickup_instructions,
        available_wed: editForm.available_wed,
        available_sat: editForm.available_sat,
        active: editForm.active,
        sort_order: editForm.sort_order,
      })
      .eq('id', editingId);
    if (!error) {
      setEditingId(null);
      setEditForm({});
      loadLocations();
    }
  }

  async function addLocation() {
    if (!addForm.name) return;
    const { error } = await supabase.from('pickup_locations').insert({
      name: addForm.name,
      address: addForm.address,
      cabinet_code: addForm.cabinet_code,
      notification_template: addForm.notification_template,
      pickup_instructions: addForm.pickup_instructions,
      available_wed: addForm.available_wed,
      available_sat: addForm.available_sat,
      active: addForm.active,
      sort_order: addForm.sort_order,
    });
    if (!error) {
      setShowAdd(false);
      setAddForm({ name: '', address: '', cabinet_code: '', notification_template: '', pickup_instructions: '', available_wed: true, available_sat: false, active: true, sort_order: 0 });
      loadLocations();
    }
  }

  async function deleteLocation(id: string) {
    if (!confirm('Abholort wirklich löschen?')) return;
    const { error } = await supabase.from('pickup_locations').delete().eq('id', id);
    if (!error) loadLocations();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-smitten-text/40">Lädt Abholorte...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-smitten-text">Abholorte</h1>
        <button
          onClick={() => setShowAdd(true)}
          className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors"
        >
          Neuen Ort hinzufügen
        </button>
      </div>

      {showAdd && (
        <div className="mt-6 bg-white rounded-xl p-5 border border-smitten-cream space-y-4">
          <h2 className="font-display font-bold text-smitten-text">Neuen Abholort anlegen</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Name</label>
              <input
                type="text"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                placeholder="z.B. Stockdorf"
                className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Sortierung</label>
              <input
                type="number"
                value={addForm.sort_order}
                onChange={(e) => setAddForm({ ...addForm, sort_order: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Adresse</label>
              <input
                type="text"
                value={addForm.address}
                onChange={(e) => setAddForm({ ...addForm, address: e.target.value })}
                placeholder="Straße, PLZ, Ort"
                className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-smitten-text/60 mb-1">Schrankcode</label>
              <input
                type="text"
                value={addForm.cabinet_code}
                onChange={(e) => setAddForm({ ...addForm, cabinet_code: e.target.value })}
                placeholder="z.B. 1234 (wird in {CODE} eingesetzt)"
                className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">
              Abhol-Hinweis für Kund:innen (erscheint bei der Bestellung und in der Bestätigungs-E-Mail)
            </label>
            <textarea
              value={addForm.pickup_instructions}
              onChange={(e) => setAddForm({ ...addForm, pickup_instructions: e.target.value })}
              rows={2}
              placeholder="z.B. Selbstbedienung im Abholschrank – deine Bestellnummer steht auf der Verpackung."
              className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            />
          </div>
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">
              Abholtage — an welchen Tagen wird hier abgeholt? (steuert, was Kund:innen im Abo wählen können)
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-smitten-text">
                <input type="checkbox" checked={addForm.available_wed}
                  onChange={(e) => setAddForm({ ...addForm, available_wed: e.target.checked })}
                  className="accent-smitten-primary" />
                Mittwoch
              </label>
              <label className="flex items-center gap-2 text-sm text-smitten-text">
                <input type="checkbox" checked={addForm.available_sat}
                  onChange={(e) => setAddForm({ ...addForm, available_sat: e.target.checked })}
                  className="accent-smitten-primary" />
                Samstag
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs text-smitten-text/60 mb-1">
              Benachrichtigungsvorlage
            </label>
            <textarea
              value={addForm.notification_template}
              onChange={(e) => setAddForm({ ...addForm, notification_template: e.target.value })}
              rows={3}
              placeholder="Verfügbare Platzhalter: {ORDER_NUMBER}, {PICKUP_LOCATION}, {CODE}, {PICKUP_TIME}"
              className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
            />
            <p className="text-xs text-smitten-text/40 mt-1">
              Platzhalter: {'{ORDER_NUMBER}'}, {'{PICKUP_LOCATION}'}, {'{CODE}'}, {'{PICKUP_TIME}'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-smitten-text">
            <input
              type="checkbox"
              checked={addForm.active}
              onChange={(e) => setAddForm({ ...addForm, active: e.target.checked })}
              className="rounded border-smitten-cream text-smitten-text focus:ring-smitten-accent"
            />
            Aktiv
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={addLocation}
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
        {locations.map((loc) => (
          <div key={loc.id} className="bg-white rounded-xl border border-smitten-cream overflow-hidden">
            {editingId === loc.id ? (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-smitten-text/60 mb-1">Name</label>
                    <input
                      type="text"
                      value={editForm.name || ''}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-smitten-text/60 mb-1">Sortierung</label>
                    <input
                      type="number"
                      value={editForm.sort_order || 0}
                      onChange={(e) => setEditForm({ ...editForm, sort_order: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Adresse</label>
                  <input
                    type="text"
                    value={editForm.address || ''}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Schrankcode</label>
                  <input
                    type="text"
                    value={editForm.cabinet_code || ''}
                    onChange={(e) => setEditForm({ ...editForm, cabinet_code: e.target.value })}
                    placeholder="Ersetzt {CODE} in der Vorlage"
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  />
                </div>
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Abhol-Hinweis für Kund:innen (erscheint bei der Bestellung und in der Bestätigungs-E-Mail)</label>
                  <textarea
                    value={editForm.pickup_instructions || ''}
                    onChange={(e) => setEditForm({ ...editForm, pickup_instructions: e.target.value })}
                    rows={2}
                    placeholder="z.B. Selbstbedienung im Abholschrank – deine Bestellnummer steht auf der Verpackung."
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Abholtage</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-smitten-text">
                      <input type="checkbox" checked={editForm.available_wed ?? true}
                        onChange={(e) => setEditForm({ ...editForm, available_wed: e.target.checked })}
                        className="accent-smitten-primary" />
                      Mittwoch
                    </label>
                    <label className="flex items-center gap-2 text-sm text-smitten-text">
                      <input type="checkbox" checked={editForm.available_sat ?? false}
                        onChange={(e) => setEditForm({ ...editForm, available_sat: e.target.checked })}
                        className="accent-smitten-primary" />
                      Samstag
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-smitten-text/60 mb-1">Benachrichtigungsvorlage</label>
                  <textarea
                    value={editForm.notification_template || ''}
                    onChange={(e) => setEditForm({ ...editForm, notification_template: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-smitten-cream text-sm focus:outline-none focus:ring-2 focus:ring-smitten-accent"
                  />
                  <p className="text-xs text-smitten-text/40 mt-1">
                    Platzhalter: {'{ORDER_NUMBER}'}, {'{PICKUP_LOCATION}'}, {'{CODE}'}, {'{PICKUP_TIME}'}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-smitten-text">
                  <input
                    type="checkbox"
                    checked={editForm.active || false}
                    onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                    className="rounded border-smitten-cream text-smitten-text focus:ring-smitten-accent"
                  />
                  Aktiv
                </label>
                <div className="flex items-center gap-2">
                  <button onClick={saveEdit} className="px-4 py-2 bg-smitten-primary text-white text-sm rounded-lg hover:bg-smitten-primary/90 transition-colors">Speichern</button>
                  <button onClick={cancelEdit} className="px-4 py-2 border border-smitten-cream text-sm rounded-lg text-smitten-text/60 hover:bg-smitten-bg transition-colors">Abbrechen</button>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-smitten-text">{loc.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        loc.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {loc.active ? 'Aktiv' : 'Inaktiv'}
                      </span>
                    </div>
                    <p className="text-xs text-smitten-text/40 mt-0.5">{loc.address}</p>
                    <p className="text-xs text-smitten-text/40">Sortierung: {loc.sort_order}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => startEdit(loc)} className="px-3 py-1.5 bg-smitten-primary text-white text-xs rounded-lg hover:bg-smitten-primary/90 transition-colors">Bearbeiten</button>
                    <button onClick={() => deleteLocation(loc.id)} className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors">Löschen</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
