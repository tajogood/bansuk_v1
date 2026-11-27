"use client";

/* OpenStreetMap 지도 (Leaflet). 점: 원 크기·색으로 값 표시, 마우스를 올리면 정보, 누르면 onSelect.
   대략 위치(approx)인 점은 점선 테두리. 지도 타일은 사용자 브라우저가 OSM에서 직접 받는다. */
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { CircleMarker, LayerGroup, Map as LMap, TileLayer } from "leaflet";

/* OpenStreetMap 기본 타일. 어두운 테마는 CSS 필터로 타일 색을 뒤집어 어둡게 보인다 (bansuk.css .osm). */
export function tileFor(_dark: boolean) {
  return {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  };
}
const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

export type MapPoint = {
  id: string | number;
  lat: number;
  lng: number;
  radius: number;
  color: string;
  tooltip: string; // HTML (이스케이프된 값만 넣는다)
  approx?: boolean;
  label?: string;
};

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export default function OsmMap({
  points,
  selected = null,
  highlight = null,
  onSelect,
  onHover,
  height = 420,
  label,
}: {
  points: MapPoint[];
  selected?: string | number | null;
  highlight?: string | number | null;
  onSelect?: (id: string | number | null) => void;
  onHover?: (id: string | number | null) => void;
  height?: number;
  label?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const markers = useRef<Map<string | number, CircleMarker>>(new Map());
  const L = useRef<typeof import("leaflet") | null>(null);
  const fitted = useRef(false);
  const tiles = useRef<TileLayer | null>(null);
  const cb = useRef({ onSelect, onHover });
  cb.current = { onSelect, onHover };

  // 지도 만들기 (한 번)
  useEffect(() => {
    let dead = false;
    import("leaflet").then((mod) => {
      if (dead || !box.current || map.current) return;
      L.current = mod;
      const m = mod.map(box.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([36.4, 127.8], 7);
      const tf = tileFor(isDark());
      tiles.current = mod.tileLayer(tf.url, { maxZoom: 18, attribution: tf.attribution }).addTo(m);
      // 지도를 눌렀을 때만 휠 확대 (페이지 스크롤을 방해하지 않게)
      m.on("click", () => m.scrollWheelZoom.enable());
      m.on("mouseout", () => m.scrollWheelZoom.disable());
      layer.current = mod.layerGroup().addTo(m);
      map.current = m;
      draw();
    });
    // 테마가 바뀌면 타일만 바꾼다
    const onTheme = () => {
      if (!tiles.current) return;
      tiles.current.setUrl(tileFor(isDark()).url);
    };
    window.addEventListener("bansuk-theme", onTheme);
    return () => {
      dead = true;
      window.removeEventListener("bansuk-theme", onTheme);
      map.current?.remove();
      map.current = null;
      fitted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = () => {
    const mod = L.current;
    const m = map.current;
    if (!mod || !m || !layer.current) return;
    layer.current.clearLayers();
    markers.current.clear();
    const sorted = [...points].sort((a, b) => b.radius - a.radius); // 큰 원을 아래로
    for (const p of sorted) {
      const mk = mod
        .circleMarker([p.lat, p.lng], {
          radius: p.radius,
          color: "#ffffff",
          weight: 2,
          fillColor: p.color,
          fillOpacity: 0.85,
          dashArray: p.approx ? "3 3" : undefined,
        })
        .bindTooltip(p.tooltip, { direction: "auto", offset: [p.radius * 0.6, 0], className: "osm-tip", opacity: 1 })
        .on("click", () => cb.current.onSelect?.(p.id))
        .on("mouseover", () => cb.current.onHover?.(p.id))
        .on("mouseout", () => cb.current.onHover?.(null))
        .addTo(layer.current);
      markers.current.set(p.id, mk);
    }
    if (!fitted.current && points.length) {
      const b = mod.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
      m.fitBounds(b.pad(0.25), { maxZoom: 9 });
      fitted.current = true;
    }
  };

  useEffect(draw, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  // 강조·선택 표시
  useEffect(() => {
    markers.current.forEach((mk, id) => {
      const on = id === highlight || id === selected;
      const dim = (highlight !== null || selected !== null) && !on;
      mk.setStyle({ color: on ? "#e8a900" : "#ffffff", weight: on ? 4 : 2, fillOpacity: dim ? 0.35 : 0.85 });
      if (on) mk.bringToFront();
    });
    if (highlight !== null) markers.current.get(highlight)?.openTooltip();
    else markers.current.forEach((mk) => mk.closeTooltip());
  }, [highlight, selected, points]);

  return <div ref={box} className="osm" style={{ height }} role="region" aria-label={label} />;
}
