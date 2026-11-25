"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPhone } from "@/components/Login";
import { adminApi, loadSession } from "@/lib/api";
import type { AccountStatus, AdminFarm, AdminHouse, AdminUser, AuditItem, FarmConfigIn, Role, Session } from "@/lib/types";
import "../analysis.css";
import "../admin.css";

const ROLE_ORDER: Role[] = ["farm_owner", "bansuk_vet", "bansuk_staff", "admin"];
const ROLE_HELP: Record<Role, string> = {
  farm_owner: "고른 농장만 보고 입력합니다",
  bansuk_vet: "모든 농장, 보고서 발행, 분석기",
  bansuk_staff: "모든 농장, 보고서 발행, 분석기",
  admin: "위 권한 + 계정·농장 관리",
};
const STATUS: Record<AccountStatus, string> = {
  active: "사용 중",
  temp: "첫 로그인 전",
  expired: "임시 비밀번호 기한 지남",
  locked: "잠김",
  inactive: "꺼짐",
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
  ["show_feed", "사료"],
  ["show_water", "급수"],
  ["show_temp", "온도"],
  ["show_humidity", "습도"],
  ["show_egg_weight", "난중"],
  ["show_cull", "도태"],
];

type UserDraft = { id?: number; name: string; phone: string; role: Role; farm_ids: number[]; active: boolean };
type FarmDraft = Omit<AdminFarm, "id" | "accounts" | "config"> & { id?: number; config: FarmConfigIn };
type Issued = { name: string; phone: string; pin: string; reset: boolean };

const fmtTime = (s: string | null) =>
  s ? new Date(s + (s.endsWith("Z") ? "" : "Z")).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" }) : "";

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<"users" | "farms" | "audit">("users");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [farms, setFarms] = useState<AdminFarm[]>([]);
  const [grades, setGrades] = useState<Record<string, string>>({});
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

  const t = session?.token ?? "";
  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 2200);
  };

  const reload = useCallback(async () => {
    if (!t) return;
    try {
      const [u, f, a] = await Promise.all([adminApi.users(t), adminApi.farms(t), adminApi.audit(t)]);
      setUsers(u.users);
      setFarms(f.farms);
      setGrades(f.grades);
      setAudit(a.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [t]);

  useEffect(() => {
    setSession(loadSession());
  }, []);
  useEffect(() => {
    if (session?.user.role === "admin" && !session.user.must_change_pin) reload();
  }, [session, reload]);

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
        await adminApi.updateUser(t, userDraft.id, { ...body, active: userDraft.active });
        flash("계정을 고쳤습니다");
      } else {
        const r = await adminApi.createUser(t, body);
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
    if (!window.confirm(`${u.name}님의 비밀번호를 초기화할까요? 지금 로그인된 기기에서도 로그아웃됩니다.`)) return;
    const r = await adminApi.resetPin(t, u.id);
    setIssued({ name: u.name, phone: u.phone, pin: r.temp_pin, reset: true });
    reload();
  };
  const unlock = async (u: AdminUser) => {
    await adminApi.unlock(t, u.id);
    flash("잠금을 풀었습니다");
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
        houses: farmDraft.houses.filter((h) => h.name.trim()),
        config: farmDraft.config,
      };
      if (farmDraft.id) await adminApi.updateFarm(t, farmDraft.id, body);
      else await adminApi.createFarm(t, body);
      flash(farmDraft.id ? "농장을 고쳤습니다" : "농장을 만들었습니다");
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
    const text = `[반석 생산 기록] ${issued.name}님 계정이 ${issued.reset ? "초기화되었" : "만들어졌"}습니다.\n아이디: ${issued.phone}\n임시 비밀번호: ${issued.pin}\n7일 안에 로그인해 새 비밀번호를 정해 주세요.`;
    try {
      await navigator.clipboard.writeText(text);
      flash("안내 문구를 복사했습니다");
    } catch {
      flash("복사하지 못했습니다. 직접 알려 주세요");
    }
  };

  if (!session)
    return (
      <main className="an-wrap">
        <p className="an-pad">
          로그인이 필요합니다. <a href="/">로그인하기</a>
        </p>
      </main>
    );
  if (session.user.role !== "admin")
    return (
      <main className="an-wrap">
        <p className="an-pad">반석 관리자 계정에서만 쓸 수 있습니다.</p>
      </main>
    );

  const farmOwnerCount = (fid: number) => users.filter((u) => u.farm_ids.includes(fid) && u.status !== "inactive").length;

  return (
    <main className="an-wrap">
      <header className="an-head">
        <a href="/" className="an-back">‹ 생산 기록</a>
        <h1>계정·농장 관리</h1>
        <span className="an-spacer" />
        <span className="an-muted">{session.user.name}</span>
      </header>
      <nav className="ad-tabs" role="tablist">
        {(
          [
            ["users", `계정 ${users.length}`],
            ["farms", `농장 ${farms.length}`],
            ["audit", "변경 기록"],
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
              <input className="ad-search" placeholder="이름, 번호, 농장으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="an-seg ad-seg">
                {(
                  [
                    ["all", "전체"],
                    ["bansuk", "반석"],
                    ["farm", "농장"],
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
                계정 만들기
              </button>
            </div>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>역할</th>
                  <th>휴대폰</th>
                  <th>농장</th>
                  <th>상태</th>
                  <th>마지막 로그인</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shownUsers.map((u) => (
                  <tr key={u.id} className={u.status === "inactive" ? "is-off" : ""}>
                    <td className="strong">{u.name}</td>
                    <td>{u.role_label}</td>
                    <td className="num">{formatPhone(u.phone)}</td>
                    <td>{u.role === "farm_owner" ? u.farm_ids.map((id) => farmName.get(id)).join(", ") : <span className="an-muted">전체</span>}</td>
                    <td>
                      <span className={`ad-badge s-${u.status}`}>{STATUS[u.status]}</span>
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
                        고치기
                      </button>
                      {u.status === "locked" && (
                        <button type="button" className="an-mini" onClick={() => unlock(u)}>
                          잠금 풀기
                        </button>
                      )}
                      {u.status !== "inactive" && (
                        <button type="button" className="an-mini" onClick={() => resetPin(u)}>
                          비밀번호 초기화
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shownUsers.length && <p className="an-empty">찾는 계정이 없습니다.</p>}
          </section>
        )}

        {tab === "farms" && (
          <section className="an-card">
            <div className="ad-toolbar">
              <span className="an-muted">계사와 입력 항목은 농장마다 다르게 정할 수 있습니다. 농장주 입력 화면이 그대로 따라갑니다.</span>
              <span className="an-spacer" />
              <button
                type="button"
                className="ad-btn an-primary"
                onClick={() => {
                  setFormError(null);
                  setFarmDraft({ name: "", region: "", contract_type: "program", active: true, houses: [{ name: "1동", kind: "laying", active: true }], config: DEFAULT_CONFIG });
                }}
              >
                농장 만들기
              </button>
            </div>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>농장</th>
                  <th>지역</th>
                  <th>계약</th>
                  <th>계사</th>
                  <th>농장 계정</th>
                  <th>상태</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {farms.map((f) => (
                  <tr key={f.id} className={f.active ? "" : "is-off"}>
                    <td className="strong">{f.name}</td>
                    <td>{f.region}</td>
                    <td>{f.contract_type === "program" ? "백신프로그램" : "검사만"}</td>
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
                          계정 만들기
                        </button>
                      )}
                    </td>
                    <td>
                      <span className={`ad-badge ${f.active ? "s-active" : "s-inactive"}`}>{f.active ? "운영 중" : "꺼짐"}</span>
                    </td>
                    <td className="ad-actions">
                      <button
                        type="button"
                        className="an-mini"
                        onClick={() => {
                          setFormError(null);
                          setFarmDraft({ id: f.id, name: f.name, region: f.region ?? "", contract_type: f.contract_type, active: f.active, houses: f.houses, config: f.config ?? DEFAULT_CONFIG });
                        }}
                      >
                        고치기
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
            <p className="an-muted ad-note">계정과 농장을 누가 언제 바꿨는지 남습니다. 비밀번호 값은 어디에도 남지 않습니다.</p>
            <table className="ad-table">
              <thead>
                <tr>
                  <th>시각</th>
                  <th>한 사람</th>
                  <th>내용</th>
                  <th>대상</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a, i) => (
                  <tr key={i}>
                    <td className="an-muted num">{fmtTime(a.at)}</td>
                    <td>{a.actor}</td>
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
            <h2>{userDraft.id ? "계정 고치기" : "계정 만들기"}</h2>
            <label>
              이름
              <input value={userDraft.name} onChange={(e) => setUserDraft({ ...userDraft, name: e.target.value })} required autoFocus />
            </label>
            <label>
              휴대폰 번호 (로그인 아이디)
              <input type="tel" value={userDraft.phone} onChange={(e) => setUserDraft({ ...userDraft, phone: formatPhone(e.target.value) })} placeholder="010-0000-0000" required />
            </label>
            <fieldset>
              <legend>역할</legend>
              {ROLE_ORDER.map((r) => (
                <label key={r} className="ad-radio">
                  <input type="radio" name="role" checked={userDraft.role === r} onChange={() => setUserDraft({ ...userDraft, role: r })} />
                  <span>
                    <b>{{ farm_owner: "농장", bansuk_vet: "수의사·연구원", bansuk_staff: "반석 직원", admin: "반석 관리자" }[r]}</b>
                    <small>{ROLE_HELP[r]}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {userDraft.role === "farm_owner" && (
              <fieldset>
                <legend>볼 수 있는 농장</legend>
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
                {!farms.length && <p className="an-muted">먼저 농장 탭에서 농장을 만들어 주세요.</p>}
              </fieldset>
            )}
            {userDraft.id && (
              <label className="an-check">
                <input type="checkbox" checked={userDraft.active} onChange={(e) => setUserDraft({ ...userDraft, active: e.target.checked })} />
                사용 (끄면 바로 로그아웃되고 로그인할 수 없습니다)
              </label>
            )}
            {!userDraft.id && <p className="an-muted">저장하면 임시 비밀번호(숫자 6자리)가 한 번 나옵니다. 본인이 첫 로그인 때 새 비밀번호를 정합니다.</p>}
            {formError && <p className="an-error">{formError}</p>}
            <div className="an-actions">
              <button type="button" onClick={() => setUserDraft(null)}>
                취소
              </button>
              <button type="submit" className="an-primary" disabled={busy}>
                {userDraft.id ? "저장" : "계정 만들기"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ---------- 농장 편집 패널 ---------- */}
      {farmDraft && (
        <div className="ad-drawer-bg" onClick={() => setFarmDraft(null)}>
          <form className="ad-drawer ad-drawer-wide" onClick={(e) => e.stopPropagation()} onSubmit={saveFarm}>
            <h2>{farmDraft.id ? "농장 고치기" : "농장 만들기"}</h2>
            <div className="an-row">
              <label>
                농장 이름
                <input value={farmDraft.name} onChange={(e) => setFarmDraft({ ...farmDraft, name: e.target.value })} required autoFocus />
              </label>
              <label>
                지역
                <input value={farmDraft.region ?? ""} onChange={(e) => setFarmDraft({ ...farmDraft, region: e.target.value })} placeholder="충북 음성" />
              </label>
            </div>
            <div className="an-row">
              <label>
                계약
                <select value={farmDraft.contract_type} onChange={(e) => setFarmDraft({ ...farmDraft, contract_type: e.target.value as FarmDraft["contract_type"] })}>
                  <option value="program">백신프로그램 운영</option>
                  <option value="test_only">검사만 의뢰</option>
                </select>
              </label>
              <label className="an-check ad-inline">
                <input type="checkbox" checked={farmDraft.active} onChange={(e) => setFarmDraft({ ...farmDraft, active: e.target.checked })} />
                운영 중
              </label>
            </div>

            <fieldset>
              <legend>계사 (농장주 입력 화면의 순서)</legend>
              <div className="ad-houses">
                {farmDraft.houses.map((h, i) => (
                  <div key={h.id ?? `n${i}`} className={`ad-house ${h.active ? "" : "is-off"}`}>
                    <input value={h.name} onChange={(e) => patchHouse(i, { name: e.target.value })} aria-label="계사 이름" />
                    <select value={h.kind} onChange={(e) => patchHouse(i, { kind: e.target.value as AdminHouse["kind"] })} aria-label="종류">
                      <option value="laying">산란</option>
                      <option value="rearing">육성</option>
                    </select>
                    <button type="button" className="an-mini" onClick={() => moveHouse(i, -1)} disabled={i === 0} aria-label="위로">↑</button>
                    <button type="button" className="an-mini" onClick={() => moveHouse(i, 1)} disabled={i === farmDraft.houses.length - 1} aria-label="아래로">↓</button>
                    {h.id ? (
                      <button type="button" className="an-mini" onClick={() => patchHouse(i, { active: !h.active })}>
                        {h.active ? "끄기" : "켜기"}
                      </button>
                    ) : (
                      <button type="button" className="an-mini an-danger" onClick={() => setFarmDraft({ ...farmDraft, houses: farmDraft.houses.filter((_, k) => k !== i) })}>
                        빼기
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="an-mini ad-add"
                onClick={() => setFarmDraft({ ...farmDraft, houses: [...farmDraft.houses, { name: `${farmDraft.houses.length + 1}동`, kind: "laying", active: true }] })}
              >
                계사 추가
              </button>
              <p className="an-muted">기록이 있는 계사는 지우지 않고 끕니다.</p>
            </fieldset>

            <fieldset>
              <legend>입력 항목</legend>
              <div className="an-row">
                <label>
                  산란 수 단위
                  <select
                    value={farmDraft.config.egg_unit}
                    onChange={(e) => setFarmDraft({ ...farmDraft, config: { ...farmDraft.config, egg_unit: e.target.value as "tray" | "egg" } })}
                  >
                    <option value="tray">판</option>
                    <option value="egg">개</option>
                  </select>
                </label>
                <label>
                  한 판에 알
                  <input
                    inputMode="numeric"
                    value={farmDraft.config.eggs_per_tray}
                    disabled={farmDraft.config.egg_unit !== "tray"}
                    onChange={(e) => setFarmDraft({ ...farmDraft, config: { ...farmDraft.config, eggs_per_tray: Number(e.target.value.replace(/\D/g, "")) || 30 } })}
                  />
                </label>
              </div>
              <span className="ad-sub">규격 (농장이 실제로 나누는 것만)</span>
              <div className="ad-chips">
                {Object.entries(grades).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={farmDraft.config.grades.includes(k)} onClick={() => toggleGrade(k)}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="ad-sub">그 밖에 매일 적는 것</span>
              <div className="ad-chips">
                {SHOW_LABELS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={Boolean(farmDraft.config[k])}
                    onClick={() => setFarmDraft({ ...farmDraft, config: { ...farmDraft.config, [k]: !farmDraft.config[k] } })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            {formError && <p className="an-error">{formError}</p>}
            <div className="an-actions">
              <button type="button" onClick={() => setFarmDraft(null)}>
                취소
              </button>
              <button type="submit" className="an-primary" disabled={busy}>
                {farmDraft.id ? "저장" : "농장 만들기"}
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
              {issued.name}님 {issued.reset ? "비밀번호를 초기화했습니다" : "계정을 만들었습니다"}
            </h2>
            <dl>
              <dt>아이디</dt>
              <dd className="num">{formatPhone(issued.phone)}</dd>
              <dt>임시 비밀번호</dt>
              <dd className="ad-pin num">{issued.pin}</dd>
            </dl>
            <p>
              이 번호는 지금 한 번만 보입니다. 본인에게 알려 주세요. 7일 안에 로그인해 새 비밀번호를 정해야 하고, 지나면 다시 초기화해야 합니다.
            </p>
            <div className="an-actions">
              <button type="button" onClick={copyIssued}>
                안내 문구 복사
              </button>
              <button type="button" className="an-primary" onClick={() => setIssued(null)}>
                확인했습니다
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
