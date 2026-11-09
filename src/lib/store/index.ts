import { useAtom, useAtomValue } from '@octanejs/effect-atom'
import { Atom } from 'effect/reactivity'
import { Effect } from 'effect'

// ============================================================
// Types
// ============================================================

export type TodoId = string
export type ProjectId = string
export type LabelId = string

export type TodoStatus = 'active' | 'completed' | 'archived'

export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent'

export type TodoSortField = 'createdAt' | 'updatedAt' | 'dueDate' | 'priority' | 'title'

export type SortDirection = 'asc' | 'desc'

export type TodoFilter = 'all' | 'active' | 'completed' | 'archived' | 'overdue' | 'today' | 'upcoming' | 'unassigned'

export interface Todo {
  readonly id: TodoId
  readonly title: string
  readonly description: string
  readonly status: TodoStatus
  readonly priority: TodoPriority
  readonly projectId: ProjectId | null
  readonly labelIds: readonly LabelId[]
  readonly dueDate: number | null
  readonly completedAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface TodoProject {
  readonly id: ProjectId
  readonly name: string
  readonly color: string
  readonly createdAt: number
}

export interface TodoLabel {
  readonly id: LabelId
  readonly name: string
  readonly color: string
}

export interface TodoSort {
  readonly field: TodoSortField
  readonly direction: SortDirection
}

export interface TodoQuery {
  readonly filter: TodoFilter
  readonly search: string
  readonly projectId: ProjectId | null
  readonly labelId: LabelId | null
  readonly priority: TodoPriority | null
  readonly sort: TodoSort
}

export interface TodoStats {
  readonly total: number
  readonly active: number
  readonly completed: number
  readonly archived: number
  readonly overdue: number
  readonly dueToday: number
  readonly completionRate: number
}

export interface TodoSnapshot {
  readonly todos: readonly Todo[]
  readonly projects: readonly TodoProject[]
  readonly labels: readonly TodoLabel[]
}

export interface TodoState extends TodoSnapshot {
  readonly query: TodoQuery
  readonly past: readonly TodoSnapshot[]
  readonly future: readonly TodoSnapshot[]
  readonly revision: number
}

export interface CreateTodoInput {
  readonly title: string
  readonly description?: string
  readonly priority?: TodoPriority
  readonly projectId?: ProjectId | null
  readonly labelIds?: readonly LabelId[]
  readonly dueDate?: number | null
}

export interface UpdateTodoInput {
  readonly title?: string
  readonly description?: string
  readonly priority?: TodoPriority
  readonly projectId?: ProjectId | null
  readonly labelIds?: readonly LabelId[]
  readonly dueDate?: number | null
}

export interface CreateProjectInput {
  readonly name: string
  readonly color?: string
}

export interface CreateLabelInput {
  readonly name: string
  readonly color?: string
}

export type TodoErrorCode = 'EMPTY_TITLE' | 'NOT_FOUND' | 'DUPLICATE_NAME' | 'INVALID_DATE' | 'INVALID_INPUT'

export class TodoError extends Error {
  readonly _tag = 'TodoError'

  constructor(
    readonly code: TodoErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'TodoError'
  }
}

// ============================================================
// Constants
// ============================================================

const MAX_HISTORY = 50

const PRIORITY_WEIGHT: Record<TodoPriority, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4
}

const DEFAULT_QUERY: TodoQuery = {
  filter: 'all',
  search: '',
  projectId: null,
  labelId: null,
  priority: null,
  sort: {
    field: 'createdAt',
    direction: 'desc'
  }
}

// ============================================================
// Initial state
// ============================================================

const createInitialState = (): TodoState => ({
  todos: [],
  projects: [],
  labels: [],
  query: DEFAULT_QUERY,
  past: [],
  future: [],
  revision: 0
})

// ============================================================
// Effect utilities
// ============================================================

const now = (): number => Date.now()

const makeId = (): string => crypto.randomUUID()

const validateTitle = (title: string): Effect.Effect<string, TodoError> =>
  Effect.gen(function* () {
    const normalized = title.trim()

    if (!normalized) {
      return yield* Effect.fail(new TodoError('EMPTY_TITLE', 'Todo title cannot be empty.'))
    }

    return normalized
  })

const validateDate = (date: number | null): Effect.Effect<void, TodoError> =>
  date === null || Number.isFinite(date) ? Effect.void : Effect.fail(new TodoError('INVALID_DATE', 'Invalid due date.'))

// ============================================================
// State helpers
// ============================================================

const snapshot = (state: TodoState): TodoSnapshot => ({
  todos: state.todos,
  projects: state.projects,
  labels: state.labels
})

const commit = (state: TodoState, next: TodoSnapshot): TodoState => ({
  ...state,
  ...next,
  past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
  future: [],
  revision: state.revision + 1
})

const findTodo = (state: TodoState, id: TodoId): Effect.Effect<Todo, TodoError> => {
  const todo = state.todos.find((item) => item.id === id)

  return todo ? Effect.succeed(todo) : Effect.fail(new TodoError('NOT_FOUND', `Todo "${id}" was not found.`))
}

const replaceTodo = (todos: readonly Todo[], updated: Todo): readonly Todo[] =>
  todos.map((todo) => (todo.id === updated.id ? updated : todo))

const isSameDay = (timestamp: number, reference: number): boolean => {
  const date = new Date(timestamp)
  const today = new Date(reference)

  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  )
}

const startOfToday = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const endOfToday = (timestamp: number): number => {
  const date = new Date(timestamp)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

// ============================================================
// Todo commands
// ============================================================

export const TodoCommands = {
  create: (state: TodoState, input: CreateTodoInput): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const title = yield* validateTitle(input.title)
      yield* validateDate(input.dueDate ?? null)

      if (input.projectId && !state.projects.some((project) => project.id === input.projectId)) {
        return yield* Effect.fail(new TodoError('NOT_FOUND', 'Project does not exist.'))
      }

      if (input.labelIds?.some((id) => !state.labels.some((label) => label.id === id))) {
        return yield* Effect.fail(new TodoError('NOT_FOUND', 'One or more labels do not exist.'))
      }

      const timestamp = now()

      const todo: Todo = {
        id: makeId(),
        title,
        description: input.description?.trim() ?? '',
        status: 'active',
        priority: input.priority ?? 'medium',
        projectId: input.projectId ?? null,
        labelIds: [...new Set(input.labelIds ?? [])],
        dueDate: input.dueDate ?? null,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }

      return commit(state, {
        ...snapshot(state),
        todos: [todo, ...state.todos]
      })
    }),

  update: (state: TodoState, id: TodoId, input: UpdateTodoInput): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const current = yield* findTodo(state, id)

      const title = input.title !== undefined ? yield* validateTitle(input.title) : current.title

      const dueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate

      yield* validateDate(dueDate)

      if (input.projectId && !state.projects.some((project) => project.id === input.projectId)) {
        return yield* Effect.fail(new TodoError('NOT_FOUND', 'Project does not exist.'))
      }

      const labelIds = input.labelIds ?? current.labelIds

      if (labelIds.some((labelId) => !state.labels.some((label) => label.id === labelId))) {
        return yield* Effect.fail(new TodoError('NOT_FOUND', 'One or more labels do not exist.'))
      }

      const updated: Todo = {
        ...current,
        ...input,
        title,
        description: input.description?.trim() ?? current.description,
        projectId: input.projectId !== undefined ? input.projectId : current.projectId,
        labelIds: [...new Set(labelIds)],
        dueDate,
        updatedAt: now()
      }

      return commit(state, {
        ...snapshot(state),
        todos: replaceTodo(state.todos, updated)
      })
    }),

  remove: (state: TodoState, id: TodoId): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      yield* findTodo(state, id)

      return commit(state, {
        ...snapshot(state),
        todos: state.todos.filter((todo) => todo.id !== id)
      })
    }),

  toggle: (state: TodoState, id: TodoId): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const current = yield* findTodo(state, id)
      const completed = current.status !== 'completed'
      const timestamp = now()

      const updated: Todo = {
        ...current,
        status: completed ? 'completed' : 'active',
        completedAt: completed ? timestamp : null,
        updatedAt: timestamp
      }

      return commit(state, {
        ...snapshot(state),
        todos: replaceTodo(state.todos, updated)
      })
    }),

  complete: (state: TodoState, id: TodoId): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const current = yield* findTodo(state, id)

      if (current.status === 'completed') return state

      const timestamp = now()

      const updated: Todo = {
        ...current,
        status: 'completed',
        completedAt: timestamp,
        updatedAt: timestamp
      }

      return commit(state, {
        ...snapshot(state),
        todos: replaceTodo(state.todos, updated)
      })
    }),

  archive: (state: TodoState, id: TodoId): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const current = yield* findTodo(state, id)

      const updated: Todo = {
        ...current,
        status: 'archived',
        updatedAt: now()
      }

      return commit(state, {
        ...snapshot(state),
        todos: replaceTodo(state.todos, updated)
      })
    }),

  restore: (state: TodoState, id: TodoId): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const current = yield* findTodo(state, id)

      const updated: Todo = {
        ...current,
        status: 'active',
        completedAt: null,
        updatedAt: now()
      }

      return commit(state, {
        ...snapshot(state),
        todos: replaceTodo(state.todos, updated)
      })
    }),

  clearCompleted: (state: TodoState): TodoState => {
    const todos = state.todos.filter((todo) => todo.status !== 'completed')

    return todos.length === state.todos.length ? state : commit(state, { ...snapshot(state), todos })
  },

  clearArchived: (state: TodoState): TodoState => {
    const todos = state.todos.filter((todo) => todo.status !== 'archived')

    return todos.length === state.todos.length ? state : commit(state, { ...snapshot(state), todos })
  },

  setManyCompleted: (state: TodoState, ids: readonly TodoId[], completed: boolean): TodoState => {
    const selected = new Set(ids)
    const timestamp = now()

    const todos = state.todos.map((todo) => {
      if (!selected.has(todo.id) || todo.status === 'archived') {
        return todo
      }

      if ((todo.status === 'completed') === completed) {
        return todo
      }

      return {
        ...todo,
        status: completed ? ('completed' as const) : ('active' as const),
        completedAt: completed ? timestamp : null,
        updatedAt: timestamp
      }
    })

    return todos.every((todo, index) => todo === state.todos[index])
      ? state
      : commit(state, { ...snapshot(state), todos })
  }
}

// ============================================================
// Project commands
// ============================================================

export const ProjectCommands = {
  create: (state: TodoState, input: CreateProjectInput): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const name = yield* validateTitle(input.name)

      if (state.projects.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
        return yield* Effect.fail(new TodoError('DUPLICATE_NAME', 'Project already exists.'))
      }

      const project: TodoProject = {
        id: makeId(),
        name,
        color: input.color ?? '#64748b',
        createdAt: now()
      }

      return commit(state, {
        ...snapshot(state),
        projects: [...state.projects, project]
      })
    }),

  remove: (state: TodoState, id: ProjectId): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      if (!state.projects.some((project) => project.id === id)) {
        return yield* Effect.fail(new TodoError('NOT_FOUND', 'Project does not exist.'))
      }

      return commit(state, {
        ...snapshot(state),
        projects: state.projects.filter((project) => project.id !== id),
        todos: state.todos.map((todo) =>
          todo.projectId === id ? { ...todo, projectId: null, updatedAt: now() } : todo
        )
      })
    })
}

// ============================================================
// Label commands
// ============================================================

export const LabelCommands = {
  create: (state: TodoState, input: CreateLabelInput): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      const name = yield* validateTitle(input.name)

      if (state.labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
        return yield* Effect.fail(new TodoError('DUPLICATE_NAME', 'Label already exists.'))
      }

      const label: TodoLabel = {
        id: makeId(),
        name,
        color: input.color ?? '#64748b'
      }

      return commit(state, {
        ...snapshot(state),
        labels: [...state.labels, label]
      })
    }),

  remove: (state: TodoState, id: LabelId): Effect.Effect<TodoState, TodoError> =>
    Effect.gen(function* () {
      if (!state.labels.some((label) => label.id === id)) {
        return yield* Effect.fail(new TodoError('NOT_FOUND', 'Label does not exist.'))
      }

      return commit(state, {
        ...snapshot(state),
        labels: state.labels.filter((label) => label.id !== id),
        todos: state.todos.map((todo) => ({
          ...todo,
          labelIds: todo.labelIds.filter((labelId) => labelId !== id)
        }))
      })
    })
}

// ============================================================
// Query and filter commands
// ============================================================

export const QueryCommands = {
  setFilter: (state: TodoState, filter: TodoFilter): TodoState => ({
    ...state,
    query: { ...state.query, filter }
  }),

  setSearch: (state: TodoState, search: string): TodoState => ({
    ...state,
    query: { ...state.query, search }
  }),

  setProject: (state: TodoState, projectId: ProjectId | null): TodoState => ({
    ...state,
    query: { ...state.query, projectId }
  }),

  setLabel: (state: TodoState, labelId: LabelId | null): TodoState => ({
    ...state,
    query: { ...state.query, labelId }
  }),

  setPriority: (state: TodoState, priority: TodoPriority | null): TodoState => ({
    ...state,
    query: { ...state.query, priority }
  }),

  setSort: (state: TodoState, sort: TodoSort): TodoState => ({
    ...state,
    query: { ...state.query, sort }
  }),

  reset: (state: TodoState): TodoState => ({
    ...state,
    query: DEFAULT_QUERY
  })
}

// ============================================================
// Selectors
// ============================================================

const matchesFilter = (todo: Todo, filter: TodoFilter, timestamp: number): boolean => {
  const todayStart = startOfToday(timestamp)
  const todayEnd = endOfToday(timestamp)

  switch (filter) {
    case 'all':
      return todo.status !== 'archived'

    case 'active':
      return todo.status === 'active'

    case 'completed':
      return todo.status === 'completed'

    case 'archived':
      return todo.status === 'archived'

    case 'overdue':
      return todo.status === 'active' && todo.dueDate !== null && todo.dueDate < todayStart

    case 'today':
      return todo.status === 'active' && todo.dueDate !== null && todo.dueDate >= todayStart && todo.dueDate <= todayEnd

    case 'upcoming':
      return todo.status === 'active' && todo.dueDate !== null && todo.dueDate > todayEnd

    case 'unassigned':
      return todo.status === 'active' && todo.projectId === null
  }
}

const compareTodos = (a: Todo, b: Todo, sort: TodoSort): number => {
  let result = 0

  switch (sort.field) {
    case 'title':
      result = a.title.localeCompare(b.title)
      break

    case 'priority':
      result = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
      break

    case 'dueDate':
      result = (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER)
      break

    case 'createdAt':
      result = a.createdAt - b.createdAt
      break

    case 'updatedAt':
      result = a.updatedAt - b.updatedAt
      break
  }

  return sort.direction === 'asc' ? result : -result
}

export const TodoSelectors = {
  visible: (state: TodoState): readonly Todo[] => {
    const { query } = state
    const timestamp = now()
    const search = query.search.trim().toLowerCase()

    return state.todos
      .filter((todo) => matchesFilter(todo, query.filter, timestamp))
      .filter((todo) => !query.projectId || todo.projectId === query.projectId)
      .filter((todo) => !query.labelId || todo.labelIds.includes(query.labelId))
      .filter((todo) => !query.priority || todo.priority === query.priority)
      .filter((todo) => {
        if (!search) return true

        return todo.title.toLowerCase().includes(search) || todo.description.toLowerCase().includes(search)
      })
      .sort((a, b) => compareTodos(a, b, query.sort))
  },

  stats: (state: TodoState): TodoStats => {
    const timestamp = now()
    const todayStart = startOfToday(timestamp)
    const todayEnd = endOfToday(timestamp)

    const active = state.todos.filter((todo) => todo.status === 'active')

    const completed = state.todos.filter((todo) => todo.status === 'completed')

    const archived = state.todos.filter((todo) => todo.status === 'archived')

    const overdue = active.filter((todo) => todo.dueDate !== null && todo.dueDate < todayStart)

    const dueToday = active.filter(
      (todo) => todo.dueDate !== null && todo.dueDate >= todayStart && todo.dueDate <= todayEnd
    )

    const total = active.length + completed.length

    return {
      total,
      active: active.length,
      completed: completed.length,
      archived: archived.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      completionRate: total === 0 ? 0 : Math.round((completed.length / total) * 100)
    }
  },

  byId: (state: TodoState, id: TodoId): Todo | undefined => state.todos.find((todo) => todo.id === id),

  byProject: (state: TodoState, projectId: ProjectId): readonly Todo[] =>
    state.todos.filter((todo) => todo.projectId === projectId),

  byLabel: (state: TodoState, labelId: LabelId): readonly Todo[] =>
    state.todos.filter((todo) => todo.labelIds.includes(labelId)),

  isOverdue: (todo: Todo, timestamp = now()): boolean =>
    todo.status === 'active' && todo.dueDate !== null && todo.dueDate < startOfToday(timestamp),

  isDueToday: (todo: Todo, timestamp = now()): boolean =>
    todo.status === 'active' && todo.dueDate !== null && isSameDay(todo.dueDate, timestamp)
}

// ============================================================
// History: Undo / Redo
// ============================================================

export const HistoryCommands = {
  undo: (state: TodoState): TodoState => {
    const previous = state.past.at(-1)

    if (!previous) return state

    return {
      ...state,
      ...previous,
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, MAX_HISTORY),
      revision: state.revision + 1
    }
  },

  redo: (state: TodoState): TodoState => {
    const next = state.future[0]

    if (!next) return state

    return {
      ...state,
      ...next,
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: state.future.slice(1),
      revision: state.revision + 1
    }
  }
}

// ============================================================
// Atoms
// ============================================================

export const todoStateAtom = Atom.make(createInitialState())

export const todosAtom = Atom.make((get) => get(todoStateAtom).todos)

export const projectsAtom = Atom.make((get) => get(todoStateAtom).projects)

export const labelsAtom = Atom.make((get) => get(todoStateAtom).labels)

export const queryAtom = Atom.make((get) => get(todoStateAtom).query)

export const visibleTodosAtom = Atom.make((get) => TodoSelectors.visible(get(todoStateAtom)))

export const todoStatsAtom = Atom.make((get) => TodoSelectors.stats(get(todoStateAtom)))

export const canUndoAtom = Atom.make((get) => get(todoStateAtom).past.length > 0)

export const canRedoAtom = Atom.make((get) => get(todoStateAtom).future.length > 0)

export const activeTodosAtom = Atom.make((get) => get(todoStateAtom).todos.filter((todo) => todo.status === 'active'))

export const completedTodosAtom = Atom.make((get) =>
  get(todoStateAtom).todos.filter((todo) => todo.status === 'completed')
)

// ============================================================
// Effect execution
// ============================================================

const runCommand = (
  setState: (updater: (state: TodoState) => TodoState) => void,
  command: (state: TodoState) => Effect.Effect<TodoState, TodoError>
): void => {
  setState((current) => Effect.runSync(command(current)))
}

const runSyncCommand = (
  setState: (updater: (state: TodoState) => TodoState) => void,
  command: (state: TodoState) => TodoState
): void => {
  setState(command)
}

// ============================================================
// React API
// ============================================================

export interface TodoActions {
  readonly create: (input: CreateTodoInput) => void
  readonly update: (id: TodoId, input: UpdateTodoInput) => void
  readonly remove: (id: TodoId) => void
  readonly toggle: (id: TodoId) => void
  readonly complete: (id: TodoId) => void
  readonly archive: (id: TodoId) => void
  readonly restore: (id: TodoId) => void

  readonly clearCompleted: () => void
  readonly clearArchived: () => void
  readonly setManyCompleted: (ids: readonly TodoId[], completed: boolean) => void

  readonly createProject: (input: CreateProjectInput) => void
  readonly removeProject: (id: ProjectId) => void
  readonly createLabel: (input: CreateLabelInput) => void
  readonly removeLabel: (id: LabelId) => void

  readonly setFilter: (filter: TodoFilter) => void
  readonly setSearch: (search: string) => void
  readonly setProject: (id: ProjectId | null) => void
  readonly setLabel: (id: LabelId | null) => void
  readonly setPriority: (priority: TodoPriority | null) => void
  readonly setSort: (sort: TodoSort) => void
  readonly resetQuery: () => void

  readonly undo: () => void
  readonly redo: () => void
}

export const useTodoActions = (): TodoActions => {
  const [, setState] = useAtom(todoStateAtom)

  return {
    create: (input) => runCommand(setState, (state) => TodoCommands.create(state, input)),

    update: (id, input) => runCommand(setState, (state) => TodoCommands.update(state, id, input)),

    remove: (id) => runCommand(setState, (state) => TodoCommands.remove(state, id)),

    toggle: (id) => runCommand(setState, (state) => TodoCommands.toggle(state, id)),

    complete: (id) => runCommand(setState, (state) => TodoCommands.complete(state, id)),

    archive: (id) => runCommand(setState, (state) => TodoCommands.archive(state, id)),

    restore: (id) => runCommand(setState, (state) => TodoCommands.restore(state, id)),

    clearCompleted: () => runSyncCommand(setState, TodoCommands.clearCompleted),

    clearArchived: () => runSyncCommand(setState, TodoCommands.clearArchived),

    setManyCompleted: (ids, completed) =>
      runSyncCommand(setState, (state) => TodoCommands.setManyCompleted(state, ids, completed)),

    createProject: (input) => runCommand(setState, (state) => ProjectCommands.create(state, input)),

    removeProject: (id) => runCommand(setState, (state) => ProjectCommands.remove(state, id)),

    createLabel: (input) => runCommand(setState, (state) => LabelCommands.create(state, input)),

    removeLabel: (id) => runCommand(setState, (state) => LabelCommands.remove(state, id)),

    setFilter: (filter) => runSyncCommand(setState, (state) => QueryCommands.setFilter(state, filter)),

    setSearch: (search) => runSyncCommand(setState, (state) => QueryCommands.setSearch(state, search)),

    setProject: (id) => runSyncCommand(setState, (state) => QueryCommands.setProject(state, id)),

    setLabel: (id) => runSyncCommand(setState, (state) => QueryCommands.setLabel(state, id)),

    setPriority: (priority) => runSyncCommand(setState, (state) => QueryCommands.setPriority(state, priority)),

    setSort: (sort) => runSyncCommand(setState, (state) => QueryCommands.setSort(state, sort)),

    resetQuery: () => runSyncCommand(setState, QueryCommands.reset),

    undo: () => runSyncCommand(setState, HistoryCommands.undo),

    redo: () => runSyncCommand(setState, HistoryCommands.redo)
  }
}

// ============================================================
// React selectors
// ============================================================

export const useTodos = () => useAtomValue(todosAtom)

export const useVisibleTodos = () => useAtomValue(visibleTodosAtom)

export const useTodoStats = () => useAtomValue(todoStatsAtom)

export const useProjects = () => useAtomValue(projectsAtom)

export const useLabels = () => useAtomValue(labelsAtom)

export const useTodoQuery = () => useAtomValue(queryAtom)

export const useCanUndo = () => useAtomValue(canUndoAtom)

export const useCanRedo = () => useAtomValue(canRedoAtom)

export const useActiveTodos = () => useAtomValue(activeTodosAtom)

export const useCompletedTodos = () => useAtomValue(completedTodosAtom)

export const useTodo = (id: TodoId) =>
  useAtomValue(todoStateAtom, (state) => state.todos.find((todo) => todo.id === id))
