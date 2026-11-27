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
  importer: string | null;
  lat: number | null;
  lng: number | null;
  houses: AdminHouse[];
  accounts: { id: number; name: string }[];
  config: FarmConfigIn | null;
};

export type AuditItem = { at: string | null; actor: string | null; action: string; target: string };

// ---------- 반석 데이터 분석기 ----------
export type AnalysisSource = "production" | "necropsy" | "lab";
export type AnalysisQuery = {
  source: AnalysisSource;
  disease?: string | null;
  antigen?: string | null;
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
  events?: Record<string, { label: string; metrics: Record<string, { label: string; unit: string }>; groups: Record<string, string>; x_axes: Record<string, string> }>;
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
  final_diseases?: string[];
  diagnosed_at?: string | null;
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
  needs_diagnosis?: boolean;
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

// ---------- 계군 관리 ----------
export type FlockLoc = { id: number; house_id: number; house: string; kind: string; from: string; to: string | null; start_count: number | null };
export type ManagedFlock = {
  id: number;
  name: string | null;
  placed_on: string;
  placed_count: number;
  breed: string | null;
  hatchery: string | null;
  status: "rearing" | "laying" | "closed";
  closed_on: string | null;
  close_reason: "shipped" | "culled" | "other" | null;
  close_note: string | null;
  program: string | null;
  age_days: number;
  current_house: { id: number; name: string; kind: string } | null;
  locations: FlockLoc[];
  bird_count: number | null;
  bird_count_date: string | null;
  records: number;
};
export type FlockBoard = {
  today: string;
  houses: { id: number; name: string; kind: string; flock: ManagedFlock | null }[];
  active: ManagedFlock[];
  closed: ManagedFlock[];
  unlinked_records: number;
};

// ---------- 엑셀 업로드 ----------
export type ImportTotals = { new: number; overwrite: number; unchanged: number; skip_manual: number; skip_house: number; skip_future: number };
export type ImportBatchItem = {
  id: number;
  status: "preview" | "applied" | "reverted" | "discarded";
  filename: string;
  importer: string;
  overwrite_manual: boolean;
  summary: {
    rows?: number;
    period?: [string, string] | null;
    totals?: ImportTotals;
    houses?: { house: string; rows: number; new: number; overwrite: number; unchanged: number; skip_manual: number; first: string | null; last: string | null }[];
    unknown_houses?: { house: string; rows: number }[];
    no_flock?: number;
    months?: string[];
    warnings?: ({ code: string } & Record<string, string | number>)[];
    applied?: { new: number; overwrite: number };
    reverted?: { restored: number; kept: number };
  };
  uploaded_by: string | null;
  uploaded_at: string | null;
  applied_at: string | null;
  reverted_at: string | null;
  reverted_by: string | null;
};

// ---------- 백신 프로그램 ----------
export type VaccineComponent = { disease: string; strain?: string | null };
export type VaccineItem = { id: number; name: string; maker: string | null; kind: string; route: string; components: VaccineComponent[]; note: string | null; active: boolean };
export type ProgramItemRow = { id?: number; age_days: number; vaccine_id: number; vaccine?: string; kind?: string | null; route: string | null; default_route?: string | null; note: string | null };
export type ProgramSummary = { id: number; name: string; version: number; label: string; based_on_id: number | null; description: string | null; active: boolean; flocks: number; item_count: number; items?: ProgramItemRow[] };
export type ScheduleRow = {
  item_id: number;
  program: string;
  age_days: number;
  planned: string;
  vaccine: { id: number; name: string; kind: string; components: VaccineComponent[] } | null;
  route: string | null;
  note: string | null;
  status: "done" | "overdue" | "due" | "upcoming";
  done: { id: number; date: string; lot: string | null } | null;
};
export type VaccinationRow = { id: number; date: string; vaccine: { id: number; name: string; kind: string } | null; route: string | null; birds: number | null; lot: string | null; program_item_id: number | null; performed_by: string | null; house: string | null; note: string | null };
export type FlockVaccination = {
  flock: { id: number; name: string | null; placed_on: string; placed_count: number; status: string; age_days: number; farm: { id: number; name: string } | null; closed_on: string | null };
  current: { program_id: number | null; label: string | null; from: string } | null;
  history: { id: number; program_id: number | null; label: string | null; from: string; to: string | null; reason: string | null; set_by: string | null }[];
  schedule: ScheduleRow[];
  vaccinations: VaccinationRow[];
  can_edit: boolean;
};
export type DueRow = ScheduleRow & { flock_id: number; farm: { id: number; name: string }; house: string | null; placed_on: string };

// ---------- 질병 검사 결과 ----------
export type LabKind = "pcr" | "serology" | "culture" | "other";
export type LabResultValue = "positive" | "negative" | "suspect" | "na";
export type LabSampleRow = { id?: number; sample: string; result: LabResultValue; value?: string | null; control: boolean };
export type SeroRow = { id?: number; antigen: string; group_label: string | null; counts: number[]; n?: number; mean?: number | null };
export type LabBrief = {
  id: number;
  report_no: string | null;
  kind: LabKind;
  status: "draft" | "issued";
  farm_id: number;
  farm: string;
  house_id: number | null;
  house: string;
  flock_id: number | null;
  case_id: number | null;
  sampled_on: string | null;
  issued_on: string | null;
  age_days: number | null;
  method: string | null;
  target: string | null;
  disease: string | null;
  antigens: string[];
  positive: boolean | null;
};
export type LabDetail = LabBrief & {
  requester: string | null;
  requested_on: string | null;
  opinion: string | null;
  source: string;
  can_edit: boolean;
  samples: LabSampleRow[];
  sero: SeroRow[];
  case: { id: number; status: string; final_diagnosis: string | null; suspected: string[]; final_diseases?: string[] } | null;
};
export type LabIn = {
  kind: LabKind;
  farm_id: number;
  house_id: number | null;
  case_id: number | null;
  report_no: string | null;
  requester: string | null;
  requested_on: string | null;
  sampled_on: string | null;
  age_days: number | null;
  method: string | null;
  target: string | null;
  disease: string | null;
  opinion: string | null;
  samples: LabSampleRow[];
  sero: SeroRow[];
};
export type TiterPoint = { submission_id: number; sampled_on: string | null; age_days: number | null; group_label: string | null; mean: number | null; n: number; counts: number[] };
export type TiterSeries = { antigen: string; points: TiterPoint[] };

// ---------- 최근 유행 질병 ----------
export type EpidemicDisease = {
  disease: string;
  count: number;
  confirmed: number;
  farms: number;
  recent: number;
  previous: number;
  regions: { region: string; count: number }[];
  weekly: number[];
  last: string | null;
};
export type Epidemic = {
  from: string;
  to: string;
  days: number;
  region: string | null;
  weeks: string[];
  total: number;
  farms: number;
  confirmed: number;
  diseases: EpidemicDisease[];
  regions: { region: string; count: number; top: { disease: string; count: number }[] }[];
  recent: { date: string; disease: string; region: string; source: "necropsy" | "lab" | "both"; confirmed: boolean; farm?: string; farm_id?: number; case_id?: number | null; lab_id?: number | null }[];
  all_regions: string[];
  map: {
    farm_id?: number;
    farm?: string;
    region: string;
    lat: number;
    lng: number;
    approx: boolean;
    count: number;
    confirmed?: number;
    last?: string | null;
    top: { disease: string; count: number }[];
  }[];
  show_farms: boolean;
};

// ---------- 부검 사진 태깅 ----------
export type Pt = [number, number];
export type PhotoRegionItem = {
  id?: number;
  key?: string; // 화면에서만 쓰는 임시 키
  organ: string;
  lesions: string[];
  points: Pt[];
  source?: "manual" | "auto";
  status: "suggested" | "confirmed";
  score?: number | null;
};
export type LabelPhotoBrief = {
  id: number;
  thumb: string;
  case_id: number | null;
  source: "case" | "archive";
  farm: string;
  date: string | null;
  status: "todo" | "done" | "skip";
  regions: number;
  suggested: number;
  diseases: string[];
  normal: boolean;
};
export type LabelPhoto = {
  id: number;
  url: string;
  width: number | null;
  height: number | null;
  source: string;
  date: string | null;
  status: "todo" | "done" | "skip";
  diseases: string[];
  normal: boolean;
  note: string | null;
  farm: string;
  house: string;
  case: { id: number; suspected: string[]; final_diagnosis: string | null; final_diseases?: string[]; summary: string | null; findings: { organ: string; lesions: string[] }[] } | null;
  regions: PhotoRegionItem[];
  auto_model: string | null;
  prev_id: number | null;
  next_id: number | null;
};
export type LabelSummary = {
  total: number;
  todo: number;
  done: number;
  skip: number;
  suggested: number;
  organs: { organ: string; count: number }[];
  target_per_organ: number;
  diseases: { disease: string; count: number }[];
  normal: number;
  model: { enabled: boolean; version: string | null; classes: string[] };
};
