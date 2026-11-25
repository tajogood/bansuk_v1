"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import Keypad from "./Keypad";
import { buildFields, display, toApi, type Field } from "@/lib/fields";
import { num } from "@/lib/format";
import type { HouseView, InputConfig, Warning } from "@/lib/types";

type Props = {
  view: HouseView;
  config: InputConfig;
  position: { index: number; total: number };
  saving: boolean;
  onBack: () => void;
  onSave: (body: Record<string, number | string | null>) => void;
};

export default function HouseEntry({ view, config, position, saving, onBack, onSave }: Props) {
  const t = useT();
  const fields = useMemo(() => buildFields(config, view.house.kind), [config, view.house.kind]);
  const initial = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of fields) v[f.key] = display(f, view.record);
    return v;
  }, [fields, view.record]);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [active, setActive] = useState(0);
  const [fresh, setFresh] = useState(true); // 칸에 들어온 직후 첫 입력은 기존 값을 덮어쓴다
  const [memo, setMemo] = useState<string>((view.record?.memo as string) ?? "");
  const [memoOpen, setMemoOpen] = useState(false);
  const [confirmMissing, setConfirmMissing] = useState<string[] | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setValues(initial);
    setActive(0);
    setFresh(true);
    setMemo((view.record?.memo as string) ?? "");
  }, [initial, view.record]);

  useEffect(() => {
    rowRefs.current[active]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  const field = fields[active];
  const prevStr = (f: Field) => display(f, view.previous);

  const setField = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));
  const go = (i: number) => {
    setActive(Math.max(0, Math.min(fields.length - 1, i)));
    setFresh(true);
  };

  const onDigit = (d: string) => {
    if (d === "." && !field.decimal) return;
    const cur = fresh ? "" : values[field.key];
    if (d === "." && cur.includes(".")) return;
    if (cur.replace(".", "").length >= 7) return;
    const next = cur === "0" && d !== "." ? d : cur + d;
    setField(field.key, next);
    setFresh(false);
  };
  const onBackspace = () => {
    setField(field.key, fresh ? "" : values[field.key].slice(0, -1));
    setFresh(false);
  };
  const onPrevious = () => {
    const p = prevStr(field);
    if (p === "") return;
    setField(field.key, p);
    next();
  };
  const isLast = active === fields.length - 1;
  const next = () => {
    if (active < fields.length - 1) go(active + 1);
    else save();
  };

  // 필수 칸이 비었으면 한 번 확인한다. 다 채웠으면 묻지 않는다.
  const save = () => {
    const missing = fields.filter((f) => !f.optional && values[f.key] === "").map((f) => f.label);
    if (missing.length && confirmMissing === null) {
      setConfirmMissing(missing);
      return;
    }
    doSave();
  };

  const doSave = () => {
    setConfirmMissing(null);
    const body: Record<string, number | string | null> = {};
    for (const f of fields) body[f.key] = toApi(f, values[f.key]);
    body.memo = memo.trim() === "" ? null : memo.trim();
    onSave(body);
  };

  // 실시간 요약: 총 산란, 예상 수수, 산란율
  const live = useMemo(() => {
    // 산란율은 모든 규격을 넣은 뒤에만 보여준다 (일부만 넣은 상태의 낮은 값은 오해를 부른다)
    const eggFields = fields.filter((f) => f.isEgg);
    let eggs = 0;
    for (const f of eggFields) eggs += toApi(f, values[f.key]) ?? 0;
    const allEggs = eggFields.length > 0 && eggFields.every((f) => values[f.key] !== "");
    const anyEgg = eggFields.some((f) => values[f.key] !== "");
    const intOf = (k: string) => (values[k] ? Math.round(Number(values[k])) : 0);
    const start = view.expected_start_count;
    const birds = start !== null ? start - intOf("mortality") - intOf("cull") : null;
    const rate = allEggs && birds ? (eggs / birds) * 100 : null;
    const feed = values.feed_kg ? Number(values.feed_kg) : null;
    const feedPerBird = feed !== null && birds ? (feed * 1000) / birds : null;
    return { eggs: anyEgg ? eggs : null, birds, rate, allEggs, hasEggs: eggFields.length > 0, feedPerBird };
  }, [fields, values, view.expected_start_count]);

  const prevRate = view.previous?.metrics.lay_rate ?? null;
  const liveWarnings: Warning[] = [];
  if (live.rate !== null && live.rate > 100)
    liveWarnings.push({ level: "error", code: "lay_over_100", message: t("산란율이 100%를 넘습니다. 판 수를 확인해 주세요.") });

  const filledRequired = fields.filter((f) => !f.optional && values[f.key] !== "").length;
  const totalRequired = fields.filter((f) => !f.optional).length;

  return (
    <div className="entry">
      <header className="entry-head">
        <button type="button" className="back" onClick={onBack} aria-label={t("동 목록으로")}>
          ‹
        </button>
        <div className="entry-title">
          <h1>{view.house.name}</h1>
          <p>
            {view.flock ? t("{w}주령 ({d}일령)", { w: view.flock.age_weeks, d: view.flock.age_days }) : t("계군 정보 없음")}
            {view.expected_start_count !== null && <span className="sep">{t("{n}수", { n: num(view.expected_start_count) })}</span>}
          </p>
        </div>
        <span className="entry-pos">
          {position.index + 1}/{position.total}
        </span>
      </header>

      <ol className="fields">
        {fields.map((f, i) => {
          const v = values[f.key];
          const p = prevStr(f);
          const first = f.optional && !fields[i - 1]?.optional;
          return (
            <li key={f.key}>
              {first && <div className="optional-head">{t("선택 항목 (비워 두어도 됩니다)")}</div>}
              <button
                type="button"
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className={`field ${i === active ? "is-active" : ""} ${v !== "" ? "is-filled" : ""}`}
                onClick={() => go(i)}
              >
                <span className="field-label">{f.label}</span>
                <span className="field-prev">{p !== "" ? t("어제 {v}", { v: num(Number(p), 1) }) : ""}</span>
                <span className="field-value">
                  {v !== "" ? num(Number(v), 1) : <span className="placeholder">{p !== "" ? num(Number(p), 1) : "0"}</span>}
                  {i === active && !fresh && <span className="caret" aria-hidden />}
                </span>
                <span className="field-unit">{f.unit}</span>
              </button>
            </li>
          );
        })}
        <li>
          {memoOpen ? (
            <textarea
              className="memo"
              value={memo}
              autoFocus
              placeholder={t("특이사항 (예: 2층 급수기 고장, 오후 정전)")}
              onChange={(e) => setMemo(e.target.value)}
              onBlur={() => setMemoOpen(memo !== "")}
            />
          ) : (
            <button type="button" className="memo-open" onClick={() => setMemoOpen(true)}>
              {memo ? t("메모: {memo}", { memo }) : t("메모 남기기")}
            </button>
          )}
        </li>
      </ol>

      <section className="summary" aria-live="polite">
        {live.hasEggs ? (
          <>
            <div>
              <span className="summary-label">{t("총 산란")}</span>
              <strong>{live.eggs !== null ? t("{n}개", { n: num(live.eggs) }) : "–"}</strong>
            </div>
            <div>
              <span className="summary-label">{t("산란율")}</span>
              <strong className={live.rate !== null && live.rate > 100 ? "is-bad" : ""}>
                {live.rate !== null ? `${live.rate.toFixed(1)}%` : live.eggs !== null ? t("입력 중") : "–"}
              </strong>
              {prevRate !== null && <span className="summary-prev">{t("어제 {v}", { v: `${prevRate.toFixed(1)}%` })}</span>}
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="summary-label">{t("현재 수수")}</span>
              <strong>{live.birds !== null ? `${num(live.birds)}` : "–"}</strong>
            </div>
            <div>
              <span className="summary-label">{t("수당 사료")}</span>
              <strong>{live.feedPerBird !== null ? `${live.feedPerBird.toFixed(1)}g` : "–"}</strong>
            </div>
          </>
        )}
        <button
          type="button"
          className={`summary-save ${filledRequired === totalRequired ? "is-ready" : ""}`}
          onClick={save}
          disabled={saving}
        >
          <span className="summary-label">
            {t("필수 {a}/{b}", { a: filledRequired, b: totalRequired })}
          </span>
          <strong>{saving ? t("저장 중") : t("저장")}</strong>
        </button>
      </section>
      {confirmMissing && (
        <div className="confirm" role="alertdialog" aria-label={t("빈 칸 확인")}>
          <p>
            {t("{fields} 칸이 비어 있습니다. 비운 채로 저장할까요?", { fields: confirmMissing.join(", ") })}
          </p>
          <div className="confirm-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                const i = fields.findIndex((f) => f.label === confirmMissing[0]);
                setConfirmMissing(null);
                go(i);
              }}
            >
              {t("채우러 가기")}
            </button>
            <button type="button" className="btn-primary" onClick={doSave}>
              {t("비운 채로 저장")}
            </button>
          </div>
        </div>
      )}
      {liveWarnings.map((w) => (
        <p key={w.code} className={`warn warn-${w.level}`}>
          {w.message}
        </p>
      ))}

      <Keypad
        allowDecimal={field.decimal}
        hasPrevious={prevStr(field) !== ""}
        isLast={isLast}
        saving={saving}
        onDigit={onDigit}
        onBackspace={onBackspace}
        onClear={() => setField(field.key, "")}
        onPrevious={onPrevious}
        onBack={() => go(active - 1)}
        onNext={next}
      />
    </div>
  );
}
