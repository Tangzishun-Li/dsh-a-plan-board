/**
 * Client half of the plan board bundle (v3).
 *
 * Surfaces:
 *   1. left-navigation icon      (sidebar.panellist)
 *   2. full page                 (main)
 *   3. conversation view tab     (conversation.view)
 *   4. chat row for /aboard      (conversation.chat.commandview)
 *
 * Data: `.dsh/plan-board.md` is the source of truth. Reads use the read-only
 * workspace-files Remote, writes go through the Host `/aboard` command.
 */
window.__ModuleLoader__.load({
  id: '@local/plan-board',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const BOARD_PATH = '.dsh/plan-board.md'
    const PRIORITIES = ['P0', 'P1', 'P2', 'P3']
    const POLL_MS = 3000
    const TIMEOUT_MS = 4000
    // Raw state colours fail WCAG on the light theme (success 2.28:1, warn 2.15:1,
    // idle 1.48:1), so text and small glyphs use the ink mix below, which measures
    // about 5.8 / 5.6 / 5.5:1 on light and 9.6 / 10.0 / 5.2:1 on dark.
    const inkMix = (name, share) => `color-mix(in srgb, var(--dsw-alias-${name}) ${share}%, var(--dsw-alias-label-primary))`
    const STATE_COLOR = {
      todo: inkMix('state-idle-primary', 45),
      doing: 'var(--dsw-alias-brand-primary)',
      done: inkMix('state-success-primary', 55),
      dropped: inkMix('state-idle-primary', 45),
    }

    const api = { ctx: null, files: null, commands: null, layout: null, locale: null }

    /** English copy, keyed by the Chinese source string used in the components. */
    const EN = {
      '计划板': 'Plan board',
      '运行中': 'Running',
      '空闲': 'Idle',
      '进行中': 'In progress',
      '已暂停': 'Paused',
      '等待开始': 'Waiting to start',
      '正在做 · {n}': 'In progress · {n}',
      '{n} 条': '{n}',
      '排队': 'Queued',
      '排队 {n} 条': '{n} queued',
      '排队中 · {n} 条': 'Queued · {n}',
      '还有 {n} 条在「接下来」里': '{n} more in Next up',
      '接下来': 'Next up',
      '整体': 'All tasks',
      '{n} 条 · {m} 个阶段': '{n} tasks · {m} phases',
      '{m} 个阶段': '{m} phases',
      '搜索': 'Search',
      '刷新': 'Refresh',
      '目标：{text}': 'Goal: {text}',
      '已完成 {n}': '{n} done',
      '收起': 'Collapse',
      '展开': 'Expand',
      '收起做法与验收': 'Hide how/accept',
      '展开做法与验收': 'Show how/accept',
      '做法': 'How',
      '验收': 'Accept',
      '批注': 'Comment',
      '加批注': 'Add comment',
      '保存批注': 'Save comment',
      '取消': 'Cancel',
      '写一句批注：哪儿不对、为什么不要、想要什么…': 'Add a comment: what is off, why not, what you want…',
      '不要这条（灰掉保留）': 'Not this one (kept, greyed)',
      '恢复这条': 'Restore',
      '选择这条': 'Select',
      '取消选择': 'Deselect',
      '设置优先级：P0 → P1 → P2 → P3 → 空': 'Priority: P0 → P1 → P2 → P3 → none',
      '简略': 'Thin',
      '缺验收或标题太短，建议补详细': 'Missing acceptance or too short',
      '标记完成': 'Mark done',
      '串行': 'Serial',
      '并行': 'Parallel',
      '一条做完再做下一条': 'One at a time',
      '每条派一个子代理同时跑': 'One subagent per task',
      '让他做这批': 'Dispatch',
      '让他做这批 · {n}': 'Dispatch · {n}',
      '清空队列（任务本身不会被删除）': 'Clear the queue (tasks are kept)',
      '清空「接下来」里的全部选择和优先级？任务本身会保留，正在做的条目不受影响。': 'Clear every pick and priority in Next up? Tasks are kept and running items are untouched.',
      '确认清空': 'Clear',
      '把左边的任务拖进来，或者点任务左边的圈。做完的条目会自动离开这里。': 'Drag tasks here, or click the circle. Finished tasks leave on their own.',
      '没有匹配的任务。': 'No matching tasks.',
      '还没有计划': 'No plan yet',
      '① 让我拆任务；② 或直接编辑 .dsh/plan-board.md；③ 或输入 /aboard 看摘要。': '① Ask me to break it down; ② or edit .dsh/plan-board.md; ③ or type /aboard.',
      '会话在跑，但还没有标记进行中的任务。': 'Running, but no task is marked in progress.',
      '会话正在运行，但没有标记正在做的任务。': 'The session is running without a task marked in progress.',
      '还没有正在做的任务。把要做的事选进「接下来」，再点「让他做这批」。': 'Nothing in progress. Pick tasks into Next up, then hit Dispatch.',
      '正在读取计划文件…': 'Reading the plan file…',
      '读不到计划文件（自检）': 'Cannot read the plan file (self-check)',
      '先打开任意一个会话，计划板才知道该看哪个工作区的文件。': 'Open a session first so the board knows which workspace to read.',
      '服务未注入': 'service not injected',
      '数据：工作区文件': 'Data: workspace file',
      '数据：Host 命令': 'Data: host command',
      ' · ↑↓ 移动 · 空格选择 · 0–3 优先级 · Enter 进行中 · 拖拽进「接下来」': ' · ↑↓ move · Space select · 0–3 priority · Enter start · drag into Next up',
      '拖到右边加入「接下来」': 'Drag into Next up',
      '拖动排序': 'Drag to reorder',
      '看板还是空的，先让我拆一批任务。': 'The board is empty — ask me to break down a batch.',
      '打开看板': 'Open board',
      '没能唤醒模型：{msg}': 'Could not wake the model: {msg}',
      '选': 'pick',
    }

    /** Active locale id, defaulting to Chinese when the service is missing. */
    function currentLang() {
      try {
        if (!api.locale) return 'zh'
        const snap = typeof api.locale.getSnapshot === 'function'
          ? api.locale.getSnapshot()
          : (typeof api.locale.getLocale === 'function' ? api.locale.getLocale() : null)
        const active = snap && typeof snap.active === 'string' ? snap.active : 'zh'
        return active
      } catch (error) {
        return 'zh'
      }
    }

    /** Translate one Chinese source string; `{name}` placeholders are interpolated. */
    function t(template, vars) {
      const english = String(currentLang()).toLowerCase().startsWith('en')
      let text = english && EN[template] !== undefined ? EN[template] : template
      if (vars) {
        for (const key of Object.keys(vars)) {
          text = text.split(`{${key}}`).join(String(vars[key]))
        }
      }
      return text
    }

    /** Re-render whenever the active locale changes. */
    function useLocaleTick() {
      const [, bump] = useState(0)
      useEffect(() => {
        if (!api.locale || typeof api.locale.subscribe !== 'function') return undefined
        return api.locale.subscribe(() => bump(value => value + 1))
      }, [])
    }

    /** Reject after `ms` so a broken carrier cannot hang the panel. */
    function withTimeout(promise, ms, label) {
      return Promise.race([
        promise,
        new Promise((_resolve, reject) => { setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms) }),
      ])
    }

    /** Split trailing `@tag` tokens from one item's text. */
    function splitTags(body) {
      const tags = []
      const text = body.replace(/\s*@([\p{L}\p{N}][\p{L}\p{N}_=:.-]*)/gu, (_match, tag) => {
        tags.push(tag)
        return ''
      })
      const startTag = tags.find(tag => tag.startsWith('start='))
      const seqTag = tags.find(tag => tag.startsWith('序='))
      return {
        text: text.trim(),
        priority: tags.find(tag => /^P[0-3]$/u.test(tag)) || null,
        picked: tags.includes('选'),
        dropped: tags.includes('弃'),
        start: startTag ? startTag.slice(6) : null,
        seq: seqTag ? Number.parseInt(seqTag.slice(2), 10) : null,
      }
    }

    /** Parse one board text into the payload shape the Host also returns. */
    function parsePayload(text) {
      const lines = String(text || '').split('\n')
      const sections = []
      let goal = null
      let title = null
      let current = null
      let last = null
      let index = 0
      for (const raw of lines) {
        const line = raw.replace(/\s+$/u, '')
        const heading = /^#\s+(.+)$/u.exec(line)
        if (heading) { title = heading[1].trim(); continue }
        const goalLine = /^>\s*目标[：:]\s*(.*)$/u.exec(line.trim())
        if (goalLine) { goal = goalLine[1].trim(); continue }
        const section = /^##\s+(.+)$/u.exec(line)
        if (section) { current = { title: section[1].trim(), items: [] }; sections.push(current); last = null; continue }
        const item = /^- \[([ x~-])\]\s+(.+)$/u.exec(line)
        if (item) {
          const parsed = splitTags(item[2])
          index += 1
          const state = item[1] === 'x' ? 'done' : item[1] === '~' ? 'doing' : item[1] === '-' ? 'dropped' : 'todo'
          if (current === null) { current = { title: '', items: [] }; sections.push(current) }
          last = {
            index, state, text: parsed.text, priority: parsed.priority, picked: parsed.picked,
            dropped: parsed.dropped || state === 'dropped', start: parsed.start, seq: parsed.seq,
            detail: { how: [], accept: [], notes: [] },
          }
          current.items.push(last)
          continue
        }
        const detail = /^\s{2,}(做法|验收|批注|备注)[：:]\s*(.*)$/u.exec(line)
        if (detail && last !== null) {
          const value = detail[2].trim()
          if (detail[1] === '做法') last.detail.how.push(value)
          else if (detail[1] === '验收') last.detail.accept.push(value)
          else last.detail.notes.push(value)
        }
      }
      const kept = sections.filter(section => section.items.length > 0)
      return { ok: true, exists: kept.length > 0, path: BOARD_PATH, title, goal, sections: kept, counts: countPayload(kept), now: Date.now() }
    }

    /** Totals over parsed sections. */
    function countPayload(sections) {
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

    const EMPTY_PAYLOAD = { ok: true, exists: false, path: BOARD_PATH, title: null, goal: null, sections: [], counts: countPayload([]), now: Date.now() }

    /** Read through the read-only workspace-files Remote. */
    async function readViaFiles(sessionId) {
      if (!api.files || typeof api.files.read !== 'function') return { label: 'files', ok: false, reason: t('服务未注入') }
      const started = Date.now()
      try {
        const result = await withTimeout(api.files.read(sessionId, BOARD_PATH, {}), TIMEOUT_MS, 'workspaceFiles.read')
        const ms = Date.now() - started
        if (result && result.ok === true) return { label: 'files', ok: true, ms, payload: parsePayload(result.value.text) }
        const code = result && result.error ? result.error.code : 'unknown'
        if (code === 'workspace-file/not-found') return { label: 'files', ok: true, ms, payload: EMPTY_PAYLOAD }
        return { label: 'files', ok: false, ms, reason: String(code) }
      } catch (error) {
        return { label: 'files', ok: false, ms: Date.now() - started, reason: error && error.message ? error.message : String(error) }
      }
    }

    /** Run one Host command and parse its JSON payload. */
    async function runCommand(sessionId, line) {
      if (!api.commands || typeof api.commands.execute !== 'function') return { label: 'command', ok: false, reason: t('服务未注入') }
      const started = Date.now()
      try {
        const result = await withTimeout(api.commands.execute(sessionId, line, []), TIMEOUT_MS, 'commands.execute')
        const ms = Date.now() - started
        if (!result || result.ok !== true) {
          const detail = result && result.error ? `${result.error.code}: ${result.error.message}` : 'refused'
          return { label: 'command', ok: false, ms, reason: detail }
        }
        const outcome = result.value && result.value.result
        if (!outcome || outcome.kind !== 'success' || typeof outcome.text !== 'string') {
          return { label: 'command', ok: false, ms, reason: outcome && outcome.text ? outcome.text : 'empty result' }
        }
        try {
          return { label: 'command', ok: true, ms, payload: JSON.parse(outcome.text) }
        } catch (error) {
          return { label: 'command', ok: false, ms, reason: `payload is not JSON: ${String(error.message || error)}` }
        }
      } catch (error) {
        return { label: 'command', ok: false, ms: Date.now() - started, reason: error && error.message ? error.message : String(error) }
      }
    }

    /** Read the board: files first, Host command as the fallback. */
    async function readBoard(sessionId) {
      const files = await readViaFiles(sessionId)
      if (files.ok) return { phase: 'ready', payload: files.payload, via: 'files', diag: [] }
      const command = await runCommand(sessionId, '/aboard json')
      if (command.ok) return { phase: 'ready', payload: command.payload, via: 'command', diag: [] }
      return { phase: 'diag', payload: null, via: null, diag: [files, command] }
    }

    /** Session id of the panel: the slot prop, or the main-view session. */
    function useCurrentSessionId(props) {
      const direct = props && props.sessionId ? props.sessionId : undefined
      const useSessions = props && props.useSessions
      const fromStore = typeof useSessions === 'function'
        ? useSessions(state => {
          const byId = state && state.byId ? Object.values(state.byId) : []
          const active = byId.find(session => session && session.retainedBy && session.retainedBy.mainView > 0)
          return (active || byId[0] || {}).id
        })
        : undefined
      return direct !== undefined ? direct : fromStore
    }

    /** Live board state with polling and mutations. */
    function useBoard(sessionId) {
      const [state, setState] = useState({ phase: 'loading', payload: null, via: null, diag: [], notice: null, tick: 0 })
      const load = useCallback(async () => {
        if (sessionId === undefined) {
          setState(prev => ({ ...prev, phase: 'no-session', payload: null, via: null, diag: [] }))
          return
        }
        const next = await readBoard(sessionId)
        setState(prev => ({ ...next, tick: prev.tick }))
      }, [sessionId])

      useEffect(() => { void load() }, [load])
      const via = state.via
      useEffect(() => {
        if (sessionId === undefined) return undefined
        const timer = setInterval(() => { void load() }, via === 'files' ? POLL_MS : POLL_MS * 5)
        return () => clearInterval(timer)
      }, [load, sessionId, via])

      const act = useCallback(async line => {
        if (sessionId === undefined) return
        const result = await runCommand(sessionId, line)
        if (result.ok) {
          const notice = result.payload && result.payload.injectError
            ? t('没能唤醒模型：{msg}', { msg: result.payload.injectError })
            : null
          setState(prev => ({ ...prev, phase: 'ready', payload: result.payload, via: 'command', notice }))
        } else {
          setState(prev => ({ ...prev, phase: 'diag', diag: [result] }))
        }
      }, [sessionId])

      return { ...state, reload: load, act }
    }

    /** Re-render on a one-second tick while `active`. */
    function useNow(active) {
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        if (!active) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active])
      return now
    }

    /** Local-time clock from an `@start` stamp. */
    function clockOf(start) {
      if (!start) return null
      const at = Date.parse(start)
      if (Number.isNaN(at)) return null
      const date = new Date(at)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    /** Human duration between an `@start` stamp and now. */
    function elapsedOf(start, now) {
      if (!start) return null
      const at = Date.parse(start)
      if (Number.isNaN(at)) return null
      const seconds = Math.max(0, Math.round((now - at) / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes}m ${seconds % 60}s`
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    }

    /** Detail completeness: missing acceptance or a too-short title. */
    function isThin(item) {
      return item.detail.accept.length === 0 || item.text.length < 20
    }

    /** Accent of one section rail: idle at 0%, brand while moving, success when complete. */
    function sectionTone(percent) {
      if (percent >= 100) return inkMix('state-success-primary', 55)
      if (percent > 0) return 'var(--dsw-alias-brand-primary)'
      return inkMix('state-idle-primary', 45)
    }

    const CSS = `
      .pb-panel { border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }
      .pb-topbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .pb-title { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.3; letter-spacing: 0.01em; }
      .pb-goal { font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pb-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; line-height: 1; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); white-space: nowrap; }
      .pb-chip[data-tone="success"] { color: var(--dsw-alias-label-primary); color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, var(--dsw-alias-label-primary)); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 9%, transparent); }
      .pb-chip[data-tone="brand"] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent); }
      .pb-chip[data-tone="warn"] { color: var(--dsw-alias-label-primary); color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-label-primary)); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent); }
      .pb-dot { width: 6px; height: 6px; border-radius: 999px; display: inline-block; background: var(--dsw-alias-state-success-primary); }
      .pb-dot[data-on="0"] { background: var(--dsw-alias-state-idle-primary); }
      .pb-dot[data-on="1"] { animation: pb-pulse 1.6s ease-in-out infinite; }
      @keyframes pb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      .pb-bar { height: 5px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
      .pb-bar > div { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--dsw-alias-brand-primary), var(--dsw-alias-state-success-primary)); transition: width 260ms ease; }
      .pb-search { box-sizing: border-box; font-family: inherit; font-size: 11px; line-height: 1.4; height: 26px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); outline: none; transition: border-color 120ms ease; }
      .pb-search:focus { border-color: var(--dsw-alias-brand-primary); }
      .pb-search::placeholder { color: var(--dsw-alias-label-secondary); }
      .pb-icon { width: 24px; height: 24px; flex: 0 0 24px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 7px; border: 1px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; transition: background 120ms ease, color 120ms ease, border-color 120ms ease; }
      .pb-icon:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
      .pb-icon[data-danger="1"]:hover { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent); }
      .pb-primary { display: inline-flex; align-items: center; gap: 6px; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); cursor: pointer; transition: filter 120ms ease, opacity 120ms ease; }
      .pb-primary:hover { filter: brightness(1.06); }
      .pb-primary[disabled] { opacity: 0.45; cursor: default; filter: none; }
      .pb-seg { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; overflow: hidden; background: var(--dsw-alias-bg-base); }
      .pb-seg button { font-family: inherit; font-size: 11px; line-height: 1; padding: 6px 9px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
      .pb-seg button[data-on="1"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); color: var(--dsw-alias-brand-primary); font-weight: 600; }
      .pb-row { display: grid; grid-template-columns: 14px 18px minmax(0, 1fr) auto auto; column-gap: 7px; align-items: start; padding: 7px 8px; border-radius: 10px; border: 1px solid transparent; transition: background 120ms ease, border-color 120ms ease; }
      .pb-row + .pb-row { margin-top: 1px; }
      .pb-row:hover { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l1); }
      .pb-row[data-cursor="1"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent); }
      .pb-row[data-doing="1"] { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
      .pb-row[data-dropped="1"] { opacity: 0.6; }
      .pb-handle { width: 14px; height: 20px; display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); opacity: 0.25; cursor: grab; font-size: 10px; letter-spacing: -1px; }
      .pb-row:hover .pb-handle { opacity: 0.8; }
      .pb-actions { display: flex; gap: 2px; align-items: center; }
      .pb-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; padding: 3px 6px; border-radius: 6px; font-family: inherit; font-size: 10px; line-height: 1; white-space: nowrap; cursor: pointer; color: var(--dsw-alias-label-secondary); border: 1px solid var(--dsw-alias-border-l1); background: transparent; }
      .pb-badge[data-p="P0"] { color: var(--dsw-alias-label-primary); color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-label-primary)); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 11%, transparent); }
      .pb-badge[data-p="P1"] { color: var(--dsw-alias-label-primary); color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-label-primary)); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 11%, transparent); }
      .pb-badge[data-p="P2"] { color: var(--dsw-alias-brand-primary); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, transparent); }
      .pb-badge[data-p="P3"] { color: var(--dsw-alias-label-secondary); border-color: var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-label-secondary) 9%, transparent); }
      .pb-badge[data-p="picked"] { color: var(--dsw-alias-brand-primary); border: 1px dashed var(--dsw-alias-brand-primary); }
      .pb-thin { font-size: 10px; line-height: 1; padding: 3px 6px; border-radius: 6px; white-space: nowrap; color: var(--dsw-alias-label-primary); color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-label-primary)); border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 40%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent); }
      .pb-section-head { display: flex; align-items: center; gap: 8px; padding: 7px 8px; cursor: pointer; user-select: none; border-radius: 9px; }
      .pb-section-head:hover { background: var(--dsw-alias-bg-layer-2); }
      .pb-rail { width: 3px; height: 14px; border-radius: 2px; display: inline-block; flex: 0 0 3px; }
      .pb-doing-strip { display: flex; flex-direction: column; max-height: 128px; overflow-y: auto; }
      .pb-doing-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 9px; }
      .pb-doing-row:hover { background: var(--dsw-alias-bg-layer-2); }
      .pb-note { font-size: 11px; line-height: 1.6; padding: 5px 9px; border-radius: 8px; border-left: 2px solid var(--dsw-alias-brand-primary); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .pb-dropzone { border-style: dashed !important; }
      .pb-spin { animation: pb-spin 1.1s linear infinite; }
      @keyframes pb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .pb-picks { position: sticky; top: 8px; align-self: start; max-height: calc(100vh - 80px); display: flex; flex-direction: column; min-height: 360px; }
      .pb-picks-scroll { flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; }
      .pb-dropzone[data-hover="1"] { border-color: var(--dsw-alias-brand-primary) !important; background: color-mix(in srgb, var(--dsw-alias-brand-primary) 7%, transparent) !important; }
    `

    const T = {
      page: {
        height: '100%', boxSizing: 'border-box', overflowY: 'auto',
        padding: '16px 20px 32px', background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', gap: '12px',
      },
      card: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' },
      cardTitle: { margin: 0, fontSize: '11px', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 },
      columns: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(220px, 300px)', gap: '12px', alignItems: 'start' },
      panel: { padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '100px' },
      itemText: { fontSize: '13px', lineHeight: 1.6, minWidth: 0, wordBreak: 'break-word' },
      itemTextDone: { color: 'var(--dsw-alias-label-secondary)', textDecoration: 'line-through' },
      itemTextDropped: { color: 'var(--dsw-alias-label-secondary)', textDecoration: 'line-through' },
      detail: { fontSize: '11px', lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' },
      detailLabel: { opacity: 0.8, marginRight: '5px' },
      meta: { fontSize: '11px', lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      warn: { fontSize: '11px', lineHeight: 1.6, padding: '6px 10px', borderRadius: '9px', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent)', color: 'var(--dsw-alias-label-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent)' },
      editor: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0 2px' },
      input: { boxSizing: 'border-box', width: '100%', fontFamily: 'inherit', fontSize: '12px', lineHeight: 1.5, padding: '6px 9px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', outline: 'none' },
      footer: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', opacity: 0.85 },
    }

    /** Stroke paths for the small icon set (16×16 grid, 1.5 stroke). */
    const ICON_PATHS = {
      pencil: ['M11.4 2.6l2 2-7.6 7.6-2.8.8.8-2.8z', 'M10.1 3.9l2 2'],
      close: ['M4.2 4.2l7.6 7.6', 'M11.8 4.2l-7.6 7.6'],
      restore: ['M3.2 8a4.8 4.8 0 1 0 1.5-3.5', 'M3.2 3.4v3h3'],
      chevronDown: ['M4.4 6.3l3.6 3.6 3.6-3.6'],
      chevronRight: ['M6.3 4.4l3.6 3.6-3.6 3.6'],
      refresh: ['M12.9 8a4.9 4.9 0 1 1-1.6-3.6', 'M12.9 3.2v3h-3'],
      check: ['M3.6 8.4l2.9 2.9 6-6.4'],
      grip: ['M6.2 4.4h.1', 'M9.7 4.4h.1', 'M6.2 8h.1', 'M9.7 8h.1', 'M6.2 11.6h.1', 'M9.7 11.6h.1'],
      trash: ['M4.4 5.4h7.2', 'M6.6 5.4V4.1h2.8v1.3', 'M5.8 5.4l.4 7h3.6l.4-7'],
    }

    /** One inline icon; inherits the surrounding color. */
    function Icon({ name, size }) {
      const dimension = size || 15
      return h('svg', {
        viewBox: '0 0 16 16', width: dimension, height: dimension,
        fill: 'none', stroke: 'currentColor', strokeWidth: name === 'grip' ? 2.2 : 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        style: { display: 'block' },
      }, (ICON_PATHS[name] || []).map((d, i) => h('path', { key: i, d })))
    }

    /** Round state marker: empty, running ring, done, or dropped. */
    function StateIcon({ state, size }) {
      const dimension = size || 15
      const base = {
        viewBox: '0 0 16 16', width: dimension, height: dimension, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block' },
      }
      if (state === 'doing') {
        return h('svg', { ...base, className: 'pb-spin', strokeWidth: 1.8 },
          h('circle', { cx: 8, cy: 8, r: 5.4, opacity: 0.22 }),
          h('path', { d: 'M8 2.6a5.4 5.4 0 0 1 5.4 5.4' }))
      }
      if (state === 'done') {
        return h('svg', base,
          h('circle', { cx: 8, cy: 8, r: 5.4 }),
          h('path', { d: 'M5.4 8.2l1.8 1.8 3.4-3.8' }))
      }
      if (state === 'dropped') {
        return h('svg', base,
          h('circle', { cx: 8, cy: 8, r: 5.4 }),
          h('path', { d: 'M6 6l4 4' }),
          h('path', { d: 'M10 6l-4 4' }))
      }
      return h('svg', base, h('circle', { cx: 8, cy: 8, r: 5.4 }))
    }

    /** Small square icon button with a tooltip. */
    function IconButton({ icon, title, onClick, danger }) {
      return h('button', {
        type: 'button',
        className: 'pb-icon',
        title,
        'aria-label': title,
        'data-danger': danger ? '1' : '0',
        onClick: event => { event.stopPropagation(); onClick() },
      }, h(Icon, { name: icon }))
    }

    /** Detail block for one item. */
    function ItemDetail({ item, open }) {
      const empty = item.detail.how.length === 0 && item.detail.accept.length === 0 && item.detail.notes.length === 0
      if (empty) return null
      const showLines = open
      return h('div', { style: { ...T.detail, display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '2px' } },
        showLines
          ? [
            item.detail.how.map((line, i) => h('div', { key: `h${i}` }, h('span', { style: T.detailLabel }, t('做法')), line)),
            item.detail.accept.map((line, i) => h('div', { key: `a${i}` }, h('span', { style: T.detailLabel }, t('验收')), line)),
          ]
          : item.detail.accept.slice(0, 1).map((line, i) => h('div', {
            key: `p${i}`,
            style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
          }, h('span', { style: T.detailLabel }, t('验收')), line)),
        item.detail.notes.map((line, i) => h('div', { key: `n${i}`, className: 'pb-note', style: { marginTop: '3px' } }, line)),
      )
    }

    /** Inline comment editor. */
    function NoteEditor({ onCancel, onSave }) {
      const [value, setValue] = useState('')
      const ref = useRefSafe()
      useEffect(() => { const node = ref.current; if (node && node.focus) node.focus() }, [])
      const save = () => {
        const text = value.replace(/\s+/gu, ' ').trim()
        if (text !== '') onSave(text)
        else onCancel()
      }
      return h('div', { style: T.editor },
        h('input', {
          ref,
          style: T.input,
          value,
          placeholder: t('写一句批注：哪儿不对、为什么不要、想要什么…'),
          onChange: event => setValue(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter') { event.preventDefault(); save() }
            if (event.key === 'Escape') { event.preventDefault(); onCancel() }
          },
        }),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { type: 'button', className: 'pb-primary', style: { padding: '5px 10px', fontSize: '11px' }, onClick: save }, t('保存批注')),
          h('button', { type: 'button', className: 'pb-chip', style: { cursor: 'pointer' }, onClick: onCancel }, t('取消')),
        ),
      )
    }

    /** `useRef` fallback that keeps the component pure when the hook is absent. */
    function useRefSafe() {
      return React.useRef ? React.useRef(null) : { current: null }
    }

    /** One task row: drag handle, state, text, priority, actions. */
    function TaskRow({ item, ui, act, now }) {
      const editorOpen = ui.editor !== null && ui.editor.index === item.index
      const detailOpen = ui.openDetail[item.index] === true
      const nextPriority = item.priority === null
        ? PRIORITIES[0]
        : item.priority === PRIORITIES[PRIORITIES.length - 1]
          ? '-'
          : PRIORITIES[PRIORITIES.indexOf(item.priority) + 1]
      const textStyle = {
        ...T.itemText,
        ...(item.state === 'done' ? T.itemTextDone : {}),
        ...(item.state === 'dropped' ? T.itemTextDropped : {}),
      }
      const hasDetail = item.detail.how.length + item.detail.accept.length + item.detail.notes.length > 0
      return h('div', null,
        h('div', {
          className: 'pb-row',
          draggable: true,
          'data-cursor': ui.cursor === item.index ? '1' : '0',
          'data-doing': item.state === 'doing' ? '1' : '0',
          'data-dropped': item.state === 'dropped' ? '1' : '0',
          onDragStart: event => {
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = 'copyMove'
              event.dataTransfer.setData('text/plain', String(item.index))
            }
            ui.startDrag('overall', item.index)
          },
          onDragEnd: () => ui.endDrag(),
          onClick: () => ui.setCursor(item.index),
        },
          h('span', { className: 'pb-handle', title: t('拖到右边加入「接下来」') }, h(Icon, { name: 'grip', size: 12 })),
          h('button', {
            type: 'button',
            title: item.picked ? t('取消选择') : t('选择这条'),
            style: {
              width: '18px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: STATE_COLOR[item.state],
            },
            onClick: event => { event.stopPropagation(); void act(`/aboard pick ${item.index}`) },
          }, h(StateIcon, { state: item.state })),
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
              h('span', { style: textStyle }, item.text),
              isThin(item) ? h('span', { className: 'pb-thin', title: t('缺验收或标题太短，建议补详细') }, t('简略')) : null,
              item.state === 'doing' && item.start
                ? h('span', { style: { ...T.meta, color: 'var(--dsw-alias-brand-primary)' } }, elapsedOf(item.start, now))
                : null,
            ),
            h(ItemDetail, { item, open: detailOpen }),
            editorOpen
              ? h(NoteEditor, {
                onCancel: ui.closeEditor,
                onSave: text => { void act(`/aboard note ${item.index} ${text}`); ui.closeEditor() },
              })
              : null,
          ),
          h('button', {
            type: 'button',
            className: 'pb-badge',
            'data-p': item.priority || (item.picked ? 'picked' : 'none'),
            title: t('设置优先级：P0 → P1 → P2 → P3 → 空'),
            onClick: event => { event.stopPropagation(); void act(`/aboard prio ${item.index} ${nextPriority}`) },
          }, item.priority || (item.picked ? t('选') : 'P?')),
          h('div', { className: 'pb-actions' },
            hasDetail
              ? h(IconButton, {
                icon: detailOpen ? 'chevronDown' : 'chevronRight',
                title: detailOpen ? t('收起做法与验收') : t('展开做法与验收'),
                onClick: () => ui.toggleDetail(item.index),
              })
              : null,
            h(IconButton, { icon: 'pencil', title: t('加批注'), onClick: () => ui.openEditor(item.index) }),
            h(IconButton, {
              icon: item.state === 'dropped' ? 'restore' : 'close',
              title: item.state === 'dropped' ? t('恢复这条') : t('不要这条（灰掉保留）'),
              danger: item.state !== 'dropped',
              onClick: () => { void act(`/aboard ${item.state === 'dropped' ? 'undrop' : 'drop'} ${item.index}`) },
            }),
          ),
        ),
      )
    }

    /** One collapsible section with a folded "done" group. */
    function Section({ section, ui, act, now }) {
      const collapsed = ui.collapsed[section.title] === true
      const doneOpen = ui.doneOpen[section.title] === true
      const done = section.items.filter(item => item.state === 'done')
      const active = section.items.filter(item => item.state !== 'done')
      const total = section.items.length
      const percent = total === 0 ? 0 : Math.round((done.length / total) * 100)
      const tone = sectionTone(percent)
      return h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { className: 'pb-section-head', onClick: () => ui.toggleSection(section.title) },
          h('span', { style: { width: '10px', fontSize: '9px', color: 'var(--dsw-alias-label-secondary)' } }, collapsed ? '▸' : '▾'),
          h('span', { className: 'pb-rail', style: { background: tone } }),
          h('span', { style: { fontSize: '12px', fontWeight: 600 } }, section.title),
          h('span', { style: { ...T.meta, marginLeft: '2px' } }, `${done.length}/${total}`),
          h('div', { style: { marginLeft: 'auto', width: '56px' } }, h('div', { className: 'pb-bar' }, h('div', { style: { width: `${percent}%`, background: tone } }))),
        ),
        collapsed ? null : h('div', { style: { display: 'flex', flexDirection: 'column', paddingBottom: '4px' } },
          active.map(item => h(TaskRow, { key: item.index, item, ui, act, now })),
          done.length > 0
            ? h('button', {
              type: 'button',
              className: 'pb-chip',
              style: { margin: '5px 8px 2px', cursor: 'pointer', alignSelf: 'flex-start', color: inkMix('state-success-primary', 55), borderColor: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent)' },
              onClick: () => ui.toggleDone(section.title),
            }, `${doneOpen ? '▾' : '▸'} ${t('已完成 {n}', { n: done.length })}`)
            : null,
          doneOpen ? done.map(item => h(TaskRow, { key: item.index, item, ui, act, now })) : null,
        ),
      )
    }

    /** Compact "doing now" strip plus the queued batch behind it. */
    function DoingStrip({ items, queue, act, now, running, ui }) {
      const [open, setOpen] = useState(true)
      const waiting = queue || []
      if (items.length === 0 && waiting.length === 0) {
        return h('section', { className: 'pb-panel', style: { ...T.card, flexDirection: 'row', alignItems: 'center', gap: '10px' } },
          h('span', { className: 'pb-chip', 'data-tone': running ? 'success' : undefined },
            h('span', { className: 'pb-dot', 'data-on': running ? '1' : '0' }),
            running ? t('运行中') : t('空闲')),
          h('span', { style: T.detail }, running ? t('会话在跑，但还没有标记进行中的任务。') : t('还没有正在做的任务。把要做的事选进「接下来」，再点「让他做这批」。')),
        )
      }
      return h('section', { className: 'pb-panel', style: T.card },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('h2', { style: T.cardTitle }, items.length > 0 ? t('正在做 · {n}', { n: items.length }) : '等待开始'),
          waiting.length > 0
            ? h('span', { className: 'pb-chip', style: { padding: '2px 7px' } }, t('排队 {n} 条', { n: waiting.length }))
            : null,
          h('span', { className: 'pb-chip', 'data-tone': running ? 'success' : undefined, style: { padding: '2px 7px' } },
            h('span', { className: 'pb-dot', 'data-on': running ? '1' : '0' }),
            running ? t('运行中') : t('已暂停')),
          h('div', { style: { marginLeft: 'auto' } },
            h(IconButton, { icon: open ? 'chevronDown' : 'chevronRight', title: open ? t('收起') : t('展开'), onClick: () => setOpen(!open) })),
        ),
        open ? h('div', { className: 'pb-doing-strip' },
          items.map(item => h('div', { key: item.index, className: 'pb-doing-row' },
            h('span', { style: { color: STATE_COLOR.doing, display: 'inline-flex' } }, h(StateIcon, { state: 'doing' })),
            h('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' } },
              h('div', { style: { ...T.itemText, display: 'flex', gap: '8px', alignItems: 'baseline' } },
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.text),
                h('span', { className: 'pb-chip', 'data-tone': 'brand', style: { padding: '2px 6px', fontSize: '10px', flex: '0 0 auto' } }, t('进行中')),
                item.priority ? h('span', { className: 'pb-badge', 'data-p': item.priority, style: { cursor: 'default', flex: '0 0 auto' } }, item.priority) : null,
              ),
              item.detail.accept.length > 0
                ? h('div', { style: { ...T.detail, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: item.detail.accept.join(' / ') },
                  h('span', { style: T.detailLabel }, t('验收')), item.detail.accept[0])
                : null,
              item.detail.how.length > 0
                ? h('div', { style: { ...T.detail, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: item.detail.how.join(' / ') },
                  h('span', { style: T.detailLabel }, t('做法')), item.detail.how[0])
                : null,
            ),
            h('span', { style: { ...T.meta, whiteSpace: 'nowrap', color: 'var(--dsw-alias-brand-primary)' } },
              item.start ? elapsedOf(item.start, now) : '—'),
            h('div', { className: 'pb-actions' },
              h(IconButton, { icon: 'pencil', title: t('加批注'), onClick: () => ui.openEditor(item.index) }),
              h(IconButton, { icon: 'check', title: t('标记完成'), onClick: () => { void act(`/aboard done ${item.index}`) } }),
            ),
          )),
          ui.editor !== null && items.some(item => item.index === ui.editor.index)
            ? h(NoteEditor, {
              onCancel: ui.closeEditor,
              onSave: text => { void act(`/aboard note ${ui.editor.index} ${text}`); ui.closeEditor() },
            })
            : null,
        ) : null,
        waiting.length > 0
          ? h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: '4px', paddingTop: '6px' } },
            h('div', { style: { ...T.meta, padding: '0 2px 2px' } }, t('排队中 · {n} 条', { n: waiting.length })),
            waiting.slice(0, 6).map((item, position) => h('div', {
              key: item.index,
              className: 'pb-doing-row',
              style: { gridTemplateColumns: '18px minmax(0, 1fr) auto auto', opacity: 0.85 },
            },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '10px', textAlign: 'center' } }, `#${position + 1}`),
              h('div', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px' } }, item.text),
              item.priority ? h('span', { className: 'pb-badge', 'data-p': item.priority, style: { cursor: 'default' } }, item.priority) : null,
              h('span', { style: T.meta }, t('排队')),
            )),
            waiting.length > 6 ? h('div', { style: { ...T.meta, padding: '2px 10px 0' } }, t('还有 {n} 条在「接下来」里', { n: waiting.length - 6 })) : null,
          )
          : null,
      )
    }

    /** Right column: the picked queue, drag-sortable, with batch dispatch controls. */
    function PicksColumn({ picks, ui, act }) {
      const [confirmClear, setConfirmClear] = useState(false)
      const ordered = [...picks].sort((a, b) => {
        const as = a.seq === null ? 99 : a.seq
        const bs = b.seq === null ? 99 : b.seq
        if (as !== bs) return as - bs
        const ap = a.priority ? PRIORITIES.indexOf(a.priority) : 99
        const bp = b.priority ? PRIORITIES.indexOf(b.priority) : 99
        return ap - bp
      })
      const mode = ui.dispatchMode === 'parallel' ? 'parallel' : 'serial'
      const dragged = ui.dragRef ? ui.dragRef.current : { from: null, index: null }
      const reorder = targetIndex => {
        const from = dragged.index
        if (dragged.from !== 'picks' || from === null || from === targetIndex) { ui.endDrag(); return }
        const order = ordered.map(item => item.index).filter(index => index !== from)
        const at = order.indexOf(targetIndex)
        order.splice(at < 0 ? order.length : at, 0, from)
        ui.endDrag()
        void act(`/aboard reorder ${order.join(',')}`)
      }
      const drop = () => {
        const from = { ...(ui.dragRef ? ui.dragRef.current : { from: null, index: null }) }
        ui.endDrag()
        if (from.from === 'overall' && from.index !== null) {
          const item = picks.find(entry => entry.index === from.index)
          if (item === undefined) void act(`/aboard pick ${from.index}`)
        }
      }
      return h('section', {
        className: 'pb-panel pb-dropzone pb-picks',
        'data-hover': ui.dropHover ? '1' : '0',
        style: { ...T.panel, gap: '8px' },
        onDragOver: event => { event.preventDefault(); ui.setDropHover(true) },
        onDragLeave: () => ui.setDropHover(false),
        onDrop: event => { event.preventDefault(); drop() },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('h2', { style: T.cardTitle }, t('接下来')),
          h('span', { style: T.meta }, t('{n} 条', { n: ordered.length })),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
          h('div', { className: 'pb-seg' },
            h('button', { type: 'button', 'data-on': mode === 'serial' ? '1' : '0', onClick: () => ui.setDispatchMode('serial'), title: t('一条做完再做下一条') }, t('串行')),
            h('button', { type: 'button', 'data-on': mode === 'parallel' ? '1' : '0', onClick: () => ui.setDispatchMode('parallel'), title: t('每条派一个子代理同时跑') }, t('并行')),
          ),
          h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' } },
            h(IconButton, {
              icon: 'trash',
              title: t('清空队列（任务本身不会被删除）'),
              danger: ordered.length > 0,
              onClick: () => setConfirmClear(ordered.length > 0),
            }),
            h('button', {
              type: 'button',
              className: 'pb-primary',
              disabled: ordered.length === 0,
              onClick: () => {
                if (ordered.length > 0) void act(`/aboard batch ${mode} ${ordered.map(item => item.index).join(',')}`)
              },
            }, ordered.length === 0 ? t('让他做这批') : t('让他做这批 · {n}', { n: ordered.length })),
          ),
        ),
        confirmClear
          ? h('div', {
            style: {
              display: 'flex', flexDirection: 'column', gap: '7px', padding: '9px 10px',
              borderRadius: '10px', border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent)',
              background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent)',
            },
          },
            h('div', { style: { fontSize: '11px', lineHeight: 1.6, color: 'var(--dsw-alias-state-warn-primary)' } },
              t('清空「接下来」里的全部选择和优先级？任务本身会保留，正在做的条目不受影响。')),
            h('div', { style: { display: 'flex', gap: '6px' } },
              h('button', {
                type: 'button', className: 'pb-primary',
                style: { padding: '5px 10px', fontSize: '11px' },
                onClick: () => { setConfirmClear(false); void act('/aboard clear') },
              }, t('确认清空')),
              h('button', {
                type: 'button', className: 'pb-chip', style: { cursor: 'pointer' },
                onClick: () => setConfirmClear(false),
              }, t('取消')),
            ),
          )
          : null,
        h('div', { className: 'pb-picks-scroll' },
          ordered.length === 0
          ? h('div', { style: { ...T.detail, padding: '14px 4px', textAlign: 'center' } },
            t('把左边的任务拖进来，或者点任务左边的圈。做完的条目会自动离开这里。'))
          : ordered.map(item => h('div', {
            key: item.index,
            className: 'pb-row',
            draggable: true,
            style: { gridTemplateColumns: '14px 18px minmax(0, 1fr) auto' },
            onDragStart: event => {
              if (event.dataTransfer) event.dataTransfer.setData('text/plain', String(item.index))
              ui.startDrag('picks', item.index)
            },
            onDragEnd: () => ui.endDrag(),
            onDragOver: event => { event.preventDefault(); ui.setDropTarget(item.index) },
            onDrop: event => {
              event.preventDefault()
              const current = ui.dragRef ? ui.dragRef.current : { from: null, index: null }
              if (current.from === 'overall') drop()
              else reorder(item.index)
            },
          },
            h('span', { className: 'pb-handle', title: t('拖动排序') }, h(Icon, { name: 'grip', size: 12 })),
            h('span', { style: { color: STATE_COLOR[item.state], display: 'inline-flex' } }, h(StateIcon, { state: item.state })),
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { ...T.itemText, ...(item.state === 'done' ? T.itemTextDone : {}) } }, item.text),
              item.detail.notes.slice(-1).map((line, i) => h('div', { key: i, className: 'pb-note', style: { marginTop: '3px' } }, line)),
            ),
            h('button', {
              type: 'button',
              className: 'pb-badge',
              'data-p': item.priority || 'picked',
              title: t('设置优先级：P0 → P1 → P2 → P3 → 空'),
              onClick: event => {
                event.stopPropagation()
                const next = item.priority === null
                  ? PRIORITIES[0]
                  : item.priority === PRIORITIES[PRIORITIES.length - 1]
                    ? '-'
                    : PRIORITIES[PRIORITIES.indexOf(item.priority) + 1]
                void act(`/aboard prio ${item.index} ${next}`)
              },
            }, item.priority || (item.seq !== null ? `#${item.seq}` : t('选'))),
          )),
        ),
      )
    }

    const COLLAPSE_KEY = 'plan-board:collapsed'

    /** Read the persisted section-collapse map. */
    function loadCollapsed() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return {}
        const raw = window.localStorage.getItem(COLLAPSE_KEY)
        return raw ? JSON.parse(raw) : {}
      } catch (error) {
        return {}
      }
    }

    /** Persist the section-collapse map. */
    function saveCollapsed(value) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(value))
        }
      } catch (error) {
        /* storage may be unavailable; collapse still works for this session */
      }
    }

    /** Whole board surface shared by the page and the conversation tab. */
    function renderBoard(pageStyle, props) {
      useLocaleTick()
      const sessionId = useCurrentSessionId(props)
      const useSessionsHook = props && props.useSessions
      const running = typeof useSessionsHook === 'function'
        ? useSessionsHook(state => {
          const entry = state && state.byId && sessionId !== undefined ? state.byId[sessionId] : undefined
          return !!(entry && entry.running)
        })
        : false
      const board = useBoard(sessionId)
      const payload = board.payload
      const [uiState, setUiState] = useState(() => ({
        query: '', collapsed: loadCollapsed(), doneOpen: {}, openDetail: {}, cursor: null, editor: null,
        drag: { from: null, index: null }, dropTarget: null, dropHover: false, dispatchMode: 'serial',
      }))
      const now = useNow(!!payload && payload.counts.doing > 0)
      const dragRef = useRefSafe()
      const ui = useMemo(() => ({
        ...uiState,
        openEditor: index => setUiState(prev => ({ ...prev, editor: { index } })),
        closeEditor: () => setUiState(prev => ({ ...prev, editor: null })),
        setCursor: index => setUiState(prev => ({ ...prev, cursor: index })),
        toggleSection: title => setUiState(prev => {
          const collapsed = { ...prev.collapsed, [title]: prev.collapsed[title] !== true }
          saveCollapsed(collapsed)
          return { ...prev, collapsed }
        }),
        toggleDone: title => setUiState(prev => ({ ...prev, doneOpen: { ...prev.doneOpen, [title]: prev.doneOpen[title] !== true } })),
        toggleDetail: index => setUiState(prev => ({ ...prev, openDetail: { ...prev.openDetail, [index]: prev.openDetail[index] !== true } })),
        dragRef,
        startDrag: (from, index) => { dragRef.current = { from, index } },
        endDrag: () => { dragRef.current = { from: null, index: null }; setUiState(prev => ({ ...prev, dropHover: false, dropTarget: null })) },
        setDropTarget: index => setUiState(prev => (prev.dropTarget === index ? prev : { ...prev, dropTarget: index })),
        setDropHover: hover => setUiState(prev => (prev.dropHover === hover ? prev : { ...prev, dropHover: hover })),
        setQuery: query => setUiState(prev => ({ ...prev, query })),
        setDispatchMode: mode => setUiState(prev => ({ ...prev, dispatchMode: mode })),
      }), [uiState])

      if (board.phase !== 'ready') {
        const notice = board.phase === 'no-session'
          ? h('p', { style: T.detail }, t('先打开任意一个会话，计划板才知道该看哪个工作区的文件。'))
          : board.phase === 'diag'
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
              h('div', { style: T.cardTitle }, t('读不到计划文件（自检）')),
              board.diag.map((entry, i) => h('p', { key: i, style: { ...T.detail, fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all' } },
                `${entry.label}: ${entry.ok ? 'ok' : 'failed'}${entry.ms != null ? ` ${entry.ms}ms` : ''}${entry.reason ? ` → ${entry.reason}` : ''}`)),
            )
            : h('p', { style: T.detail }, t('正在读取计划文件…'))
        return h('div', { style: pageStyle },
          h('style', null, CSS),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('h1', { className: 'pb-title' }, t('计划板'))),
          h('section', { className: 'pb-panel', style: T.card }, notice),
        )
      }

      const sections = payload.sections
      const counts = payload.counts
      const percent = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100)
      const query = uiState.query.trim().toLowerCase()
      const matches = item => query === '' || item.text.toLowerCase().includes(query)
        || item.detail.how.join(' ').toLowerCase().includes(query)
        || item.detail.accept.join(' ').toLowerCase().includes(query)
        || item.detail.notes.join(' ').toLowerCase().includes(query)
      const filtered = sections
        .map(section => ({ ...section, items: section.items.filter(matches) }))
        .filter(section => section.items.length > 0)
      const allItems = sections.flatMap(section => section.items)
      const picks = allItems.filter(item => (item.picked || item.priority) && item.state !== 'dropped' && item.state !== 'done')
      const doingItems = allItems.filter(item => item.state === 'doing')
      const visible = filtered.flatMap(section => section.items)
      const runningButIdle = running && doingItems.length === 0

      const onKeyDown = event => {
        if (event.target && /input|textarea/iu.test(event.target.tagName)) return
        if (visible.length === 0) return
        const position = visible.findIndex(item => item.index === uiState.cursor)
        if (event.key === 'ArrowDown' || event.key === 'j') {
          event.preventDefault()
          const next = visible[Math.min(visible.length - 1, Math.max(0, position) + (position < 0 ? 0 : 1))]
          if (next) ui.setCursor(next.index)
        } else if (event.key === 'ArrowUp' || event.key === 'k') {
          event.preventDefault()
          const prev = visible[Math.max(0, position - 1)]
          if (prev) ui.setCursor(prev.index)
        } else if (event.key === ' ' && position >= 0) {
          event.preventDefault()
          void board.act(`/aboard pick ${visible[position].index}`)
        } else if (position >= 0 && /^[0-3]$/u.test(event.key)) {
          event.preventDefault()
          void board.act(`/aboard prio ${visible[position].index} P${event.key}`)
        } else if (position >= 0 && event.key === 'Enter') {
          event.preventDefault()
          void board.act(`/aboard doing ${visible[position].index}`)
        }
      }

      return h('div', { style: { ...pageStyle, outline: 'none' }, tabIndex: 0, onKeyDown },
        h('style', null, CSS),

        // ---- compact header -------------------------------------------------
        h('header', { style: { display: 'flex', flexDirection: 'column', gap: '5px' } },
          h('div', { className: 'pb-topbar' },
            h('h1', { className: 'pb-title' }, payload.title || t('计划板')),
            h('span', { className: 'pb-chip', 'data-tone': running ? 'success' : undefined },
              h('span', { className: 'pb-dot', 'data-on': running ? '1' : '0' }),
              running ? t('运行中') : t('空闲')),
            h('span', { className: 'pb-chip', 'data-tone': counts.done === counts.total && counts.total > 0 ? 'success' : undefined },
              `${counts.done}/${counts.total}`),
            doingItems.length > 0 ? h('span', { className: 'pb-chip', 'data-tone': 'brand' }, `${t(t('进行中'))} ${doingItems.length}`) : null,
            h('div', { style: { width: '96px' } }, h('div', { className: 'pb-bar' }, h('div', { style: { width: `${percent}%` } }))),
            h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' } },
              h('input', {
                className: 'pb-search',
                style: { width: '150px' },
                value: uiState.query,
                placeholder: t('搜索'),
                onChange: event => ui.setQuery(event.target.value),
              }),
              h(IconButton, { icon: 'refresh', title: t('刷新'), onClick: () => { void board.reload() } }),
            ),
          ),
          payload.goal ? h('div', { className: 'pb-goal', title: payload.goal }, t('目标：{text}', { text: payload.goal })) : null,
          board.notice ? h('div', { style: T.warn }, board.notice) : null,
          runningButIdle ? h('div', { style: T.warn }, t('会话正在运行，但没有标记正在做的任务。')) : null,
        ),

        counts.total === 0
          ? h('section', { className: 'pb-panel', style: T.card },
            h('h2', { style: T.cardTitle }, t('还没有计划')),
            h('div', { style: T.detail }, t('① 让我拆任务；② 或直接编辑 .dsh/plan-board.md；③ 或输入 /aboard 看摘要。')))
          : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
            h(DoingStrip, {
              items: doingItems,
              queue: picks.filter(item => item.state !== 'doing'),
              act: board.act, now, running, ui,
            }),
            h('div', { style: T.columns },
              h('section', {
                className: 'pb-panel',
                style: T.panel,
                onDragOver: event => { event.preventDefault() },
                onDrop: event => {
                  event.preventDefault()
                  const dragged = ui.dragRef ? ui.dragRef.current : { from: null, index: null }
                  if (dragged.from === 'picks' && dragged.index !== null) {
                    void board.act(`/aboard pick ${dragged.index}`)
                    ui.endDrag()
                  }
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                  h('h2', { style: T.cardTitle }, t('整体')),
                  h('span', { style: T.meta }, t('{n} 条 · {m} 个阶段', { n: counts.total, m: sections.length })),
                ),
                filtered.length === 0
                  ? h('div', { style: T.detail }, t('没有匹配的任务。'))
                  : filtered.map(section => h(Section, { key: section.title, section, ui, act: board.act, now })),
              ),
              h(PicksColumn, { picks, ui, act: board.act }),
            ),
            h('div', { style: T.footer },
              board.via === 'files' ? t('数据：工作区文件') : t('数据：Host 命令'),
              t(' · ↑↓ 移动 · 空格选择 · 0–3 优先级 · Enter 进行中 · 拖拽进「接下来」'),
            ),
          ),
      )
    }

    /** One section row of the chat card. */
    function CardSectionRow({ section }) {
      const done = section.items.filter(item => item.state === 'done').length
      const total = section.items.length
      const percent = total === 0 ? 0 : Math.round((done / total) * 100)
      const tone = percent >= 100
        ? inkMix('state-success-primary', 55)
        : percent > 0 ? 'var(--dsw-alias-brand-primary)' : inkMix('state-idle-primary', 45)
      return h('div', {
        style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto 64px', gap: '10px', alignItems: 'center', padding: '3px 0' },
      },
        h('span', { style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, section.title),
        h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' } }, `${done}/${total}`),
        h('div', {
          style: { height: '4px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' },
        }, h('div', { style: { width: `${percent}%`, height: '100%', borderRadius: '999px', background: tone } })),
      )
    }

    /** Rich chat card for `/aboard`: sections, counts, and progress. */
    function AboardCard({ data }) {
      const counts = data.counts || { total: 0, done: 0, doing: 0, dropped: 0, picked: 0 }
      const percent = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100)
      const sections = Array.isArray(data.sections) ? data.sections : []
      const open = () => {
        try {
          if (api.layout && typeof api.layout.selectPanel === 'function') api.layout.selectPanel('plan-board')
        } catch (error) {
          /* navigation is best effort */
        }
      }
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '660px',
          padding: '13px 15px', borderRadius: '14px',
          border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)',
          boxShadow: '0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent)',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', { style: { fontSize: '13px', fontWeight: 600 } }, data.title || t('计划板')),
          h('span', {
            style: {
              fontSize: '11px', lineHeight: 1, padding: '4px 8px', borderRadius: '999px',
              border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)',
            },
          }, `${counts.done}/${counts.total}`),
          counts.doing > 0
            ? h('span', {
              style: {
                fontSize: '11px', lineHeight: 1, padding: '4px 8px', borderRadius: '999px',
                border: '1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent)',
                color: 'var(--dsw-alias-brand-primary)',
              },
            }, `${t(t('进行中'))} ${counts.doing}`)
            : null,
          h('button', {
            type: 'button',
            onClick: open,
            style: {
              marginLeft: 'auto', fontSize: '11px', lineHeight: 1, padding: '5px 9px', borderRadius: '8px',
              border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)',
              color: 'var(--dsw-alias-label-secondary)', font: 'inherit', cursor: 'pointer',
            },
          }, t('打开看板')),
        ),
        data.goal
          ? h('div', {
            style: { fontSize: '11px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            title: data.goal,
          }, t('目标：{text}', { text: data.goal }))
          : null,
        h('div', { style: { height: '6px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' } },
          h('div', {
            style: {
              width: `${percent}%`, height: '100%', borderRadius: '999px',
              background: 'linear-gradient(90deg, var(--dsw-alias-brand-primary), var(--dsw-alias-state-success-primary))',
            },
          })),
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
          h('span', null, t('{m} 个阶段', { m: sections.length })),
          h('span', null, `${percent}%`),
        ),
        sections.length > 0
          ? h('div', { style: { display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '6px' } },
            sections.map(section => h(CardSectionRow, { key: section.title, section })))
          : h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } }, t('看板还是空的，先让我拆一批任务。')),
        h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', opacity: 0.85 } }, data.path || '.dsh/plan-board.md'),
      )
    }

    /** Chat row for `/aboard`: machine calls collapse, a bare call shows a card. */
    function AboardCommandRow(props) {
      const node = props && props.node
      const args = node && typeof node.args === 'string' ? node.args.trim() : ''
      if (args !== '') {
        return [
          h('style', { key: 'collapse' }, 'div:has(> [data-plan-board-machine]){display:none !important}'),
          h('span', { key: 'marker', 'data-plan-board-machine': '1', style: { display: 'none' } }),
        ]
      }
      const text = node && node.outcome && typeof node.outcome.text === 'string' ? node.outcome.text : ''
      if (text !== '') {
        try {
          const parsed = JSON.parse(text)
          if (parsed && parsed.ok === true && Array.isArray(parsed.sections)) {
            return h(AboardCard, { data: parsed })
          }
        } catch (error) {
          /* plain-text answer (`/aboard list`) renders below */
        }
      }
      return h('div', {
        style: {
          padding: '12px 14px', borderRadius: '14px', border: '1px solid var(--dsw-alias-border-l1)',
          background: 'var(--dsw-alias-bg-layer-1)', display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '660px',
        },
      },
        h('span', { style: { fontSize: '11px', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 } }, t('计划板')),
        text === '' ? null : h('pre', { style: { margin: 0, fontSize: '11px', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: '260px', overflowY: 'auto', fontFamily: 'inherit', color: 'var(--dsw-alias-label-primary)' } }, text),
      )
    }

    /** Left-navigation glyph. */
    function BoardIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', 'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', { x: 3.5, y: 3.5, width: 17, height: 17, rx: 4.5, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M7.6 9h3M7.6 12h3M7.6 15h3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'M13.7 8.9l1.2 1.2 2.1-2.3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M13.7 14.6h3.1', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    /** Full page opened from the left navigation. */
    function BoardPanel(props) {
      return renderBoard(T.page, props)
    }

    /** Conversation view tab. */
    function BoardView(props) {
      return renderBoard({ ...T.page, padding: '12px 16px 24px' }, props)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        api.ctx = ctx
        if (typeof ctx.inject === 'function') {
          ctx.inject(['locale'], child => { api.locale = child.locale })
          ctx.inject(['remote', 'remote.commands', 'remote.workspaceFiles', 'layout'], child => {
            api.files = (child.remote && child.remote.workspaceFiles) || child['remote.workspaceFiles']
            api.commands = child.remote && child.remote.commands
            api.layout = child.layout
          })
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'plan-board', order: 60, label: () => t('计划板'),
        }, BoardIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'plan-board',
        }, BoardPanel))

        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'plan-board', order: 20, label: () => t('计划板'),
        }, BoardView))

        ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
          name: 'conversation.chat.commandview', key: 'aboard',
        }, AboardCommandRow))
      },
    }
  },
})
