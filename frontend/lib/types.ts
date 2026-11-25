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

export type Farm = { id: number; name: string; region: string | null };
export type Session = {
  token: string;
  user: { id: number; name: string; role: string };
  farms: Farm[];
};
