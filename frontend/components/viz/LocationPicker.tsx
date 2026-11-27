"use client";

/* 농장 위치 정하기: 주소로 찾거나(OSM Nominatim) 지도를 눌러 핀을 놓는다. 핀은 끌어서 옮길 수 있다. */
import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { CircleMarker, Map as LMap } from "leaflet";
import { useT } from "@/lib/i18n";

export default function LocationPicker({
  lat,
  lng,
  hint,
  onChange,
}: {
  lat: number | null;
  lng: number | null;
  hint: string;
  onChange: (lat: number | null, lng: number | null) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const pin = useRef<CircleMarker | null>(null);
  const L = useRef<typeof import("leaflet") | null>(null);
  const [q, setQ] = useState(hint);
  const [msg, setMsg] = useState<string | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  const place = (la: number, ln: number, pan = false) => {
    const mod = L.current;
    const m = map.current;
    if (!mod || !m) return;
    if (!pin.current) pin.current = mod.circleMarker([la, ln], { radius: 9, color: "#fff", weight: 3, fillColor: "#b42318", fillOpacity: 1 }).addTo(m);
    else pin.current.setLatLng([la, ln]);
    if (pan) m.setView([la, ln], Math.max(m.getZoom(), 12));
  };

  useEffect(() => {
    let dead = false;
    import("leaflet").then((mod) => {
      if (dead || !box.current || map.current) return;
      L.current = mod;
      const m = mod.map(box.current, { scrollWheelZoom: true }).setView(lat !== null && lng !== null ? [lat, lng] : [36.4, 127.8], lat !== null ? 12 : 7);
      mod.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(m);
      m.on("click", (e) => {
        const la = +e.latlng.lat.toFixed(5);
        const ln = +e.latlng.lng.toFixed(5);
        place(la, ln);
        cb.current(la, ln);
      });
      map.current = m;
      if (lat !== null && lng !== null) place(lat, lng);
    });
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
      pin.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    if (!q.trim()) return;
    setMsg(t("찾는 중"));
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(q.trim())}`);
      const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
      if (!j.length) {
        setMsg(t("찾지 못했습니다. 읍·면 이름으로 찾거나 지도를 눌러 정하세요."));
        return;
      }
      const la = +(+j[0].lat).toFixed(5);
      const ln = +(+j[0].lon).toFixed(5);
      place(la, ln, true);
      cb.current(la, ln);
      setMsg(j[0].display_name);
    } catch {
      setMsg(t("주소 찾기에 실패했습니다. 지도를 눌러 정하세요."));
    }
  };

  return (
    <div className="locpick">
      <div className="locpick-bar">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder={t("주소나 읍·면 이름 (예: 음성군 대소면)")}
        />
        <button type="button" className="link-btn" onClick={search}>
          {t("주소로 찾기")}
        </button>
        {lat !== null && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              pin.current?.remove();
              pin.current = null;
              onChange(null, null);
            }}
          >
            {t("위치 지우기")}
          </button>
        )}
      </div>
      <div ref={box} className="osm locpick-map" />
      <p className="locpick-msg">
        {lat !== null && lng !== null ? `${lat}, ${lng}` : t("위치를 정하지 않으면 지역 중심 근처에 대략 표시합니다.")}
        {msg ? ` · ${msg}` : ""}
      </p>
    </div>
  );
}
