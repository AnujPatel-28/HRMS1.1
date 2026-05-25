import { useCallback, useEffect, useState } from "react";
import { Building2, MapPin, Plus, Save, X } from "lucide-react";
import { db } from "../insforge/client";
import { useTenant } from "../contexts/TenantContext";
import { useAuditLog } from "../hooks/useAuditLog";
import { Skeleton } from "../shared/Skeleton";
import { useToast } from "../shared/ToastContext";
import LocationMap from "../shared/LocationMap";

type OfficeLocationRow = {
  id: string;
  tenant_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_meters: number;
  is_active: boolean;
  updated_at: string;
};

export default function OfficeLocations() {
  const { tenantId } = useTenant();
  const { logAction } = useAuditLog();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<OfficeLocationRow[]>([]);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editUpdatedAt, setEditUpdatedAt] = useState<string | null>(null);
  
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radiusMeters, setRadiusMeters] = useState("500");

  const loadLocations = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await db
        .from("office_locations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      setLocations((data ?? []) as OfficeLocationRow[]);
    } catch (err) {
      console.error(err);
      toastError("Failed to load office locations.");
    } finally {
      setLoading(false);
    }
  }, [tenantId, toastError]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations]);

  function openModal(loc?: OfficeLocationRow) {
    if (loc) {
      setEditId(loc.id);
      setEditUpdatedAt(loc.updated_at);
      setName(loc.name);
      setLat(String(loc.lat));
      setLng(String(loc.lng));
      setRadiusMeters(String(loc.radius_meters));
    } else {
      setEditId(null);
      setEditUpdatedAt(null);
      setName("");
      setLat("");
      setLng("");
      setRadiusMeters("500");
    }
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
  }

  async function saveLocation() {
    if (!tenantId) return;
    if (!name.trim() || !lat || !lng || !radiusMeters) {
      toastError("Please fill all required fields.");
      return;
    }

    setSaving(true);
    try {
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);
      const parsedRadius = parseInt(radiusMeters, 10);
      
      if (isNaN(parsedLat) || isNaN(parsedLng) || isNaN(parsedRadius)) {
        throw new Error("Invalid number format for latitude, longitude, or radius.");
      }

      if (editId) {
        // Update
        const { error: updateError } = await db
          .from("office_locations")
          .update({
            name: name.trim(),
            lat: parsedLat,
            lng: parsedLng,
            radius_meters: parsedRadius,
          })
          .eq("tenant_id", tenantId)
          .eq("id", editId)
          .eq("updated_at", editUpdatedAt);
        if (updateError) throw updateError;
        
        const loc = locations.find(l => l.id === editId);
        void logAction("office_location.updated", "office_locations", editId, {
          location_id: editId,
          name: name.trim(),
          changes_diff: {
            old_name: loc?.name,
            new_name: name.trim(),
            old_lat: loc?.lat,
            new_lat: parsedLat,
            old_lng: loc?.lng,
            new_lng: parsedLng,
            old_radius: loc?.radius_meters,
            new_radius: parsedRadius,
          },
          severity: "INFO",
        });
        success("Office location updated.");
      } else {
        // Insert
        const { data, error: insertError } = await db
          .from("office_locations")
          .insert([{
            tenant_id: tenantId,
            name: name.trim(),
            lat: parsedLat,
            lng: parsedLng,
            radius_meters: parsedRadius,
          }])
          .select("id")
          .maybeSingle();
        if (insertError) throw insertError;
        
        if (data) {
          void logAction("office_location.created", "office_locations", data.id, {
            location_id: data.id,
            name: name.trim(),
            lat: parsedLat,
            lng: parsedLng,
            radius_meters: parsedRadius,
            severity: "INFO",
          });
        }
        success("Office location created.");
      }
      
      closeModal();
      void loadLocations();
    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("office_locations_tenant_name_idx")) {
        toastError("An office location with this name already exists.");
      } else {
        toastError(err.message || "Failed to save office location.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deactivateLocation(loc: OfficeLocationRow) {
    if (!window.confirm(`Are you sure you want to deactivate ${loc.name}? This will remove it from geo-fence validation.`)) {
      return;
    }
    
    try {
      const { error } = await db
        .from("office_locations")
        .update({ is_active: false })
        .eq("tenant_id", tenantId)
        .eq("id", loc.id)
        .eq("updated_at", loc.updated_at);
      if (error) throw error;
      
      void logAction("office_location.deactivated", "office_locations", loc.id, {
        location_id: loc.id,
        name: loc.name,
        reason: "User requested soft-delete",
        severity: "WARNING",
      });
      
      success("Office location deactivated.");
      void loadLocations();
    } catch (err) {
      console.error(err);
      toastError("Failed to deactivate office location.");
    }
  }

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const isValidLocation = !isNaN(parsedLat) && !isNaN(parsedLng);

  if (loading) {
    return (
      <section className="space-y-5">
        <Skeleton className="h-16 w-72" />
        <Skeleton className="h-[400px] w-full rounded-2xl" />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <Building2 className="h-6 w-6 text-brand-600" />
            Office Locations
          </h2>
          <p className="mt-1 text-sm text-slate-500">Manage geo-fenced office locations for attendance tracking.</p>
        </div>
        <button
          onClick={() => openModal()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-95"
        >
          <Plus className="h-4 w-4" /> Add Location
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {locations.map((loc) => (
          <div key={loc.id} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
            <div className="h-32 w-full bg-slate-100">
              <LocationMap lat={loc.lat} lng={loc.lng} label={loc.name} accuracy={null} />
            </div>
            <div className="flex flex-1 flex-col p-5">
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-900">{loc.name}</h3>
                  <div className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin className="h-3 w-3" />
                    <span>{loc.lat}, {loc.lng}</span>
                  </div>
                </div>
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                  {loc.radius_meters}m
                </span>
              </div>
              
              <div className="mt-auto flex gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={() => openModal(loc)}
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => void deactivateLocation(loc)}
                  className="flex-1 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}

        {locations.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center">
            <Building2 className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="text-lg font-semibold text-slate-900">No office locations</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-500">Add an office location to enable multi-branch geo-fencing for attendance.</p>
            <button
              onClick={() => openModal()}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              <Plus className="h-4 w-4" /> Add Location
            </button>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <h3 className="text-lg font-bold text-slate-900">{editId ? "Edit Location" : "Add Location"}</h3>
              <button onClick={closeModal} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto">
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Office Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Headquarters, Bangalore Branch"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="e.g. 12.9716"
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                      placeholder="e.g. 77.5946"
                      className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Radius (meters)</label>
                  <input
                    type="number"
                    min={0}
                    value={radiusMeters}
                    onChange={(e) => setRadiusMeters(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none transition focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>

                {isValidLocation && (
                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">Preview</div>
                    <div className="h-48 w-full p-0">
                      <LocationMap lat={parsedLat} lng={parsedLng} label={name || "Office"} accuracy={null} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 shrink-0">
              <button
                onClick={closeModal}
                disabled={saving}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveLocation()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save Location"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
