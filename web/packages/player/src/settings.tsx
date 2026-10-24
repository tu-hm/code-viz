import { Button, Dialog, DialogContent, DialogTrigger } from '@viz/ui'
import { useId, type ReactNode } from 'react'
import { densities, fontSizes, speeds, themes, type Settings } from './store.ts'

const maxStepChoices = [100, 500, 1000, 2000, 5000]

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mono-label mb-2 text-muted-foreground">{title}</legend>
      {note && <p className="text-muted-foreground">{note}</p>}
      {children}
    </fieldset>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="size-4 accent-primary"
      />
    </label>
  )
}

function Select<T extends string | number>({
  label,
  value,
  options,
  format,
  onChange,
}: {
  label: string
  value: T
  options: readonly T[]
  format: (option: T) => string
  onChange: (value: T) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      {label}
      <select
        value={String(value)}
        onChange={(e) => onChange(options[e.currentTarget.selectedIndex]!)}
        className="h-9 rounded-xl border border-input bg-background px-3 text-base sm:text-sm"
      >
        {options.map((o) => (
          <option key={o} value={String(o)}>
            {format(o)}
          </option>
        ))}
      </select>
    </label>
  )
}

function Choice<T extends string>({
  legend,
  value,
  options,
  format,
  onChange,
}: {
  legend: string
  value: T
  options: readonly T[]
  format: (option: T) => string
  onChange: (value: T) => void
}) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={legend} className="flex items-center justify-between gap-4">
      {legend}
      <div className="flex gap-3">
        {options.map((o) => (
          <label key={o} className="flex items-center gap-1.5">
            <input
              type="radio"
              name={name}
              checked={o === value}
              onChange={() => onChange(o)}
              className="size-4 accent-primary"
            />
            {format(o)}
          </label>
        ))}
      </div>
    </div>
  )
}

const capitalized = (s: string) => s[0]!.toUpperCase() + s.slice(1)

type SettingsDialogProps = {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  pointers: boolean
  safetyChecks: boolean
  maxStepsCeiling: number
}

export function SettingsDialog({
  settings,
  onChange,
  pointers,
  safetyChecks,
  maxStepsCeiling,
}: SettingsDialogProps) {
  const maxSteps = Math.min(settings.maxSteps, maxStepsCeiling)
  const stepChoices = [...new Set([...maxStepChoices, maxSteps, maxStepsCeiling])]
    .filter((n) => n <= maxStepsCeiling)
    .sort((a, b) => a - b)
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent title="Visualizer settings">
        <Group title="Next run" note="These apply the next time you visualize.">
          <Select
            label="Max steps"
            value={maxSteps}
            options={stepChoices}
            format={(n) => n.toLocaleString('en')}
            onChange={(n) => onChange({ maxSteps: n })}
          />
          {safetyChecks && (
            <Toggle
              label="Safety checks"
              checked={settings.safetyChecks}
              onChange={(on) => onChange({ safetyChecks: on })}
            />
          )}
        </Group>
        <Group title="Playback">
          <Select
            label="Autoplay speed"
            value={settings.autoplaySpeed}
            options={speeds}
            format={(s) => `${s}×`}
            onChange={(s) => onChange({ autoplaySpeed: s })}
          />
        </Group>
        <Group title="State">
          <Toggle
            label="Draw reference arrows"
            checked={settings.drawArrows}
            onChange={(on) => onChange({ drawArrows: on })}
          />
          <Toggle
            label="Highlight changed values"
            checked={settings.highlightChanges}
            onChange={(on) => onChange({ highlightChanges: on })}
          />
          <Toggle
            label="Show unreachable objects"
            checked={settings.showUnreachable}
            onChange={(on) => onChange({ showUnreachable: on })}
          />
          <Toggle
            label="Matrix view for 2-D data"
            checked={settings.matrixView}
            onChange={(on) => onChange({ matrixView: on })}
          />
          {pointers && (
            <Toggle
              label="Show memory addresses"
              checked={settings.showAddresses}
              onChange={(on) => onChange({ showAddresses: on })}
            />
          )}
          <Toggle
            label="Show compiler internals"
            checked={settings.showInternals}
            onChange={(on) => onChange({ showInternals: on })}
          />
        </Group>
        <Group title="Display">
          <Choice
            legend="Density"
            value={settings.density}
            options={densities}
            format={capitalized}
            onChange={(density) => onChange({ density })}
          />
          <Choice
            legend="Font size"
            value={settings.fontSize}
            options={fontSizes}
            format={(f) => f.toUpperCase()}
            onChange={(fontSize) => onChange({ fontSize })}
          />
          <Choice
            legend="Theme"
            value={settings.theme}
            options={themes}
            format={capitalized}
            onChange={(theme) => onChange({ theme })}
          />
        </Group>
      </DialogContent>
    </Dialog>
  )
}
