export type Grade = { code: string; label: string };

export type InputConfig = {
  egg_unit: "tray" | "egg";
  eggs_per_tray: number;
  grades: Grade[];
  show_feed: boolean;
  show_water: boolean;
  show_temp: boolean;
  show_humidity: boolean;
  show_egg_weight: boolean;
  show_cull: boolean;
};

export type Metrics = {
  total_eggs: number | null;
  lay_rate: number | null;
  feed_per_bird_g: number | null;
  mortality_per_10k: number | null;
};

export type DailyRecord = {
  date: string;
  bird_count: number | null;
  metrics: Metrics;
  [field: string]: unknown;
};

export type Warning = { level: "error" | "warning"; code: string; message: string };

export type HouseView = {
  house: { id: number; name: string; kind: string };
  flock: { id: number; name: string | null; age_days: number; age_weeks: number } | null;
  record: DailyRecord | null;
  previous: DailyRecord | null;
  expected_start_count: number | null;
  lay_rate_7d_avg: number | null;
  warnings: Warning[];
};

export type DayView = {
  farm: { id: number; name: string };
  date: string;
  config: InputConfig;
  houses: HouseView[];
  progress: { done: number; total: number };
};

export type FlockItem = {
  id: number;
  name: string | null;
  placed_on: string;
  status: string;
  program: string | null;
  houses: string[];
  records: number;
};

export type BandPoint = { age: number; target: number | null; median?: number; p10?: number; p90?: number; n?: number };

export type MetricRow = {
  metric: string;
  target: number | null;
  n: number;
  median?: number;
  p10?: number;
  p90?: number;
  rank?: number;
  of?: number;
  higher_is_better?: boolean | null;
};

export type FlockReport = {
  farm: { id: number; name: string; region: string | null };
  flock: {
    id: number;
    name: string | null;
    placed_on: string;
    placed_count: number;
    breed: string | null;
    program: string | null;
    houses: string[];
    status: string;
  };
  baseline: "past" | "all";
  curve: { age_at_50: number | null; peak: number | null; peak_age: number | null; days_over_90: number };
  baseline_curve: { median_age_at_50: number | null; median_peak: number | null };
  band: BandPoint[];
  comparison: {
    age_from: number;
    age_to: number;
    target: Record<string, unknown> | null;
    peer_count: number;
    metrics: MetricRow[];
    grades: { grade: string; label: string; target: number; median: number | null }[];
  } | null;
  data: {
    target_records: number;
    baseline_flocks: number;
    baseline_records: number;
    first_date: string | null;
    last_date: string | null;
    lay_over_limit_days: number;
    fingerprint: string;
  };
  cautions: string[];
  method: { age_base: number; moving_average_days: number; lay_valid_max: number; min_band_flocks: number; peer_min_coverage: number };
  meta: {
    status: "preview" | "issued";
    generated_at?: string;
    report_no?: string;
    issued_at?: string;
    issued_by?: string;
    reviewer_note?: string | null;
    data_changed_since_issue?: boolean;
  };
};

export type Dashboard = {
  farm: { id: number; name: string };
  date: string;
  houses: {
    house: { id: number; name: string; kind: string };
    flock: { id: number; name: string | null; age_weeks: number; program: string | null } | null;
    daily: { date: string; lay_rate: number | null; mortality: number | null; feed_per_bird_g: number | null; water_l: number | null; bird_count: number | null }[];
    position: { age_days: number; lay_7d: number; past_median: number | null; past_n: number; better_than_pct: number | null } | null;
  }[];
};

export type Farm = { id: number; name: string; region: string | null };
export type PinRule = { kind: "digits6" | "password"; rule: string };

export type SessionUser = {
  id: number;
  name: string;
  role: string;
  role_label: string;
  must_change_pin: boolean;
  pin_rule: PinRule;
};

export type Session = {
  token: string;
  user: SessionUser;
  farms: Farm[];
};

// ---------- 반석 관리자 ----------
export type Role = "admin" | "bansuk_vet" | "bansuk_staff" | "farm_owner";
export type AccountStatus = "active" | "temp" | "expired" | "locked" | "inactive";

export type AdminUser = {
  id: number;
  name: string;
  phone: string;
  role: Role;
  role_label: string;
  farm_ids: number[];
  status: AccountStatus;
  last_login_at: string | null;
  temp_expires_at: string | null;
  created_at: string | null;
};

export type AdminHouse = { id?: number; name: string; kind: "laying" | "rearing"; active: boolean };

export type FarmConfigIn = {
  egg_unit: "tray" | "egg";
  eggs_per_tray: number;
  grades: string[];
  show_feed: boolean;
  show_water: boolean;
  show_temp: boolean;
  show_humidity: boolean;
  show_egg_weight: boolean;
  show_cull: boolean;
};

export type AdminFarm = {
  id: number;
  name: string;
  region: string | null;
  contract_type: "program" | "test_only";
  active: boolean;
  houses: AdminHouse[];
  accounts: { id: number; name: string }[];
  config: FarmConfigIn | null;
};

export type AuditItem = { at: string | null; actor: string | null; action: string; target: string };

// ---------- 반석 데이터 분석기 ----------
export type AnalysisQuery = {
  source: "production";
  metric: string;
  x: string;
  group: string;
  farm_ids: number[];
  flock_ids?: number[];
  house_ids?: number[];
  date_from?: string | null;
  date_to?: string | null;
  age_from?: number | null;
  age_to?: number | null;
  program: "any" | "applied" | "not";
  house_kind: "laying" | "rearing" | "all";
  smooth: boolean;
};

export type Catalog = {
  sources: Record<string, string>;
  metrics: Record<string, { label: string; unit: string }>;
  x_axes: Record<string, string>;
  groups: Record<string, string>;
};

export type Series = { key: string; label: string; points: [string | number, number][] };

export type QueryResult = {
  metric: { code: string; label: string; unit: string; note?: string | null };
  x: { code: string; label: string };
  group: { code: string; label: string };
  series: Series[];
  truncated: boolean;
  record_count: number;
};

export type ChartKind = "line" | "bar" | "table";

export type Widget = {
  id: string;
  title: string;
  chart: ChartKind;
  width: 1 | 2;
  query: AnalysisQuery;
  note?: string | null;
};

export type AnalysisDashboard = {
  id: number;
  name: string;
  shared: boolean;
  widgets: Widget[];
  owner: string | null;
  mine: boolean;
  updated_at: string | null;
};

// ---------- 폐사 신고·부검 ----------
export type CaseStatus = "reported" | "scheduling" | "scheduled" | "done" | "shared" | "cancelled";
export type Finding = { organ: string; lesions: string[]; note?: string | null };
export type CaseResult = {
  performed_at: string | null;
  birds_examined: number | null;
  findings: Finding[];
  suspected: string[];
  samples: string[];
  summary: string | null;
  advice: string | null;
  final_diagnosis: string | null;
  internal_note?: string | null;
};
export type CasePhotoItem = {
  id: number;
  stage: "report" | "necropsy";
  thumb: string;
  full: string;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  caption: string | null;
  can_delete: boolean;
};
export type CaseEventItem = {
  id: number;
  at: string | null;
  kind: string;
  data: Record<string, unknown>;
  author: string;
  side: "bansuk" | "farm" | "system";
  mine: boolean;
};
export type NecropsyCase = {
  id: number;
  status: CaseStatus;
  awaiting: "farm" | "bansuk" | null;
  farm: { id: number; name: string; region: string | null } | null;
  house: { id: number; name: string } | null;
  flock: { id: number; placed_on: string; age_days: number } | null;
  reported_at: string | null;
  dead_count: number | null;
  onset: string | null;
  symptoms: string[];
  report_note: string | null;
  proposals: { at: string; by: "bansuk" | "farm" }[];
  scheduled_at: string | null;
  vet: { id: number; name: string } | null;
  shared_at: string | null;
  updated_at: string | null;
  result?: CaseResult;
  events?: CaseEventItem[];
  photos?: CasePhotoItem[];
  production?: { date: string; mortality: number | null; lay_rate: number | null }[];
  vets?: { id: number; name: string }[];
  upload?: { saved: number; failed: { name: string; error: string }[] };
};
export type NotificationItem = {
  id: number;
  case_id: number | null;
  kind: string;
  data: Record<string, unknown>;
  at: string | null;
  read: boolean;
};
