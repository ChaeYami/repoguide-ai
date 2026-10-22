// 한 줄 설명이 붙은 단일 선택 카드 (수준·목적 선택 공용). 네이티브 radio라 키보드·스크린리더로 쓸 수 있다.

export interface Option<T extends string> {
  value: T;
  label: string;
  description: string;
}

export function OptionCards<T extends string>(props: {
  legend: string;
  name: string;
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="mt-6">
      <legend className="text-sm font-semibold text-slate-700">{props.legend}</legend>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {props.options.map((option) => {
          const checked = props.value === option.value;
          return (
            <label
              key={option.value}
              className={`cursor-pointer rounded-lg border p-3 transition ${
                checked ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-200 hover:border-slate-400"
              }`}
            >
              <input
                type="radio"
                name={props.name}
                value={option.value}
                checked={checked}
                onChange={() => props.onChange(option.value)}
                className="sr-only"
              />
              <span className="block font-medium">{option.label}</span>
              <span className="mt-1 block text-sm text-slate-600">{option.description}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
