import { fireEvent, screen, within } from '@testing-library/react'
import { fixtureNames, loadFixture } from '@viz/fixtures'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createEngine } from './engine.ts'
import { ending } from './ending.ts'
import { usePlayer } from './store.ts'
import { python, renderPlayer } from './test-player.tsx'

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  usePlayer.setState(usePlayer.getInitialState())
})

const counter = (step: number, of: number) => screen.findByText(`Step ${step} of ${of}`)
const region = (name: string) => screen.getByRole('region', { name })
const paragraph = (text: string | RegExp) => (_: string, el: Element | null) =>
  el?.tagName === 'P' &&
  (typeof text === 'string' ? el.textContent === text : text.test(el.textContent))
const header = (name: string) => loadFixture(name).header

async function open(name: string, options: Parameters<typeof renderPlayer>[1] = {}) {
  const rendered = renderPlayer(name, options)
  await counter(1, rendered.stepCount)
  return rendered
}

describe('§19.6 friendly errors', () => {
  test.each([
    {
      fixture: 'python-error-index',
      title: 'Index out of range · line 5, in <module> · step 10',
      message: 'grid[r][2] was used, but grid[r] has size 2 (valid indices 0–1).',
      hint: 'Hint: Valid indices are 0 to size − 1. Check loop bounds such as i <= n.',
    },
    {
      fixture: 'cpp-check-index',
      title: 'Index out of range · line 8, in main() · step 15',
      message: 'a[5] was used, but a has size 5 (valid indices 0–4).',
      hint: 'Hint: Valid indices are 0 to size − 1. Check loop bounds such as i <= n.',
    },
    {
      fixture: 'cpp-check-overflow',
      title: 'Integer overflow · line 8, in main() · step 7',
      message: '2000000000 + 1000000000 does not fit in int (max 2,147,483,647).',
      hint: 'Hint: Use long long, or apply % MOD earlier.',
    },
    {
      fixture: 'python-error-divide',
      title: 'Division by zero · line 2, in average() · step 4',
      message: 'total // count with count = 0.',
      hint: 'Hint: Check the divisor before dividing.',
    },
    {
      fixture: 'cpp-check-divide',
      title: 'Division by zero · line 5, in average() · step 5',
      message: 'A division or % by zero.',
      hint: 'Hint: Check the divisor before dividing.',
    },
    {
      fixture: 'cpp-check-empty',
      title: 'Empty container · line 8, in main() · step 5',
      message: 'q.front() on an empty queue.',
      hint: 'Hint: Check .empty() first.',
    },
    {
      fixture: 'python-recursion',
      title: 'Recursion too deep · line 7, in down() · step 26',
      message: 'Python stops at 25 nested calls.',
      hint: 'Hint: Use sys.setrecursionlimit(10**6) or an iterative DFS.',
    },
    {
      fixture: 'cpp-stack-overflow',
      title: 'Recursion too deep · line 6, in dive() · step 16',
      message: 'The recursion went 8 calls deep and ran out of stack.',
      hint: "Hint: Use an iterative version, or check the judge's stack limit.",
    },
  ])('$fixture: $title', async ({ fixture, title, message, hint }) => {
    await open(fixture)
    const banner = within(region('Runtime error'))
    expect(banner.getByText(paragraph(`!! ${title}`))).toBeDefined()
    expect(banner.getByText(paragraph(message))).toBeDefined()
    expect(banner.getByText(paragraph(hint))).toBeDefined()
  })

  test('jumps to the error step and to the step before it', async () => {
    const { stepCount } = await open('cpp-check-index')
    fireEvent.click(screen.getByRole('button', { name: 'Show values at step 14' }))
    await counter(14, stepCount)
    fireEvent.click(screen.getByRole('button', { name: 'Jump to step 15' }))
    await counter(15, stepCount)
  })

  test('the raw message stays one click away', async () => {
    await open('cpp-check-overflow')
    const raw = screen.getByText('Raw message')
    expect(raw.closest('details')!.open).toBe(false)
    fireEvent.click(raw)
    expect(raw.closest('details')!.open).toBe(true)
    expect(screen.getByText(/UBSan: signed integer overflow/)).toBeDefined()
  })

  test.each([
    {
      name: 'an error with no kind shows the runtime’s own message',
      fixture: 'python-error-other',
      title:
        "ValueError: invalid literal for int() with base 10: 'ten' · line 4, in <module> · step 7",
    },
    {
      name: 'a signal reads as words',
      fixture: 'cpp-segfault',
      title: 'Segmentation fault (invalid memory access) · line 6, in bump() · step 9',
    },
    {
      name: 'an error unwound through its callers says where it was raised',
      fixture: 'python-exception',
      title:
        'IndexError: list index out of range · line 2, in f() · raised at step 6, program ended at step 9',
    },
  ])('$name', async ({ fixture, title }) => {
    const { stepCount } = await open(fixture)
    const banner = within(region('Runtime error'))
    expect(banner.getByText(paragraph(`!! ${title}`))).toBeDefined()
    expect(banner.queryByText(paragraph(/^Hint:/))).toBeNull()
    fireEvent.click(banner.getByRole('button', { name: 'Jump to error step' }))
    const raised = loadFixture(fixture)
      .chunks.flat()
      .findIndex((s) => s.error !== null)
    await counter(raised + 1, stepCount)
  })

  test.each(
    fixtureNames.filter(
      (name) =>
        !loadFixture(name)
          .chunks.flat()
          .some((s) => s.error),
    ),
  )('%s has no error banner', async (name) => {
    await open(name)
    expect(screen.queryByRole('region', { name: 'Runtime error' })).toBeNull()
  })

  test('an error the program got past is no crash', () => {
    const steps = loadFixture('python-error-index').chunks.flat()
    const after = { ...steps[8]!, i: steps.length, keyframe: false, frames: {}, heap: {} }
    const { crash } = ending([...steps, after], createEngine([...steps, after]).state)
    expect(crash).toBeNull()
  })
})

describe('step limit (§5.6, D25)', () => {
  const tail = loadFixture('python-step-limit').tail

  test('says what the program did after the traced steps, and offers the re-runs', async () => {
    const onStartAt = vi.fn<() => void>()
    const onRaiseLimit = vi.fn<() => void>()
    await open('python-step-limit', { language: python, tail, onStartAt, onRaiseLimit })
    const banner = within(region('Step limit'))
    expect(
      banner.getByText(
        paragraph(
          '(!) Traced the first 30 steps, up to line 2 in <module>, total = 91, i = 13; the program then finished normally (not traced).',
        ),
      ),
    ).toBeDefined()
    fireEvent.click(banner.getByRole('button', { name: 'Start tracing from line…' }))
    fireEvent.click(banner.getByRole('button', { name: 'Raise limit to 5,000' }))
    expect(onStartAt).toHaveBeenCalledOnce()
    expect(onRaiseLimit).toHaveBeenCalledOnce()
    expect(screen.getByText(/exit: normal \(0\) \(not traced\)$/)).toBeDefined()
  })

  test('Why? explains the limit', async () => {
    await open('python-step-limit', { language: python, tail })
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }))
    const why = await screen.findByRole('dialog', { name: 'Why the trace stops' })
    expect(why.textContent).toContain('records at most 30 steps')
    expect(why.textContent).toContain('output and exit status are still complete')
  })

  test.each([
    {
      name: 'a trace without an untraced tail says the program was still running',
      untracedTail: undefined,
      text: /^The program was still running: line 2 in <module>, total = 91, i = 13\. Later lines were not recorded\.$/,
    },
    {
      name: 'a tail that ran out of time says so',
      untracedTail: {
        completed: false,
        exit: { kind: 'timeout', code: null, signal: null, message: null },
        stdoutBytes: 0,
      } as const,
      text: /the program then ran until the time limit \(not traced\)\.$/,
    },
    {
      name: 'a tail that raised names the exception',
      untracedTail: {
        completed: true,
        exit: { kind: 'exception', code: 1, signal: null, message: 'ValueError: bad' },
        stdoutBytes: 0,
      } as const,
      text: /the program then raised ValueError: bad \(not traced\)\.$/,
    },
  ])('$name', async ({ untracedTail, text }) => {
    const { summary } = header('python-step-limit')
    await open('python-step-limit', {
      language: python,
      header: { summary: { ...summary, untracedTail } },
    })
    expect(within(region('Step limit')).getByText(paragraph(text))).toBeDefined()
  })

  test('without a host to re-run, or at the ceiling already, only Why? is offered', async () => {
    const { options } = header('python-step-limit')
    await open('python-step-limit', {
      language: python,
      header: { options: { ...options, maxSteps: 5000 } },
      onRaiseLimit: () => {},
    })
    const banner = within(region('Step limit'))
    expect(banner.getAllByRole('button').map((b) => b.textContent)).toEqual(['Why?'])
  })

  test('the untraced output follows the traced output on the last step, marked', async () => {
    const { stepCount } = await open('python-step-limit', { language: python, tail })
    expect(screen.queryByRole('region', { name: 'Not traced' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'End' })
    await counter(stepCount, stepCount)
    const untraced = within(region('Not traced'))
    expect(untraced.getByText('Printed after step 30, not traced')).toBeDefined()
    expect(untraced.getByText('1999000')).toBeDefined()
    expect(screen.queryByText('(nothing printed yet)')).toBeNull()
  })
})

describe('other limits (§5.6)', () => {
  test('a timeout keeps its steps and says when it stopped', async () => {
    await open('python-timeout', { language: python })
    expect(
      within(region('Time limit')).getByText(paragraph(/^\(!\) Stopped after 15 s \(time limit\)/)),
    ).toBeDefined()
  })

  test('the output limit marks where the output was cut', async () => {
    const { stepCount } = await open('python-output-limit', { language: python })
    expect(region('Output limit')).toBeDefined()
    const output = within(region('Stdout / Stderr'))
    expect(output.queryByText('… (output truncated)')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'End' })
    await counter(stepCount, stepCount)
    expect(output.getByText('… (output truncated)')).toBeDefined()
  })

  test('a tracer failure is ours, with the trace ID', async () => {
    const { summary, id } = header('python-aliasing')
    const exit = { kind: 'internal_error', code: 70, signal: null, message: null } as const
    await open('python-aliasing', { header: { summary: { ...summary, exit } } })
    const banner = within(region('Internal error'))
    expect(banner.getByText(paragraph('!! Something went wrong on our side.'))).toBeDefined()
    expect(banner.getByText(`Trace ID: ${id}`)).toBeDefined()
  })
})
