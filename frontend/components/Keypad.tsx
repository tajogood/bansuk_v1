"use client";

type Props = {
  allowDecimal: boolean;
  hasPrevious: boolean;
  isLast: boolean;
  saving: boolean;
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onPrevious: () => void; // 어제 값 넣기
  onBack: () => void; // 이전 칸
  onNext: () => void; // 다음 칸 또는 저장
};

/**
 * 계사 안에서 장갑 낀 손으로도 누를 수 있게 키를 크게 만든 숫자 키패드.
 * OS 키보드를 쓰지 않아 화면이 흔들리지 않고, 다음 칸 이동이 한 번에 된다.
 */
export default function Keypad(p: Props) {
  const tap = (fn: () => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    if (navigator.vibrate) navigator.vibrate(8);
    fn();
  };
  const digit = (d: string) => (
    <button key={d} type="button" className="key" onPointerDown={tap(() => p.onDigit(d))}>
      {d}
    </button>
  );

  return (
    <div className="keypad" role="group" aria-label="숫자 키패드">
      {digit("1")}
      {digit("2")}
      {digit("3")}
      <button
        type="button"
        className="key key-fn"
        aria-label="지우기"
        onPointerDown={tap(p.onBackspace)}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onClear();
        }}
      >
        ⌫
      </button>
      {digit("4")}
      {digit("5")}
      {digit("6")}
      <button
        type="button"
        className="key key-fn key-yesterday"
        disabled={!p.hasPrevious}
        onPointerDown={tap(p.onPrevious)}
      >
        어제와
        <br />
        같음
      </button>
      {digit("7")}
      {digit("8")}
      {digit("9")}
      <button
        type="button"
        className={`key key-next ${p.isLast ? "is-save" : ""}`}
        disabled={p.saving}
        onPointerDown={tap(p.onNext)}
      >
        {p.saving ? "저장 중" : p.isLast ? "저장" : "다음"}
      </button>
      <button
        type="button"
        className="key key-fn"
        disabled={!p.allowDecimal}
        aria-label="소수점"
        onPointerDown={tap(() => p.onDigit("."))}
      >
        .
      </button>
      {digit("0")}
      <button type="button" className="key key-fn key-small" onPointerDown={tap(p.onBack)}>
        이전 칸
      </button>
    </div>
  );
}
