/**
 * Host half of the plan board bundle.
 *
 * Owns `.dsh/plan-board.md` inside the Session workspace and exposes it
 * through one slash command shared by two callers: a person typing `/aboard`,
 * and the Client panel using the same command as its RPC.
 *
 * Format (markdown, human-editable):
 *
 *   # 计划板 · title
 *   > 目标：one line
 *   ## P1 · group
 *   - [ ] 标题（一句完整人话）  @P0 @选 @start=2026-11-15T16:49
 *     做法：how it will be done
 *     验收：how we know it is done
 *     批注：the user's comment
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const name = 'plan-board'
export const inject = ['commands', 'tools']

const BOARD_RELATIVE = '.dsh/plan-board.md'
const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
const DETAIL_PREFIXES = ['做法', '验收', '批注', '备注']

/** Board path for one invocation, derived from the Session workspace root. */
function boardPathOf(agent) {
  const session = agent && agent.session
  const cwd = (session && session.header && session.header.cwd)
    || (session && session.cwd)
    || (agent && agent.cwd)
  return typeof cwd === 'string' && cwd.length > 0 ? join(cwd, BOARD_RELATIVE) : null
}

/** Local minute stamp used for the `@start` tag. */
function stamp(now = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** Split trailing `@tag` tokens from an item's visible text. */
function splitTags(body) {
  const tags = []
  const text = body.replace(/\s*@([\p{L}\p{N}][\p{L}\p{N}_=:.-]*)/gu, (_match, tag) => {
    tags.push(tag)
    return ''
  })
  const priority = tags.find(tag => /^P[0-3]$/u.test(tag)) || null
  const startTag = tags.find(tag => tag.startsWith('start='))
  const seqTag = tags.find(tag => tag.startsWith('序='))
  return {
    text: text.trim(),
    priority,
    picked: tags.includes('选'),
    dropped: tags.includes('弃'),
    start: startTag ? startTag.slice('start='.length) : null,
    seq: seqTag ? Number.parseInt(seqTag.slice('序='.length), 10) : null,
  }
}

/** Compose the markdown line for one item header. */
function itemLine(item) {
  const glyph = item.state === 'done' ? 'x' : item.state === 'doing' ? '~' : item.state === 'dropped' ? '-' : ' '
  const tags = []
  if (item.priority) tags.push(item.priority)
  if (item.picked) tags.push('选')
  if (item.dropped) tags.push('弃')
  if (item.seq !== null && item.seq !== undefined) tags.push(`序=${item.seq}`)
  if (item.start) tags.push(`start=${item.start}`)
  return `- [${glyph}] ${item.text}${tags.length > 0 ? `  @${tags.join(' @')}` : ''}`
}

/** Parse one board text into goal, sections, and item line bookkeeping. */
function parseBoard(text) {
  const lines = String(text || '').split('\n')
  const sections = []
  let goal = null
  let projectTitle = null
  let current = null
  let lastItem = null
  let index = 0

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const raw = lines[lineNo]
    const line = raw.replace(/\s+$/u, '')
    const title = /^#\s+(.+)$/u.exec(line)
    if (title) {
      projectTitle = title[1].trim()
      continue
    }
    const goalMatch = /^>\s*目标[：:]\s*(.*)$/u.exec(line.trim())
    if (goalMatch) {
      goal = goalMatch[1].trim()
      continue
    }
    const heading = /^##\s+(.+)$/u.exec(line)
    if (heading) {
      current = { title: heading[1].trim(), items: [] }
      sections.push(current)
      lastItem = null
      continue
    }
    const itemMatch = /^- \[([ x~-])\]\s+(.+)$/u.exec(line)
    if (itemMatch) {
      const parsed = splitTags(itemMatch[2])
      index += 1
      const state = itemMatch[1] === 'x'
        ? 'done'
        : itemMatch[1] === '~'
          ? 'doing'
          : itemMatch[1] === '-'
            ? 'dropped'
            : 'todo'
      if (current === null) {
        current = { title: '', items: [] }
        sections.push(current)
      }
      lastItem = {
        index,
        line: lineNo,
        lastDetailLine: lineNo,
        state,
        text: parsed.text,
        priority: parsed.priority,
        picked: parsed.picked,
        dropped: parsed.dropped || state === 'dropped',
        start: parsed.start,
        seq: parsed.seq,
        detail: { how: [], accept: [], notes: [] },
      }
      current.items.push(lastItem)
      continue
    }
    const detail = /^\s{2,}(做法|验收|批注|备注)[：:]\s*(.*)$/u.exec(line)
    if (detail && lastItem !== null) {
      const kind = detail[1]
      const value = detail[2].trim()
      if (kind === '做法') lastItem.detail.how.push(value)
      else if (kind === '验收') lastItem.detail.accept.push(value)
      else lastItem.detail.notes.push(value)
      lastItem.lastDetailLine = lineNo
      continue
    }
  }

  return { projectTitle, goal, sections: sections.filter(section => section.items.length > 0), lines }
}

/** Totals used by both the summary text and the Client. */
function countBoard(sections) {
  const counts = { total: 0, done: 0, doing: 0, dropped: 0, picked: 0 }
  for (const section of sections) {
    for (const item of section.items) {
      counts.total += 1
      if (item.state === 'done') counts.done += 1
      if (item.state === 'doing') counts.doing += 1
      if (item.state === 'dropped') counts.dropped += 1
      if (item.picked || item.priority) counts.picked += 1
    }
  }
  return counts
}

/** Wire payload for the Client panel. */
function payloadOf(path, text) {
  const state = parseBoard(text)
  const sections = state.sections.map(section => ({
    title: section.title,
    items: section.items.map(item => ({
      index: item.index,
      state: item.state,
      text: item.text,
      priority: item.priority,
      picked: item.picked,
      dropped: item.dropped,
      start: item.start,
      seq: item.seq,
      detail: item.detail,
    })),
  }))
  const exists = text !== null && text !== ''
  return {
    ok: true,
    exists,
    path: BOARD_RELATIVE,
    title: state.projectTitle,
    goal: state.goal,
    sections: exists ? sections : [],
    counts: countBoard(exists ? sections : []),
    now: Date.now(),
  }
}

/** Read the board file, or null when it does not exist yet. */
function readBoardFile(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Persist one board text, creating `.dsh` on demand. */
function writeBoardFile(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

/** Find one parsed item plus its enclosing board state. */
function locateItem(text, index) {
  const state = parseBoard(text)
  for (const section of state.sections) {
    for (const item of section.items) {
      if (item.index === index) return { state, item }
    }
  }
  return { state, item: null }
}

/** Apply a header-level change to one item and persist. */
function mutateItem(path, text, index, change) {
  const { item } = locateItem(text, index)
  if (item === null) return { ok: false, error: 'no-such-item' }
  const next = { ...item, ...change }
  const lines = String(text).split('\n')
  lines[item.line] = itemLine(next)
  const updated = lines.join('\n')
  writeBoardFile(path, updated)
  return payloadOf(path, updated)
}

/** Append a `批注：` line under one item and persist. */
function appendNote(path, text, index, note) {
  const { item } = locateItem(text, index)
  if (item === null) return { ok: false, error: 'no-such-item' }
  const lines = String(text).split('\n')
  const at = item.lastDetailLine + 1
  lines.splice(at, 0, `  批注：${note}`)
  const updated = lines.join('\n')
  writeBoardFile(path, updated)
  return payloadOf(path, updated)
}

/** Assign `@序` to the given indices in the given order. */
function reorderItems(path, text, order) {
  const { state } = locateItem(text, Number.MAX_SAFE_INTEGER)
  const byIndex = new Map()
  for (const section of state.sections) {
    for (const item of section.items) byIndex.set(item.index, item)
  }
  const lines = String(text).split('\n')
  order.forEach((index, position) => {
    const item = byIndex.get(index)
    if (item === undefined) return
    lines[item.line] = itemLine({ ...item, seq: position + 1 })
  })
  const updated = lines.join('\n')
  writeBoardFile(path, updated)
  return payloadOf(path, updated)
}

/** Replace or insert the board's `> 目标：` line. */
function setGoal(path, text, goal) {
  const lines = String(text).split('\n')
  const goalIndex = lines.findIndex(line => /^>\s*目标[：:]/u.test(line.trim()))
  if (goalIndex >= 0) lines[goalIndex] = `> 目标：${goal}`
  else {
    const titleIndex = lines.findIndex(line => /^#\s+/u.test(line))
    lines.splice(titleIndex >= 0 ? titleIndex + 1 : 0, 0, '', `> 目标：${goal}`)
  }
  const updated = lines.join('\n')
  writeBoardFile(path, updated)
  return payloadOf(path, updated)
}

/** Human-readable grouped summary for a bare `/aboard`. */
function renderSummary(payload) {
  if (!payload.exists) {
    return `计划板还没有内容。文件：${BOARD_RELATIVE}\n让我拆任务，或直接按 markdown 勾选列表写进这个文件。`
  }
  const counts = payload.counts
  const lines = [
    `计划板 · 完成 ${counts.done}/${counts.total} · 进行中 ${counts.doing} · 已选 ${counts.picked} · 已否决 ${counts.dropped}`,
  ]
  if (payload.goal) lines.push(`目标：${payload.goal}`)
  for (const section of payload.sections) {
    const done = section.items.filter(item => item.state === 'done').length
    lines.push('', `## ${section.title}  ${done}/${section.items.length}`)
    for (const item of section.items) {
      const glyph = item.state === 'done' ? '[x]' : item.state === 'doing' ? '[~]' : item.state === 'dropped' ? '[-]' : '[ ]'
      const tags = [item.priority, item.picked ? '选' : null, item.state === 'dropped' ? '弃' : null].filter(Boolean)
      lines.push(`${glyph} ${item.index}. ${item.text}${tags.length > 0 ? `  @${tags.join(' @')}` : ''}`)
    }
  }
  lines.push('', `文件：${BOARD_RELATIVE}`)
  return lines.join('\n')
}

/** One plain-language briefing of an item, used for the follow-up message. */
function renderBriefing(item) {
  const lines = [`标题：${item.text}`]
  for (const line of item.detail.how) lines.push(`做法：${line}`)
  for (const line of item.detail.accept) lines.push(`验收：${line}`)
  for (const line of item.detail.notes) lines.push(`批注（来自用户）：${line}`)
  if (item.priority) lines.push(`优先级：${item.priority}`)
  return lines.join('\n')
}

/** Wrap a briefing into the user message that wakes the agent. */
function taskMessage(item) {
  const text = `【计划板】做第 ${item.index} 条。执行约定：加载 skill \`plan-board\`。`
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: plainText(text) }],
    source: { kind: 'user' },
  }
}

/** Mark one item as in progress and wake the agent with its briefing. */
function startItem(agent, path, text, index) {
  const { item } = locateItem(text, index)
  if (item === null) return { payload: { ok: false, error: 'no-such-item' }, injected: false }
  const payload = mutateItem(path, text, index, { state: 'doing', start: stamp(), dropped: false, picked: true })
  try {
    agent.followup(taskMessage(item))
  } catch (error) {
    // Leave the board unchanged when the wake-up cannot be delivered.
    const current = readBoardFile(path)
    const reverted = current === null
      ? payload
      : mutateItem(path, current, index, { state: item.state, start: item.start, picked: item.picked })
    return {
      payload: (reverted && reverted.ok ? reverted : payload),
      injected: false,
      injectError: error && error.message ? error.message : String(error),
    }
  }
  return { payload, injected: true }
}

/** First item of the user's queue: picked or prioritised, not done or dropped. */
function nextQueueItem(text) {
  const { state } = locateItem(text, Number.MAX_SAFE_INTEGER)
  const queue = state.sections
    .flatMap(section => section.items)
    .filter(item => (item.picked || item.priority) && item.state !== 'done' && item.state !== 'dropped')
    .sort((a, b) => {
      const as = a.seq === null || a.seq === undefined ? 99 : a.seq
      const bs = b.seq === null || b.seq === undefined ? 99 : b.seq
      if (as !== bs) return as - bs
      const ap = a.priority ? PRIORITIES.indexOf(a.priority) : 99
      const bp = b.priority ? PRIORITIES.indexOf(b.priority) : 99
      return ap - bp
    })
  return queue[0] || null
}

/** Neutralise @tokens so chat renders the injected text as prose, not reference chips. */
function plainText(text) {
  return String(text).replace(/@/gu, '＠')
}

/** Compose the dispatch message for a batch of tasks. */
function batchMessage(items, mode) {
  const body = items.map(item => [
    `第 ${item.index} 条：${item.text}`,
    ...item.detail.how.map(line => `  做法：${line}`),
    ...item.detail.accept.map(line => `  验收：${line}`),
    ...item.detail.notes.map(line => `  批注（来自用户）：${line}`),
    item.priority ? `  优先级：${item.priority}` : null,
  ].filter(Boolean).join('\n')).join('\n\n')
  const indices = items.map(item => item.index).join('、')
  const text = mode === 'parallel'
    ? `【计划板】并行做第 ${indices} 条（每条一个子代理）。执行约定：加载 skill \`plan-board\`。`
    : `【计划板】串行做第 ${indices} 条。执行约定：加载 skill \`plan-board\`。`
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: plainText(text) }],
    source: { kind: 'user' },
  }
}

/** Mark a batch of items and wake the agent once for the whole batch. */
function startBatch(agent, path, text, indices, mode) {
  let current = text
  const picked = []
  let lastPayload = null
  for (const index of indices) {
    const found = locateItem(current, index)
    if (found.item === null) continue
    if (found.item.state === 'done' || found.item.state === 'dropped') continue
    const markDoing = mode === 'parallel' || picked.length === 0
    lastPayload = mutateItem(path, current, index, markDoing
      ? { state: 'doing', start: stamp(), picked: true, dropped: false }
      : { picked: true })
    current = readBoardFile(path)
    picked.push(found.item)
  }
  if (picked.length === 0) return { payload: lastPayload || payloadOf(path, text), injected: false, error: 'no-eligible-item' }
  try {
    agent.followup(batchMessage(picked, mode))
  } catch (error) {
    const restored = readBoardFile(path)
    if (restored !== null) {
      for (const item of picked) {
        mutateItem(path, restored, item.index, { state: item.state, start: item.start, picked: item.picked })
      }
    }
    return { payload: payloadOf(path, readBoardFile(path) || ''), injected: false, error: error && error.message ? error.message : String(error) }
  }
  return { payload: lastPayload || payloadOf(path, current), injected: true, count: picked.length }
}

/** Run one `/aboard` invocation. */
function handleCommand(agent, rawInput) {
  const invocationAgent = agent
  const path = boardPathOf(agent)
  if (path === null) return { kind: 'error', text: '找不到这个会话的工作区目录，计划板没法定位文件。' }
  const text = readBoardFile(path)
  const input = String(rawInput || '').trim()
  const parts = input.length === 0 ? [''] : input.split(/\s+/u)
  const verb = parts[0]
  const rest = parts.slice(1)
  const payload = () => payloadOf(path, text)

  if (verb === '') {
    // The Client renders this with its own card; structured data keeps it rich.
    return { kind: 'success', text: JSON.stringify({ ...payloadOf(path, text), summary: renderSummary(payload()) }) }
  }
  if (verb === 'list') {
    return { kind: 'success', text: renderSummary(payload()) }
  }
  if (verb === 'json') {
    return { kind: 'success', text: JSON.stringify(payload()) }
  }
  if (verb === 'goal') {
    const goal = rest.join(' ').trim()
    if (goal === '') return { kind: 'error', text: '要给一个目标：/aboard goal 把看板做成能用的工作台' }
    return { kind: 'success', text: JSON.stringify(setGoal(path, text, goal)) }
  }
  if (verb === 'clear') {
    if (text === null) return { kind: 'success', text: JSON.stringify(payloadOf(path, null)) }
    const state = parseBoard(text)
    const lines = String(text).split('\n')
    let cleared = 0
    for (const section of state.sections) {
      for (const item of section.items) {
        if (item.state === 'doing') continue
        if (!item.picked && !item.priority && (item.seq === null || item.seq === undefined)) continue
        lines[item.line] = itemLine({ ...item, picked: false, priority: null, seq: null })
        cleared += 1
      }
    }
    const updated = lines.join('\n')
    writeBoardFile(path, updated)
    return { kind: 'success', text: JSON.stringify({ ...payloadOf(path, updated), cleared }) }
  }

  if (verb === 'reorder') {
    const order = rest.join(',').split(',').map(value => Number.parseInt(value.trim(), 10)).filter(Number.isInteger)
    if (order.length === 0) return { kind: 'error', text: '要给一个顺序：/aboard reorder 3,1,2' }
    return { kind: 'success', text: JSON.stringify(reorderItems(path, text, order)) }
  }

  if (verb === 'batch') {
    const mode = rest[0] === 'parallel' ? 'parallel' : 'serial'
    const indices = rest.slice(1).join(',').split(',').map(value => Number.parseInt(value.trim(), 10)).filter(Number.isInteger)
    if (indices.length === 0) return { kind: 'error', text: '要给一批任务序号：/aboard batch serial 4,5,6' }
    const started = startBatch(invocationAgent, path, text, indices, mode)
    if (started.error === 'no-eligible-item') {
      return { kind: 'error', text: '这批任务都已完成或已否决，没有可做的。' }
    }
    return {
      kind: 'success',
      text: JSON.stringify({ ...started.payload, injected: started.injected, count: started.count, injectError: started.error }),
    }
  }

  if (verb === 'next') {
    const candidate = nextQueueItem(text)
    if (candidate === null) {
      return { kind: 'error', text: '「接下来」里还没有可做的任务：先点任务左边的圈把它选上，或设一个 P0–P3。' }
    }
    const started = startItem(invocationAgent, path, text, candidate.index)
    if (started.payload && started.payload.ok === false) {
      return { kind: 'error', text: `选中的任务定位失败：${started.payload.error}` }
    }
    return {
      kind: 'success',
      text: JSON.stringify({ ...started.payload, started: candidate.index, injected: started.injected, injectError: started.injectError }),
    }
  }

  const index = Number.parseInt(rest[0] || '', 10)
  if (!Number.isInteger(index) || index <= 0) {
    return { kind: 'error', text: '要指定第几条：/aboard pick 3、/aboard prio 3 P1、/aboard done 3。' }
  }

  if (verb === 'start') {
    const started = startItem(invocationAgent, path, text, index)
    if (started.payload && started.payload.ok === false) {
      return { kind: 'error', text: `改不动这条：${started.payload.error}` }
    }
    return {
      kind: 'success',
      text: JSON.stringify({ ...started.payload, started: index, injected: started.injected, injectError: started.injectError }),
    }
  }

  let result = null
  if (verb === 'pick') {
    const { item } = locateItem(text, index)
    if (item === null) return { kind: 'error', text: '改不动这条：no-such-item' }
    result = mutateItem(path, text, index, { picked: !item.picked })
  }
  else if (verb === 'prio' || verb === 'priority') {
    const value = (rest[1] || '').toUpperCase()
    result = mutateItem(path, text, index, { priority: PRIORITIES.includes(value) ? value : null })
  } else if (verb === 'doing') result = mutateItem(path, text, index, { state: 'doing', start: stamp(), dropped: false })
  else if (verb === 'done') result = mutateItem(path, text, index, { state: 'done', start: null })
  else if (verb === 'undone') result = mutateItem(path, text, index, { state: 'todo', start: null })
  else if (verb === 'drop') result = mutateItem(path, text, index, { state: 'dropped', dropped: true, start: null })
  else if (verb === 'undrop') result = mutateItem(path, text, index, { state: 'todo', dropped: false })
  else if (verb === 'note') {
    const note = rest.slice(1).join(' ').trim()
    if (note === '') return { kind: 'error', text: '要写批注内容：/aboard note 3 这条验收太含糊' }
    result = appendNote(path, text, index, note)
  } else {
    return {
      kind: 'error',
      text: `不认识的子命令 ${verb}。可用：list / json / pick / prio / doing / done / undone / drop / undrop / note / reorder / goal。`,
    }
  }

  // `mutateItem` accepts a change object; the pick branch passes a function.
  if (typeof result === 'object' && result !== null && result.ok === false) {
    return { kind: 'error', text: `改不动这条：${result.error}` }
  }
  return { kind: 'success', text: JSON.stringify(result) }
}

/** Empty board used when a write arrives before the file exists. */
function blankBoard() {
  return ['# 计划板', '', '> 目标：先在对话里说清这一轮要达成什么。', ''].join('\n')
}

/** Render one item into board lines. */
function itemLines(item) {
  const tags = item.priority ? `  @${item.priority}` : ''
  return [
    `- [ ] ${item.title}${tags}`,
    `  做法：${item.how}`,
    `  验收：${item.accept}`,
  ]
}

/** Split a board text into line blocks per section. */
function sectionBounds(lines, heading) {
  const wanted = heading.startsWith('## ') ? heading.trim() : `## ${heading.trim()}`
  const start = lines.findIndex(line => line.trim() === wanted)
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/u.test(lines[i])) { end = i; break }
  }
  return { start, end }
}

/** Write one section: append its items, or replace the whole section body. */
function writeSection(path, text, heading, blocks, mode) {
  const lines = (text === null || text === '' ? blankBoard() : text).split('\n')
  const bounds = sectionBounds(lines, heading)
  if (bounds === null) {
    const appended = [...lines]
    if (appended[appended.length - 1] === '' || appended.length === 0) { /* keep */ } else appended.push('')
    appended.push(`## ${heading.trim()}`, '', ...blocks, '')
    const next = appended.join('\n')
    writeBoardFile(path, next)
    return payloadOf(path, next)
  }
  if (mode === 'replace') {
    const head = lines.slice(0, bounds.start + 1)
    const tail = lines.slice(bounds.end)
    const next = [...head, '', ...blocks, '', ...tail].join('\n').replace(/\n{3,}/gu, '\n\n')
    writeBoardFile(path, next)
    return payloadOf(path, next)
  }
  let insertAt = bounds.end
  while (insertAt > bounds.start + 1 && lines[insertAt - 1].trim() === '') insertAt -= 1
  const next = [...lines.slice(0, insertAt), '', ...blocks, ...lines.slice(insertAt)].join('\n').replace(/\n{3,}/gu, '\n\n')
  writeBoardFile(path, next)
  return payloadOf(path, next)
}

/** Shared output declaration for both board tools. */
function toolOutput() {
  return {
    // Annotation-only schema: the registry accepts this unconstrained-JSON form.
    schema: {},
    render: (_args, value) => [{
      type: 'text',
      text: String(value && value.summary ? value.summary : JSON.stringify(value)),
    }],
  }
}

/** Reject items that are not written as complete, human sentences. */
function validateItems(items) {
  const problems = []
  items.forEach((item, position) => {
    const title = String((item && item.title) || '').trim()
    const how = String((item && item.how) || '').trim()
    const accept = String((item && item.accept) || '').trim()
    const label = `第 ${position + 1} 条`
    if (title.length < 20) {
      problems.push(`${label}标题只有 ${title.length} 字：「${title}」。至少要 20 字，写清做什么和做出什么效果，不许写成「打通 API」这种缩写。`)
    }
    if (how.length < 8) problems.push(`${label}缺「做法」：写清具体怎么做，至少 8 个字。`)
    if (accept.length < 8) problems.push(`${label}缺「验收」：写清怎么算做完，最好带可验证的数字或现象。`)
  })
  return problems
}

/** `plan_board_write`: validated creation or replacement of one section. */
async function runWriteTool(args, exec) {
  const agent = exec && exec.agent
  const path = boardPathOf(agent)
  if (path === null) throw new Error('找不到当前会话的工作区目录，写不了计划板。')
  const section = String((args && args.section) || '').trim()
  if (section === '') throw new Error('缺少 section：给出分组标题，例如「P3 · 模型侧」。')
  const items = Array.isArray(args && args.items) ? args.items : []
  if (items.length === 0) throw new Error('items 为空：至少给一条任务。')
  const problems = validateItems(items)
  if (problems.length > 0) {
    throw new Error(`条目不够详细，已拒绝写入：\n- ${problems.join('\n- ')}`)
  }
  const mode = args && args.mode === 'replace' ? 'replace' : 'append'
  const blocks = []
  for (const item of items) {
    blocks.push(...itemLines({
      title: String(item.title).trim(),
      how: String(item.how).trim(),
      accept: String(item.accept).trim(),
      priority: item.priority && /^P[0-3]$/u.test(item.priority) ? item.priority : null,
    }))
  }
  const payload = writeSection(path, readBoardFile(path), section, blocks, mode)
  const counts = payload.counts
  return {
    summary: `已写入 ${items.length} 条到「${section}」（${mode === 'replace' ? '替换' : '追加'}）。`
      + `当前看板：完成 ${counts.done}/${counts.total}，进行中 ${counts.doing}。`,
    section,
    written: items.length,
    counts,
  }
}

/** `plan_board_status`: move one item between todo / doing / done / dropped. */
async function runStatusTool(args, exec) {
  const agent = exec && exec.agent
  const path = boardPathOf(agent)
  if (path === null) throw new Error('找不到当前会话的工作区目录，改不了计划板。')
  const index = Number(args && args.index)
  const state = String((args && args.state) || '')
  if (!Number.isInteger(index) || index <= 0) throw new Error('index 必须是正整数，对应看板条目的序号。')
  const allowed = ['todo', 'doing', 'done', 'dropped']
  if (!allowed.includes(state)) throw new Error(`state 只能是 ${allowed.join(' / ')}。`)
  const text = readBoardFile(path)
  const found = locateItem(text || '', index)
  if (found.item === null) throw new Error(`计划板里没有第 ${index} 条任务。`)
  const change = state === 'doing'
    ? { state: 'doing', start: stamp(), dropped: false, picked: true }
    : state === 'done'
      ? { state: 'done', start: null }
      : state === 'dropped'
        ? { state: 'dropped', dropped: true, start: null }
        : { state: 'todo', start: null, dropped: false }
  const payload = mutateItem(path, text, index, change)
  if (!payload || payload.ok !== true) throw new Error(`改不动第 ${index} 条：${payload && payload.error ? payload.error : 'unknown'}`)
  const label = { todo: '未开始', doing: '进行中', done: '已完成', dropped: '已否决' }[state]
  return {
    summary: `第 ${index} 条已标为「${label}」：${found.item.text}`,
    index,
    state,
    counts: payload.counts,
  }
}

/** Register the one command that serves the person and the panel. */
export function apply(ctx) {
  const tools = ctx.get ? ctx.get('tools') : ctx.tools
  if (tools !== undefined && tools !== null) {
    try {
      tools.register({
        name: 'plan_board_write',
        description: '把任务写进工作区的计划板（.dsh/plan-board.md）。每条必须给出标题、做法、验收；标题少于 20 字或缺少做法/验收会被拒绝，要求改写成完整人话。',
        parameters: {
          type: 'object',
          properties: {
            section: { type: 'string', description: '分组标题，例如「P3 · 模型侧」；不存在时会新建。' },
            mode: { type: 'string', enum: ['append', 'replace'], description: 'append 追加到该分组（默认），replace 替换该分组全部条目。' },
            items: {
              type: 'array',
              description: '要写入的任务。',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: '一句完整人话的任务标题，至少 20 字。' },
                  how: { type: 'string', description: '具体做法。' },
                  accept: { type: 'string', description: '怎么算做完，尽量可验证。' },
                  priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
                },
                required: ['title', 'how', 'accept'],
                additionalProperties: false,
              },
            },
          },
          required: ['section', 'items'],
          additionalProperties: false,
        },
        output: toolOutput(),
        execute: runWriteTool,
      })
      tools.register({
        name: 'plan_board_status',
        description: '更新计划板里某一条任务的状态：doing 进行中（记录开始时间）、done 完成、dropped 否决、todo 回到待做。',
        parameters: {
          type: 'object',
          properties: {
            index: { type: 'number', description: '条目序号，从看板上读到的数字。' },
            state: { type: 'string', enum: ['todo', 'doing', 'done', 'dropped'] },
          },
          required: ['index', 'state'],
          additionalProperties: false,
        },
        output: toolOutput(),
        execute: runStatusTool,
      })
    } catch (error) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('plan-board: tool registration failed: %s', error && error.message ? error.message : String(error))
      }
    }
  }
  ctx.commands.register({
    name: 'aboard',
    description: '查看并整理计划看板',
    input: { hint: '[list|json|next|batch <serial|parallel> <i,j,k>|start <n>|pick <n>|prio <n> <P0-P3>|doing <n>|done <n>|undone <n>|drop <n>|undrop <n>|note <n> <text>|clear|reorder <i,j,k>|goal <text>]' },
    handler: invocation => handleCommand(invocation.agent, invocation.rawInput),
  })
}
