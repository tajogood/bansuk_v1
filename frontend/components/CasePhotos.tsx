"use client";

import { useEffect, useRef, useState } from "react";
import { casesApi } from "@/lib/api";
import { fmtDateTime } from "@/lib/cases";
import { useT } from "@/lib/i18n";
import type { CasePhotoItem, NecropsyCase } from "@/lib/types";

const MAX_SIDE = 2560;
const BATCH = 4; // 전파가 약해도 끊기지 않게 몇 장씩 나눠 보낸다

/** 휴대폰 사진을 보내기 전에 줄인다 (보통 5~10MB → 1MB 안팎). 아이폰 HEIC도 JPEG로 바뀐다. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 2_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.88));
  } catch {
    return file; // 브라우저가 못 읽는 형식이면 원본 그대로 보내고 서버가 판단
  }
}

export default function CasePhotos({
  token,
  c,
  canUpload,
  onChange,
}: {
  token: string;
  c: NecropsyCase;
  canUpload: boolean;
  onChange: (c: NecropsyCase) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<number | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const album = useRef<HTMLInputElement>(null);
  const photos = c.photos ?? [];
  const groups: [string, CasePhotoItem[]][] = [
    [t("농장에서 올린 사진"), photos.filter((p) => p.stage === "report")],
    [t("부검 사진"), photos.filter((p) => p.stage === "necropsy")],
  ];

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setError(null);
    const files = Array.from(list);
    let latest: NecropsyCase | null = null;
    const failed: string[] = [];
    for (let i = 0; i < files.length; i += BATCH) {
      setBusy(t("사진 올리는 중 {a}/{b}", { a: Math.min(i + BATCH, files.length), b: files.length }));
      try {
        const blobs = await Promise.all(files.slice(i, i + BATCH).map(shrink));
        latest = await casesApi.uploadPhotos(token, c.id, blobs);
        latest.upload?.failed.forEach((f) => failed.push(f.error));
      } catch (e) {
        failed.push((e as Error).message);
      }
    }
    setBusy(null);
    if (latest) onChange(latest);
    if (failed.length) setError(t("{n}장을 올리지 못했습니다: {msg}", { n: failed.length, msg: failed[0] }));
    if (camera.current) camera.current.value = "";
    if (album.current) album.current.value = "";
  };

  const remove = async (p: CasePhotoItem) => {
    if (!window.confirm(t("이 사진을 지울까요?"))) return;
    onChange(await casesApi.deletePhoto(token, c.id, p.id));
    setView(null);
  };

  useEffect(() => {
    if (view === null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setView(null);
      if (e.key === "ArrowRight") setView((v) => (v === null ? v : Math.min(photos.length - 1, v + 1)));
      if (e.key === "ArrowLeft") setView((v) => (v === null ? v : Math.max(0, v - 1)));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [view, photos.length]);

  const cur = view !== null ? photos[view] : null;

  return (
    <section className="cs-sec">
      <div className="cs-sec-head">
        <h2>{t("사진")}</h2>
        {canUpload && (
          <div className="cs-photo-btns">
            {/* 휴대폰(농장·현장)은 카메라를 쓰고, 데스크탑(반석)은 파일 업로드 하나만 */}
            <button type="button" className="cs-photo-camera" onClick={() => camera.current?.click()} disabled={!!busy}>
              {t("사진 찍기")}
            </button>
            <button type="button" onClick={() => album.current?.click()} disabled={!!busy}>
              {t("업로드하기")}
            </button>
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files)} />
            <input ref={album} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
          </div>
        )}
      </div>
      {busy && <p className="cs-muted">{busy}</p>}
      {error && <p className="warn warn-error">{error}</p>}
      {photos.length === 0 && !busy && <p className="cs-muted">{t("아직 사진이 없습니다.")}</p>}
      {groups.map(([title, list]) =>
        list.length ? (
          <div key={title} className="cs-photo-group">
            <h3>
              {title} <span>{list.length}</span>
            </h3>
            <div className="cs-photos">
              {list.map((p) => (
                <button key={p.id} type="button" className="cs-thumb" onClick={() => setView(photos.indexOf(p))}>
                  <img src={p.thumb} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        ) : null,
      )}
      {cur && (
        <div className="cs-lightbox" role="dialog" aria-modal="true" onClick={() => setView(null)}>
          <img src={cur.full} alt="" onClick={(e) => e.stopPropagation()} />
          <div className="cs-lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setView(Math.max(0, view! - 1))} disabled={view === 0} aria-label={t("이전 사진")}>
              ‹
            </button>
            <span>
              {view! + 1} / {photos.length}
              {cur.taken_at ? ` · ${fmtDateTime(cur.taken_at)}` : ""}
            </span>
            <button type="button" onClick={() => setView(Math.min(photos.length - 1, view! + 1))} disabled={view === photos.length - 1} aria-label={t("다음 사진")}>
              ›
            </button>
            {cur.can_delete && (
              <button type="button" className="cs-danger" onClick={() => remove(cur)}>
                {t("지우기")}
              </button>
            )}
            <button type="button" onClick={() => setView(null)}>
              {t("닫기")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
