import { useId, type ReactNode } from 'react'

/**
 * Confidence rating, 0–100 %.
 *
 * Recorded *before* the answer is revealed so the gap between confidence and result is
 * meaningful. Rendered as a slider with a text readout — the value is never conveyed by
 * position alone.
 */
export function ConfidenceSlider({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null
  onChange: (value: number) => void
  disabled?: boolean
}): ReactNode {
  const id = useId()
  const current = value ?? 50

  return (
    <div className="field confidence">
      <label className="field__label" htmlFor={id}>
        Jak jistý/á si jste svou odpovědí?
      </label>
      <span className="field__hint" id={`${id}-hint`}>
        Zapište jistotu dřív, než uvidíte správné řešení. Pomáhá to poznat, kde se
        přeceňujete.
      </span>
      <input
        id={id}
        className="confidence__input"
        type="range"
        min={0}
        max={100}
        step={5}
        value={current}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        aria-valuetext={`${current} procent`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <p className="meta-line">
        Zvolená jistota: <span className="confidence__value">{current} %</span>
        {value === null && ' (zatím nepotvrzeno)'}
      </p>
    </div>
  )
}
