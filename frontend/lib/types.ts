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
export type Session = {
  token: string;
  user: { id: number; name: string; role: string };
  farms: Farm[];
};
