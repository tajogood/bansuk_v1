"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPhone } from "@/components/Login";
import { adminApi, loadSession } from "@/lib/api";
import type { AccountStatus, AdminFarm, AdminHouse, AdminUser, AuditItem, FarmConfigIn, Role, Session } from "@/lib/types";
import LangToggle from "@/components/LangToggle";
import NotificationBell from "@/components/NotificationBell";
import { k, locale, tr, useLang } from "@/lib/i18n";
import "../analysis.css";
import "../admin.css";

const ROLE_ORDER: Role[] = ["farm_owner", "bansuk_vet", "bansuk_staff", "admin"];
const ROLE_HELP: Record<Role, string> = {
  farm_owner: k("고른 농장만 보고 입력합니다"),
  bansuk_vet: k("모든 농장, 보고서 발행, 분석기"),
  bansuk_staff: k("모든 농장, 보고서 발행, 분석기"),
  admin: k("위 권한 + 계정·농장 관리"),
};
const STATUS: Record<AccountStatus, string> = {
  active: k("사용 중"),
  temp: k("첫 로그인 전"),
  expired: k("임시 비밀번호 기한 지남"),
  locked: k("잠김"),
  inactive: k("꺼짐"),
};
const DEFAULT_CONFIG: FarmConfigIn = {
  egg_unit: "tray",
  eggs_per_tray: 30,
  grades: ["jumbo", "xl", "l", "m", "s", "double", "mudae", "muzung", "crack"],
  show_feed: true,
  show_water: true,
  show_temp: true,
  show_humidity: true,
  show_egg_weight: false,
  show_cull: false,
};
const SHOW_LABELS: [keyof FarmConfigIn, string][] = [
  ["show_feed", k("사료")],
  ["show_water", k("급수")],
  ["show_temp", k("온도")],
  ["show_humidity", k("습도")],
  ["show_egg_weight", k("난중")],
  ["show_cull", k("도태")],
];

type UserDraft = { id?: number; name: string; phone: string; role: Role; farm_ids: number[]; active: boolean };
type FarmDraft = Omit<AdminFarm, "id" | "accounts" | "config"> & { id?: number; config: FarmConfigIn };
type Issued = { name: string; phone: string; pin: string; reset: boolean };

const fmtTime = (s: string | null) =>
  s ? new Date(s + (s.endsWith("Z") ? "" : "Z")).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "";

export default function AdminPage() {
  const lang = useLang();
  const t = tr;
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"users" | "farms" | "audit">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [farms, setFarms] = useState<AdminFarm[]>([]);
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [importers, setImporters] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft | null>(null);
  const [farmDraft, setFarmDraft] = useState<FarmDraft | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "bansuk" | "farm">("all");
  const [toast, setToast] = useState<string | null>(null);

  const tok = session?.token ?? "";
  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2200);
  };

  const reload = useCallback(async () => {
    if (!tok) return;
    try {
      const [u, f, a] = await Promise.all([adminApi.users(tok), adminApi.farms(tok), adminApi.audit(tok)]);
      setUsers(u.users);
      setFarms(f.farms);
      setGrades(f.grades);
      setImporters(f.importers ?? {});
      setAudit(a.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [tok]);

  useEffect(() => {
    setSession(loadSession());
  }, []);
  useEffect(() => {
    if (session?.user.role === "admin" && !session.user.must_change_pin) reload();
  }, [session, reload, lang]);

  const farmName = useMemo(() => new Map(farms.map((f) => [f.id, f.name])), [farms]);
  const shownUsers = users.filter((u) => {
    if (roleFilter === "farm" && u.role !== "farm_owner") return false;
    if (roleFilter === "bansuk" && u.role === "farm_owner") return false;
    if (!q) return true;
    const hay = `${u.name} ${u.phone} ${u.farm_ids.map((id) => farmName.get(id)).join(" ")}`;
    return hay.includes(q) || u.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "") || "\u0000");
  });

  // ---------- 계정 ----------
  const saveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userDraft) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = { name: userDraft.name, phone: userDraft.phone, role: userDraft.role, farm_ids: userDraft.farm_ids };
      if (userDraft.id) {
        await adminApi.updateUser(tok, userDraft.id, { ...body, active: userDraft.active });
        flash(t("계정을 고쳤습니다"));
      } else {
        const r = await adminApi.createUser(tok, body);
        setIssued({ name: r.user.name, phone: r.user.phone, pin: r.temp_pin, reset: false });
      }
      setUserDraft(null);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resetPin = async (u: AdminUser) => {
    if (!window.confirm(t("{name}님의 비밀번호를 초기화할까요? 지금 로그인된 기기에서도 로그아웃됩니다.", { name: u.name }))) return;
    const r = await adminApi.resetPin(tok, u.id);
    setIssued({ name: u.name, phone: u.phone, pin: r.temp_pin, reset: true });
    reload();
  };
  const unlock = async (u: AdminUser) => {
    await adminApi.unlock(tok, u.id);
    flash(t("잠금을 풀었습니다"));
    reload();
  };

  // ---------- 농장 ----------
  const saveFarm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmDraft) return;
    setBusy(true);
    setFormError(null);
    try {
      const body = {
        name: farmDraft.name,
        region: farmDraft.region || null,
        contract_type: farmDraft.contract_type,
        active: farmDraft.active,
        importer: farmDraft.importer || null,
        houses: farmDraft.houses.filter((h) => h.name.trim()),
        config: farmDraft.config,
      };
      if (farmDraft.id) await adminApi.updateFarm(tok, farmDraft.id, body);
      else await adminApi.createFarm(tok, body);
      flash(farmDraft.id ? t("농장을 고쳤습니다") : t("농장을 만들었습니다"));
      setFarmDraft(null);
      reload();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patchHouse = (i: number, p: Partial<AdminHouse>) =>
    farmDraft && setFarmDraft({ ...farmDraft, houses: farmDraft.houses.map((h, k) => (k === i ? { ...h, ...p } : h)) });
  const moveHouse = (i: number, d: -1 | 1) => {
    if (!farmDraft) return;
    const hs = [...farmDraft.houses];
    const j = i + d;
    if (j < 0 || j >= hs.length) return;
    [hs[i], hs[j]] = [hs[j], hs[i]];
    setFarmDraft({ ...farmDraft, houses: hs });
  };
  const toggleGrade = (g: string) => {
    if (!farmDraft) return;
    const order = Object.keys(grades);
    const cur = farmDraft.config.grades;
    const next = cur.includes(g) ? cur.filter((x) => x !== g) : order.filter((x) => cur.includes(x) || x === g);
    setFarmDraft({ ...farmDraft, config: { ...farmDraft.config, grades: next } });
  };

  const copyIssued = async () => {
    if (!issued) return;
    const text = t(
      issued.reset
        ? "[반석 생산 기록] {name}님 계정 비밀번호가 초기화되었습니다.\n아이디: {phone}\n임시 비밀번호: {pin}\n7일 안에 로그인해 새 비밀번호를 정해 주세요."
        : "[반석 생산 기록] {name}님 계정이 만들어졌습니다.\n아이디: {phone}\n임시 비밀번호: {pin}\n7일 안에 로그인해 새 비밀번호를 정해 주세요.",
      { name: issued.name, phone: issued.phone, pin: issued.pin },
    );
    try {
      await navigator.clipboard.writeText(text);
      flash(t("안내 문구를 복사했습니다"));
    } catch {
      flash(t("복사하지 못했습니다. 직접 알려 주세요"));
    }
  };

  if (!session)
    return (
      <main className="an-wrap">
        <p className="an-pad">
          {t("로그인이 필요합니다.")} <a href="/">{t("로그인하기")}</a>
        </p>
      </main>
    );
  if (session.user.role !== "admin")
    return (
      <main className="an-wrap">
        <p className="an-pad">{t("반석 관리자 계정에서만 쓸 수 있습니다.")}</p>
      </main>
    );

  const farmOwnerCount = (fid: number) => users.filter((u) => u.farm_ids.includes(fid) && u.status !== "inactive").length;

  return (
    <main className="an-wrap">
      <header className="an-head">
        <a href="/" className="an-back">‹ {t("생산 기록")}</a>
        <h1>{t("계정·농장 관리")}</h1>
        <span className="an-spacer" />
        <span className="an-muted">{session.user.name}</span>
        <LangToggle />
        <NotificationBell token={session.token} />
      </header>
      <nav className="ad-tabs" role="tablist">
        {(
          [
            ["users", t("계정 {n}", { n: users.length })],
            ["farms", t("농장 {n}", { n: farms.length })],
            ["audit", t("변경 기록")],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
      {error && <p className="an-error an-pad">{error}</p>}

      <div className="ad-body">
        {tab === "users" && (
          <section className="an-card">
            <div className="ad-toolbar">
              <input className="ad-search" placeholder={t("이름, 번호, 농장으로 찾기")} value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="an-seg ad-seg">
                {(
                  [
                    ["all", t("전체")],
                    ["bansuk", t("반석")],
                    ["farm", t("농장")],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={roleFilter === k} onClick={() => setRoleFilter(k)}>
                    {l}
                  </button>
                ))}
              </div>
              <span className="an-spacer" />
              <button
                type="button"
                className="ad-btn an-primary"
                onClick={() => {
                  setFormError(null);
                  setUserDraft({ name: "", phone: "", role: "farm_owner", farm_ids: [], active: true });
                }}
              >
                {t("계정 만들기")}
              </button>
            </div>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>{t("이름")}</th>
                  <th>{t("역할")}</th>
                  <th>{t("휴대폰")}</th>
                  <th>{t("농장")}</th>
                  <th>{t("상태")}</th>
                  <th>{t("마지막 로그인")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownUsers.map((u) => (
                  <tr key={u.id} className={u.status === "inactive" ? "is-off" : ""}>
                    <td className="strong">{u.name}</td>
                    <td>{u.role_label}</td>
                    <td className="num">{formatPhone(u.phone)}</td>
                    <td>{u.role === "farm_owner" ? u.farm_ids.map((id) => farmName.get(id)).join(", ") : <span className="an-muted">{t("전체")}</span>}</td>
                    <td>
                      <span className={`ad-badge s-${u.status}`}>{t(STATUS[u.status])}</span>
                    </td>
                    <td className="an-muted">{fmtTime(u.last_login_at)}</td>
                    <td className="ad-actions">
                      <button
                        type="button"
                        className="an-mini"
                        onClick={() => {
                          setFormError(null);
                          setUserDraft({ id: u.id, name: u.name, phone: formatPhone(u.phone), role: u.role, farm_ids: u.farm_ids, active: u.status !== "inactive" });
                        }}
                      >
                        {t("고치기")}
                      </button>
                      {u.status === "locked" && (
                        <button type="button" className="an-mini" onClick={() => unlock(u)}>
                          {t("잠금 풀기")}
                        </button>
                      )}
                      {u.status !== "inactive" && (
                        <button type="button" className="an-mini" onClick={() => resetPin(u)}>
                          {t("비밀번호 초기화")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shownUsers.length && <p className="an-empty">{t("찾는 계정이 없습니다.")}</p>}
          </section>
        )}

        {tab === "farms" && (
          <section className="an-card">
            <div className="ad-toolbar">
              <span className="an-muted">{t("계사와 입력 항목은 농장마다 다르게 정할 수 있습니다. 농장주 입력 화면이 그대로 따라갑니다.")}</span>
              <span className="an-spacer" />
              <button
                type="button"
                className="ad-btn an-primary"
                onClick={() => {
                  setFormError(null);
                  setFarmDraft({ name: "", region: "", contract_type: "program", active: true, importer: null, houses: [{ name: t("{n}동", { n: 1 }), kind: "laying", active: true }], config: DEFAULT_CONFIG });
                }}
              >
                {t("농장 만들기")}
              </button>
            </div>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>{t("농장")}</th>
                  <th>{t("지역")}</th>
                  <th>{t("계약")}</th>
                  <th>{t("계사")}</th>
                  <th>{t("농장 계정")}</th>
                  <th>{t("상태")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {farms.map((f) => (
                  <tr key={f.id} className={f.active ? "" : "is-off"}>
                    <td className="strong">{f.name}</td>
                    <td>{f.region}</td>
                    <td>{f.contract_type === "program" ? t("백신프로그램") : t("검사만")}</td>
                    <td>
                      {f.houses.filter((h) => h.active).map((h) => h.name).join(", ")}
                    </td>
                    <td>
                      {farmOwnerCount(f.id) ? (
                        f.accounts.map((a) => a.name).join(", ")
                      ) : (
                        <button
                          type="button"
                          className="an-mini"
                          onClick={() => {
                            setTab("users");
                            setFormError(null);
                            setUserDraft({ name: "", phone: "", role: "farm_owner", farm_ids: [f.id], active: true });
                          }}
                        >
                          {t("계정 만들기")}
                        </button>
                      )}
                    </td>
                    <td>
                      <span className={`ad-badge ${f.active ? "s-active" : "s-inactive"}`}>{f.active ? t("운영 중") : t("꺼짐")}</span>
                    </td>
                    <td className="ad-actions">
                      <button
                        type="button"
                        className="an-mini"
                        onClick={() => {
                          setFormError(null);
                          setFarmDraft({ id: f.id, name: f.name, region: f.region ?? "", contract_type: f.contract_type, active: f.active, importer: f.importer, houses: f.houses, config: f.config ?? DEFAULT_CONFIG });
                        }}
                      >
                        {t("고치기")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === "audit" && (
          <section className="an-card">
            <p className="an-muted ad-note">{t("계정과 농장을 누가 언제 바꿨는지 남습니다. 비밀번호 값은 어디에도 남지 않습니다.")}</p>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>{t("시각")}</th>
                  <th>{t("한 사람")}</th>
                  <th>{t("내용")}</th>
                  <th>{t("대상")}</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a, i) => (
                  <tr key={i}>
                    <td className="an-muted num">{fmtTime(a.at)}</td>
                    <td>{a.actor ?? t("시스템")}</td>
                    <td>{a.action}</td>
                    <td>{a.target}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {/* ---------- 계정 편집 패널 ---------- */}
      {userDraft && (
        <div className="ad-drawer-bg" onClick={() => setUserDraft(null)}>
          <form className="ad-drawer" onClick={(e) => e.stopPropagation()} onSubmit={saveUser}>
            <h2>{userDraft.id ? t("계정 고치기") : t("계정 만들기")}</h2>
            <label>
              {t("이름")}
              <input value={userDraft.name} onChange={(e) => setUserDraft({ ...userDraft, name: e.target.value })} required autoFocus />
            </label>
            <label>
              {t("휴대폰 번호 (로그인 아이디)")}
              <input type="tel" value={userDraft.phone} onChange={(e) => setUserDraft({ ...userDraft, phone: formatPhone(e.target.value) })} placeholder="010-0000-0000" required />
            </label>
            <fieldset>
              <legend>{t("역할")}</legend>
              {ROLE_ORDER.map((r) => (
                <label key={r} className="ad-radio">
                  <input type="radio" name="role" checked={userDraft.role === r} onChange={() => setUserDraft({ ...userDraft, role: r })} />
                  <span>
                    <b>{{ farm_owner: t("농장"), bansuk_vet: t("수의사·연구원"), bansuk_staff: t("반석 직원"), admin: t("반석 관리자") }[r]}</b>
                    <small>{t(ROLE_HELP[r])}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {userDraft.role === "farm_owner" && (
              <fieldset>
                <legend>{t("볼 수 있는 농장")}</legend>
                <div className="an-checks">
                  {farms
                    .filter((f) => f.active || userDraft.farm_ids.includes(f.id))
                    .map((f) => (
                      <label key={f.id} className="an-check">
                        <input
                          type="checkbox"
                          checked={userDraft.farm_ids.includes(f.id)}
                          onChange={(e) =>
                            setUserDraft({
                              ...userDraft,
                              farm_ids: e.target.checked ? [...userDraft.farm_ids, f.id] : userDraft.farm_ids.filter((x) => x !== f.id),
                            })
                          }
                        />
                        {f.name}
                      </label>
                    ))}
                </div>
                {!farms.length && <p className="an-muted">{t("먼저 농장 탭에서 농장을 만들어 주세요.")}</p>}
              </fieldset>
            )}
            {userDraft.id && (
              <label className="an-check">
                <input type="checkbox" checked={userDraft.active} onChange={(e) => setUserDraft({ ...userDraft, active: e.target.checked })} />
                {t("사용 (끄면 바로 로그아웃되고 로그인할 수 없습니다)")}
              </label>
            )}
            {!userDraft.id && <p className="an-muted">{t("저장하면 임시 비밀번호(숫자 6자리)가 한 번 나옵니다. 본인이 첫 로그인 때 새 비밀번호를 정합니다.")}</p>}
            {formError && <p className="an-error">{formError}</p>}
            <div className="an-actions">
              <button type="button" onClick={() => setUserDraft(null)}>
                {t("취소")}
              </button>
              <button type="submit" className="an-primary" disabled={busy}>
                {userDraft.id ? t("저장") : t("계정 만들기")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------- 농장 편집 패널 ---------- */}
      {farmDraft && (
        <div className="ad-drawer-bg" onClick={() => setFarmDraft(null)}>
          <form className="ad-drawer ad-drawer-wide" onClick={(e) => e.stopPropagation()} onSubmit={saveFarm}>
            <h2>{farmDraft.id ? t("농장 고치기") : t("농장 만들기")}</h2>
            <div className="an-row">
              <label>
                {t("농장 이름")}
                <input value={farmDraft.name} onChange={(e) => setFarmDraft({ ...farmDraft, name: e.target.value })} required autoFocus />
              </label>
              <label>
                {t("지역")}
                <input value={farmDraft.region ?? ""} onChange={(e) => setFarmDraft({ ...farmDraft, region: e.target.value })} placeholder={t("충북 음성")} />
              </label>
            </div>
            <div className="an-row">
              <label>
                {t("계약")}
                <select value={farmDraft.contract_type} onChange={(e) => setFarmDraft({ ...farmDraft, contract_type: e.target.value as FarmDraft["contract_type"] })}>
                  <option value="program">{t("백신프로그램 운영")}</option>
                  <option value="test_only">{t("검사만 의뢰")}</option>
                </select>
              </label>
              <label className="an-check ad-inline">
                <input type="checkbox" checked={farmDraft.active} onChange={(e) => setFarmDraft({ ...farmDraft, active: e.target.checked })} />
                {t("운영 중")}
              </label>
            </div>

            <label>
              {t("엑셀 양식 (농장주 업로드용)")}
              <select value={farmDraft.importer ?? ""} onChange={(e) => setFarmDraft({ ...farmDraft, importer: e.target.value || null })}>
                <option value="">{t("없음 (직접 입력만)")}</option>
                {Object.entries(importers).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              <small className="an-muted">{t("새 농장 양식은 개발해서 이 목록에 추가합니다.")}</small>
            </label>
            <fieldset>
              <legend>{t("계사 (농장주 입력 화면의 순서)")}</legend>
              <div className="ad-houses">
                {farmDraft.houses.map((h, i) => (
                  <div key={h.id ?? `n${i}`} className={`ad-house ${h.active ? "" : "is-off"}`}>
                    <input value={h.name} onChange={(e) => patchHouse(i, { name: e.target.value })} aria-label={t("계사 이름")} />
                    <select value={h.kind} onChange={(e) => patchHouse(i, { kind: e.target.value as AdminHouse["kind"] })} aria-label={t("종류")}>
                      <option value="laying">{t("산란")}</option>
                      <option value="rearing">{t("육성")}</option>
                    </select>
                    <button type="button" className="an-mini" onClick={() => moveHouse(i, -1)} disabled={i === 0} aria-label={t("위로")}>↑</button>
                    <button type="button" className="an-mini" onClick={() => moveHouse(i, 1)} disabled={i === farmDraft.houses.length - 1} aria-label={t("아래로")}>↓</button>
                    {h.id ? (
                      <button type="button" className="an-mini" onClick={() => patchHouse(i, { active: !h.active })}>
                        {h.active ? t("끄기") : t("켜기")}
                      </button>
                    ) : (
                      <button type="button" className="an-mini an-danger" onClick={() => setFarmDraft({ ...farmDraft, houses: farmDraft.houses.filter((_, k) => k !== i) })}>
                        {t("빼기")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="an-mini ad-add"
                onClick={() => setFarmDraft({ ...farmDraft, houses: [...farmDraft.houses, { name: t("{n}동", { n: farmDraft.houses.length + 1 }), kind: "laying", active: true }] })}
              >
                {t("계사 추가")}
              </button>
              <p className="an-muted">{t("기록이 있는 계사는 지우지 않고 끕니다.")}</p>
            </fieldset>

            <fieldset>
              <legend>{t("입력 항목")}</legend>
              <div className="an-row">
                <label>
                  {t("산란 수 단위")}
                  <select
                    value={farmDraft.config.egg_unit}
                    onChange={(e) => setFarmDraft({ ...farmDraft, config: { ...farmDraft.config, egg_unit: e.target.value as "tray" | "egg" } })}
                  >
                    <option value="tray">{t("판")}</option>
                    <option value="egg">{t("개")}</option>
                  </select>
                </label>
                <label>
                  {t("한 판에 알")}
                  <input
                    inputMode="numeric"
                    value={farmDraft.config.eggs_per_tray}
                    disabled={farmDraft.config.egg_unit !== "tray"}
                    onChange={(e) => setFarmDraft({ ...farmDraft, config: { ...farmDraft.config, eggs_per_tray: Number(e.target.value.replace(/\D/g, "")) || 30 } })}
                  />
                </label>
              </div>
              <span className="ad-sub">{t("규격 (농장이 실제로 나누는 것만)")}</span>
              <div className="ad-chips">
                {Object.entries(grades).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={farmDraft.config.grades.includes(k)} onClick={() => toggleGrade(k)}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="ad-sub">{t("그 밖에 매일 적는 것")}</span>
              <div className="ad-chips">
                {SHOW_LABELS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={Boolean(farmDraft.config[k])}
                    onClick={() => setFarmDraft({ ...farmDraft, config: { ...farmDraft.config, [k]: !farmDraft.config[k] } })}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </fieldset>
            {formError && <p className="an-error">{formError}</p>}
            <div className="an-actions">
              <button type="button" onClick={() => setFarmDraft(null)}>
                {t("취소")}
              </button>
              <button type="submit" className="an-primary" disabled={busy}>
                {farmDraft.id ? t("저장") : t("농장 만들기")}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------- 임시 비밀번호 안내 ---------- */}
      {issued && (
        <div className="ad-drawer-bg ad-center">
          <div className="ad-issued" role="dialog" aria-modal="true" aria-labelledby="issued-title">
            <h2 id="issued-title">
              {t(issued.reset ? "{name}님 비밀번호를 초기화했습니다" : "{name}님 계정을 만들었습니다", { name: issued.name })}
            </h2>
            <dl>
              <dt>{t("아이디")}</dt>
              <dd className="num">{formatPhone(issued.phone)}</dd>
              <dt>{t("임시 비밀번호")}</dt>
              <dd className="ad-pin num">{issued.pin}</dd>
            </dl>
            <p>
              {t("이 번호는 지금 한 번만 보입니다. 본인에게 알려 주세요. 7일 안에 로그인해 새 비밀번호를 정해야 하고, 지나면 다시 초기화해야 합니다.")}
            </p>
            <div className="an-actions">
              <button type="button" onClick={copyIssued}>
                {t("안내 문구 복사")}
              </button>
              <button type="button" className="an-primary" onClick={() => setIssued(null)}>
                {t("확인했습니다")}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
